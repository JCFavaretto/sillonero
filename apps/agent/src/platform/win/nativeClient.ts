import type { Clock, Displays, Logger, MediaKeys, RawDisplay, RawWindow, RawWindowFull, TimerHandle, Windows } from "../../ports";

// Cliente del proceso hijo que habla con Windows (docs/PLAN.md D10). Un struct mal declarado en koffi
// no tira una excepción: mata el proceso. Por eso las llamadas viven en un hijo y, si se cae, el agente
// sigue con los celus conectados y lo relanza.

export type HostOp =
  | "displays.list"
  | "displays.setEnabled"
  | "displays.arrange"
  | "windows.foreground"
  | "windows.place"
  | "windows.list"
  | "windows.focus"
  | "windows.show"
  | "windows.close"
  | "windows.fullscreen"
  | "input.mediaKey";
export interface HostRequest {
  id: number;
  op: HostOp;
  /** `displays.setEnabled` o `windows.place`. */
  args?:
    | { devicePath: string; on: boolean; restoreAt?: { x: number; y: number; w: number; h: number } }
    | { items: { devicePath: string; x: number; y: number }[] }
    | { handle: string; rect: { x: number; y: number; w: number; h: number }; maximize: boolean }
    | { handle: string; cmd: "minimize" | "maximize" | "restore" }
    | { handle: string; monitor: { x: number; y: number; w: number; h: number } }
    | { handle: string }
    | { vk: number };
}
export type HostReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Lo mínimo del proceso hijo (`child_process.fork` en producción, uno falso en los tests). */
export interface HostChild {
  send(msg: HostRequest): void;
  kill(): void;
  onMessage(cb: (msg: HostReply) => void): void;
  onExit(cb: (reason: string) => void): void;
}

export interface NativeClient {
  displays: Displays;
  windows: Windows;
  /** ⏮ ⏯ ⏭ del teclado: respaldo cuando no hay ninguna sesión de media (D35). */
  mediaKeys: MediaKeys;
  /** Mata al hijo y rechaza lo pendiente. Después de esto todo pedido falla. */
  stop(): void;
}

/** Códigos virtuales de las teclas de Media: VK_MEDIA_PREV_TRACK, VK_MEDIA_PLAY_PAUSE y VK_MEDIA_NEXT_TRACK. */
const MEDIA_VK: Record<string, number> = { prev: 0xb1, playPause: 0xb3, next: 0xb0 };
const DEFAULT_TIMEOUT_MS = 5_000;
/** Prender o apagar una pantalla tarda más (Windows reacomoda todo): ~1–2 s, y damos mucho margen. */
const CHANGE_TIMEOUT_MS = 20_000;
const DEATH_WINDOW_MS = 60_000;
const MAX_DEATHS = 3;

interface Pending {
  op: HostOp;
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: TimerHandle;
}

export function createNativeClient(deps: {
  spawn(): HostChild;
  clock: Clock;
  log: Logger;
  timeoutMs?: number;
}): NativeClient {
  const { clock, log } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<number, Pending>();
  let child: HostChild | null = null;
  let nextId = 0;
  let stopped = false;
  let deaths: number[] = [];

  function failAll(err: Error): void {
    for (const p of pending.values()) {
      clock.clear(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  function recordDeath(reason: string): void {
    deaths.push(clock.now());
    log.warn("native host failed", { reason });
  }

  /** Descarta al hijo actual (colgado o roto): lo mata y rechaza lo que esperaba. */
  function discard(reason: string): void {
    const dead = child;
    child = null;
    recordDeath(reason);
    failAll(new Error(`native host: ${reason}`));
    try {
      dead?.kill();
    } catch {
      // ya estaba muerto
    }
  }

  function ensureChild(): HostChild {
    if (child) return child;
    let c: HostChild;
    try {
      c = deps.spawn();
    } catch (err) {
      recordDeath(`no se pudo lanzar: ${String(err)}`);
      throw err;
    }
    child = c;
    nextId = 0; // los ids son por hijo: las respuestas de uno descartado ya se ignoran
    c.onMessage((reply) => {
      if (child !== c) return; // respuesta tardía de un hijo ya descartado
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

  function call<T>(op: HostOp, args?: HostRequest["args"]): Promise<T> {
    if (stopped) return Promise.reject(new Error("native host stopped"));
    const now = clock.now();
    deaths = deaths.filter((d) => now - d <= DEATH_WINDOW_MS);
    if (deaths.length >= MAX_DEATHS) return Promise.reject(new Error("native host unavailable (se cayó 3 veces en un minuto)"));

    let c: HostChild;
    try {
      c = ensureChild();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      // El hijo atiende de a un pedido por vez: una lectura que queda esperando detrás de un cambio de pantalla
      // (que puede tardar) no debe vencer antes y matar al hijo a mitad de SetDisplayConfig.
      const behindChange = [...pending.values()].some((p) => p.op === "displays.setEnabled" || p.op === "displays.arrange");
      const isChange = op === "displays.setEnabled" || op === "displays.arrange";
      const limit = isChange || behindChange ? Math.max(timeoutMs, CHANGE_TIMEOUT_MS) : timeoutMs;
      const timer = clock.setTimeout(() => {
        if (!pending.has(id)) return;
        discard(`timeout (${limit} ms sin respuesta a ${op})`);
      }, limit);
      pending.set(id, { op, resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        c.send(args ? { id, op, args } : { id, op });
      } catch (err) {
        discard(`no se pudo enviar: ${String(err)}`);
      }
    });
  }

  return {
    displays: {
      list: () => call<RawDisplay[]>("displays.list"),
      setEnabled: async (devicePath, on, restoreAt) =>
        void (await call<null>("displays.setEnabled", restoreAt ? { devicePath, on, restoreAt } : { devicePath, on })),
      arrange: async (items) => void (await call<null>("displays.arrange", { items })),
    },
    windows: {
      foreground: () => call<RawWindow | null>("windows.foreground"),
      place: async (handle, rect, maximize) => void (await call<null>("windows.place", { handle, rect, maximize })),
      list: () => call<RawWindowFull[]>("windows.list"),
      focus: async (handle) => void (await call<null>("windows.focus", { handle })),
      show: async (handle, cmd) => void (await call<null>("windows.show", { handle, cmd })),
      close: async (handle) => void (await call<null>("windows.close", { handle })),
      toggleFullscreen: async (handle, monitor) => void (await call<null>("windows.fullscreen", { handle, monitor })),
    },
    mediaKeys: {
      press: async (key) => {
        const vk = MEDIA_VK[key];
        if (vk === undefined) throw new Error(`tecla de media inválida: ${String(key)}`);
        await call<null>("input.mediaKey", { vk });
      },
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const c = child;
      child = null;
      failAll(new Error("native host stopped"));
      try {
        c?.kill();
      } catch {
        // ya estaba muerto
      }
    },
  };
}
