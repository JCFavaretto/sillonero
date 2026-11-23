/**
 * Agrupa deltas enteros (docs/PLAN.md D43): el primero sale enseguida y lo que llega mientras tanto se suma y sale al vencer
 * `ms`. Así 60 eventos por segundo del dedo son como mucho ~60 mensajes y nunca se pierde nada de lo movido. Parte lo que
 * pase de `max` por mensaje (el agente rechaza más).
 */
export function createBatcher(send: (dx: number, dy: number) => void, ms: number, max = 512) {
  let px = 0;
  let py = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function emit(dx: number, dy: number) {
    while (dx !== 0 || dy !== 0) {
      const sx = Math.max(-max, Math.min(max, dx));
      const sy = Math.max(-max, Math.min(max, dy));
      send(sx, sy);
      dx -= sx;
      dy -= sy;
    }
  }

  function fire(dx: number, dy: number) {
    emit(dx, dy);
    timer = setTimeout(() => {
      timer = null;
      if (px !== 0 || py !== 0) {
        const x = px;
        const y = py;
        px = 0;
        py = 0;
        fire(x, y);
      }
    }, ms);
  }

  return {
    push(dx: number, dy: number) {
      if (dx === 0 && dy === 0) return;
      if (timer) {
        px += dx;
        py += dy;
      } else {
        fire(dx, dy);
      }
    },
    /** Manda ya lo que falte (al soltar el dedo). */
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      const x = px;
      const y = py;
      px = 0;
      py = 0;
      emit(x, y);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      px = 0;
      py = 0;
    },
  };
}
