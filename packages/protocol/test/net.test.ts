import { describe, expect, it } from "vitest";
import { isPrivateIPv4, normalizeIp } from "../src/net";

describe("isPrivateIPv4", () => {
  it.each(["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.5", "192.168.100.5"])(
    "acepta %s",
    (ip) => {
      expect(isPrivateIPv4(ip)).toBe(true);
    },
  );

  it.each([
    "172.15.255.255",
    "172.32.0.1",
    "100.64.0.1", // CGNAT / Tailscale
    "169.254.1.1", // link-local
    "127.0.0.1", // loopback: lo decide el agente, no el protocolo
    "8.8.8.8",
    "192.169.0.1",
    "11.0.0.1",
  ])("rechaza %s (no es de red privada)", (ip) => {
    expect(isPrivateIPv4(ip)).toBe(false);
  });

  it.each([
    "::1",
    "fe80::1",
    "::ffff:192.168.1.5", // mapeada: se normaliza antes, acá no se acepta
    "abc",
    "",
    "256.1.1.1",
    "192.168.1",
    "192.168.1.5.6",
    "192.168.1.-5",
    "192.168.001.005", // ceros a la izquierda: ambiguo (octal)
    "192.168.1.5 ",
    " 192.168.1.5",
    "192.168.1.5/24",
  ])("rechaza %j (mal formada)", (ip) => {
    expect(isPrivateIPv4(ip)).toBe(false);
  });

  it("rechaza valores que no son texto", () => {
    expect(isPrivateIPv4(undefined as unknown as string)).toBe(false);
    expect(isPrivateIPv4(null as unknown as string)).toBe(false);
    expect(isPrivateIPv4(1921681 as unknown as string)).toBe(false);
  });
});

describe("normalizeIp", () => {
  it("convierte IPv4 mapeada en IPv6 a IPv4", () => {
    expect(normalizeIp("::ffff:192.168.1.5")).toBe("192.168.1.5");
    expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
  });

  it("deja igual una IPv4 normal", () => {
    expect(normalizeIp("192.168.1.5")).toBe("192.168.1.5");
  });

  it("deja igual una IPv6 que no es mapeada", () => {
    expect(normalizeIp("::1")).toBe("::1");
    expect(normalizeIp("fe80::1")).toBe("fe80::1");
  });

  it("no inventa nada con texto raro", () => {
    expect(normalizeIp("::ffff:no-es-ip")).toBe("::ffff:no-es-ip");
    expect(normalizeIp("")).toBe("");
  });
});
