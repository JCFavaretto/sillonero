import { isPrivateIPv4, normalizeIp } from "@proyecto-e/protocol";

/**
 * ¿Puede conectarse un cliente con esta IP? Solo red privada IPv4
 * (`::ffff:a.b.c.d` se normaliza). El loopback entra únicamente en tests.
 */
export function isAllowedClient(ip: string, opts: { allowLoopback: boolean }): boolean {
  const n = normalizeIp(ip);
  return isPrivateIPv4(n) || (opts.allowLoopback && n === "127.0.0.1");
}
