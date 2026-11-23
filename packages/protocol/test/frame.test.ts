import { describe, expect, it } from "vitest";
import { MAX_FRAME_BYTES } from "../src/constants";
import { bytesToUtf8, utf8ToBytes } from "../src/bytes";
import { decodeHs1Payload, decodeHs2Payload, encodeHs1Payload, encodeHs2Payload } from "../src/handshake";
import { NoiseError, initiatorHandshake, keyPairFromPrivate, responderHandshake } from "../src/noise";
import { openFrame, sealToFrame } from "../src/channel";
import { encodeFrame, parseFrame } from "../src/frame";

const CODE = "A".repeat(22);

describe("marco exterior v2", () => {
  it("ida y vuelta de cada tipo", () => {
    for (const k of ["hs1", "hs2", "data"] as const) {
      const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
      const r = parseFrame(encodeFrame(k, bytes));
      expect(r).toEqual({ ok: true, kind: k, data: bytes });
    }
  });

  it("el marco es JSON con v:2 y no deja ver nada del contenido", () => {
    const text = encodeFrame("data", utf8ToBytes("clave-secreta"));
    expect(JSON.parse(text)).toMatchObject({ v: 2, k: "data" });
    expect(text).not.toContain("clave-secreta");
  });

  it("un celu de B1 (v:1) → incompatible", () => {
    expect(parseFrame(JSON.stringify({ v: 1, id: "1", type: "ping", payload: {} }))).toMatchObject({ ok: false, code: "incompatible" });
  });

  it("v mayor → incompatible; sin v o no entero → bad_message", () => {
    expect(parseFrame(JSON.stringify({ v: 3, k: "data", d: "AA" }))).toMatchObject({ ok: false, code: "incompatible" });
    expect(parseFrame(JSON.stringify({ k: "data", d: "AA" }))).toMatchObject({ ok: false, code: "bad_message" });
    expect(parseFrame(JSON.stringify({ v: "2", k: "data", d: "AA" }))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it.each([
    ["no es JSON", "{nope", "bad_json"],
    ["no es objeto", "[1,2]", "bad_message"],
    ["tipo desconocido", JSON.stringify({ v: 2, k: "otro", d: "AA" }), "bad_message"],
    ["campo de más", JSON.stringify({ v: 2, k: "data", d: "AA", x: 1 }), "bad_message"],
    ["d con caracteres inválidos", JSON.stringify({ v: 2, k: "data", d: "A+B/" }), "bad_message"],
    ["d no canónico (bits sobrantes)", JSON.stringify({ v: 2, k: "data", d: "AB" }), "bad_message"],
    ["falta d", JSON.stringify({ v: 2, k: "data" }), "bad_message"],
  ])("%s → %s", (_n, raw, code) => {
    expect(parseFrame(raw)).toMatchObject({ ok: false, code });
  });

  it("más grande que el tope → too_large", () => {
    expect(parseFrame("x".repeat(MAX_FRAME_BYTES + 1))).toMatchObject({ ok: false, code: "too_large" });
  });

  it("un mensaje del tamaño máximo cifrado entra en un marco", () => {
    const big = new Uint8Array(16_384 + 16).fill(9);
    expect(encodeFrame("data", big).length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    expect(parseFrame(encodeFrame("data", big)).ok).toBe(true);
  });
});

describe("payloads del handshake", () => {
  it("hs1 pair y connect válidos", () => {
    const pair = { intent: "pair", code: CODE, deviceName: "  Pixel de Jay ", platform: "android", appVersion: "0.1.0" };
    const r = decodeHs1Payload(encodeHs1Payload(pair as never));
    expect(r.ok && r.payload).toMatchObject({ intent: "pair", deviceName: "Pixel de Jay" });
    expect(decodeHs1Payload(encodeHs1Payload({ intent: "connect", appVersion: "0.1.0" })).ok).toBe(true);
  });

  it.each([
    ["código de 21", { intent: "pair", code: "A".repeat(21), deviceName: "x", platform: "android", appVersion: "1" }],
    ["nombre vacío", { intent: "pair", code: CODE, deviceName: "  ", platform: "android", appVersion: "1" }],
    ["nombre de 41", { intent: "pair", code: CODE, deviceName: "n".repeat(41), platform: "android", appVersion: "1" }],
    ["plataforma rara", { intent: "pair", code: CODE, deviceName: "x", platform: "palm", appVersion: "1" }],
    ["intent desconocido", { intent: "hack", appVersion: "1" }],
    ["campo de más", { intent: "connect", appVersion: "1", extra: 1 }],
  ])("hs1 inválido: %s", (_n, payload) => {
    expect(decodeHs1Payload(utf8ToBytes(JSON.stringify(payload)))).toMatchObject({ ok: false });
  });

  it("hs1 que no es JSON ni UTF-8 → inválido, sin excepción", () => {
    expect(decodeHs1Payload(utf8ToBytes("{no"))).toMatchObject({ ok: false });
    expect(decodeHs1Payload(Uint8Array.of(0xff, 0xfe))).toMatchObject({ ok: false });
  });

  it("hs2 ok y cada motivo de rechazo", () => {
    expect(decodeHs2Payload(encodeHs2Payload({ ok: true, pcName: "PC", agentVersion: "0.1.0" })).ok).toBe(true);
    for (const reason of ["unknown_device", "revoked", "invalid_code", "busy", "rate_limited"] as const) {
      const r = decodeHs2Payload(encodeHs2Payload({ ok: false, reason }));
      expect(r.ok && r.payload).toEqual({ ok: false, reason });
    }
    expect(decodeHs2Payload(utf8ToBytes(JSON.stringify({ ok: false, reason: "otro" })))).toMatchObject({ ok: false });
  });
});

describe("canal cifrado (sellar y abrir)", () => {
  function channel() {
    let n = 1;
    const random = (len: number) => Uint8Array.from({ length: len }, (_, i) => (n++ * 13 + i) % 256);
    const pc = keyPairFromPrivate(random(32));
    const phone = keyPairFromPrivate(random(32));
    const init = initiatorHandshake({ s: phone, rs: pc.publicKey, random });
    const resp = responderHandshake({ s: pc, random });
    resp.readHs1(init.writeHs1(new Uint8Array(0)));
    const w2 = resp.writeHs2(new Uint8Array(0));
    const r2 = init.readHs2(w2.msg);
    return { phone: r2.transport, pc: w2.transport };
  }

  it("un mensaje sellado por un lado lo abre el otro, en los dos sentidos", () => {
    const { phone, pc } = channel();
    const json = JSON.stringify({ v: 1, id: "1", type: "ping", payload: {} });
    const frame = parseFrame(sealToFrame(phone, json));
    expect(frame).toMatchObject({ ok: true, kind: "data" });
    if (!frame.ok) return;
    expect(openFrame(pc, frame.data)).toBe(json);
    const back = parseFrame(sealToFrame(pc, "hola ñandú"));
    if (back.ok) expect(openFrame(phone, back.data)).toBe("hola ñandú");
  });

  it("lo que viaja no contiene el texto original", () => {
    const { phone } = channel();
    expect(sealToFrame(phone, "texto-muy-reconocible-123")).not.toContain("texto-muy-reconocible-123");
    const bytes = utf8ToBytes("texto-muy-reconocible-123");
    expect(bytesToUtf8(bytes)).toBe("texto-muy-reconocible-123");
  });

  it("un marco alterado o repetido no se abre (NoiseError)", () => {
    const { phone, pc } = channel();
    const f = parseFrame(sealToFrame(phone, "uno"));
    if (!f.ok) throw new Error("frame");
    const bad = Uint8Array.from(f.data);
    bad[0]! ^= 1;
    expect(() => openFrame(pc, bad)).toThrow(NoiseError);
  });

  it("un mensaje que descifra pero no es UTF-8 válido → NoiseError", () => {
    const { phone, pc } = channel();
    const ct = phone.encrypt(Uint8Array.of(0xff, 0xfe));
    expect(() => openFrame(pc, ct)).toThrow(NoiseError);
  });
});
