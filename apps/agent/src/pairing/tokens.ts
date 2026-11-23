import { timingSafeEqual } from "node:crypto";
import type { Random } from "../ports";

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Código del QR: 16 bytes (128 bits) en base64url → 22 caracteres. */
export function generatePairCode(random: Random): string {
  return base64url(random.bytes(16));
}

/** Igualdad de strings en tiempo constante (largos distintos dan false). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
