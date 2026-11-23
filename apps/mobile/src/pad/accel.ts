/**
 * Curva del cursor (docs/PLAN.md D45, suavizada el 08/11/2026 tras la primera prueba). Pura: se prueba sin celu.
 * `gain` = sensibilidad × (1 + velocidad/2,5), con la velocidad (px por ms) topada en 2,5: lento casi 1:1, rápido hasta 2×.
 */
const MAX_SPEED = 2.5;

export function gain(speed: number, sensitivity: number): number {
  const s = Math.min(Math.max(Number.isFinite(speed) ? speed : 0, 0), MAX_SPEED);
  return sensitivity * (1 + s / MAX_SPEED);
}

/** Convierte lo que se movió el dedo en enteros para mandar, guardando el resto: si no, los movimientos lentos se pierden. */
export function createAccel() {
  let rx = 0;
  let ry = 0;
  return {
    apply(dx: number, dy: number, dtMs: number, sensitivity: number): { dx: number; dy: number } {
      const dt = Math.max(1, Number.isFinite(dtMs) ? dtMs : 1);
      const g = gain(Math.hypot(dx, dy) / dt, sensitivity);
      rx += dx * g;
      ry += dy * g;
      const ox = Math.trunc(rx);
      const oy = Math.trunc(ry);
      rx -= ox;
      ry -= oy;
      return { dx: ox, dy: oy };
    },
    reset() {
      rx = 0;
      ry = 0;
    },
  };
}
