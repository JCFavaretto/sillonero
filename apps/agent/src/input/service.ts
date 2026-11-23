import type { ClientMessage, CommandError, PadState } from "@proyecto-e/protocol";
import type { Clock, InputSystem, Logger, TimerHandle } from "../ports";
import { backspaceEvents, keyEvents, nextCursor, shortcutEvents, textUnits, toVirtual, VK, type MonitorGeom, type Point } from "./model";

// Servicio del Pad (docs/PLAN.md 8.5): traduce los mensajes del celu a entrada de Windows. Emparejado = usa todo; la única
// llave es la global del panel de la PC. Lo que NUNCA puede pasar: que una tecla o un botón queden apretados (D53).

export type PadClientMessage = Extract<ClientMessage, { type: `pad.${string}` }>;
export type PadOutcome = { ok: true } | { ok: false; reason: CommandError };

export interface PadService {
  state(): PadState;
  /** `"silent"` = no se contesta (pad.move y pad.scroll, D42). */
  handle(deviceId: string, msg: PadClientMessage): Promise<PadOutcome> | "silent";
  /** Una sesión autenticada de este celu (puede haber dos un instante si reconecta antes de que se cierre la vieja). */
  connect(deviceId: string): void;
  /** Se cerró una sesión del celu; cuando se cierra la última, suelta lo que ese celu tenía apretado. */
  disconnect(deviceId: string): void;
  /** La llave global del panel de la PC. */
  setEnabled(on: boolean): Promise<void>;
  /** "Soltar todo": suelta el botón izquierdo y Alt si quedaron apretados. */
  release(): Promise<void>;
  subscribe(cb: (state: PadState) => void): () => void;
  stop(): void;
}

export interface PadDeps {
  input: InputSystem;
  clock: Clock;
  log: Logger;
  config: { enabled(): boolean; setEnabled(on: boolean): Promise<void> };
}

/** Mensajes de flujo (mover y scroll): 150 por segundo por celu. */
const FLOW_PER_SECOND = 150;
/** Texto en vivo: 30 por segundo. */
const TYPE_PER_SECOND = 30;
/** Teclas, atajos, clics, Alt+Tab y soltar: 20 por segundo. */
const DISCRETE_PER_SECOND = 20;
/** Sin mensajes de quien lo apretó durante este tiempo, el agente suelta el botón o Alt (D53). */
const WATCHDOG_MS = 3_000;
const WATCHDOG_TICK_MS = 1_000;
/** Alt+Tab sin pasos durante este tiempo: elige solo (D52). */
const ALT_TAB_COMMIT_MS = 2_000;
/** Pasado este tiempo sin mover, se vuelve a leer el cursor (Jay pudo mover el mouse de verdad). */
const CURSOR_STALE_MS = 250;
/** Mientras algún celu mandó algo hace menos de esto, se mira si la ventana del frente es de administrador. */
const ACTIVE_MS = 5_000;
const ELEVATED_POLL_MS = 1_000;

type Bucket = { start: number; count: number };
type Kind = "flow" | "type" | "discrete";
const LIMITS: Record<Kind, number> = { flow: FLOW_PER_SECOND, type: TYPE_PER_SECOND, discrete: DISCRETE_PER_SECOND };

/** Tope de lo que puede esperar en la cola de escritura (D43): más que eso contesta busy en vez de seguir tecleando de a poco. */
const QUEUE_MAX = 64;

const BUSY: PadOutcome = { ok: false, reason: "busy" };
const FAILED: PadOutcome = { ok: false, reason: "failed" };
const BLOCKED: PadOutcome = { ok: false, reason: "input_blocked" };
const OK: PadOutcome = { ok: true };

export function createPadService(deps: PadDeps): PadService {
  const { input, clock, log, config } = deps;
  const listeners = new Set<(s: PadState) => void>();
  const buckets = new Map<string, Record<Kind, Bucket>>();
  const lastSeen = new Map<string, number>();

  /** Quién tiene apretado qué (D53). */
  const held: { left: string | null; alt: string | null } = { left: null, alt: null };
  let leftSeq = 0;
  /** `down` enviados al hijo que todavía no contestaron: si se pide soltar en ese lapso, el `up` sale igual. */
  let downInFlight = 0;
  /** Cambia cada vez que se apaga la llave o se suelta todo: lo que esperaba en la cola de antes no se escribe. */
  let epoch = 0;
  const deviceEpoch = new Map<string, number>();
  const connections = new Map<string, number>();
  let queued = 0;
  let pumpDone: Promise<void> | null = null;
  let elevated = false;
  let lastEmitted = "";
  let watchdog: TimerHandle | null = null;
  let poll: TimerHandle | null = null;
  let altTimer: TimerHandle | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let stopped = false;

  // — estado —
  function state(): PadState {
    return { available: input.available(), enabled: config.enabled(), elevated, holding: { left: held.left !== null, alt: held.alt !== null } };
  }
  function emit(): void {
    const s = state();
    const key = JSON.stringify(s);
    if (key === lastEmitted) return;
    lastEmitted = key;
    for (const cb of listeners) cb(s);
  }
  lastEmitted = JSON.stringify(state());

  // — ritmo —
  function allow(deviceId: string, kind: Kind): boolean {
    let b = buckets.get(deviceId);
    if (!b) {
      b = { flow: { start: 0, count: 0 }, type: { start: 0, count: 0 }, discrete: { start: 0, count: 0 } };
      buckets.set(deviceId, b);
    }
    const bucket = b[kind];
    const now = clock.now();
    if (now - bucket.start >= 1_000) {
      bucket.start = now;
      bucket.count = 0;
    }
    return ++bucket.count <= LIMITS[kind];
  }

  const devEpoch = (d: string) => deviceEpoch.get(d) ?? 0;

  /**
   * Orden estricto de lo que escribe (texto, teclas, Alt+Tab): una cosa a la vez. Tiene tope, y lo que esperaba cuando se apagó la
   * llave, se soltó todo o se fue el celu NO se escribe (solo lo "esencial" —soltar Alt— corre siempre).
   */
  function enqueue(deviceId: string, fn: () => Promise<PadOutcome>, essential = false): Promise<PadOutcome> {
    if (!essential && queued >= QUEUE_MAX) return Promise.resolve(BUSY);
    const myEpoch = epoch;
    const myDevice = devEpoch(deviceId);
    queued++;
    const task = async (): Promise<PadOutcome> => {
      try {
        if (!essential && (myEpoch !== epoch || myDevice !== devEpoch(deviceId) || !config.enabled())) return FAILED;
        return await fn();
      } finally {
        queued--;
      }
    };
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  }

  // — administrador (D55) —
  async function refreshElevated(): Promise<boolean> {
    try {
      elevated = await input.elevated();
    } catch (err) {
      // Si no se puede saber, se intenta igual: mejor que bloquear teclas sin motivo.
      log.warn("no se pudo saber si la ventana del frente es de administrador", { error: String(err) });
      elevated = false;
    }
    emit();
    return elevated;
  }

  function touch(deviceId: string): void {
    lastSeen.set(deviceId, clock.now());
    if (poll === null && !stopped) {
      poll = clock.setInterval(() => {
        const now = clock.now();
        for (const [d, at] of lastSeen) if (now - at > ACTIVE_MS) lastSeen.delete(d);
        if (lastSeen.size === 0) {
          if (poll !== null) clock.clear(poll);
          poll = null;
          return;
        }
        void refreshElevated();
      }, ELEVATED_POLL_MS);
    }
  }

  // — soltar todo (D53) —
  function syncWatchdog(): void {
    const holding = held.left !== null || held.alt !== null;
    if (holding && watchdog === null && !stopped) {
      watchdog = clock.setInterval(() => {
        const now = clock.now();
        for (const k of ["left", "alt"] as const) {
          const who = held[k];
          if (who !== null && now - (lastSeen.get(who) ?? 0) >= WATCHDOG_MS) {
            log.warn("se suelta lo apretado: el celu dejó de mandar mensajes", { deviceId: who, what: k });
            if (k === "left") void releaseLeft();
            else void releaseAlt();
          }
        }
      }, WATCHDOG_TICK_MS);
    } else if (!holding && watchdog !== null) {
      clock.clear(watchdog);
      watchdog = null;
    }
  }

  async function releaseLeft(): Promise<void> {
    leftSeq++;
    const who = held.left;
    if (who === null && downInFlight === 0) return;
    held.left = null;
    syncWatchdog();
    emit();
    try {
      await input.button("left", "up");
    } catch (err) {
      log.error("no se pudo soltar el botón izquierdo: se reintenta", { error: String(err) });
      // Windows lo puede tener apretado todavía: se sigue diciendo "apretado" y el vigilante reintenta cada segundo.
      if (held.left === null) {
        held.left = who ?? "";
        lastSeen.set(held.left, -WATCHDOG_MS); // el vigilante reintenta en el próximo tick
        syncWatchdog();
        emit();
      }
    }
  }

  function clearAltTimer(): void {
    if (altTimer !== null) clock.clear(altTimer);
    altTimer = null;
  }

  async function releaseAlt(): Promise<void> {
    clearAltTimer();
    const who = held.alt;
    if (who === null) return;
    held.alt = null;
    syncWatchdog();
    emit();
    try {
      await input.keys([[VK.ALT, true, false]]);
    } catch (err) {
      log.error("no se pudo soltar Alt: se reintenta", { error: String(err) });
      if (held.alt === null) {
        held.alt = who;
        lastSeen.set(who, -WATCHDOG_MS); // el vigilante reintenta en el próximo tick
        syncWatchdog();
        emit();
      }
    }
  }

  async function releaseAll(): Promise<void> {
    await Promise.all([releaseLeft(), releaseAlt()]);
  }

  // — mover —
  let pos: Point | null = null;
  let lastMoveAt = 0;
  let monitors: { list: MonitorGeom[]; virtual: { x: number; y: number; w: number; h: number } } | null = null;
  const pending = { dx: 0, dy: 0, n: 0 };
  let pumping = false;

  async function applyMove(dx: number, dy: number): Promise<void> {
    const now = clock.now();
    if (pos === null || monitors === null || now - lastMoveAt > CURSOR_STALE_MS) {
      pos = await input.cursor();
      monitors = await input.monitors();
    }
    lastMoveAt = now;
    if (dx === 0 && dy === 0) return;
    pos = nextCursor(pos, dx, dy, monitors.list);
    const n = toVirtual(pos.x, pos.y, monitors.virtual);
    input.moveAbs(n.x, n.y);
  }

  async function pump(): Promise<void> {
    pumping = true;
    try {
      while (pending.n > 0) {
        const { dx, dy } = pending;
        pending.dx = 0;
        pending.dy = 0;
        pending.n = 0;
        try {
          await applyMove(dx, dy);
        } catch (err) {
          pos = null; // lo próximo vuelve a leer el cursor
          log.warn("no se pudo mover el cursor", { error: String(err) });
        }
      }
    } finally {
      pumping = false;
    }
  }

  // — mensajes —

  async function writeKeys(events: Parameters<InputSystem["keys"]>[0]): Promise<PadOutcome> {
    try {
      await input.keys(events);
      return OK;
    } catch (err) {
      log.warn("no se pudieron mandar teclas", { error: String(err) });
      return FAILED;
    }
  }

  function typed(deviceId: string, msg: Extract<PadClientMessage, { type: "pad.type" }>): Promise<PadOutcome> {
    return enqueue(deviceId, async () => {
      if (await refreshElevated()) return BLOCKED;
      try {
        if (msg.payload.backspaces > 0) await input.keys(backspaceEvents(msg.payload.backspaces));
        if (msg.payload.text.length > 0) await input.text(textUnits(msg.payload.text));
        return OK;
      } catch (err) {
        log.warn("no se pudo escribir", { error: String(err) });
        return FAILED;
      }
    });
  }

  function keyed(deviceId: string, events: ReturnType<typeof keyEvents>): Promise<PadOutcome> {
    return enqueue(deviceId, async () => ((await refreshElevated()) ? BLOCKED : writeKeys(events)));
  }

  function armAltTimer(): void {
    clearAltTimer();
    altTimer = clock.setTimeout(() => {
      altTimer = null;
      void enqueue("", async () => (await releaseAlt(), OK), true);
    }, ALT_TAB_COMMIT_MS);
  }

  function altTab(deviceId: string, step: Extract<PadClientMessage, { type: "pad.altTab" }>["payload"]["step"]): Promise<PadOutcome> {
    const essential = step === "commit" || step === "cancel";
    return enqueue(deviceId, async () => {
      if (step === "commit") {
        await releaseAlt();
        return OK;
      }
      if (step === "cancel") {
        if (held.alt === null) return OK;
        await writeKeys(keyEvents("esc", []));
        await releaseAlt();
        return OK;
      }
      if (await refreshElevated()) return BLOCKED;
      if (held.alt === null) {
        try {
          await input.keys([[VK.ALT, false, false]]);
        } catch (err) {
          log.warn("no se pudo apretar Alt", { error: String(err) });
          return FAILED;
        }
        held.alt = deviceId;
        syncWatchdog();
        emit();
      }
      const res = await writeKeys(keyEvents("tab", step === "prev" ? ["shift"] : []));
      armAltTimer();
      return res;
    }, essential);
  }

  function button(deviceId: string, msg: Extract<PadClientMessage, { type: "pad.button" }>): Promise<PadOutcome> {
    const { button: which, action } = msg.payload;
    if (which === "right" || which === "middle") {
      // Derecho y rueda (clic del medio): solo clic; apretarlos no se soporta (no hay arrastre con ellos).
      if (action !== "click") return Promise.resolve({ ok: false, reason: "unsupported" });
      return input.button(which, "click").then(() => OK, () => FAILED);
    }
    // Izquierdo. Todo lo de acá sale síncrono hacia el hijo para que `down` y `up` lleguen en orden.
    if (action === "down") {
      const my = ++leftSeq;
      downInFlight++;
      return input.button("left", "down").then(
        () => {
          downInFlight--;
          if (my === leftSeq) {
            held.left = deviceId;
            syncWatchdog();
            emit();
          } else {
            // Se pidió soltar mientras el down estaba en vuelo: el down igual se aplicó, así que se suelta ahora.
            void input.button("left", "up").catch((e: unknown) => log.error("no se pudo soltar el botón izquierdo", { error: String(e) }));
          }
          return OK;
        },
        (err: unknown) => {
          downInFlight--;
          log.warn("no se pudo apretar el botón", { error: String(err) });
          return FAILED;
        },
      );
    }
    leftSeq++;
    const wasHeld = held.left !== null;
    held.left = null;
    syncWatchdog();
    if (wasHeld) emit();
    return input.button("left", action).then(() => OK, () => FAILED);
  }

  function handle(deviceId: string, msg: PadClientMessage): Promise<PadOutcome> | "silent" {
    const flow = msg.type === "pad.move" || msg.type === "pad.scroll";
    if (!config.enabled()) return flow ? "silent" : Promise.resolve({ ok: false, reason: "input_disabled" });
    if (!input.available()) return flow ? "silent" : Promise.resolve({ ok: false, reason: "input_unavailable" });
    const kind: Kind = flow ? "flow" : msg.type === "pad.type" ? "type" : "discrete";
    // Soltar (up, soltar todo, elegir o cancelar Alt+Tab) nunca se descarta por el ritmo: dejar algo apretado es peor que pasarse de rápido.
    const exempt =
      (msg.type === "pad.button" && msg.payload.action === "up") ||
      msg.type === "pad.release" ||
      (msg.type === "pad.altTab" && (msg.payload.step === "commit" || msg.payload.step === "cancel"));
    if (!exempt && !allow(deviceId, kind)) return flow ? "silent" : Promise.resolve(BUSY);
    touch(deviceId);

    switch (msg.type) {
      case "pad.move":
        pending.dx += msg.payload.dx;
        pending.dy += msg.payload.dy;
        pending.n++;
        if (!pumping) pumpDone = pump();
        return "silent";
      case "pad.scroll":
        if (msg.payload.dx !== 0 || msg.payload.dy !== 0) input.wheel(msg.payload.dx, msg.payload.dy);
        return "silent";
      case "pad.button":
        // Un clic o un down van a donde quedó el cursor: si hay un movimiento todavía aplicándose, espera a que termine.
        return pumping && pumpDone ? pumpDone.then(() => button(deviceId, msg)) : button(deviceId, msg);
      case "pad.key":
        return keyed(deviceId, keyEvents(msg.payload.key, msg.payload.mods));
      case "pad.shortcut":
        return keyed(deviceId, shortcutEvents(msg.payload.name));
      case "pad.type":
        return typed(deviceId, msg);
      case "pad.altTab":
        return altTab(deviceId, msg.payload.step);
      case "pad.release":
        epoch++; // lo que esperaba en la cola de antes ya no se escribe
        return releaseAll().then(() => OK);
    }
  }


  return {
    state,
    handle,
    connect(deviceId) {
      connections.set(deviceId, (connections.get(deviceId) ?? 0) + 1);
    },
    disconnect(deviceId) {
      const remaining = (connections.get(deviceId) ?? 0) - 1;
      if (remaining > 0) {
        connections.set(deviceId, remaining); // el celu ya reconectó: la sesión nueva sigue con lo suyo
        return;
      }
      connections.delete(deviceId);
      deviceEpoch.set(deviceId, devEpoch(deviceId) + 1); // lo suyo que esperaba en la cola no se escribe
      lastSeen.delete(deviceId);
      buckets.delete(deviceId);
      if (held.left === deviceId) void releaseLeft();
      if (held.alt === deviceId) void releaseAlt();
    },
    async release() {
      epoch++;
      await releaseAll();
    },
    async setEnabled(on) {
      await config.setEnabled(on);
      if (!on) {
        epoch++; // lo que esperaba en la cola no se escribe
        await releaseAll();
      }
      emit();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stop() {
      stopped = true;
      epoch++;
      void releaseAll();
      if (poll !== null) clock.clear(poll);
      poll = null;
      if (watchdog !== null) clock.clear(watchdog);
      watchdog = null;
      clearAltTimer();
      listeners.clear();
    },
  };
}
