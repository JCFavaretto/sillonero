import { describe, expect, it } from "vitest";
import { planMove } from "../src/screens/moveWindow";

// Port de MoverVentana del prototipo AutoHotkey (docs/historia/prototipo-ahk/PanelMonitores.ahk): la ventana conserva su
// posición relativa, se achica si no entra y queda siempre adentro de la pantalla de destino.

const A = { x: 0, y: 0, w: 1920, h: 1040 }; // pantalla de la izquierda (sin la barra de tareas)
const B = { x: 1920, y: 0, w: 2560, h: 1400 }; // la principal, más grande
const LEFT = { x: -1920, y: 0, w: 1920, h: 1040 }; // una pantalla con coordenadas negativas

const win = (rect: { x: number; y: number; w: number; h: number }, state: "normal" | "maximized" | "minimized" = "normal") => ({ rect, state });

describe("planMove · ventana normal", () => {
  it("si ya está en esa pantalla no hace nada", () => {
    expect(planMove(win({ x: 100, y: 100, w: 800, h: 600 }), A, A, true)).toBeNull();
  });

  it("conserva la posición relativa: un 10% / 20% en A queda en 10% / 20% de B", () => {
    const plan = planMove(win({ x: 192, y: 208, w: 800, h: 600 }), A, B, false)!;
    expect(plan.maximize).toBe(false);
    expect(plan.rect.x).toBe(B.x + Math.round(0.1 * B.w));
    expect(plan.rect.y).toBe(B.y + Math.round(0.2 * B.h));
    expect(plan.rect.w).toBe(800);
    expect(plan.rect.h).toBe(600);
  });

  it("si es más grande que el destino se achica a lo que entra", () => {
    const small = { x: 0, y: 0, w: 1280, h: 720 };
    const plan = planMove(win({ x: 0, y: 0, w: 1920, h: 1000 }), A, small, false)!;
    expect(plan.rect).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it("siempre queda adentro del destino aunque la posición relativa la saque", () => {
    // la ventana está pegada abajo a la derecha de A: proporcionalmente caería afuera de un destino chico
    const small = { x: 3000, y: 0, w: 1000, h: 700 };
    const plan = planMove(win({ x: 1200, y: 600, w: 700, h: 400 }), A, small, false)!;
    expect(plan.rect.x).toBeGreaterThanOrEqual(small.x);
    expect(plan.rect.y).toBeGreaterThanOrEqual(small.y);
    expect(plan.rect.x + plan.rect.w).toBeLessThanOrEqual(small.x + small.w);
    expect(plan.rect.y + plan.rect.h).toBeLessThanOrEqual(small.y + small.h);
  });

  it("estaba fuera de toda pantalla (origen desconocido): queda centrada en el destino", () => {
    const plan = planMove(win({ x: 9000, y: 9000, w: 800, h: 600 }), null, B, false)!;
    expect(plan.rect).toEqual({ x: B.x + (B.w - 800) / 2, y: B.y + (B.h - 600) / 2, w: 800, h: 600 });
  });

  it("funciona con coordenadas negativas (pantalla a la izquierda del escritorio)", () => {
    const plan = planMove(win({ x: 960, y: 520, w: 400, h: 300 }), A, LEFT, false)!;
    expect(plan.rect.x).toBe(LEFT.x + 960);
    expect(plan.rect.y).toBe(520);
  });

  it("los números son enteros", () => {
    const plan = planMove(win({ x: 101, y: 103, w: 777, h: 555 }), A, B, false)!;
    for (const v of Object.values(plan.rect)) expect(Number.isInteger(v)).toBe(true);
  });
});

describe("planMove · maximizada y minimizada", () => {
  it("maximizada en otra pantalla: se centra (80% del destino) y se vuelve a maximizar", () => {
    const plan = planMove(win({ x: 0, y: 0, w: 1920, h: 1040 }, "maximized"), A, B, false)!;
    expect(plan.maximize).toBe(true);
    expect(plan.rect.w).toBe(Math.round(B.w * 0.8));
    expect(plan.rect.h).toBe(Math.round(B.h * 0.8));
    expect(plan.rect.x).toBe(B.x + Math.round((B.w - plan.rect.w) / 2));
    expect(plan.rect.y).toBe(B.y + Math.round((B.h - plan.rect.h) / 2));
  });

  it("maximizada en la misma pantalla: no hace nada", () => {
    expect(planMove(win({ x: 0, y: 0, w: 1920, h: 1040 }, "maximized"), A, A, true)).toBeNull();
  });

  it("minimizada: se restaura centrada en el destino, sin maximizar", () => {
    const plan = planMove(win({ x: -32000, y: -32000, w: 160, h: 28 }, "minimized"), null, B, false)!;
    expect(plan.maximize).toBe(false);
    expect(plan.rect.w).toBe(Math.round(B.w * 0.8));
    expect(plan.rect.x).toBeGreaterThanOrEqual(B.x);
  });
});

describe("planMove · datos raros", () => {
  it("un destino sin tamaño no se puede usar → null", () => {
    expect(planMove(win({ x: 0, y: 0, w: 100, h: 100 }), A, { x: 0, y: 0, w: 0, h: 0 }, false)).toBeNull();
  });

  it("una ventana sin tamaño igual se acomoda adentro", () => {
    const plan = planMove(win({ x: 10, y: 10, w: 0, h: 0 }), A, B, false)!;
    expect(plan.rect.w).toBe(0);
    expect(plan.rect.x).toBeGreaterThanOrEqual(B.x);
  });
});
