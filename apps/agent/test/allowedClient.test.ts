import { describe, expect, it } from "vitest";
import { isAllowedClient } from "../src/net/allowedClient";

describe("isAllowedClient", () => {
  it("acepta IPs privadas y las IPv4 mapeadas en IPv6", () => {
    for (const ip of ["192.168.1.5", "10.0.0.2", "172.16.4.4", "::ffff:192.168.1.5"]) {
      expect(isAllowedClient(ip, { allowLoopback: false })).toBe(true);
    }
  });

  it("rechaza IPs públicas, CGNAT, link-local, IPv6 y basura", () => {
    for (const ip of ["8.8.8.8", "100.64.0.1", "169.254.1.1", "::1", "fe80::1", "abc", ""]) {
      expect(isAllowedClient(ip, { allowLoopback: false })).toBe(false);
      expect(isAllowedClient(ip, { allowLoopback: true })).toBe(false);
    }
  });

  it("127.0.0.1 solo con allowLoopback (tests)", () => {
    expect(isAllowedClient("127.0.0.1", { allowLoopback: false })).toBe(false);
    expect(isAllowedClient("127.0.0.1", { allowLoopback: true })).toBe(true);
    expect(isAllowedClient("::ffff:127.0.0.1", { allowLoopback: true })).toBe(true);
  });
});
