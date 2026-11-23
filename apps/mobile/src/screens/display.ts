import type { Monitor } from "@proyecto-e/protocol";

/** Cómo se llama una pantalla en la app: el apodo si lo tiene, si no el nombre del monitor. */
export const displayName = (m: Monitor): string => m.nickname ?? m.name;

/** "1920×1080"; las apagadas usan el tamaño de la última vez que estuvieron prendidas. */
export function resolutionText(m: Monitor): string | null {
  const r = m.resolution ?? m.bounds ?? m.lastBounds;
  if (!r) return null;
  const w = "w" in r ? r.w : 0;
  const h = "h" in r ? r.h : 0;
  return w > 0 && h > 0 ? `${w}×${h}` : null;
}
