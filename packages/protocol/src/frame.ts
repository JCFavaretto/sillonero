import { z } from "zod";
import { Base64Url } from "./base64url";
import { base64UrlToBytes, bytesToBase64Url } from "./bytes";
import { FRAME_VERSION, MAX_FRAME_BYTES } from "./constants";
import type { ParseFailure } from "./envelope";

/**
 * Marco exterior v2: lo único que viaja en claro. El mensaje de aplicación (`{v, id, type, payload}`)
 * va adentro, cifrado (`k: "data"`), o es uno de los dos mensajes del handshake de Noise.
 */
export const FrameKind = z.enum(["hs1", "hs2", "data"]);
export type FrameKind = z.infer<typeof FrameKind>;

export const Frame = z.strictObject({
  v: z.literal(FRAME_VERSION),
  k: FrameKind,
  /** ~60 KB de binario en base64url. */
  d: Base64Url.max(81_960),
});

export function encodeFrame(kind: FrameKind, data: Uint8Array): string {
  return JSON.stringify({ v: FRAME_VERSION, k: kind, d: bytesToBase64Url(data) });
}

/**
 * Orden fijo: tamaño → JSON → es objeto → `v` (entero) → `v` compatible → resto del marco → base64url canónico.
 * Un celu de B1 manda `v: 1`: `incompatible`.
 */
export function parseFrame(raw: string, maxBytes: number = MAX_FRAME_BYTES): { ok: true; kind: FrameKind; data: Uint8Array } | ParseFailure {
  if (raw.length > maxBytes) return { ok: false, code: "too_large", detail: `más de ${maxBytes} bytes` };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: "bad_json", detail: "no es JSON válido" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, code: "bad_message", detail: "el marco tiene que ser un objeto" };
  }

  const v = (data as Record<string, unknown>)["v"];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return { ok: false, code: "bad_message", detail: "falta `v` o no es un entero" };
  }
  if (v !== FRAME_VERSION) {
    return { ok: false, code: "incompatible", detail: `versión ${v}; esta es la ${FRAME_VERSION}` };
  }

  const parsed = Frame.safeParse(data);
  if (!parsed.success) return { ok: false, code: "bad_message", detail: z.prettifyError(parsed.error) };
  const bytes = base64UrlToBytes(parsed.data.d);
  if (bytes === null) return { ok: false, code: "bad_message", detail: "`d` no es base64url canónico" };
  return { ok: true, kind: parsed.data.k, data: bytes };
}
