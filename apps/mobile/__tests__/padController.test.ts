import { createPadController, DEFAULT_SETTINGS, type PadSettings } from "@/pad/controller";
import type { TouchPoint } from "@/pad/gestures";

type Sent = { type: string; payload: Record<string, number> };

function setup(over: Partial<PadSettings> = {}) {
  jest.useFakeTimers();
  let now = 0;
  const fired: Sent[] = [];
  const buttons: string[] = [];
  const haptics: string[] = [];
  let settings: PadSettings = { ...DEFAULT_SETTINGS, ...over };
  let online = true;
  const c = createPadController({
    fire: (type, payload) => {
      if (!online) return false;
      fired.push({ type, payload: payload as Record<string, number> });
      return true;
    },
    button: (button, action) => {
      buttons.push(`${button}:${action}`);
    },
    haptic: (kind) => haptics.push(kind),
    settings: () => settings,
    now: () => now,
  });
  const f = (id: number, x: number, y: number): TouchPoint => ({ id, x, y });
  const advance = (ms: number) => {
    now += ms;
    jest.advanceTimersByTime(ms);
  };
  const sum = (type: string, k: "dx" | "dy") => fired.filter((e) => e.type === type).reduce((s, e) => s + (e.payload[k] ?? 0), 0);
  return { c, fired, buttons, haptics, f, advance, sum, set: (s: Partial<PadSettings>) => (settings = { ...settings, ...s }), setOnline: (v: boolean) => (online = v) };
}
afterEach(() => jest.useRealTimers());

describe("controlador del touchpad", () => {
  it("un toque manda clic izquierdo (sin vibrar por defecto)", () => {
    const t = setup();
    t.c.touches([t.f(1, 50, 50)]);
    t.advance(60);
    t.c.touches([]);
    expect(t.buttons).toEqual(["left:click"]);
    expect(t.haptics).toEqual([]);
  });

  it("con 'vibrar en cada clic' prendido, vibra al hacer clic", () => {
    const t = setup({ vibrateClick: true });
    t.c.touches([t.f(1, 50, 50)]);
    t.advance(60);
    t.c.touches([]);
    expect(t.haptics).toEqual(["tap"]);
  });

  it("mover el dedo manda pad.move acelerado y con todo lo recorrido (nada se pierde)", () => {
    const t = setup({ sensitivity: 1 });
    t.c.touches([t.f(1, 100, 100)]);
    for (let i = 1; i <= 20; i++) {
      t.advance(16);
      t.c.touches([t.f(1, 100 + i * 5, 100)]);
    }
    t.advance(50);
    t.c.touches([]);
    const total = t.sum("pad.move", "dx");
    expect(total).toBeGreaterThanOrEqual(100); // ≥ lo recorrido: la curva solo acelera
    expect(total).toBeLessThanOrEqual(250);
    expect(t.sum("pad.move", "dy")).toBe(0);
    expect(t.buttons).toEqual([]);
  });

  it("el resto fraccionario no se pierde con movimientos lentos", () => {
    const t = setup({ sensitivity: 1 });
    t.c.touches([t.f(1, 0, 0)]);
    t.advance(16);
    t.c.touches([t.f(1, 0, 20)]); // sale del margen
    for (let i = 1; i <= 100; i++) {
      t.advance(16);
      t.c.touches([t.f(1, 0, 20 + i * 0.5)]);
    }
    t.advance(50);
    t.c.touches([]);
    expect(t.sum("pad.move", "dy")).toBeGreaterThanOrEqual(65);
  });

  it("mantener 400 ms: aprieta el botón izquierdo, vibra, arrastra y al soltar lo suelta", () => {
    const t = setup({ sensitivity: 1 });
    t.c.touches([t.f(1, 100, 100)]);
    t.advance(450);
    expect(t.buttons).toEqual(["left:down"]);
    expect(t.haptics).toEqual(["drag"]);
    t.advance(16);
    t.c.touches([t.f(1, 140, 100)]);
    t.advance(16);
    t.c.touches([]);
    expect(t.buttons).toEqual(["left:down", "left:up"]);
    expect(t.sum("pad.move", "dx")).toBeGreaterThan(0);
  });

  it("mientras arrastra manda un aviso (pad.move 0,0) cada segundo aunque el dedo esté quieto (vigilante de la PC)", () => {
    const t = setup();
    t.c.touches([t.f(1, 100, 100)]);
    t.advance(450);
    t.fired.length = 0;
    t.advance(3_000);
    expect(t.fired.filter((e) => e.type === "pad.move" && e.payload.dx === 0 && e.payload.dy === 0).length).toBeGreaterThanOrEqual(3);
    t.c.touches([]);
    t.fired.length = 0;
    t.advance(3_000);
    expect(t.fired).toEqual([]); // soltó: se acaban los avisos
  });

  it("dos dedos: scroll natural por defecto (arrastrar hacia arriba = rueda negativa = la página baja)", () => {
    const t = setup();
    t.c.touches([t.f(1, 100, 200), t.f(2, 160, 200)]);
    t.advance(16);
    t.c.touches([t.f(1, 100, 160), t.f(2, 160, 160)]); // 40 dp hacia arriba
    t.advance(50);
    t.c.touches([]);
    expect(t.sum("pad.scroll", "dy")).toBeLessThan(0);
    expect(Math.abs(t.sum("pad.scroll", "dy"))).toBeGreaterThanOrEqual(100); // ~120 = un clic de rueda cada 40 dp
  });

  it("scroll invertido cuando 'scroll natural' está apagado", () => {
    const t = setup({ naturalScroll: false });
    t.c.touches([t.f(1, 100, 200), t.f(2, 160, 200)]);
    t.advance(16);
    t.c.touches([t.f(1, 100, 160), t.f(2, 160, 160)]);
    t.advance(50);
    t.c.touches([]);
    expect(t.sum("pad.scroll", "dy")).toBeGreaterThan(0);
  });

  it("la velocidad del scroll escala lo que se manda", () => {
    const slow = setup({ scrollSpeed: 0.5 });
    const fast = setup({ scrollSpeed: 2 });
    for (const t of [slow, fast]) {
      t.c.touches([t.f(1, 100, 200), t.f(2, 160, 200)]);
      t.advance(16);
      t.c.touches([t.f(1, 100, 100), t.f(2, 160, 100)]);
      t.advance(50);
      t.c.touches([]);
    }
    expect(Math.abs(fast.sum("pad.scroll", "dy"))).toBeGreaterThan(Math.abs(slow.sum("pad.scroll", "dy")) * 3);
  });

  it("toque con dos dedos: clic derecho", () => {
    const t = setup();
    t.c.touches([t.f(1, 100, 100), t.f(2, 160, 100)]);
    t.advance(60);
    t.c.touches([]);
    expect(t.buttons).toEqual(["right:click"]);
  });

  it("candado: deja el clic apretado después de soltar el dedo y lo suelta al tocarlo otra vez", () => {
    const t = setup();
    t.c.setLock(true);
    expect(t.buttons).toEqual(["left:down"]);
    t.c.touches([t.f(1, 100, 100)]);
    t.advance(60);
    t.c.touches([]); // soltó
    t.advance(3_000);
    expect(t.fired.some((e) => e.type === "pad.move" && e.payload.dx === 0)).toBe(true); // sigue avisando
    t.c.setLock(false);
    expect(t.buttons.at(-1)).toBe("left:up");
  });

  it("con candado, un arrastre no suelta el botón al levantar el dedo", () => {
    const t = setup();
    t.c.setLock(true);
    t.c.touches([t.f(1, 100, 100)]);
    t.advance(450);
    t.c.touches([]);
    expect(t.buttons.filter((b) => b === "left:up")).toEqual([]);
  });

  it("dispose suelta lo apretado y para los avisos", () => {
    const t = setup();
    t.c.touches([t.f(1, 100, 100)]);
    t.advance(450);
    t.c.dispose();
    expect(t.buttons).toEqual(["left:down", "left:up"]);
    t.fired.length = 0;
    t.advance(5_000);
    expect(t.fired).toEqual([]);
  });

  it("sin conexión (fire devuelve false) no explota ni acumula", () => {
    const t = setup();
    t.setOnline(false);
    t.c.touches([t.f(1, 100, 100)]);
    t.advance(16);
    t.c.touches([t.f(1, 200, 100)]);
    t.advance(50);
    t.c.touches([]);
    expect(t.fired).toEqual([]);
  });

  it("cancel (el sistema le quitó el gesto) termina el arrastre", () => {
    const t = setup();
    t.c.touches([t.f(1, 100, 100)]);
    t.advance(450);
    t.c.cancel();
    expect(t.buttons).toEqual(["left:down", "left:up"]);
  });
});

