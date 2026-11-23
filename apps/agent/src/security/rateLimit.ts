import { RATE_LIMIT } from "@proyecto-e/protocol";
import type { Clock } from "../ports";

export interface AttemptResult {
  allowed: boolean;
  /** Solo si no está permitido: cuánto falta para que se levante el bloqueo. */
  retryAfterMs?: number;
}

export interface RateLimiter {
  /** Registra un intento de la IP. El que pasa el límite bloquea a la IP. */
  attempt(ip: string): AttemptResult;
  /** ¿Está bloqueada ahora? No cuenta como intento. */
  isBlocked(ip: string): boolean;
  /** Cantidad de IPs que se están siguiendo (para tests). */
  size(): number;
}

export interface RateLimitOptions {
  clock: Clock;
  attempts?: number;
  windowMs?: number;
  blockMs?: number;
}

type Entry = { hits: number[]; blockedUntil: number | null };

/**
 * Ventana deslizante por IP: más de `attempts` intentos en `windowMs` bloquea
 * `blockMs`. Mientras dura el bloqueo no se extiende; al terminar, cuenta en cero.
 */
export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const { clock } = opts;
  const attempts = opts.attempts ?? RATE_LIMIT.attempts;
  const windowMs = opts.windowMs ?? RATE_LIMIT.windowMs;
  const blockMs = opts.blockMs ?? RATE_LIMIT.blockMs;
  const entries = new Map<string, Entry>();

  function prune(now: number): void {
    for (const [ip, e] of entries) {
      if (e.blockedUntil !== null) {
        if (now >= e.blockedUntil) entries.delete(ip);
      } else if (e.hits.every((t) => now - t >= windowMs)) {
        entries.delete(ip);
      }
    }
  }

  return {
    attempt(ip) {
      const now = clock.now();
      prune(now);
      const entry = entries.get(ip) ?? { hits: [], blockedUntil: null };
      if (entry.blockedUntil !== null) {
        return { allowed: false, retryAfterMs: entry.blockedUntil - now };
      }
      entry.hits = entry.hits.filter((t) => now - t < windowMs);
      entry.hits.push(now);
      if (entry.hits.length > attempts) {
        entry.hits = [];
        entry.blockedUntil = now + blockMs;
        entries.set(ip, entry);
        return { allowed: false, retryAfterMs: blockMs };
      }
      entries.set(ip, entry);
      return { allowed: true };
    },

    isBlocked(ip) {
      const e = entries.get(ip);
      return e?.blockedUntil != null && clock.now() < e.blockedUntil;
    },

    size: () => entries.size,
  };
}
