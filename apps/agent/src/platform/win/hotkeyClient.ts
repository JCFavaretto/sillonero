import type { Clock, HotkeyRegistration, HotkeyResult, Hotkeys, Logger, TimerHandle } from "../../ports";

// Cliente del proceso hijo de ATAJOS (docs/PLAN.md 8.6, D67). Igual que `inputClient.ts` (hijo aparte, plazo por pedido,
// relanzado, 3 caídas en 60 s = no disponible) y con dos cosas más: el hijo manda avisos sin que nadie los pida (la tecla
// apretada) y, si se cae, el cliente lo relanza y vuelve a registrar lo último pedido (si no, los atajos se perderían callados).

export interface HotkeyRequest {
  id: number;
  op: "set";
  args: { keys: HotkeyRegistration[] };
}
export type HotkeyMessage =
  | { id: number; ok: true; result: HotkeyResult[] }
  | { id: number; ok: false; error: string }
  | { event: "pressed"; hotkey: number };

export interface HotkeyChild {
  send(msg: HotkeyRequest): void;
  kill(): void;
  onMessage(cb: (msg: HotkeyMessage) => void): void;
  onExit(cb: (reason: string) => void): void;
}

const DEFAULT_TIMEOUT_MS = 3_000;
const DEATH_WINDOW_MS = 60_000;
const MAX_DEATHS = 3;
const RELAUNCH_DELAY_MS = 1_000;

interface Pending {
  resolve(value: HotkeyResult[]): void;
  reject(err: Error): void;
  timer: TimerHandle;
}

export type HotkeyClient = Hotkeys;

export function createHotkeyClient(deps: { spawn(): HotkeyChild; clock: Clock; log: Logger; timeoutMs?: number }): HotkeyClient {
  const { clock, log } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<number, Pending>();
  let child: HotkeyChild | null = null;
  let nextId = 0;
  let stopped = false;
  let deaths: number[] = [];
  let wanted: HotkeyRegistration[] = [];
  let pressed: ((id: number) => void) | null = null;
  let relaunch: TimerHandle | null = null;
  let restored: (() => void) | null = null;

  function failAll(err: Error): void {
    for (const p of pending.values()) {
      clock.clear(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  function available(): boolean {
    if (stopped) return false;
    const now = clock.now();
    deaths = deaths.filter((d) => now - d <= DEATH_WINDOW_MS);
    return deaths.length < MAX_DEATHS;
  }

  function discard(reason: string): void {
    const dead = child;
    child = null;
    deaths.push(clock.now());
    log.warn("hotkey host failed", { reason });
    failAll(new Error(`hotkey host: ${reason}`));
    try {
      dead?.kill();
    } catch {
      // ya estaba muerto
    }
    scheduleRelaunch();
  }

  /** Si había atajos registrados, el hijo vuelve a levantarse y los registra otra vez. */
  function scheduleRelaunch(): void {
    if (stopped || wanted.length === 0 || relaunch !== null || !available()) return;
    relaunch = clock.setTimeout(() => {
      relaunch = null;
      if (stopped || child || wanted.length === 0 || !available()) return;
      call(wanted)
        .catch((err: unknown) => log.warn("hotkeys: could not register after relaunch", { error: String(err) }))
        .finally(() => restored?.());
    }, RELAUNCH_DELAY_MS);
  }

  function ensureChild(): HotkeyChild {
    if (child) return child;
    let c: HotkeyChild;
    try {
      c = deps.spawn();
    } catch (err) {
      deaths.push(clock.now());
      log.warn("hotkey host failed", { reason: `no se pudo lanzar: ${String(err)}` });
      throw new Error(`hotkey host: no se pudo lanzar (${String(err)})`);
    }
    child = c;
    nextId = 0;
    c.onMessage((msg) => {
      if (child !== c) return;
      if ("event" in msg) {
        if (msg.event === "pressed") pressed?.(msg.hotkey);
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clock.clear(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    c.onExit((reason) => {
      if (child !== c) return;
      discard(`exited (${reason})`);
    });
    return c;
  }

  function call(keys: HotkeyRegistration[]): Promise<HotkeyResult[]> {
    if (stopped) return Promise.reject(new Error("hotkey host stopped"));
    if (!available()) return Promise.reject(new Error("hotkey host no disponible (se cayó 3 veces en un minuto)"));
    let c: HotkeyChild;
    try {
      c = ensureChild();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const id = ++nextId;
    return new Promise<HotkeyResult[]>((resolve, reject) => {
      const timer = clock.setTimeout(() => {
        if (pending.has(id)) discard(`timeout (${timeoutMs} ms sin respuesta a set)`);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        c.send({ id, op: "set", args: { keys } });
      } catch (err) {
        discard(`no se pudo enviar: ${String(err)}`);
      }
    });
  }

  return {
    available,
    set(keys) {
      wanted = keys.map((k) => ({ ...k }));
      // Sin hijo y nada que registrar: no hay nada que soltar, no se lanza un proceso para eso.
      if (keys.length === 0 && !child) return Promise.resolve([]);
      return call(wanted);
    },
    onPressed(cb) {
      pressed = cb;
    },
    onRestored(cb) {
      restored = cb;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      wanted = [];
      if (relaunch !== null) clock.clear(relaunch);
      relaunch = null;
      const c = child;
      child = null;
      failAll(new Error("hotkey host stopped"));
      try {
        c?.kill();
      } catch {
        // ya estaba muerto
      }
    },
  };
}
