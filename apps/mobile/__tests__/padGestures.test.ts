import { createGestureEngine, type GestureOutput, type TouchPoint } from "@/pad/gestures";

type Ev = ["move" | "scroll", number, number] | ["click", "left" | "right"] | ["dragStart"] | ["dragEnd"];

function setup() {
  jest.useFakeTimers();
  let now = 0;
  const events: Ev[] = [];
  const out: GestureOutput = {
    move: (dx, dy) => events.push(["move", dx, dy]),
    scroll: (dx, dy) => events.push(["scroll", dx, dy]),
    click: (b) => events.push(["click", b]),
    dragStart: () => events.push(["dragStart"]),
    dragEnd: () => events.push(["dragEnd"]),
  };
  const engine = createGestureEngine(out, { now: () => now, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) });
  const advance = (ms: number) => {
    now += ms;
    jest.advanceTimersByTime(ms);
  };
  const f = (id: number, x: number, y: number): TouchPoint => ({ id, x, y });
  const sum = (kind: "move" | "scroll") =>
    events.filter((e): e is ["move" | "scroll", number, number] => e[0] === kind).reduce((s, e) => ({ x: s.x + e[1], y: s.y + e[2] }), { x: 0, y: 0 });
  return { engine, events, advance, f, sum };
}
afterEach(() => jest.useRealTimers());

describe("un dedo", () => {
  it("un toque corto es clic izquierdo", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100)]);
    advance(80);
    engine.update([]);
    expect(events).toEqual([["click", "left"]]);
  });

  it("temblor dentro del margen no mueve ni cancela el toque", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100)]);
    advance(20);
    engine.update([f(1, 103, 102)]);
    advance(20);
    engine.update([]);
    expect(events).toEqual([["click", "left"]]);
  });

  it("mover más allá del margen mueve el cursor con todo lo recorrido y no hace clic", () => {
    const { engine, events, advance, f, sum } = setup();
    engine.update([f(1, 100, 100)]);
    advance(16);
    engine.update([f(1, 120, 100)]);
    advance(16);
    engine.update([f(1, 150, 110)]);
    advance(16);
    engine.update([]);
    expect(sum("move")).toEqual({ x: 50, y: 10 });
    expect(events.some((e) => e[0] === "click")).toBe(false);
  });

  it("un toque largo sin moverse (más de 250 ms, menos de 400) no hace nada", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 50, 50)]);
    advance(300);
    engine.update([]);
    expect(events).toEqual([]);
  });

  it("mantener quieto 400 ms empieza el arrastre (con aviso para vibrar); mover arrastra; soltar lo termina sin clic", () => {
    const { engine, events, advance, f, sum } = setup();
    engine.update([f(1, 100, 100)]);
    advance(399);
    expect(events).toEqual([]);
    advance(2);
    expect(events).toEqual([["dragStart"]]);
    engine.update([f(1, 130, 100)]);
    engine.update([f(1, 160, 120)]);
    expect(sum("move")).toEqual({ x: 60, y: 20 });
    engine.update([]);
    expect(events.at(-1)).toEqual(["dragEnd"]);
    expect(events.filter((e) => e[0] === "click")).toHaveLength(0);
  });

  it("si se mueve antes de los 400 ms, no hay arrastre", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100)]);
    advance(200);
    engine.update([f(1, 140, 100)]);
    advance(500);
    expect(events.some((e) => e[0] === "dragStart")).toBe(false);
    engine.update([]);
    expect(events.some((e) => e[0] === "dragEnd")).toBe(false);
  });

  it("soltar antes de los 400 ms cancela el temporizador (no queda un arrastre fantasma)", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100)]);
    advance(100);
    engine.update([]);
    advance(1000);
    expect(events).toEqual([["click", "left"]]);
  });

  it("un arrastre largo sin mover el dedo sigue vivo hasta soltar", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100)]);
    advance(500);
    advance(5000);
    expect(events).toEqual([["dragStart"]]);
    engine.update([]);
    expect(events.at(-1)).toEqual(["dragEnd"]);
  });

  it("cancel() (el sistema le quitó el gesto) termina el arrastre y no hace clic", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100)]);
    advance(500);
    engine.cancel();
    expect(events).toEqual([["dragStart"], ["dragEnd"]]);
    engine.cancel();
    expect(events).toHaveLength(2);
  });

  it("después de soltar, el próximo toque es un gesto nuevo", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 10, 10)]);
    advance(50);
    engine.update([]);
    engine.update([f(1, 200, 200)]);
    advance(50);
    engine.update([]);
    expect(events).toEqual([["click", "left"], ["click", "left"]]);
  });
});

describe("dos dedos", () => {
  it("un toque con dos dedos es clic derecho", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100), f(2, 160, 100)]);
    advance(80);
    engine.update([f(2, 160, 100)]);
    engine.update([]);
    expect(events).toEqual([["click", "right"]]);
  });

  it("dos dedos que se mueven hacen scroll (con lo recorrido) y no clic", () => {
    const { engine, events, advance, f, sum } = setup();
    engine.update([f(1, 100, 100), f(2, 160, 100)]);
    advance(16);
    engine.update([f(1, 100, 130), f(2, 160, 130)]);
    advance(16);
    engine.update([f(1, 100, 170), f(2, 160, 170)]);
    advance(16);
    engine.update([f(2, 160, 170)]);
    engine.update([]);
    expect(sum("scroll")).toEqual({ x: 0, y: 70 });
    expect(events.some((e) => e[0] === "click" || e[0] === "move")).toBe(false);
  });

  it("si se suma un segundo dedo mientras se movía con uno, pasa a scroll sin saltos", () => {
    const { engine, events, advance, f, sum } = setup();
    engine.update([f(1, 100, 100)]);
    advance(16);
    engine.update([f(1, 140, 100)]);
    const movedBefore = sum("move").x;
    engine.update([f(1, 140, 100), f(2, 200, 100)]);
    advance(16);
    engine.update([f(1, 140, 140), f(2, 200, 140)]);
    expect(sum("move").x).toBe(movedBefore);
    expect(sum("scroll").y).toBe(40);
    engine.update([]);
    expect(events.some((e) => e[0] === "click")).toBe(false);
  });

  it("al levantar un dedo y quedar uno, no se mueve el cursor hasta soltar todo", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100), f(2, 160, 100)]);
    advance(16);
    engine.update([f(1, 100, 140), f(2, 160, 140)]);
    engine.update([f(2, 160, 140)]);
    engine.update([f(2, 200, 200)]);
    expect(events.filter((e) => e[0] === "move")).toHaveLength(0);
    engine.update([]);
    expect(events.filter((e) => e[0] === "click")).toHaveLength(0);
  });

  it("dos dedos que tardan en soltar (más de 250 ms) y no se movieron no hacen clic derecho", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100), f(2, 160, 100)]);
    advance(400);
    engine.update([]);
    expect(events).toEqual([]);
  });

  it("dos dedos no arrancan un arrastre aunque se queden quietos", () => {
    const { engine, events, advance, f } = setup();
    engine.update([f(1, 100, 100), f(2, 160, 100)]);
    advance(1000);
    expect(events).toEqual([]);
    engine.update([]);
  });
});
