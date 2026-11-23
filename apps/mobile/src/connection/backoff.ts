/**
 * Espera antes del reintento n (0 = el primero): 1, 2, 4, 8, 16, 30 s…
 * con un jitter de ±20 % para que varios celus no golpeen a la vez.
 * `random` se inyecta para poder testear.
 */
export function nextDelay(attempt: number, random: () => number = Math.random): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const base = Math.min(30_000, 1000 * 2 ** Math.min(n, 30));
  return Math.round(base * (0.8 + 0.4 * random()));
}
