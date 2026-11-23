import { z } from "zod";

/** Texto en base64url (A-Z a-z 0-9 - _), sin relleno `=`. */
export const Base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INDEX = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/**
 * Hecho a mano para no depender de `Buffer`, `btoa` ni `TextEncoder`,
 * que cambian según el runtime (Node, Hermes en el celu).
 */
export function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // sustituto suelto
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

/** UTF-8 estricto: devuelve null ante secuencias inválidas, sobrelargas o sustitutos. */
export function utf8Decode(bytes: ArrayLike<number>): string | null {
  const cps: number[] = [];
  const cont = (i: number, lo = 0x80, hi = 0xbf) => {
    const b = bytes[i];
    return b !== undefined && b >= lo && b <= hi ? b & 0x3f : -1;
  };
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i] as number;
    if (b < 0x80) {
      cps.push(b);
      i += 1;
    } else if (b >= 0xc2 && b <= 0xdf) {
      const c1 = cont(i + 1);
      if (c1 < 0) return null;
      cps.push(((b & 0x1f) << 6) | c1);
      i += 2;
    } else if (b >= 0xe0 && b <= 0xef) {
      const c1 = b === 0xe0 ? cont(i + 1, 0xa0) : b === 0xed ? cont(i + 1, 0x80, 0x9f) : cont(i + 1);
      const c2 = cont(i + 2);
      if (c1 < 0 || c2 < 0) return null;
      cps.push(((b & 0x0f) << 12) | (c1 << 6) | c2);
      i += 3;
    } else if (b >= 0xf0 && b <= 0xf4) {
      const c1 = b === 0xf0 ? cont(i + 1, 0x90) : b === 0xf4 ? cont(i + 1, 0x80, 0x8f) : cont(i + 1);
      const c2 = cont(i + 2);
      const c3 = cont(i + 3);
      if (c1 < 0 || c2 < 0 || c3 < 0) return null;
      cps.push(((b & 0x07) << 18) | (c1 << 12) | (c2 << 6) | c3);
      i += 4;
    } else return null;
  }
  return String.fromCodePoint(...cps);
}

export function base64UrlEncode(text: string): string {
  return base64UrlEncodeBytes(utf8Encode(text));
}

/** Bytes → base64url sin relleno. */
export function base64UrlEncodeBytes(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Devuelve null si el texto no es base64url canónico (sin relleno) o no es UTF-8 válido. */
export function base64UrlDecode(text: string): string | null {
  const bytes = base64UrlDecodeBytes(text);
  return bytes === null ? null : utf8Decode(bytes);
}

/** base64url canónico → bytes; `null` si hay caracteres de más, relleno o bits sobrantes. */
export function base64UrlDecodeBytes(text: string): number[] | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    const v = [...chunk].map((c) => INDEX.get(c) as number);
    const [a, b, c, d] = v as [number, number, number | undefined, number | undefined];
    bytes.push(((a << 2) | (b >> 4)) & 0xff);
    if (c !== undefined) bytes.push((((b & 0x0f) << 4) | (c >> 2)) & 0xff);
    if (d !== undefined) bytes.push((((c as number) & 0x03) << 6) | d);
    // los bits sobrantes tienen que ser cero (si no, hay más de una forma de escribir lo mismo)
    if (chunk.length === 2 && (b & 0x0f) !== 0) return null;
    if (chunk.length === 3 && ((c as number) & 0x03) !== 0) return null;
  }
  return bytes;
}
