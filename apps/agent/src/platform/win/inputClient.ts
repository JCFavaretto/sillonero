import type { Clock, InputKeyEvent, InputMonitors, InputSystem, Logger, TimerHandle } from "../../ports";

// Cliente del proceso hijo de ENTRADA (docs/PLAN.md D56). Igual que `nativeClient.ts` (hijo aparte, plazo por pedido,
// relanzado, 3 caídas en 60 s = no disponible) y con una cosa más: `moveAbs` y `wheel` no esperan respuesta y se fusionan
// mientras hay uno en vuelo, así 60 movimientos por segundo nunca hacen cola.

export type InputOp = "cursor" | "monitors" | "moveAbs" | "wheel" | "button" | "keys" | "text" | "elevated";
export interface InputRequest {
  id: number;
  op: InputOp;
  args?: Record<string, unknown>;
}
export type InputReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export interface InputChild {
  send(msg: InputRequest): void;
  kill(): void;
  onMessage(cb: (msg: InputReply) => void): void;
  onExit(cb: (reason: string) => void): void;
}

const DEFAULT_TIMEOUT_MS = 3_000;
const DEATH_WINDOW_MS = 60_000;
const MAX_DEATHS = 3;
const WHEEL_MAX = 1_200;
/** Lo máximo que se acumula mientras hay un scroll en vuelo: más que eso seguiría scrolleando mucho después de que el celu corte. */
const WHEEL_QUEUE_MAX = 12_000;

interface Pending {
  op: InputOp;
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: TimerHandle;
}

export interface InputClient extends InputSystem {
  /** Mata al hijo y rechaza lo pendiente. Después de esto todo pedido falla. */
  stop(): void;
}

export function createInputClient(deps: { spawn(): InputChild; clock: Clock; log: Logger; timeoutMs?: number }): InputClient {
  const { clock, log } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<number, Pending>();
  let child: InputChild | null = null;
  let nextId = 0;
  let stopped = false;
  let deaths: number[] = [];

  // Fusión de lo que no espera respuesta.
  let moveInFlight = false;
  let queuedMove: { nx: number; ny: number } | null = null;
  let wheelInFlight = false;
  let queuedWheel = { dx: 0, dy: 0 };

  function failAll(err: Error): void {
    for (const p of pending.values()) {
      clock.clear(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  function recordDeath(reason: string): void {
    deaths.push(clock.now());
    log.warn("input host failed", { reason });
  }

  function discard(reason: string): void {
    const dead = child;
    child = null;
    recordDeath(reason);
    failAll(new Error(`input host: ${reason}`));
    // lo que estaba en vuelo ya no va a contestar: se libera la fusión
    moveInFlight = false;
    wheelInFlight = false;
    queuedMove = null;
    queuedWheel = { dx: 0, dy: 0 };
    try {
      dead?.kill();
    } catch {
      // ya estaba muerto
    }
  }

  function ensureChild(): InputChild {
    if (child) return child;
    let c: InputChild;
    try {
      c = deps.spawn();
    } catch (err) {
      recordDeath(`no se pudo lanzar: ${String(err)}`);
      throw new Error(`input host: no se pudo lanzar (${String(err)})`);
    }
    child = c;
    nextId = 0;
    c.onMessage((reply) => {
      if (child !== c) return;
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      clock.clear(p.timer);
      if (reply.ok) p.resolve(reply.result);
      else p.reject(new Error(reply.error));
    });
    c.onExit((reason) => {
      if (child !== c) return;
      discard(`exited (${reason})`);
    });
    return c;
  }

  function available(): boolean {
    if (stopped) return false;
    const now = clock.now();
    deaths = deaths.filter((d) => now - d <= DEATH_WINDOW_MS);
    return deaths.length < MAX_DEATHS;
  }

  function call<T>(op: InputOp, args?: Record<string, unknown>): Promise<T> {
    if (stopped) return Promise.reject(new Error("input host stopped"));
    if (!available()) return Promise.reject(new Error("input host no disponible (se cayó 3 veces en un minuto)"));
    let c: InputChild;
    try {
      c = ensureChild();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = clock.setTimeout(() => {
        if (!pending.has(id)) return;
        discard(`timeout (${timeoutMs} ms sin respuesta a ${op})`);
      }, timeoutMs);
      pending.set(id, { op, resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        c.send(args ? { id, op, args } : { id, op });
      } catch (err) {
        discard(`no se pudo enviar: ${String(err)}`);
      }
    });
  }

  function sendMove(nx: number, ny: number): void {
    moveInFlight = true;
    call<null>("moveAbs", { nx, ny })
      .catch((err: unknown) => log.warn("no se pudo mover el cursor", { error: String(err) }))
      .finally(() => {
        moveInFlight = false;
        const next = queuedMove;
        queuedMove = null;
        if (next && !stopped) sendMove(next.nx, next.ny);
      });
  }

  function sendWheel(dx: number, dy: number): void {
    wheelInFlight = true;
    call<null>("wheel", { dx, dy })
      .catch((err: unknown) => log.warn("no se pudo hacer scroll", { error: String(err) }))
      .finally(() => {
        wheelInFlight = false;
        const take = (v: number) => Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, v));
        const dx2 = take(queuedWheel.dx);
        const dy2 = take(queuedWheel.dy);
        queuedWheel = { dx: queuedWheel.dx - dx2, dy: queuedWheel.dy - dy2 };
        if ((dx2 !== 0 || dy2 !== 0) && !stopped) sendWheel(dx2, dy2);
      });
  }

  return {
    available,
    cursor: () => call<{ x: number; y: number }>("cursor"),
    monitors: () => call<InputMonitors>("monitors"),
    moveAbs(nx, ny) {
      if (moveInFlight) queuedMove = { nx, ny };
      else sendMove(nx, ny);
    },
    wheel(dx, dy) {
      if (wheelInFlight) {
        const cap = (v: number) => Math.max(-WHEEL_QUEUE_MAX, Math.min(WHEEL_QUEUE_MAX, v));
        queuedWheel = { dx: cap(queuedWheel.dx + dx), dy: cap(queuedWheel.dy + dy) };
      } else {
        sendWheel(dx, dy);
      }
    },
    button: async (button, action) => void (await call<null>("button", { button, action })),
    keys: async (events: readonly InputKeyEvent[]) => void (await call<null>("keys", { events })),
    text: async (units) => void (await call<null>("text", { units })),
    elevated: () => call<boolean>("elevated"),
    stop() {
      if (stopped) return;
      stopped = true;
      const c = child;
      child = null;
      failAll(new Error("input host stopped"));
      try {
        c?.kill();
      } catch {
        // ya estaba muerto
      }
    },
  };
}
