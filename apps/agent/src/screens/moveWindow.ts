import type { RawRect, RawWindow } from "../ports";

// Dónde queda una ventana al mandarla a otra pantalla. Port de `MoverVentana` del prototipo AutoHotkey
// (docs/historia/prototipo-ahk/PanelMonitores.ahk). Puro: no toca Windows.

export interface MovePlan {
  rect: RawRect;
  /** Después de moverla hay que volver a maximizarla. */
  maximize: boolean;
}

/** Una maximizada o minimizada no tiene una posición "normal" que conservar: se centra a este tamaño. */
const CENTERED_FRACTION = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function centered(area: RawRect, w: number, h: number): RawRect {
  return { x: Math.round(area.x + (area.w - w) / 2), y: Math.round(area.y + (area.h - h) / 2), w, h };
}

/**
 * - `fromArea`: el área de trabajo de la pantalla donde está la ventana, o `null` si está fuera de toda pantalla.
 * - `toArea`: la del destino (sin la barra de tareas).
 * - `sameMonitor`: ya está en la pantalla de destino.
 * Devuelve `null` si no hay nada que hacer.
 */
export function planMove(win: Pick<RawWindow, "rect" | "state">, fromArea: RawRect | null, toArea: RawRect, sameMonitor: boolean): MovePlan | null {
  if (toArea.w <= 0 || toArea.h <= 0) return null;
  if (sameMonitor && win.state !== "minimized") return null;

  if (win.state !== "normal") {
    const w = Math.round(toArea.w * CENTERED_FRACTION);
    const h = Math.round(toArea.h * CENTERED_FRACTION);
    return { rect: centered(toArea, w, h), maximize: win.state === "maximized" };
  }

  const w = Math.min(win.rect.w, toArea.w);
  const h = Math.min(win.rect.h, toArea.h);
  if (!fromArea || fromArea.w <= 0 || fromArea.h <= 0) return { rect: centered(toArea, w, h), maximize: false };

  // Misma posición relativa dentro de la pantalla, y siempre adentro del destino.
  const fx = (win.rect.x - fromArea.x) / fromArea.w;
  const fy = (win.rect.y - fromArea.y) / fromArea.h;
  const x = clamp(Math.round(toArea.x + fx * toArea.w), toArea.x, toArea.x + toArea.w - w);
  const y = clamp(Math.round(toArea.y + fy * toArea.h), toArea.y, toArea.y + toArea.h - h);
  return { rect: { x, y, w, h }, maximize: false };
}
