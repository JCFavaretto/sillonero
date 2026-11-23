import { dirname } from "node:path";
import type { Clock, FileSystem, LogFields, Logger } from "./ports";

export const DEFAULT_MAX_LOG_BYTES = 1_048_576; // 1 MB

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;
// token, secret y código de emparejamiento. `code` suelto también, pero no
// `closeCode`/`errorCode`, que sí sirven para depurar.
const SENSITIVE_KEY = /token|secret|^code$|pair[-_]?code/i;

/** Copia el valor reemplazando lo sensible por "[redacted]". No muta el original. */
export function redact<T>(value: T): T {
  return redactValue(value, new WeakSet(), 0) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[too deep]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactValue(v, seen, depth + 1);
  }
  return out;
}

export interface FileLogger extends Logger {
  /** Espera a que se escriban las entradas pendientes. Nunca rechaza. */
  flush(): Promise<void>;
}

export interface LoggerOptions {
  fs: FileSystem;
  clock: Clock;
  path: string;
  maxBytes?: number;
}

/**
 * Logger de líneas JSON con rotación: al pasar `maxBytes` el archivo pasa a
 * `<path>.1` (pisando el anterior). Escribe en segundo plano y en orden; un
 * fallo de disco se descarta, el log nunca tira al agente.
 */
export function createLogger(opts: LoggerOptions): FileLogger {
  const { fs, clock, path } = opts;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
  let queue: Promise<void> = Promise.resolve();
  let dirReady = false;

  async function write(line: string): Promise<void> {
    if (!dirReady) {
      await fs.mkdirp(dirname(path));
      dirReady = true;
    }
    const current = (await fs.size(path)) ?? 0;
    if (current > 0 && current + Buffer.byteLength(line) > maxBytes) {
      await fs.rename(path, `${path}.1`);
    }
    await fs.appendFile(path, line);
  }

  function log(level: "info" | "warn" | "error", msg: string, fields?: LogFields): void {
    const entry: Record<string, unknown> = {
      t: new Date(clock.now()).toISOString(),
      level,
      msg,
    };
    if (fields) {
      const safe = redact(fields) as Record<string, unknown>;
      for (const [k, v] of Object.entries(safe)) {
        if (!(k in entry)) entry[k] = v; // t, level y msg no se pisan
      }
    }
    const line = JSON.stringify(entry) + "\n";
    queue = queue.then(() => write(line)).catch(() => undefined);
  }

  return {
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
    flush: () => queue,
  };
}

/**
 * Envuelve un logger para que un mensaje repetido (mismo nivel y texto) salga como máximo
 * una vez por ventana, con la cantidad de descartados. Frena que alguien de la red llene
 * el log (y empuje afuera lo importante) abriendo conexiones sin parar.
 */
export function createThrottledLogger(inner: Logger, clock: Clock, windowMs = 10_000): Logger {
  const seen = new Map<string, { last: number; suppressed: number }>();
  function emit(level: "info" | "warn" | "error", msg: string, fields?: LogFields): void {
    const key = `${level}:${msg}`;
    const now = clock.now();
    const entry = seen.get(key);
    if (entry && now - entry.last < windowMs) {
      entry.suppressed++;
      return;
    }
    const extra = entry && entry.suppressed > 0 ? { ...fields, suppressed: entry.suppressed } : fields;
    seen.set(key, { last: now, suppressed: 0 });
    inner[level](msg, extra);
  }
  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
