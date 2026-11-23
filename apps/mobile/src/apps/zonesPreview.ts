import type { Zone } from "@proyecto-e/protocol";

/** El rectángulo de una zona en proporciones (0 a 1), para dibujar la miniatura. `null` = no se mueve. */
export function zoneFraction(zone: Zone): { x: number; y: number; w: number; h: number } | null {
  switch (zone) {
    case "keep":
      return null;
    case "full":
    case "fullscreen":
      return { x: 0, y: 0, w: 1, h: 1 };
    case "left":
      return { x: 0, y: 0, w: 0.5, h: 1 };
    case "right":
      return { x: 0.5, y: 0, w: 0.5, h: 1 };
    case "top":
      return { x: 0, y: 0, w: 1, h: 0.5 };
    case "bottom":
      return { x: 0, y: 0.5, w: 1, h: 0.5 };
    case "tl":
      return { x: 0, y: 0, w: 0.5, h: 0.5 };
    case "tr":
      return { x: 0.5, y: 0, w: 0.5, h: 0.5 };
    case "bl":
      return { x: 0, y: 0.5, w: 0.5, h: 0.5 };
    case "br":
      return { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
  }
}
