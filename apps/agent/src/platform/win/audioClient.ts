import type { AudioReady, AudioSystem, Clock, Logger, RawAudio, TimerHandle } from "../../ports";

// Cliente del hijo de audio (docs/PLAN.md 8.4.4, D27): un PowerShell que atiende de a un pedido por vez, un JSON por línea.
// Igual que el hijo de koffi de B2: si se cuelga o se cae, el agente sigue con los celus conectados y lo relanza; si se cae
// 3 veces en un minuto, Audio queda "no disponible" hasta que pase el minuto.

/** Lo mínimo del proceso hijo (PowerShell real en producción, uno falso en los tests). */
export interface AudioChild {
  write(line: string): void;
  kill(): void;
  /** Una línea completa de stdout (sin el salto de línea). */
  onLine(cb: (line: string) => void): void;
  onExit(cb: (reason: string) => void): void;
}

export interface AudioClient extends AudioSystem {
  /** Mata al hijo y rechaza lo pendiente. Después de esto todo pedido falla. */
  stop(): void;
}

const CALL_TIMEOUT_MS = 5_000;
/** Compilar el C# y arrancar PowerShell tarda ~1 s; con el antivirus mirando, bastante más. */
const READY_TIMEOUT_MS = 20_000;
const DEATH_WINDOW_MS = 60_000;
const MAX_DEATHS = 3;
const MAX_PIDS = 64;
const MAX_ID = 300;
/** Pedidos esperando turno: pasado esto se contesta "busy" (un celu pegado no puede apilar cientos de pedidos). */
const MAX_QUEUE = 32;

type Op = "snapshot" | "setOutputVolume" | "setOutputMute" | "setAppVolume" | "setAppMute" | "setDefault" | "route" | "mediaControl" | "art" | "playSound";
const MEDIA_KEYS: ReadonlySet<string> = new Set(["prev", "playPause", "next"]);

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: TimerHandle;
}

const invalid = (what: string) => new Error(`audio: argumento inválido (${what})`);
const okId = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= MAX_ID;
const okIndex = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 16;
/** Un archivo de sonido del agente: una carpeta `sounds` y un nombre `s_<id>.<ext>` (nunca una ruta cualquiera). */
const okSoundFile = (s: unknown): s is string => typeof s === "string" && s.length <= 400 && /^[A-Za-z]:[\\/]/.test(s) && /[\\/]sounds[\\/]s_[A-Za-z0-9_-]{6,40}\.(mp3|wav|ogg|m4a)$/.test(s) && !/\.\./.test(s) && !/[\\/]{2}/.test(s.slice(3));
const okWinId = (s: unknown): s is string => typeof s === "string" && /^\{[0-9a-f.]+\}\.\{[0-9a-f-]{36}\}$/i.test(s);
const okScalar = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
const okPids = (p: unknown): p is number[] => Array.isArray(p) && p.length >= 1 && p.length <= MAX_PIDS && p.every((x) => Number.isInteger(x) && (x as number) > 0);

export function createAudioClient(deps: {
  spawn(): AudioChild;
  clock: Clock;
  log: Logger;
  timeoutMs?: number;
  readyTimeoutMs?: number;
}): AudioClient {
  const { clock, log } = deps;
  const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS;
  const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const pending = new Map<number, Pending>();
  // El hijo atiende de a un pedido por vez: los demás esperan acá, y el plazo de cada uno corre desde que se le escribe (no desde que se encola).
  let waiting: { run(): void; reject(err: Error): void }[] = [];
  let inFlight = false;
  let child: AudioChild | null = null;
  let readyP: Promise<AudioReady> | null = null;
  let rejectReady: ((e: Error) => void) | null = null;
  let readyTimer: TimerHandle | null = null;
  let nextId = 0;
  let stopped = false;
  let deaths: number[] = [];

  function next(): void {
    inFlight = false;
    const w = waiting.shift();
    if (w) w.run();
  }

  function failAll(err: Error): void {
    for (const p of pending.values()) {
      clock.clear(p.timer);
      p.reject(err);
    }
    pending.clear();
    for (const w of waiting) w.reject(err);
    waiting = [];
    inFlight = false;
    if (readyTimer) clock.clear(readyTimer);
    readyTimer = null;
    rejectReady?.(err);
    rejectReady = null;
  }

  /** Descarta al hijo actual (colgado o roto): lo mata y rechaza lo que esperaba. */
  function discard(reason: string): void {
    const dead = child;
    child = null;
    readyP = null;
    deaths.push(clock.now());
    log.warn("audio host failed", { reason });
    failAll(new Error(`audio host: ${reason}`));
    try {
      dead?.kill();
    } catch {
      // ya estaba muerto
    }
  }

  function checkAvailable(): void {
    if (stopped) throw new Error("audio host stopped (detenido)");
    const now = clock.now();
    deaths = deaths.filter((d) => now - d <= DEATH_WINDOW_MS);
    if (deaths.length >= MAX_DEATHS) throw new Error("audio no disponible (el hijo se cayó 3 veces en un minuto)");
  }

  function ensureChild(): { c: AudioChild; ready: Promise<AudioReady> } {
    if (child && readyP) return { c: child, ready: readyP };
    let c: AudioChild;
    try {
      c = deps.spawn();
    } catch (err) {
      deaths.push(clock.now());
      log.warn("audio host failed", { reason: `no se pudo lanzar: ${String(err)}` });
      throw err;
    }
    child = c;
    nextId = 0; // los ids son por hijo: las respuestas de uno descartado ya se ignoran
    const ready = new Promise<AudioReady>((resolve, reject) => {
      rejectReady = reject;
      readyTimer = clock.setTimeout(() => {
        if (child === c) discard(`no avisó que estaba listo en ${readyTimeoutMs} ms`);
      }, readyTimeoutMs);
      c.onLine((line) => {
        if (child !== c) return; // línea tardía de un hijo ya descartado
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          if (line.trim() !== "") log.warn("audio host: línea que no es JSON", { line: line.slice(0, 120) });
          return;
        }
        const m = msg as { ready?: unknown; id?: unknown; ok?: unknown; result?: unknown; error?: unknown; defaultOutput?: unknown; appRouting?: unknown } | null;
        if (m && m.ready === true) {
          if (readyTimer) clock.clear(readyTimer);
          readyTimer = null;
          rejectReady = null;
          const info = m as { build?: unknown; factory?: unknown; media?: unknown };
          const build = typeof info.build === "number" ? info.build : null;
          log.info("audio host ready", { build, factory: info.factory, media: info.media, defaultOutput: m.defaultOutput === true, appRouting: m.appRouting === true });
          // Las dos funciones no documentadas de Windows se verificaron en Windows 10 (19041–19045). En otro build siguen prendidas, pero queda el aviso
          // y los interruptores del panel: si una actualización cambió la interfaz interna, se apagan a mano sin tocar código.
          if (m.appRouting === true && (build === null || build < 19041 || build > 19045)) log.warn("audio: build de Windows sin verificar para mandar apps a otra salida", { build });
          resolve({ defaultOutput: m.defaultOutput === true, appRouting: m.appRouting === true });
          return;
        }
        if (!m || typeof m.id !== "number") {
          log.warn("audio host: línea que no es una respuesta", { line: line.slice(0, 120) });
          return;
        }
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clock.clear(p.timer);
        if (m.ok === true) p.resolve(m.result);
        else p.reject(new Error(typeof m.error === "string" ? m.error : "failed"));
        next();
      });
      c.onExit((reason) => {
        if (child === c) discard(`exited (${reason})`);
      });
    });
    ready.catch(() => undefined); // si nadie lo espera, que no sea un rechazo sin manejar
    readyP = ready;
    return { c, ready };
  }

  async function call<T>(op: Op, args?: Record<string, unknown>): Promise<T> {
    checkAvailable();
    const { c, ready } = ensureChild();
    await ready;
    if (child !== c) throw new Error("audio host: se reinició");
    if (waiting.length >= MAX_QUEUE) throw new Error("audio busy (demasiados pedidos esperando)");
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        if (child !== c) {
          reject(new Error("audio host: se reinició"));
          return next();
        }
        const id = ++nextId;
        inFlight = true;
        const timer = clock.setTimeout(() => {
          if (pending.has(id)) discard(`timeout (${timeoutMs} ms sin respuesta a ${op})`);
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        try {
          c.write(JSON.stringify(args ? { id, op, args } : { id, op }));
        } catch (err) {
          discard(`no se pudo enviar: ${String(err)}`);
        }
      };
      if (inFlight) waiting.push({ run, reject });
      else run();
    });
  }

  const guard = <T>(ok: boolean, what: string, run: () => Promise<T>): Promise<T> => (ok ? run() : Promise.reject(invalid(what)));

  return {
    async ready() {
      checkAvailable();
      return ensureChild().ready;
    },
    snapshot: () => call<RawAudio>("snapshot"),
    setOutputVolume: (winId, scalar) => guard(okId(winId) && okScalar(scalar), "volumen de salida", async () => void (await call<null>("setOutputVolume", { winId, scalar }))),
    setOutputMute: (winId, muted) => guard(okId(winId) && typeof muted === "boolean", "silencio de salida", async () => void (await call<null>("setOutputMute", { winId, muted }))),
    setAppVolume: (pids, scalar) => guard(okPids(pids) && okScalar(scalar), "volumen de app", async () => void (await call<null>("setAppVolume", { pids, scalar }))),
    setAppMute: (pids, muted) => guard(okPids(pids) && typeof muted === "boolean", "silencio de app", async () => void (await call<null>("setAppMute", { pids, muted }))),
    setDefault: (winId) => guard(okId(winId), "salida", async () => void (await call<null>("setDefault", { winId }))),
    route: (pids, winId) => guard(okPids(pids) && (winId === null || okId(winId)), "ruta de app", async () => void (await call<null>("route", { pids, winId }))),
    mediaControl: (aumid, key, index) => guard(okId(aumid) && MEDIA_KEYS.has(key) && okIndex(index), "control de media", async () => void (await call<null>("mediaControl", { aumid, key, index }))),
    playSound: (file, winId, volume) => guard(okSoundFile(file) && okWinId(winId) && okScalar(volume), "sonido", async () => void (await call<null>("playSound", { file, winId, volume }))),
    art: (aumid, index) => guard(okId(aumid) && okIndex(index), "carátula", () => call<string | null>("art", { aumid, index })),
    stop() {
      if (stopped) return;
      stopped = true;
      const c = child;
      child = null;
      readyP = null;
      failAll(new Error("audio host stopped (detenido)"));
      try {
        c?.kill();
      } catch {
        // ya estaba muerto
      }
    },
  };
}
