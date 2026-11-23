import type { Monitor } from "@proyecto-e/protocol";

/** Una pantalla ya ubicada dentro de la caja del mapa (en dp). */
export interface MapItem {
  id: string;
  index: number | null;
  primary: boolean;
  /** Apagada: se dibuja en gris punteado, en el lugar donde estaba. */
  off: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

const PAD = 8;
/** Espacio abajo para el apodo de cada pantalla. */
const LABEL_SPACE = 16;

/**
 * Dibuja las pantallas a escala dentro de `box`, centradas y con la proporción real.
 * Las apagadas usan `lastBounds`; las que no tienen ninguna posición conocida no se dibujan
 * (siguen en la lista). Función pura: no conoce React ni Windows.
 */
export function mapLayout(monitors: Monitor[], box: { width: number; height: number }): MapItem[] {
  if (!(box.width > 0) || !(box.height > 0)) return [];

  const placed = monitors.flatMap((m) => {
    const rect = m.enabled ? (m.bounds ?? m.lastBounds) : (m.lastBounds ?? m.bounds);
    return rect && rect.w > 0 && rect.h > 0 ? [{ m, rect }] : [];
  });
  if (placed.length === 0) return [];

  const minX = Math.min(...placed.map((p) => p.rect.x));
  const minY = Math.min(...placed.map((p) => p.rect.y));
  const maxX = Math.max(...placed.map((p) => p.rect.x + p.rect.w));
  const maxY = Math.max(...placed.map((p) => p.rect.y + p.rect.h));
  const unionW = maxX - minX;
  const unionH = maxY - minY;

  const availW = Math.max(1, box.width - 2 * PAD);
  const availH = Math.max(1, box.height - 2 * PAD - LABEL_SPACE);
  const scale = Math.min(availW / unionW, availH / unionH);
  const offsetX = (box.width - unionW * scale) / 2;
  const offsetY = PAD + (availH - unionH * scale) / 2;

  return placed.map(({ m, rect }) => ({
    id: m.id,
    index: m.index,
    primary: m.primary,
    off: !m.enabled,
    left: offsetX + (rect.x - minX) * scale,
    top: offsetY + (rect.y - minY) * scale,
    width: rect.w * scale,
    height: rect.h * scale,
  }));
}
