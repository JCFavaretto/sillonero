import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "../src/base64url";

describe("base64url", () => {
  it.each([
    ["", ""],
    ["f", "Zg"],
    ["fo", "Zm8"],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg"],
  ])("codifica %j como %s (sin relleno)", (text, expected) => {
    expect(base64UrlEncode(text)).toBe(expected);
    expect(base64UrlDecode(expected)).toBe(text);
  });

  it("usa - y _ en lugar de + y /, y nunca =", () => {
    // ">>>" en base64 normal es "Pj4+" y "???" es "Pz8/"
    expect(base64UrlEncode(">>>")).toBe("Pj4-");
    expect(base64UrlEncode("???")).toBe("Pz8_");
  });

  it("ida y vuelta con tildes, ñ, euro y emoji (UTF-8)", () => {
    for (const s of ["ñandú", "€uro", "😀 PC de Jay", "DESKTOP-PSB9K0R", "日本語"]) {
      expect(base64UrlDecode(base64UrlEncode(s))).toBe(s);
    }
    expect(base64UrlEncode("ñ")).toBe("w7E");
  });

  it.each([["Zm9v="], ["Zm+v"], ["Zm/v"], ["Zm 9v"], ["Z"], ["Zm9vY"], ["!!!!"]])(
    "rechaza %j (devuelve null)",
    (bad) => {
      expect(base64UrlDecode(bad)).toBeNull();
    },
  );

  it("rechaza bytes que no son UTF-8 válido", () => {
    // 0xFF no es UTF-8 válido: en base64url es "_w"
    expect(base64UrlDecode("_w")).toBeNull();
  });
});
