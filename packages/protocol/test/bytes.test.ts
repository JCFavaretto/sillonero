import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "../src/base64url";
import { base64UrlToBytes, bytesEqual, bytesToBase64Url, bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from "../src/bytes";

describe("bytes", () => {
  it("base64url de bytes: ida y vuelta para todos los largos de 0 a 70", () => {
    for (let n = 0; n <= 70; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) % 256);
      const text = bytesToBase64Url(b);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64UrlToBytes(text)).toEqual(b);
    }
  });

  it("32 bytes dan 43 caracteres (el largo que usan las claves en el protocolo)", () => {
    expect(bytesToBase64Url(new Uint8Array(32)).length).toBe(43);
  });

  it("rechaza lo no canónico: relleno, caracteres raros, largo imposible, bits sobrantes", () => {
    expect(base64UrlToBytes("AA==")).toBeNull();
    expect(base64UrlToBytes("A+B/")).toBeNull();
    expect(base64UrlToBytes("A")).toBeNull();
    expect(base64UrlToBytes("AB")).toBeNull(); // bits sobrantes no cero
  });

  it("sigue siendo compatible con las funciones de texto de antes", () => {
    expect(base64UrlDecode(base64UrlEncode("canción ñandú 🎮"))).toBe("canción ñandú 🎮");
    expect(base64UrlToBytes(base64UrlEncode("hola"))).toEqual(utf8ToBytes("hola"));
  });

  it("UTF-8: ida y vuelta y rechazo de bytes inválidos", () => {
    expect(bytesToUtf8(utf8ToBytes("Tele living ★"))).toBe("Tele living ★");
    expect(bytesToUtf8(Uint8Array.of(0xc0, 0x80))).toBeNull();
    expect(bytesToUtf8(Uint8Array.of(0xff))).toBeNull();
  });

  it("hex: ida y vuelta y errores", () => {
    expect(bytesToHex(Uint8Array.of(0, 15, 16, 255))).toBe("000f10ff");
    expect(hexToBytes("000F10ff")).toEqual(Uint8Array.of(0, 15, 16, 255));
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("zz")).toThrow();
  });

  it("bytesEqual", () => {
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(bytesEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
  });
});
