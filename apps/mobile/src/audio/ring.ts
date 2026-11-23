// Matemática del anillo de volumen (boceto audio 09). Puro: sin React ni Reanimated.
// El arco mide 270° y tiene el hueco abajo (donde va el botón de encendido). Los ángulos se miden desde las 12 en punto,
// en el sentido de las agujas del reloj: el arco va de -135° (abajo a la izquierda, volumen 0) a +135° (abajo a la derecha, 100).

export const ARC_DEGREES = 270;
const START = -135;

/** El ángulo del punto `i` de `n` (de -135° a +135°). */
export const dotAngle = (i: number, n: number): number => START + (ARC_DEGREES * i) / (n - 1);

/** Cuántos puntos quedan prendidos con este volumen (0 a n). */
export const volumeToDots = (volume: number, n: number): number => Math.round((Math.min(100, Math.max(0, volume)) / 100) * n);

/**
 * El volumen que corresponde a un toque en (x, y) dentro de un anillo de `size` de lado. En el hueco de abajo se pega al
 * extremo más cercano: cruzar el hueco no hace saltar el volumen de 0 a 100.
 */
export function angleToVolume(x: number, y: number, size: number): number {
  const c = size / 2;
  const deg = (Math.atan2(x - c, c - y) * 180) / Math.PI; // -180 a 180, 0 = arriba
  if (deg < START) return 0; // hueco, lado izquierdo
  if (deg > START + ARC_DEGREES) return 100; // hueco, lado derecho
  return Math.round(((deg - START) / ARC_DEGREES) * 100);
}

/** ¿El toque cae sobre la franja del anillo (y no sobre la carátula del medio ni lejos)? Un poco de margen: el dedo no es preciso. */
export function inRingBand(x: number, y: number, size: number): boolean {
  const c = size / 2;
  const d = Math.hypot(x - c, y - c);
  return d >= size * 0.34 && d <= size * 0.5 + 14;
}

const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/** Mezcla dos colores `#rrggbb` (t = 0 el primero, t = 1 el segundo). */
export function lerpColor(a: string, b: string, t: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${hex(p(a, 0) + (p(b, 0) - p(a, 0)) * t)}${hex(p(a, 1) + (p(b, 1) - p(a, 1)) * t)}${hex(p(a, 2) + (p(b, 2) - p(a, 2)) * t)}`;
}
