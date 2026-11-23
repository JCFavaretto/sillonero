import { describe, expect, it } from "vitest";
import { base64UrlEncode } from "../src/base64url";
import { decodeQr, encodeQr, type QrPayload } from "../src/qr";

const NOW = 1_800_000_000_000;
const payload: QrPayload = {
  v: 2,
  host: "192.168.100.5",
  port: 47800,
  name: "DESKTOP-PSB9K0R",
  code: "AAAAAAAAAAAAAAAAAAAAAA", // 22 caracteres = 16 bytes
  exp: NOW + 120_000,
  pk: "C".repeat(43), // clave pública de la PC (32 bytes)
};
const qr = (obj: unknown) => "pe2:" + base64UrlEncode(JSON.stringify(obj));

describe("encodeQr / decodeQr", () => {
  it("ida y vuelta da lo mismo", () => {
    const r = decodeQr(encodeQr(payload), NOW);
    expect(r).toEqual({ ok: true, payload });
  });

  it("el texto empieza con pe2: y es base64url (sin + / =)", () => {
    const text = encodeQr(payload);
    expect(text.startsWith("pe2:")).toBe(true);
    expect(text.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("conserva nombres con tildes y emoji", () => {
    const p = { ...payload, name: "PC de Jay 😀 ñandú" };
    expect(decodeQr(encodeQr(p), NOW)).toEqual({ ok: true, payload: p });
  });

  it("encodeQr no deja codificar un payload inválido", () => {
    expect(() => encodeQr({ ...payload, host: "8.8.8.8" })).toThrow();
    expect(() => encodeQr({ ...payload, port: 80 })).toThrow();
    expect(() => encodeQr({ ...payload, code: "corto" })).toThrow();
    expect(() => encodeQr({ ...payload, pk: "corta" })).toThrow();
  });

  describe("motivos de rechazo", () => {
    it("not_ours: texto que no empieza con pe2:", () => {
      for (const t of ["https://ejemplo.com", "", "pe3:abc", "PE2:abc", "wifi:S:casa;;"]) {
        expect(decodeQr(t, NOW)).toEqual({ ok: false, reason: "not_ours" });
      }
    });

    it("bad_format: base64 inválido, JSON roto o campos que no cuadran", () => {
      const casos = [
        "pe2:",
        "pe2:!!!",
        "pe2:" + base64UrlEncode("{no es json"),
        qr([]),
        qr(null),
        qr({ ...payload, extra: 1 }),
        qr({ ...payload, v: 1 }),
        qr({ ...payload, pk: "C".repeat(42) }),
        qr({ ...payload, pk: "C".repeat(42) + "+" }),
        qr({ ...payload, pk: undefined }),
        qr({ ...payload, port: "47800" }),
        qr({ ...payload, port: 80 }),
        qr({ ...payload, port: 70000 }),
        qr({ ...payload, name: "" }),
        qr({ ...payload, name: "x".repeat(65) }),
        qr({ ...payload, code: "corto" }),
        qr({ ...payload, code: "A".repeat(21) + "+" }),
        qr({ ...payload, exp: "mañana" }),
        qr({ ...payload, host: undefined }),
      ];
      for (const t of casos) {
        expect(decodeQr(t, NOW), t).toEqual({ ok: false, reason: "bad_format" });
      }
    });

    it("old_version: un QR de B1 (pe1:) se reconoce y se explica", () => {
      expect(decodeQr("pe1:" + base64UrlEncode(JSON.stringify({ v: 1 })), NOW)).toEqual({ ok: false, reason: "old_version" });
      expect(decodeQr("pe1:", NOW)).toEqual({ ok: false, reason: "old_version" });
    });

    it("host_not_private: IP pública, CGNAT, loopback, IPv6 o nombre", () => {
      for (const host of ["8.8.8.8", "100.64.0.1", "127.0.0.1", "169.254.1.1", "::1", "pc.local"]) {
        expect(decodeQr(qr({ ...payload, host }), NOW), host).toEqual({ ok: false, reason: "host_not_private" });
      }
    });

    it("expired: ya pasó la hora de vencimiento (now >= exp)", () => {
      expect(decodeQr(encodeQr(payload), payload.exp - 1).ok).toBe(true);
      expect(decodeQr(encodeQr(payload), payload.exp)).toEqual({ ok: false, reason: "expired" });
      expect(decodeQr(encodeQr(payload), payload.exp + 60_000)).toEqual({ ok: false, reason: "expired" });
    });

    it("el orden es not_ours → bad_format → host_not_private → expired", () => {
      const vencidoYPublico = qr({ ...payload, host: "8.8.8.8", exp: NOW - 1 });
      expect(decodeQr(vencidoYPublico, NOW)).toEqual({ ok: false, reason: "host_not_private" });
    });
  });
});
