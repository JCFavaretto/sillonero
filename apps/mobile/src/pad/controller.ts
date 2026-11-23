import type { FireRequest, FireType } from "@/connection/client";
import { createAccel } from "./accel";
import { createBatcher } from "./batcher";
import { createGestureEngine, type TouchPoint } from "./gestures";

/** Lo que se ajusta en el Pad (boceto 05). Se guarda en el celu. */
export interface PadSettings {
  /** Multiplica la curva del cursor (1 = una vuelta del dedo ≈ lo mismo en la PC). */
  sensitivity: number;
  scrollSpeed: number;
  /** Como en el celu: subís el dedo y la página sube. */
  naturalScroll: boolean;
  vibrateClick: boolean;
  keepAwake: boolean;
}

export const DEFAULT_SETTINGS: PadSettings = { sensitivity: 1.3, scrollSpeed: 1, naturalScroll: true, vibrateClick: false, keepAwake: true };
export const SENSITIVITY_RANGE = { min: 0.6, max: 3.4 } as const;
export const SCROLL_RANGE = { min: 0.4, max: 2.5 } as const;

/** 40 dp de dedo = un "clic" de rueda (120) a velocidad 1. */
const WHEEL_PER_DP = 120 / 40;
const MOVE_SEND_MS = 16;
const SCROLL_SEND_MS = 33;
/** Mientras hay un botón apretado se avisa cada segundo aunque el dedo esté quieto: si no, la PC lo suelta a los 3 s (D53). */
const KEEPALIVE_MS = 1_000;

export interface PadControllerDeps {
  /** Mover y scroll: sin respuesta. `false` = no hay conexión (se pierde ese movimiento). */
  fire<T extends FireType>(type: T, payload: Extract<FireRequest, { type: T }>["payload"]): boolean;
  /** Clic o botón apretado/soltado (lleva respuesta; acá no se espera). */
  button(button: "left" | "middle" | "right", action: "click" | "down" | "up"): void;
  haptic(kind: "tap" | "drag"): void;
  /** Para la superficie: el anillo del clic y el borde del arrastre. */
  fx?(fx: "click" | "dragStart" | "dragEnd"): void;
  settings(): PadSettings;
  now(): number;
}

/** Une el motor de gestos con la curva, el agrupado de mensajes y el envío. Vive mientras el Pad está a la vista. */
export function createPadController(deps: PadControllerDeps) {
  const accel = createAccel();
  const moveBatcher = createBatcher((dx, dy) => void deps.fire("pad.move", { dx, dy }), MOVE_SEND_MS, 512);
  const wheelBatcher = createBatcher((dx, dy) => void deps.fire("pad.scroll", { dx, dy }), SCROLL_SEND_MS, 1200);
  let lastMoveAt = 0;
  let wheelRx = 0;
  let wheelRy = 0;
  let dragging = false;
  let locked = false;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const holding = () => dragging || locked;
  function syncKeepalive() {
    if (holding() && keepalive === null) keepalive = setInterval(() => void deps.fire("pad.move", { dx: 0, dy: 0 }), KEEPALIVE_MS);
    else if (!holding() && keepalive !== null) {
      clearInterval(keepalive);
      keepalive = null;
    }
  }

  const engine = createGestureEngine(
    {
      move(dx, dy) {
        const now = deps.now();
        const dt = lastMoveAt === 0 ? 16 : now - lastMoveAt;
        lastMoveAt = now;
        const o = accel.apply(dx, dy, dt, deps.settings().sensitivity);
        moveBatcher.push(o.dx, o.dy);
      },
      scroll(dx, dy) {
        const s = deps.settings();
        const k = WHEEL_PER_DP * s.scrollSpeed;
        // Vertical natural: dedo hacia arriba (dy < 0) = rueda negativa = la página baja. Horizontal natural: dedo a la izquierda = rueda positiva.
        const sy = s.naturalScroll ? 1 : -1;
        wheelRy += dy * k * sy;
        wheelRx += dx * k * -sy;
        const oy = Math.trunc(wheelRy);
        const ox = Math.trunc(wheelRx);
        wheelRy -= oy;
        wheelRx -= ox;
        wheelBatcher.push(ox, oy);
      },
      click(button) {
        moveBatcher.flush();
        deps.button(button, "click");
        deps.fx?.("click");
        if (deps.settings().vibrateClick) deps.haptic("tap");
      },
      dragStart() {
        moveBatcher.flush();
        dragging = true;
        if (!locked) deps.button("left", "down");
        deps.haptic("drag");
        deps.fx?.("dragStart");
        syncKeepalive();
      },
      dragEnd() {
        moveBatcher.flush();
        dragging = false;
        if (!locked) deps.button("left", "up");
        deps.fx?.("dragEnd");
        syncKeepalive();
      },
    },
    { now: () => deps.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
  );

  function reset() {
    accel.reset();
    lastMoveAt = 0;
  }

  return {
    /** Todos los dedos apoyados ahora (se llama al apoyar, mover y levantar). */
    touches(list: readonly TouchPoint[]) {
      engine.update(list);
      if (list.length === 0) {
        moveBatcher.flush();
        wheelBatcher.flush();
        reset();
      }
    },
    /** El candado de la barra de clic: deja el botón izquierdo apretado hasta tocarlo otra vez. */
    setLock(on: boolean) {
      if (on === locked) return;
      locked = on;
      if (on) {
        if (!dragging) deps.button("left", "down");
      } else if (!dragging) {
        deps.button("left", "up");
      }
      syncKeepalive();
    },
    isLocked: () => locked,
    /** El sistema le quitó el gesto (otra vista, se cortó la conexión). */
    cancel() {
      engine.cancel();
      moveBatcher.cancel();
      wheelBatcher.cancel();
      reset();
    },
    /**
     * Se cortó la conexión o la PC apagó el Pad: no hay a quién avisarle (la PC suelta sola lo que quedó apretado). Se olvida el
     * candado y el arrastre, y se apagan los avisos, para que la pantalla y el controlador no queden desincronizados.
     */
    reset() {
      engine.cancel();
      locked = false;
      dragging = false;
      moveBatcher.cancel();
      wheelBatcher.cancel();
      syncKeepalive();
      reset();
    },
    /** Se sale del Pad: se suelta todo y se apagan los avisos. */
    dispose() {
      engine.cancel();
      if (locked) {
        locked = false;
        deps.button("left", "up");
      }
      moveBatcher.cancel();
      wheelBatcher.cancel();
      syncKeepalive();
      reset();
    },
  };
}

export type PadController = ReturnType<typeof createPadController>;
