import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage } from "../src/messages";
import { Foreground, Monitor, ScreensState } from "../src/screens";

const MON = {
  id: "m_AbCdEfGhIjKlMnOp",
  index: 1,
  nickname: null,
  name: "DELL U2412M",
  connector: "displayport",
  enabled: true,
  primary: false,
  bounds: { x: 0, y: 0, w: 1920, h: 1080 },
  lastBounds: { x: 0, y: 0, w: 1920, h: 1080 },
  resolution: { w: 1920, h: 1080 },
  canDisable: true,
  blockedBy: null,
  busy: false,
};

describe("Monitor", () => {
  it("acepta una pantalla prendida", () => {
    expect(Monitor.safeParse(MON).success).toBe(true);
  });

  it("acepta una apagada: sin número, sin bounds, con lastBounds", () => {
    const off = { ...MON, index: null, enabled: false, bounds: null, resolution: null, canDisable: false };
    expect(Monitor.safeParse(off).success).toBe(true);
  });

  it("rechaza un id mal formado", () => {
    expect(Monitor.safeParse({ ...MON, id: "otra-cosa" }).success).toBe(false);
    expect(Monitor.safeParse({ ...MON, id: "m_corto" }).success).toBe(false);
  });

  it("rechaza un apodo de 33 caracteres y acepta uno de 32", () => {
    expect(Monitor.safeParse({ ...MON, nickname: "a".repeat(33) }).success).toBe(false);
    expect(Monitor.safeParse({ ...MON, nickname: "a".repeat(32) }).success).toBe(true);
  });

  it("rechaza un conector desconocido y un blockedBy inválido", () => {
    expect(Monitor.safeParse({ ...MON, connector: "usb" }).success).toBe(false);
    expect(Monitor.safeParse({ ...MON, blockedBy: "nope" }).success).toBe(false);
  });

  it("rechaza campos de más", () => {
    expect(Monitor.safeParse({ ...MON, extra: 1 }).success).toBe(false);
  });
});

describe("Foreground y ScreensState", () => {
  it("la ventana activa puede no tener pantalla", () => {
    expect(Foreground.safeParse({ title: "x", app: "y.exe", monitorId: null }).success).toBe(true);
  });

  it("el estado lleva pantallas y ventana activa (o null)", () => {
    expect(ScreensState.safeParse({ monitors: [MON], foreground: null }).success).toBe(true);
    expect(ScreensState.safeParse({ monitors: [], foreground: null }).success).toBe(true);
    expect(ScreensState.safeParse({ monitors: [MON] }).success).toBe(false);
  });

  it("tope de 16 pantallas", () => {
    expect(ScreensState.safeParse({ monitors: Array(17).fill(MON), foreground: null }).success).toBe(false);
  });
});

describe("mensajes screens.snapshot y screens.update", () => {
  const state = { monitors: [MON], foreground: null };
  const wire = (type: string, payload: unknown) => JSON.stringify({ v: 1, id: "7", type, payload });

  it.each(["screens.snapshot", "screens.update"])("%s llega al celu con el estado", (type) => {
    const r = parseServerMessage(wire(type, state));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg.type).toBe(type);
  });

  it("un estado inválido es bad_message", () => {
    const r = parseServerMessage(wire("screens.update", { monitors: "no", foreground: null }));
    expect(r).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("el celu no puede mandarlos (son solo del agente)", () => {
    expect(parseClientMessage(wire("screens.update", state))).toMatchObject({ ok: false, code: "unknown_type" });
  });
});

describe("monitor.rename y command.result (R4)", () => {
  const wire = (type: string, payload: unknown, id = "9") => JSON.stringify({ v: 1, id, type, payload });
  const ID = "m_AbCdEfGhIjKlMnOp";

  it("monitor.rename válido, con apodo o con null (sacar el apodo)", () => {
    for (const nickname of ["Tele living", null]) {
      expect(parseClientMessage(wire("monitor.rename", { monitorId: ID, nickname })).ok, String(nickname)).toBe(true);
    }
  });

  it("el apodo se recorta; vacío, solo espacios o de 33 caracteres se rechazan", () => {
    const r = parseClientMessage(wire("monitor.rename", { monitorId: ID, nickname: "  Tele  " }));
    expect(r.ok && r.msg.type === "monitor.rename" && r.msg.payload.nickname).toBe("Tele");
    for (const nickname of ["", "   ", "a".repeat(33)]) {
      expect(parseClientMessage(wire("monitor.rename", { monitorId: ID, nickname })), nickname).toMatchObject({ ok: false, code: "bad_message" });
    }
  });

  it("monitor.rename con id mal formado o campos de más → bad_message", () => {
    expect(parseClientMessage(wire("monitor.rename", { monitorId: "otro", nickname: "x" }))).toMatchObject({ ok: false });
    expect(parseClientMessage(wire("monitor.rename", { monitorId: ID, nickname: "x", extra: 1 }))).toMatchObject({ ok: false });
  });

  it("command.result llega al celu, con éxito o con un motivo conocido", () => {
    expect(parseServerMessage(wire("command.result", { replyTo: "c7", ok: true })).ok).toBe(true);
    for (const reason of ["not_found", "primary", "last_active", "no_window", "elevated", "busy", "failed", "unsupported"]) {
      expect(parseServerMessage(wire("command.result", { replyTo: "c7", ok: false, reason })).ok, reason).toBe(true);
    }
    expect(parseServerMessage(wire("command.result", { replyTo: "c7", ok: false, reason: "otro" }))).toMatchObject({ ok: false });
    expect(parseServerMessage(wire("command.result", { ok: true }))).toMatchObject({ ok: false });
  });

  it("los comandos los manda el celu y el resultado el agente, no al revés", () => {
    expect(parseServerMessage(wire("monitor.rename", { monitorId: ID, nickname: "x" }))).toMatchObject({ ok: false, code: "unknown_type" });
    expect(parseClientMessage(wire("command.result", { replyTo: "c", ok: true }))).toMatchObject({ ok: false, code: "unknown_type" });
  });
});

describe("monitor.setEnabled (R5)", () => {
  const wire = (payload: unknown) => JSON.stringify({ v: 1, id: "9", type: "monitor.setEnabled", payload });
  const ID = "m_AbCdEfGhIjKlMnOp";

  it("prender y apagar válidos", () => {
    expect(parseClientMessage(wire({ monitorId: ID, enabled: true })).ok).toBe(true);
    expect(parseClientMessage(wire({ monitorId: ID, enabled: false })).ok).toBe(true);
  });

  it.each([
    ["sin enabled", { monitorId: ID }],
    ["enabled que no es booleano", { monitorId: ID, enabled: "si" }],
    ["id mal formado", { monitorId: "otro", enabled: true }],
    ["campo de más", { monitorId: ID, enabled: true, force: true }],
  ])("inválido: %s → bad_message", (_n, payload) => {
    expect(parseClientMessage(wire(payload))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("solo lo manda el celu", () => {
    expect(parseServerMessage(wire({ monitorId: ID, enabled: true }))).toMatchObject({ ok: false, code: "unknown_type" });
  });
});

describe("window.moveActive (R6)", () => {
  const wire = (payload: unknown) => JSON.stringify({ v: 1, id: "9", type: "window.moveActive", payload });
  const ID = "m_AbCdEfGhIjKlMnOp";

  it("válido: manda la ventana activa a una pantalla", () => {
    expect(parseClientMessage(wire({ monitorId: ID })).ok).toBe(true);
  });

  it.each([
    ["sin pantalla", {}],
    ["id mal formado", { monitorId: "uno" }],
    ["campo de más (el celu no elige la ventana: es la activa de la PC)", { monitorId: ID, windowId: "0x1" }],
  ])("inválido: %s → bad_message", (_n, payload) => {
    expect(parseClientMessage(wire(payload))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("solo lo manda el celu", () => {
    expect(parseServerMessage(wire({ monitorId: ID }))).toMatchObject({ ok: false, code: "unknown_type" });
  });
});

describe("monitor.identify (R7)", () => {
  const wire = (payload: unknown) => JSON.stringify({ v: 1, id: "9", type: "monitor.identify", payload });

  it("válido y vacío: es un pedido sin datos", () => {
    expect(parseClientMessage(wire({})).ok).toBe(true);
  });

  it("con datos de más → bad_message (el celu no puede mandarle nada a la PC para mostrar)", () => {
    expect(parseClientMessage(wire({ text: "hola" }))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("solo lo manda el celu", () => {
    expect(parseServerMessage(wire({}))).toMatchObject({ ok: false, code: "unknown_type" });
  });
});

describe("monitor.setOrder (orden de las pantallas)", () => {
  const wire = (payload: unknown) => JSON.stringify({ v: 1, id: "9", type: "monitor.setOrder", payload });
  const A = "m_AaAaAaAaAaAaAaAa";
  const B = "m_BbBbBbBbBbBbBbBb";

  it("válido: la lista de pantallas de izquierda a derecha", () => {
    expect(parseClientMessage(wire({ order: [A, B] })).ok).toBe(true);
    expect(parseClientMessage(wire({ order: [A] })).ok).toBe(true);
  });

  it.each([
    ["vacía", { order: [] }],
    ["con repetidas", { order: [A, A] }],
    ["con un id mal formado", { order: [A, "otro"] }],
    ["más de 16", { order: Array.from({ length: 17 }, (_, i) => "m_" + String(i).padStart(16, "x")) }],
    ["campo de más", { order: [A], force: true }],
    ["sin order", {}],
  ])("inválido: %s → bad_message", (_n, payload) => {
    expect(parseClientMessage(wire(payload))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("solo lo manda el celu", () => {
    expect(parseServerMessage(wire({ order: [A] }))).toMatchObject({ ok: false, code: "unknown_type" });
  });
});
