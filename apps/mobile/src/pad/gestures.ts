// Motor de gestos del touchpad (docs/PLAN.md D46/D47). Puro: recibe la lista de dedos que hay apoyados cada vez que algo
// cambia (apoyar, mover, levantar) y avisa qué hay que hacer. No sabe nada de React Native: se prueba con un reloj falso.
//
//   un dedo  quieto y suelto rápido  → clic izquierdo
//   un dedo  moviéndose              → mover el cursor
//   un dedo  quieto 400 ms           → empieza el arrastre (botón izquierdo apretado); moverlo arrastra; soltar termina
//   dos dedos moviéndose             → scroll
//   dos dedos tocando y soltando     → clic derecho

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

export interface GestureOutput {
  /** Cuánto se movió el dedo (dp), sin curva: la aceleración la pone quien llama. */
  move(dx: number, dy: number): void;
  scroll(dx: number, dy: number): void;
  click(button: "left" | "right"): void;
  /** El toque largo se reconoció: acá se vibra y se aprieta el botón izquierdo. */
  dragStart(): void;
  dragEnd(): void;
}

export interface GestureDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface GestureOptions {
  /** Cuánto puede temblar el dedo (dp) sin que cuente como movimiento (5: el cursor arranca casi enseguida). */
  slop?: number;
  /** Un toque más largo que esto no es clic. */
  tapMs?: number;
  longPressMs?: number;
}

type Mode = "idle" | "pending1" | "move" | "drag" | "pending2" | "scroll" | "ignore";

export function createGestureEngine(out: GestureOutput, deps: GestureDeps, options: GestureOptions = {}) {
  const slop = options.slop ?? 5;
  const tapMs = options.tapMs ?? 250;
  const longPressMs = options.longPressMs ?? 400;

  let mode: Mode = "idle";
  let count = 0;
  let prev = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let startedAt = 0;
  let timer: unknown = null;

  const centroid = (t: readonly TouchPoint[]) => ({ x: t.reduce((s, p) => s + p.x, 0) / t.length, y: t.reduce((s, p) => s + p.y, 0) / t.length });
  const far = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) > slop;

  function clearTimer() {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  }

  function reset() {
    clearTimer();
    mode = "idle";
    count = 0;
  }

  function endDragIfAny() {
    if (mode === "drag") out.dragEnd();
  }

  function begin(c: { x: number; y: number }, n: number) {
    clearTimer();
    start = c;
    prev = c;
    startedAt = deps.now();
    if (n === 1) {
      mode = "pending1";
      timer = deps.setTimeout(() => {
        timer = null;
        if (mode === "pending1") {
          mode = "drag";
          out.dragStart();
        }
      }, longPressMs);
    } else {
      mode = "pending2";
    }
  }

  return {
    /** Llamar con TODOS los dedos apoyados cada vez que cambia algo (al apoyar, al mover y al levantar). */
    update(touches: readonly TouchPoint[]) {
      const n = touches.length;

      if (n === 0) {
        const wasMode = mode;
        const quick = deps.now() - startedAt <= tapMs;
        const still = !far(prev, start);
        clearTimer();
        if (wasMode === "drag") out.dragEnd();
        else if (wasMode === "pending1" && quick && still) out.click("left");
        else if (wasMode === "pending2" && quick && still) out.click("right");
        reset();
        return;
      }

      const c = centroid(touches);

      if (mode === "idle") {
        count = n;
        begin(c, n);
        return;
      }

      if (n !== count) {
        // Cambió la cantidad de dedos.
        const before = count;
        count = n;
        if (mode === "drag") {
          prev = c; // sigue arrastrando sin saltos
          return;
        }
        if (n > before && n === 2 && (mode === "pending1" || mode === "move")) {
          // se sumó un segundo dedo: pasa a scroll desde acá
          clearTimer();
          mode = "pending2";
          start = c;
          prev = c;
          startedAt = deps.now();
          return;
        }
        if (n < before && mode === "pending2") return; // dos dedos que se levantan de a uno para un toque: sigue siendo candidato a clic derecho
        if (n < before) {
          // quedó menos dedos: no se mueve nada hasta soltar todo (evita saltos y clics de más)
          clearTimer();
          mode = "ignore";
          prev = c;
          return;
        }
        prev = c;
        return;
      }

      // Misma cantidad de dedos: movimiento.
      const dx = c.x - prev.x;
      const dy = c.y - prev.y;
      switch (mode) {
        case "pending1":
          if (far(c, start)) {
            clearTimer();
            mode = "move";
            out.move(c.x - start.x, c.y - start.y); // alcanza lo recorrido dentro del margen
          }
          break;
        case "move":
        case "drag":
          if (dx !== 0 || dy !== 0) out.move(dx, dy);
          break;
        case "pending2":
          if (far(c, start)) {
            mode = "scroll";
            out.scroll(c.x - start.x, c.y - start.y);
          }
          break;
        case "scroll":
          if (dx !== 0 || dy !== 0) out.scroll(dx, dy);
          break;
        default:
          break;
      }
      prev = c;
    },

    /** El sistema le quitó el gesto (otra vista lo pidió, se cortó la conexión): se termina todo sin hacer clic. */
    cancel() {
      endDragIfAny();
      reset();
    },
  };
}
