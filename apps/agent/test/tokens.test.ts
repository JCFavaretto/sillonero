import { describe, expect, it } from "vitest";
import { Hs1Payload } from "@proyecto-e/protocol";
import { generatePairCode, safeEqual } from "../src/pairing/tokens";
import { FakeRandom } from "./fakes";
import { cryptoRandom } from "../src/platform/random";

// Desde v2 no hay tokens de dispositivo (la identidad es la clave pública de Noise): queda el código del QR.
describe("código de emparejamiento", () => {
  it("tiene 22 caracteres base64url (16 bytes)", () => {
    expect(generatePairCode(new FakeRandom())).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("es válido para el esquema del handshake (hs1 pair)", () => {
    const code = generatePairCode(cryptoRandom);
    const payload = { intent: "pair", code, deviceName: "Pixel", platform: "android", appVersion: "0.1.0" };
    expect(Hs1Payload.safeParse(payload).success).toBe(true);
  });

  it("dos códigos reales no se repiten", () => {
    expect(generatePairCode(cryptoRandom)).not.toBe(generatePairCode(cryptoRandom));
  });

  it("safeEqual compara en tiempo constante y tolera largos distintos", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
