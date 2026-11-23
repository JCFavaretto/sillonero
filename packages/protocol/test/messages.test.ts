import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_BYTES } from "../src/constants";
import { parseClientMessage, parseServerMessage } from "../src/messages";

const UUID = "3f2b8c1e-5d4a-4b7e-9c3a-1f2e3d4c5b6a";
const TOKEN = "B".repeat(43); // 32 bytes
const STATE = {
  hostname: "DESKTOP-PSB9K0R",
  agentVersion: "0.1.0",
  uptimeSec: 8100,
  cpuPercent: 23.5,
  memUsedBytes: 10_500_000_000,
  memTotalBytes: 17_000_000_000,
  sampledAt: 1_800_000_000_000,
};
const env = (type: string, payload: unknown, extra: object = {}) =>
  JSON.stringify({ v: 1, id: "m1", type, payload, ...extra });

describe("parseClientMessage (celu → agente)", () => {
  it("device.unpair válido (Olvidar en el celu); con campos extra no", () => {
    expect(parseClientMessage(env("device.unpair", {})).ok).toBe(true);
    expect(parseClientMessage(env("device.unpair", { x: 1 }))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("pair.request, auth.hello y auth.error ya no existen: los reemplaza el handshake", () => {
    for (const t of ["pair.request", "auth.hello", "auth.error"]) {
      expect(parseClientMessage(env(t, {})), t).toMatchObject({ ok: false, code: "unknown_type" });
      expect(parseServerMessage(env(t, {})), t).toMatchObject({ ok: false, code: "unknown_type" });
    }
  });

  it("ping válido; con campos extra no", () => {
    expect(parseClientMessage(env("ping", {})).ok).toBe(true);
    expect(parseClientMessage(env("ping", { x: 1 }))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("un mensaje del agente no lo puede mandar el celu → unknown_type", () => {
    for (const t of ["auth.ok", "state.update", "pong", "pair.result", "error"]) {
      expect(parseClientMessage(env(t, {})), t).toMatchObject({ ok: false, code: "unknown_type" });
    }
  });

  it("type inventado → unknown_type", () => {
    expect(parseClientMessage(env("monitor.toggle", {}))).toMatchObject({ ok: false, code: "unknown_type" });
  });

  it("deja pasar los errores de sobre: bad_json, too_large, incompatible", () => {
    expect(parseClientMessage("{roto")).toMatchObject({ ok: false, code: "bad_json" });
    expect(parseClientMessage("x".repeat(MAX_MESSAGE_BYTES + 1))).toMatchObject({ ok: false, code: "too_large" });
    expect(parseClientMessage(env("ping", {}, { v: 2 }))).toMatchObject({ ok: false, code: "incompatible" });
  });

  it("el detalle del error es legible", () => {
    const r = parseClientMessage(env("ping", { extra: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/extra/);
  });
});

describe("parseServerMessage (agente → celu)", () => {
  it("pair.pending y pong válidos", () => {
    expect(parseServerMessage(env("pair.pending", {})).ok).toBe(true);
    expect(parseServerMessage(env("pong", {})).ok).toBe(true);
  });

  it("pair.result ok:true trae deviceId y pcName (sin token: la identidad es la clave)", () => {
    const ok = { ok: true, deviceId: UUID, pcName: "DESKTOP-PSB9K0R" };
    expect(parseServerMessage(env("pair.result", ok)).ok).toBe(true);
    expect(parseServerMessage(env("pair.result", { ok: true, deviceId: UUID }))).toMatchObject({ ok: false, code: "bad_message" });
    expect(parseServerMessage(env("pair.result", { ...ok, token: TOKEN }))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it.each(["rejected", "timeout"])("pair.result ok:false con motivo %s", (reason) => {
    expect(parseServerMessage(env("pair.result", { ok: false, reason })).ok).toBe(true);
  });

  it("pair.result ok:false con un motivo del handshake o desconocido → bad_message", () => {
    for (const reason of ["busy", "invalid_code", "nope"]) {
      expect(parseServerMessage(env("pair.result", { ok: false, reason })), reason).toMatchObject({ ok: false, code: "bad_message" });
    }
  });

  it("auth.ok válido", () => {
    expect(parseServerMessage(env("auth.ok", { pcName: "PC", agentVersion: "0.1.0" })).ok).toBe(true);
  });

  it.each(["state.snapshot", "state.update"])("%s válido", (type) => {
    expect(parseServerMessage(env(type, STATE)).ok).toBe(true);
  });

  it.each([
    ["cpu mayor a 100", { ...STATE, cpuPercent: 100.1 }],
    ["cpu negativa", { ...STATE, cpuPercent: -1 }],
    ["RAM total en cero", { ...STATE, memTotalBytes: 0 }],
    ["uptime negativo", { ...STATE, uptimeSec: -5 }],
    ["uptime con decimales", { ...STATE, uptimeSec: 1.5 }],
    ["falta hostname", { ...STATE, hostname: undefined }],
    ["hostname largo", { ...STATE, hostname: "x".repeat(65) }],
    ["campo extra", { ...STATE, procesos: 3 }],
  ])("state.update inválido: %s → bad_message", (_n, payload) => {
    expect(parseServerMessage(env("state.update", payload))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("error válido con y sin replyTo; código desconocido no", () => {
    expect(parseServerMessage(env("error", { code: "bad_json", message: "roto" })).ok).toBe(true);
    expect(parseServerMessage(env("error", { code: "rate_limited", message: "x", replyTo: "m9" })).ok).toBe(true);
    expect(parseServerMessage(env("error", { code: "inventado", message: "x" }))).toMatchObject({ ok: false, code: "bad_message" });
    expect(parseServerMessage(env("error", { code: "internal", message: "x".repeat(201) }))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("un mensaje del celu no lo puede mandar el agente → unknown_type", () => {
    for (const t of ["device.unpair", "ping"]) {
      expect(parseServerMessage(env(t, {})), t).toMatchObject({ ok: false, code: "unknown_type" });
    }
  });

  it("v distinta → incompatible", () => {
    expect(parseServerMessage(env("pong", {}, { v: 3 }))).toMatchObject({ ok: false, code: "incompatible" });
  });
});
