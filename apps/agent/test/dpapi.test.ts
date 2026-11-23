import { describe, expect, it } from "vitest";
import { createDpapiSecret } from "../src/platform/win/dpapi";

// DPAPI real: solo en memoria, con la cuenta de Windows de quien corre el test (no toca el registro ni el disco).
describe.skipIf(process.platform !== "win32")("dpapi (Windows real)", () => {
  const secret = createDpapiSecret();
  const plain = Uint8Array.from({ length: 32 }, (_, i) => i * 7);

  it("cifra y vuelve a abrir los mismos bytes", () => {
    const cipher = secret.protect(plain);
    expect(cipher.length).toBeGreaterThan(plain.length);
    expect(Buffer.from(cipher).includes(Buffer.from(plain))).toBe(false); // no queda en claro adentro
    expect([...secret.unprotect(cipher)]).toEqual([...plain]);
  });

  it("dos cifrados del mismo texto no son iguales (lleva sal), y los dos abren", () => {
    const a = secret.protect(plain);
    const b = secret.protect(plain);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect([...secret.unprotect(b)]).toEqual([...plain]);
  });

  it("basura no se abre: rechaza en vez de devolver cualquier cosa", () => {
    expect(() => secret.unprotect(Uint8Array.from([1, 2, 3, 4, 5]))).toThrow(/CryptUnprotectData/);
  });

  it("algo vacío lo rechaza Windows: error normal, el proceso no se rompe", () => {
    expect(() => secret.protect(new Uint8Array(0))).toThrow(/CryptProtectData/);
  });
});
