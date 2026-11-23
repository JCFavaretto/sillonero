import { describe, expect, it } from "vitest";
import { originAllowed } from "../src/net/originAllowed";

const OWN = ["192.168.100.5", "10.0.0.7"];

describe("originAllowed (D14)", () => {
  it("sin Origin pasa: no es un navegador (la app de React Native puede no mandarlo)", () => {
    expect(originAllowed(undefined, OWN, 47800)).toBe(true);
  });

  it("el que manda React Native por defecto: http://<IP propia>:<puerto del WS>", () => {
    expect(originAllowed("http://192.168.100.5:47800", OWN, 47800)).toBe(true);
    expect(originAllowed("http://10.0.0.7:47800", OWN, 47800)).toBe(true);
  });

  it.each([
    ["una web cualquiera", "http://evil.com"],
    ["una web con puerto", "http://evil.com:47800"],
    ["la IP propia pero otro puerto", "http://192.168.100.5:47801"],
    ["la IP propia sin puerto", "http://192.168.100.5"],
    ["https", "https://192.168.100.5:47800"],
    ["la IP de otra máquina de la red", "http://192.168.100.9:47800"],
    ["el panel local", "http://127.0.0.1:47801"],
    ["null (páginas sandbox o file://)", "null"],
    ["vacío", ""],
    ["con camino", "http://192.168.100.5:47800/"],
    ["con mayúsculas raras en el esquema", "HTTP://192.168.100.5:47800"],
    ["con espacios", " http://192.168.100.5:47800"],
  ])("rechaza %s", (_n, origin) => {
    expect(originAllowed(origin, OWN, 47800)).toBe(false);
  });

  it("127.0.0.1 solo si se pide (tests de integración)", () => {
    expect(originAllowed("http://127.0.0.1:47800", OWN, 47800)).toBe(false);
    expect(originAllowed("http://127.0.0.1:47800", OWN, 47800, { allowLoopback: true })).toBe(true);
  });

  it("sin direcciones propias solo pasan los que no mandan Origin", () => {
    expect(originAllowed("http://192.168.100.5:47800", [], 47800)).toBe(false);
    expect(originAllowed(undefined, [], 47800)).toBe(true);
  });
});
