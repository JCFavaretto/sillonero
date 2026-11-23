import { describe, expect, it } from "vitest";
import type { ClientMessage } from "@proyecto-e/protocol";
import { setup } from "./padHelpers";

type PadMsg = Extract<ClientMessage, { type: `pad.${string}` }>;
let n = 0;
const m = <T extends PadMsg["type"]>(type: T, payload: Extract<PadMsg, { type: T }>["payload"]) => ({ v: 1, id: `c${++n}`, type, payload }) as unknown as PadMsg;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("llave global", () => {
  it("apagada: todo pad.* que contesta responde input_disabled y no toca Windows", async () => {
    const { pad, input } = setup({ enabled: false });
    for (const msg of [m("pad.button", { button: "left", action: "click" }), m("pad.key", { key: "a", mods: [] }), m("pad.shortcut", { name: "reload" }), m("pad.type", { backspaces: 0, text: "x" }), m("pad.altTab", { step: "start" }), m("pad.release", {})]) {
      expect(await pad.handle("d1", msg), msg.type).toEqual({ ok: false, reason: "input_disabled" });
    }
    expect(pad.handle("d1", m("pad.move", { dx: 5, dy: 5 }))).toBe("silent");
    await flush();
    expect(input.calls).toEqual([]);
  });

  it("sin el hijo de entrada: input_unavailable", async () => {
    const { pad, input } = setup();
    input.isAvailable = false;
    expect(await pad.handle("d1", m("pad.key", { key: "a", mods: [] }))).toEqual({ ok: false, reason: "input_unavailable" });
    expect(pad.state().available).toBe(false);
  });

  it("apagarla suelta lo apretado y avisa a todos", async () => {
    const { pad, input, states } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    expect(pad.state().holding.left).toBe(true);
    await pad.setEnabled(false);
    expect(input.heldNow().left).toBe(false);
    expect(pad.state().enabled).toBe(false);
    expect(states.at(-1)).toMatchObject({ enabled: false, holding: { left: false, alt: false } });
  });
});

describe("pad.move", () => {
  it("lee el cursor y las pantallas al empezar una racha y después lleva la posición él mismo", async () => {
    const { pad, input } = setup();
    pad.handle("d1", m("pad.move", { dx: 10, dy: 0 }));
    await flush();
    pad.handle("d1", m("pad.move", { dx: 10, dy: 0 }));
    await flush();
    expect(input.cursorReads).toBe(1);
    const moves = input.of("moveAbs");
    expect(moves).toHaveLength(2);
    expect(moves[1]!.nx).toBeGreaterThan(moves[0]!.nx);
  });

  it("vuelve a leer el cursor tras 250 ms quieto (por si Jay movió el mouse de verdad)", async () => {
    const { pad, input, clock } = setup();
    pad.handle("d1", m("pad.move", { dx: 10, dy: 0 }));
    await flush();
    clock.advance(300);
    input.cursorAt = { x: 900, y: 500 };
    pad.handle("d1", m("pad.move", { dx: 0, dy: 0 }));
    await flush();
    expect(input.cursorReads).toBe(2);
  });

  it("el movimiento acumula deltas mientras se lee el cursor (no se pierde ninguno)", async () => {
    const { pad, input } = setup();
    for (let i = 0; i < 5; i++) pad.handle("d1", m("pad.move", { dx: 1, dy: 0 }));
    await flush();
    // 1 + 4 acumulados: la posición final es 100 + 5
    const last = input.of("moveAbs").at(-1)!;
    expect(Math.floor((last.nx * 1920) / 65536)).toBe(105);
  });

  it("una falla al leer el cursor no tira el servicio: el siguiente movimiento anda", async () => {
    const { pad, input } = setup();
    input.failNext = "cursor";
    pad.handle("d1", m("pad.move", { dx: 5, dy: 0 }));
    await flush();
    pad.handle("d1", m("pad.move", { dx: 5, dy: 0 }));
    await flush();
    expect(input.of("moveAbs").length).toBeGreaterThanOrEqual(1);
  });

  it("pad.scroll manda la rueda tal cual", async () => {
    const { pad, input } = setup();
    expect(pad.handle("d1", m("pad.scroll", { dx: 0, dy: -120 }))).toBe("silent");
    expect(input.of("wheel")).toEqual([{ op: "wheel", dx: 0, dy: -120 }]);
  });
});

describe("clics", () => {
  it("click manda un solo pedido y no queda nada apretado", async () => {
    const { pad, input } = setup();
    expect(await pad.handle("d1", m("pad.button", { button: "left", action: "click" }))).toEqual({ ok: true });
    expect(input.of("button")).toEqual([{ op: "button", button: "left", action: "click" }]);
    expect(pad.state().holding.left).toBe(false);
  });

  it("down marca el botón apretado y up lo suelta", async () => {
    const { pad } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    expect(pad.state().holding.left).toBe(true);
    await pad.handle("d1", m("pad.button", { button: "left", action: "up" }));
    expect(pad.state().holding.left).toBe(false);
  });

  it("el clic del medio (la rueda) es solo clic, como el derecho", async () => {
    const { pad, input } = setup();
    expect(await pad.handle("d1", m("pad.button", { button: "middle", action: "click" }))).toEqual({ ok: true });
    expect(await pad.handle("d1", m("pad.button", { button: "middle", action: "down" }))).toEqual({ ok: false, reason: "unsupported" });
    expect(input.of("button")).toEqual([{ op: "button", button: "middle", action: "click" }]);
  });

  it("el botón derecho solo hace click (apretarlo no se soporta)", async () => {
    const { pad, input } = setup();
    expect(await pad.handle("d1", m("pad.button", { button: "right", action: "click" }))).toEqual({ ok: true });
    expect(await pad.handle("d1", m("pad.button", { button: "right", action: "down" }))).toEqual({ ok: false, reason: "unsupported" });
    expect(input.of("button")).toHaveLength(1);
  });

  it("si Windows falla, contesta failed y no deja el botón marcado como apretado", async () => {
    const { pad, input } = setup();
    input.failNext = "button";
    expect(await pad.handle("d1", m("pad.button", { button: "left", action: "down" }))).toEqual({ ok: false, reason: "failed" });
    expect(pad.state().holding.left).toBe(false);
  });

  it("los clics andan aunque la ventana del frente sea de administrador (solo se bloquea el teclado)", async () => {
    const { pad, input } = setup();
    input.isElevated = true;
    expect(await pad.handle("d1", m("pad.button", { button: "left", action: "click" }))).toEqual({ ok: true });
  });
});

describe("límites de ritmo (D43)", () => {
  it("150 mensajes por segundo por celu: lo que pasa se descarta en silencio", async () => {
    const { pad, input } = setup();
    for (let i = 0; i < 400; i++) pad.handle("d1", m("pad.scroll", { dx: 0, dy: 1 }));
    expect(input.of("wheel").length).toBe(150);
  });

  it("después de un segundo el balde se llena de nuevo", async () => {
    const { pad, input, clock } = setup();
    for (let i = 0; i < 200; i++) pad.handle("d1", m("pad.scroll", { dx: 0, dy: 1 }));
    clock.advance(1_000);
    for (let i = 0; i < 10; i++) pad.handle("d1", m("pad.scroll", { dx: 0, dy: 1 }));
    expect(input.of("wheel").length).toBe(160);
  });

  it("cada celu tiene su balde", async () => {
    const { pad, input } = setup();
    for (let i = 0; i < 150; i++) pad.handle("d1", m("pad.scroll", { dx: 0, dy: 1 }));
    pad.handle("d2", m("pad.scroll", { dx: 0, dy: 1 }));
    expect(input.of("wheel").length).toBe(151);
  });

  it("teclas y clics: 20 por segundo, el resto contesta busy", async () => {
    const { pad } = setup();
    const results = [];
    for (let i = 0; i < 25; i++) results.push(await pad.handle("d1", m("pad.key", { key: "a", mods: [] })));
    expect(results.filter((r) => (r as { ok?: boolean }).ok === true).length).toBe(20);
    expect(results.at(-1)).toEqual({ ok: false, reason: "busy" });
  });

  it("pad.type: 30 por segundo", async () => {
    const { pad } = setup();
    const results = [];
    for (let i = 0; i < 35; i++) results.push(await pad.handle("d1", m("pad.type", { backspaces: 0, text: "a" })));
    expect(results.filter((r) => (r as { ok?: boolean }).ok === true).length).toBe(30);
    expect(results.at(-1)).toEqual({ ok: false, reason: "busy" });
  });

  it("una lluvia de pad.move no gasta el balde de teclas", async () => {
    const { pad } = setup();
    for (let i = 0; i < 400; i++) pad.handle("d1", m("pad.move", { dx: 1, dy: 0 }));
    expect(await pad.handle("d1", m("pad.key", { key: "a", mods: [] }))).toEqual({ ok: true });
  });
});
