import { describe, expect, it } from "vitest";
import type { ClientMessage } from "@proyecto-e/protocol";
import { keyEvents, shortcutEvents, VK } from "../src/input/model";
import { setup } from "./padHelpers";

type PadMsg = Extract<ClientMessage, { type: `pad.${string}` }>;
let n = 1000;
const m = <T extends PadMsg["type"]>(type: T, payload: Extract<PadMsg, { type: T }>["payload"]) => ({ v: 1, id: `x${++n}`, type, payload }) as unknown as PadMsg;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("teclas y atajos", () => {
  it("pad.key manda la combinación completa en un solo pedido (atómica)", async () => {
    const { pad, input } = setup();
    expect(await pad.handle("d1", m("pad.key", { key: "l", mods: ["ctrl"] }))).toEqual({ ok: true });
    expect(input.of("keys")).toEqual([{ op: "keys", events: keyEvents("l", ["ctrl"]) }]);
  });

  it("pad.shortcut manda las teclas de la tabla", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.shortcut", { name: "closeTab" }));
    expect(input.of("keys")[0]!.events).toEqual(shortcutEvents("closeTab"));
  });

  it("con la ventana del frente de administrador: input_blocked y no se manda nada", async () => {
    const { pad, input, states } = setup();
    input.isElevated = true;
    expect(await pad.handle("d1", m("pad.key", { key: "a", mods: [] }))).toEqual({ ok: false, reason: "input_blocked" });
    expect(await pad.handle("d1", m("pad.type", { backspaces: 0, text: "x" }))).toEqual({ ok: false, reason: "input_blocked" });
    expect(await pad.handle("d1", m("pad.shortcut", { name: "copy" }))).toEqual({ ok: false, reason: "input_blocked" });
    expect(input.calls).toEqual([]);
    expect(pad.state().elevated).toBe(true);
    expect(states.at(-1)?.elevated).toBe(true);
  });

  it("si no se puede saber si es administrador, se manda igual (mejor intentar)", async () => {
    const { pad, input } = setup();
    input.failNext = "elevated";
    expect(await pad.handle("d1", m("pad.key", { key: "a", mods: [] }))).toEqual({ ok: true });
    expect(input.of("keys")).toHaveLength(1);
  });

  it("vuelve a andar cuando la ventana deja de ser de administrador", async () => {
    const { pad, input } = setup();
    input.isElevated = true;
    await pad.handle("d1", m("pad.key", { key: "a", mods: [] }));
    input.isElevated = false;
    expect(await pad.handle("d1", m("pad.key", { key: "a", mods: [] }))).toEqual({ ok: true });
    expect(pad.state().elevated).toBe(false);
  });

  it("si Windows falla contesta failed", async () => {
    const { pad, input } = setup();
    input.failNext = "keys";
    expect(await pad.handle("d1", m("pad.key", { key: "a", mods: [] }))).toEqual({ ok: false, reason: "failed" });
  });
});

describe("pad.type (escribir en vivo)", () => {
  it("borra y escribe, en ese orden", async () => {
    const { pad, input } = setup();
    expect(await pad.handle("d1", m("pad.type", { backspaces: 2, text: "ñu😀" }))).toEqual({ ok: true });
    expect(input.calls.map((c) => c.op)).toEqual(["keys", "text"]);
    expect(input.of("keys")[0]!.events).toEqual([[VK.BACK, false, false], [VK.BACK, true, false], [VK.BACK, false, false], [VK.BACK, true, false]]);
    expect(input.of("text")[0]!.units).toEqual([0xf1, 0x75, 0xd83d, 0xde00]);
  });

  it("solo texto: no manda retrocesos; solo retrocesos: no manda texto", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.type", { backspaces: 0, text: "hola" }));
    await pad.handle("d1", m("pad.type", { backspaces: 3, text: "" }));
    expect(input.calls.map((c) => c.op)).toEqual(["text", "keys"]);
  });

  it("dos mensajes seguidos se escriben en orden aunque Windows tarde", async () => {
    const { pad, input } = setup();
    let release!: () => void;
    input.gate = new Promise<void>((r) => (release = r));
    const a = pad.handle("d1", m("pad.type", { backspaces: 0, text: "uno" }));
    const b = pad.handle("d1", m("pad.type", { backspaces: 0, text: "dos" }));
    await flush();
    expect(input.calls).toEqual([]);
    release();
    await Promise.all([a, b]);
    expect(input.of("text").map((c) => String.fromCharCode(...c.units))).toEqual(["uno", "dos"]);
  });

  it("una tecla y un texto seguidos también respetan el orden", async () => {
    const { pad, input } = setup();
    let release!: () => void;
    input.gate = new Promise<void>((r) => (release = r));
    const a = pad.handle("d1", m("pad.type", { backspaces: 0, text: "abc" }));
    const b = pad.handle("d1", m("pad.key", { key: "enter", mods: [] }));
    release();
    await Promise.all([a, b]);
    expect(input.calls.map((c) => c.op)).toEqual(["text", "keys"]);
  });
});

describe("Alt+Tab (D52)", () => {
  it("start deja Alt apretado y aprieta Tab; next aprieta Tab; commit suelta Alt", async () => {
    const { pad, input } = setup();
    expect(await pad.handle("d1", m("pad.altTab", { step: "start" }))).toEqual({ ok: true });
    expect(pad.state().holding.alt).toBe(true);
    expect(input.heldNow().alt).toBe(true);
    await pad.handle("d1", m("pad.altTab", { step: "next" }));
    await pad.handle("d1", m("pad.altTab", { step: "commit" }));
    expect(pad.state().holding.alt).toBe(false);
    expect(input.heldNow().alt).toBe(false);
    const tabs = input.of("keys").flatMap((c) => c.events).filter(([vk, up]) => vk === VK.TAB && !up);
    expect(tabs).toHaveLength(2);
  });

  it("prev aprieta Shift+Tab con Alt apretado", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.altTab", { step: "start" }));
    await pad.handle("d1", m("pad.altTab", { step: "prev" }));
    const last = input.of("keys").at(-1)!.events;
    expect(last.map((e) => `${e[0].toString(16)}${e[1] ? "^" : "v"}`)).toEqual(["10v", "9v", "9^", "10^"]);
  });

  it("cancel manda Esc y suelta Alt", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.altTab", { step: "start" }));
    await pad.handle("d1", m("pad.altTab", { step: "cancel" }));
    const flat = input.of("keys").flatMap((c) => c.events);
    expect(flat.some(([vk, up]) => vk === VK.ESC && !up)).toBe(true);
    expect(input.heldNow().alt).toBe(false);
  });

  it("sin pasos durante 2 s, hace commit solo", async () => {
    const { pad, input, clock } = setup();
    await pad.handle("d1", m("pad.altTab", { step: "start" }));
    clock.advance(1_900);
    expect(input.heldNow().alt).toBe(true);
    clock.advance(200);
    await flush();
    expect(input.heldNow().alt).toBe(false);
    expect(pad.state().holding.alt).toBe(false);
  });

  it("cada paso reinicia los 2 s", async () => {
    const { pad, input, clock } = setup();
    await pad.handle("d1", m("pad.altTab", { step: "start" }));
    clock.advance(1_500);
    await pad.handle("d1", m("pad.altTab", { step: "next" }));
    clock.advance(1_500);
    await flush();
    expect(input.heldNow().alt).toBe(true);
  });

  it("next sin start empieza igual; commit sin Alt no hace nada", async () => {
    const { pad, input } = setup();
    expect(await pad.handle("d1", m("pad.altTab", { step: "commit" }))).toEqual({ ok: true });
    expect(input.calls).toEqual([]);
    await pad.handle("d1", m("pad.altTab", { step: "next" }));
    expect(pad.state().holding.alt).toBe(true);
  });

  it("con la ventana de administrador al frente no arranca (y no queda Alt apretado)", async () => {
    const { pad, input } = setup();
    input.isElevated = true;
    expect(await pad.handle("d1", m("pad.altTab", { step: "start" }))).toEqual({ ok: false, reason: "input_blocked" });
    expect(pad.state().holding.alt).toBe(false);
  });
});

describe("soltar todo (D53)", () => {
  it("pad.release suelta el botón y Alt", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    await pad.handle("d1", m("pad.altTab", { step: "start" }));
    expect(await pad.handle("d1", m("pad.release", {}))).toEqual({ ok: true });
    expect(input.heldNow()).toEqual({ left: false, alt: false });
    expect(pad.state().holding).toEqual({ left: false, alt: false });
  });

  it("si el celu se desconecta, suelta lo suyo", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    pad.disconnect("d1");
    await flush();
    expect(input.heldNow().left).toBe(false);
  });

  it("si se desconecta otro celu, no suelta lo del que está arrastrando", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    pad.disconnect("d2");
    await flush();
    expect(input.heldNow().left).toBe(true);
  });

  it("vigilante: a los 3 s sin mensajes de quien lo apretó, lo suelta", async () => {
    const { pad, input, clock } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    clock.advance(2_500);
    expect(input.heldNow().left).toBe(true);
    clock.advance(1_500);
    await flush();
    expect(input.heldNow().left).toBe(false);
    expect(pad.state().holding.left).toBe(false);
  });

  it("vigilante: un pad.move de aviso (0,0) mantiene el arrastre vivo", async () => {
    const { pad, input, clock } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    for (let i = 0; i < 6; i++) {
      clock.advance(1_000);
      pad.handle("d1", m("pad.move", { dx: 0, dy: 0 }));
      await flush();
    }
    expect(input.heldNow().left).toBe(true);
  });

  it("vigilante: sin nada apretado no hay temporizadores colgados", async () => {
    const { pad, clock } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "click" }));
    await pad.handle("d1", m("pad.key", { key: "a", mods: [] }));
    pad.stop();
    expect(clock.pendingTimers()).toBe(0);
  });

  it("stop() suelta todo", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    pad.stop();
    await flush();
    expect(input.heldNow().left).toBe(false);
  });
});

describe("estado", () => {
  it("avisa a los suscriptores cuando cambia y solo cuando cambia", async () => {
    const { pad, states } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    await pad.handle("d1", m("pad.button", { button: "left", action: "up" }));
    expect(states.map((s) => s.holding.left)).toEqual([true, false]);
  });

  it("el estado inicial", () => {
    const { pad } = setup();
    expect(pad.state()).toEqual({ available: true, enabled: true, elevated: false, holding: { left: false, alt: false } });
  });
});
