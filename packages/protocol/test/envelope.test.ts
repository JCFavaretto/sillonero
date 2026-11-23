import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_BYTES } from "../src/constants";
import { parseEnvelope, utf8ByteLength } from "../src/envelope";

const ok = { v: 1, id: "m1", type: "ping", payload: {} };

describe("parseEnvelope", () => {
  it("acepta un sobre válido y lo devuelve tal cual", () => {
    const r = parseEnvelope(JSON.stringify(ok));
    expect(r).toEqual({ ok: true, envelope: ok });
  });

  it("acepta un payload con datos", () => {
    const msg = { v: 1, id: "m2", type: "pair.request", payload: { code: "x", deviceName: "Pixel" } };
    const r = parseEnvelope(JSON.stringify(msg));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.payload).toEqual(msg.payload);
  });

  it("rechaza un mensaje más grande que el máximo con too_large", () => {
    const big = JSON.stringify({ ...ok, payload: { x: "a".repeat(MAX_MESSAGE_BYTES) } });
    const r = parseEnvelope(big);
    expect(r).toMatchObject({ ok: false, code: "too_large" });
  });

  it("acepta un mensaje justo en el máximo", () => {
    const base = JSON.stringify({ ...ok, payload: { x: "" } });
    const pad = MAX_MESSAGE_BYTES - utf8ByteLength(base);
    const exact = JSON.stringify({ ...ok, payload: { x: "a".repeat(pad) } });
    expect(utf8ByteLength(exact)).toBe(MAX_MESSAGE_BYTES);
    expect(parseEnvelope(exact).ok).toBe(true);
  });

  it("cuenta bytes y no caracteres para el tamaño", () => {
    // "ñ" ocupa 2 bytes en UTF-8: 9000 ñ = 18000 bytes > 16384
    const msg = JSON.stringify({ ...ok, payload: { x: "ñ".repeat(9000) } });
    expect(msg.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseEnvelope(msg)).toMatchObject({ ok: false, code: "too_large" });
  });

  it("rechaza JSON roto con bad_json", () => {
    expect(parseEnvelope("{no es json")).toMatchObject({ ok: false, code: "bad_json" });
    expect(parseEnvelope("")).toMatchObject({ ok: false, code: "bad_json" });
  });

  it.each([["null"], ["[]"], ['"texto"'], ["42"], ["true"]])(
    "rechaza %s (no es un objeto) con bad_message",
    (raw) => {
      expect(parseEnvelope(raw)).toMatchObject({ ok: false, code: "bad_message" });
    },
  );

  it("sin v → bad_message", () => {
    const { v: _v, ...sinV } = ok;
    expect(parseEnvelope(JSON.stringify(sinV))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it.each([["1"], [1.5], [null], [true]])("v inválida (%j) → bad_message", (v) => {
    expect(parseEnvelope(JSON.stringify({ ...ok, v }))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("v distinta de 1 → incompatible, aunque el resto esté mal", () => {
    expect(parseEnvelope(JSON.stringify({ ...ok, v: 2 }))).toMatchObject({ ok: false, code: "incompatible" });
    // el v se mira ANTES que el resto: un sobre v2 cifrado no trae type ni payload
    const v2 = { v: 2, id: "x", enc: { nonce: "n", ct: "c" } };
    expect(parseEnvelope(JSON.stringify(v2))).toMatchObject({ ok: false, code: "incompatible" });
  });

  it("sin id, con id vacío o demasiado largo → bad_message", () => {
    const { id: _id, ...sinId } = ok;
    expect(parseEnvelope(JSON.stringify(sinId)).ok).toBe(false);
    expect(parseEnvelope(JSON.stringify({ ...ok, id: "" })).ok).toBe(false);
    expect(parseEnvelope(JSON.stringify({ ...ok, id: "a".repeat(65) })).ok).toBe(false);
  });

  it("sin type o con type vacío → bad_message", () => {
    const { type: _t, ...sinType } = ok;
    expect(parseEnvelope(JSON.stringify(sinType)).ok).toBe(false);
    expect(parseEnvelope(JSON.stringify({ ...ok, type: "" })).ok).toBe(false);
  });

  it("payload ausente o que no es objeto → bad_message", () => {
    const { payload: _p, ...sinPayload } = ok;
    expect(parseEnvelope(JSON.stringify(sinPayload)).ok).toBe(false);
    expect(parseEnvelope(JSON.stringify({ ...ok, payload: "x" })).ok).toBe(false);
    expect(parseEnvelope(JSON.stringify({ ...ok, payload: [] })).ok).toBe(false);
    expect(parseEnvelope(JSON.stringify({ ...ok, payload: null })).ok).toBe(false);
  });

  it("campo extra en el sobre → bad_message", () => {
    const r = parseEnvelope(JSON.stringify({ ...ok, extra: 1 }));
    expect(r).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("el error trae un detalle legible", () => {
    const r = parseEnvelope(JSON.stringify({ ...ok, id: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail.length).toBeGreaterThan(0);
  });
});

describe("utf8ByteLength", () => {
  it("cuenta bytes UTF-8", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("ñ")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
    expect(utf8ByteLength("")).toBe(0);
  });
});
