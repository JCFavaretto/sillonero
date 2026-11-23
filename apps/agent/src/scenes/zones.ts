import type { Zone } from "@proyecto-e/protocol";
import type { RawRect } from "../ports";

// Dónde queda una ventana según la zona elegida (docs/PLAN.md D24). Puro: sin Windows ni reloj.

export interface ZonePlan {
  rect: RawRect;
  /** Maximizarla en vez de darle un rectángulo. */
  maximize: boolean;
  /** Sin bordes, sobre todo el monitor (como Ctrl+Alt+4 del .ahk). */
  fullscreen: boolean;
}

/**
 * `work` es el área de trabajo de la pantalla (sin la barra de tareas) y `bounds` todo el monitor.
 * Las mitades y los cuartos se reparten el área entera: la mitad derecha toma lo que sobra de la división,
 * así un área de ancho impar no deja una columna de píxeles sin cubrir. `keep` devuelve `null`: no se toca.
 */
export function zoneRect(zone: Zone, work: RawRect, bounds: RawRect): ZonePlan | null {
  if (zone === "keep") return null;
  if (zone === "full") return { rect: { ...work }, maximize: true, fullscreen: false };
  if (zone === "fullscreen") return { rect: { ...bounds }, maximize: false, fullscreen: true };

  const w1 = Math.floor(work.w / 2);
  const h1 = Math.floor(work.h / 2);
  const left = zone === "left" || zone === "tl" || zone === "bl";
  const right = zone === "right" || zone === "tr" || zone === "br";
  const top = zone === "top" || zone === "tl" || zone === "tr";
  const bottom = zone === "bottom" || zone === "bl" || zone === "br";

  const x = right ? work.x + w1 : work.x;
  const w = left ? w1 : right ? work.w - w1 : work.w;
  const y = bottom ? work.y + h1 : work.y;
  const h = top ? h1 : bottom ? work.h - h1 : work.h;
  return { rect: { x, y, w, h }, maximize: false, fullscreen: false };
}
