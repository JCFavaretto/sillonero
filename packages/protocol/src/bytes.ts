import { base64UrlDecodeBytes, base64UrlEncodeBytes, utf8Decode, utf8Encode } from "./base64url";

// Utilidades de bytes sin `Buffer`, `btoa` ni `TextEncoder` (no están igual en Node y en Hermes).

export const utf8ToBytes = (text: string): Uint8Array => Uint8Array.from(utf8Encode(text));

/** `null` si los bytes no son UTF-8 válido. */
export const bytesToUtf8 = (bytes: Uint8Array): string | null => utf8Decode(bytes);

export const bytesToBase64Url = (bytes: Uint8Array): string => base64UrlEncodeBytes(bytes);

/** `null` si el texto no es base64url canónico. */
export function base64UrlToBytes(text: string): Uint8Array | null {
  const bytes = base64UrlDecodeBytes(text);
  return bytes === null ? null : Uint8Array.from(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += (b < 16 ? "0" : "") + b.toString(16);
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error("hex inválido");
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

/** Igualdad de bytes sin cortar en el primer byte distinto (no filtra por tiempo dónde difieren). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
