import { describe, expect, it } from "vitest";
import type { ClientMessage } from "@proyecto-e/protocol";
import { setup } from "./padHelpers";

type PadMsg = Extract<ClientMessage, { type: `pad.${string}` }>;
let n = 5000;
const m = <T extends PadMsg["type"]>(type: T, payload: Extract<PadMsg, { type: T }>["payload"]) => ({ v: 1, id: `y${++n}`, type, payload }) as unknown as PadMsg;
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const hold = (input: { gate: Promise<void> | null }) => {
  let release!: () => void;
  input.gate = new Promise<void>((r) => (release = r));
  return () => {
    input.gate = null;
    release();
  };
};

describe("revisión de cierre: el botón nunca queda apretado", () => {
  it("soltar todo mientras el down todavía está en vuelo manda el up igual", async () => {
    const { pad, input } = setup();
    const release = hold(input);
    const down = pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    await flush();
    const rel = pad.handle("d1", m("pad.release", {}));
    release();
    await Promise.all([down, rel]);
    await flush();
    expect(input.heldNow().left).toBe(false);
    expect(pad.state().holding.left).toBe(false);
  });

  it("apagar la llave con el down en vuelo tampoco lo deja apretado", async () => {
    const { pad, input } = setup();
    const release = hold(input);
    const down = pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    await flush();
    const off = pad.setEnabled(false);
    release();
    await Promise.all([down, off]);
    await flush();
    expect(input.heldNow().left).toBe(false);
  });

  it("si el up falla, se reintenta (el estado sigue diciendo apretado hasta que salga)", async () => {
    const { pad, input, clock } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    input.failNext = "button";
    await pad.handle("d1", m("pad.release", {}));
    await flush();
    expect(pad.state().holding.left).toBe(true);
    clock.advance(1_100);
    await flush();
    expect(input.heldNow().left).toBe(false);
    expect(pad.state().holding.left).toBe(false);
  });

  it("el límite de ritmo nunca descarta soltar: up, release y commit/cancel de Alt+Tab pasan siempre", async () => {
    const { pad, input } = setup();
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    await pad.handle("d1", m("pad.altTab", { step: "start" }));
    for (let i = 0; i < 30; i++) await pad.handle("d1", m("pad.key", { key: "a", mods: [] }));
    expect(await pad.handle("d1", m("pad.key", { key: "a", mods: [] }))).toEqual({ ok: false, reason: "busy" });
    expect(await pad.handle("d1", m("pad.altTab", { step: "commit" }))).toEqual({ ok: true });
    expect(await pad.handle("d1", m("pad.button", { button: "left", action: "up" }))).toEqual({ ok: true });
    expect(input.heldNow()).toEqual({ left: false, alt: false });
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    expect(await pad.handle("d1", m("pad.release", {}))).toEqual({ ok: true });
    expect(input.heldNow().left).toBe(false);
  });

  it("un clic o down que llega después de un movimiento sale DESPUÉS de ese movimiento", async () => {
    const { pad, input, clock } = setup();
    pad.handle("d1", m("pad.move", { dx: 10, dy: 0 }));
    await flush();
    clock.advance(400); // el cursor queda viejo: el próximo movimiento lo vuelve a leer
    let release!: () => void;
    input.cursorGate = new Promise<void>((r) => (release = r));
    pad.handle("d1", m("pad.move", { dx: 50, dy: 0 }));
    const click = pad.handle("d1", m("pad.button", { button: "left", action: "click" }));
    await flush();
    expect(input.of("button")).toEqual([]); // espera a que el movimiento se aplique
    input.cursorGate = null;
    release();
    await click;
    const ops = input.calls.map((c) => c.op);
    expect(ops.lastIndexOf("moveAbs")).toBeLessThan(ops.indexOf("button"));
  });
});

describe("revisión de cierre: la cola de escritura obedece a la llave", () => {
  it("tiene tope: con la cola llena, lo siguiente contesta busy", async () => {
    const { pad, input, clock } = setup();
    hold(input);
    const results: Array<Promise<unknown> | "silent"> = [];
    for (let i = 0; i < 100; i++) {
      results.push(pad.handle("d1", m("pad.type", { backspaces: 0, text: "a" })));
      if (i % 25 === 24) clock.advance(1_000); // se renueva el balde de ritmo: lo que corta es el tope de la cola
    }
    const settled = await Promise.all(results.map((r) => Promise.race([r, flush().then(() => "pendiente")])));
    const busy = settled.filter((r) => (r as { reason?: string }).reason === "busy");
    expect(busy.length).toBeGreaterThan(0);
  });

  it("apagar la llave descarta lo que estaba esperando (no sigue tecleando)", async () => {
    const { pad, input } = setup();
    const release = hold(input);
    const first = pad.handle("d1", m("pad.type", { backspaces: 0, text: "uno" }));
    const queued = [2, 3, 4].map((i) => pad.handle("d1", m("pad.type", { backspaces: 0, text: `n${i}` })));
    await flush();
    await pad.setEnabled(false);
    release();
    await Promise.all([first, ...queued]);
    await flush();
    const typed = input.of("text").map((c) => String.fromCharCode(...c.units));
    expect(typed).not.toContain("n2");
    expect(typed).not.toContain("n4");
  });

  it("soltar todo también descarta lo que esperaba", async () => {
    const { pad, input } = setup();
    const release = hold(input);
    const first = pad.handle("d1", m("pad.key", { key: "a", mods: [] }));
    const queued = pad.handle("d1", m("pad.key", { key: "b", mods: [] }));
    await flush();
    const rel = pad.handle("d1", m("pad.release", {}));
    release();
    await Promise.all([first, queued, rel]);
    const keys = input.of("keys").flatMap((c) => c.events.map((e) => e[0]));
    expect(keys).not.toContain(0x42); // la B no se escribió
  });

  it("si el celu se desconecta, lo suyo que esperaba no se escribe", async () => {
    const { pad, input } = setup();
    pad.connect("d1");
    const release = hold(input);
    const first = pad.handle("d1", m("pad.key", { key: "a", mods: [] }));
    const queued = pad.handle("d1", m("pad.key", { key: "c", mods: [] }));
    await flush();
    pad.disconnect("d1");
    release();
    await Promise.all([first, queued]);
    const keys = input.of("keys").flatMap((c) => c.events.map((e) => e[0]));
    expect(keys).not.toContain(0x43);
  });
});

describe("revisión de cierre: reconexión del mismo celu", () => {
  it("cerrar la sesión vieja no suelta lo que está haciendo la nueva", async () => {
    const { pad, input } = setup();
    pad.connect("d1"); // sesión vieja
    pad.connect("d1"); // el celu reconectó antes de que se cerrara la vieja
    await pad.handle("d1", m("pad.button", { button: "left", action: "down" }));
    pad.disconnect("d1"); // se cierra la vieja
    await flush();
    expect(input.heldNow().left).toBe(true);
    pad.disconnect("d1"); // se cierra la nueva
    await flush();
    expect(input.heldNow().left).toBe(false);
  });
});
