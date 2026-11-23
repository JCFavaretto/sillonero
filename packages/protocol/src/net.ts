/** Devuelve los 4 octetos de una IPv4 bien formada, o null. Sin ceros a la izquierda (ambiguos: octal). */
function parseIPv4(ip: unknown): [number, number, number, number] | null {
  if (typeof ip !== "string") return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const octets: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const part = m[i] as string;
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/**
 * ¿Es una IPv4 de red privada? Solo 10/8, 172.16/12 y 192.168/16.
 * Quedan afuera: 100.64/10 (CGNAT, Tailscale), 169.254/16, loopback, IPv6 y todo lo mal formado.
 * El loopback lo permite el agente aparte (en tests), no el protocolo.
 */
export function isPrivateIPv4(ip: string): boolean {
  const o = parseIPv4(ip);
  if (!o) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** `ws` informa las IPv4 como `::ffff:192.168.1.5`; las llevamos a `192.168.1.5`. */
export function normalizeIp(ip: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (!m) return ip;
  const v4 = m[1] as string;
  return parseIPv4(v4) ? v4 : ip;
}
