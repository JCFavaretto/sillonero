/**
 * Un deslizador manda decenas de valores por segundo (D38): se manda el primero enseguida, después como mucho uno cada
 * `ms`, siempre el último, y `flush` manda el que falte al soltar.
 */
export function createThrottle<T>(send: (value: T) => void, ms: number) {
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function fire(value: T) {
    send(value);
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        const p = pending;
        pending = null;
        fire(p.value);
      }
    }, ms);
  }

  return {
    push(value: T) {
      if (timer) pending = { value };
      else fire(value);
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending) {
        const p = pending;
        pending = null;
        send(p.value);
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
