import type { TouchPoint } from "./gestures";

interface RawTouch {
  identifier: number | string;
  pageX: number;
  pageY: number;
  target?: unknown;
}

/**
 * Los dedos que están SOBRE el touchpad. El evento del responder trae los toques de toda la pantalla: el pulgar apoyado en la barra
 * de clic (u otro botón) no tiene que contar como un segundo dedo (sería scroll o clic derecho sin querer).
 */
export function ownTouches(nativeEvent: { touches: readonly RawTouch[]; target?: unknown }): TouchPoint[] {
  return nativeEvent.touches
    .filter((t) => t.target === nativeEvent.target)
    .map((t) => ({ id: Number(t.identifier), x: t.pageX, y: t.pageY }));
}
