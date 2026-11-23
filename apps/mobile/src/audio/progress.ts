import type { MediaTimeline } from "@proyecto-e/protocol";

// La barra de reproducción (D97, docs/PLAN.md 8.8). La PC manda por dónde iba cuando armó el mensaje; el celu la avanza solo.
// Puro: el reloj lo pone quien llama.

/** Por dónde va ahora: lo que dijo la PC más el tiempo que pasó desde que llegó (por la velocidad), si está reproduciendo. */
export function positionAt(timeline: MediaTimeline, playing: boolean, elapsedMs: number): number {
  const advanced = playing ? timeline.positionMs + Math.max(0, elapsedMs) * timeline.rate : timeline.positionMs;
  return Math.min(timeline.durationMs, Math.max(0, Math.round(advanced)));
}

/** "1:22" o "1:02:03". */
export function clockText(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
