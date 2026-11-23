import { z } from "zod";
import { Base64Url } from "./base64url";
import { bytesToUtf8, utf8ToBytes } from "./bytes";

// Contenido de los dos mensajes del handshake de Noise (viaja cifrado dentro de hs1 / hs2).
// En hs1 el celu dice quién es y qué quiere; en hs2 la PC contesta, y desde ahí el canal es de datos.

export const Hs1Payload = z.discriminatedUnion("intent", [
  z.strictObject({
    intent: z.literal("pair"),
    code: Base64Url.length(22), // 16 bytes, el del QR
    deviceName: z.string().trim().min(1).max(40),
    platform: z.enum(["android", "ios"]),
    appVersion: z.string().max(20),
  }),
  z.strictObject({ intent: z.literal("connect"), appVersion: z.string().max(20) }),
]);
export type Hs1Payload = z.infer<typeof Hs1Payload>;

export const Hs2Reason = z.enum(["unknown_device", "revoked", "invalid_code", "busy", "rate_limited"]);
export type Hs2Reason = z.infer<typeof Hs2Reason>;

export const Hs2Payload = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), pcName: z.string().max(64), agentVersion: z.string().max(20) }),
  z.strictObject({ ok: z.literal(false), reason: Hs2Reason }),
]);
export type Hs2Payload = z.infer<typeof Hs2Payload>;

type Decoded<T> = { ok: true; payload: T } | { ok: false; detail: string };

function decode<S extends z.ZodType>(schema: S, bytes: Uint8Array): Decoded<z.infer<S>> {
  const text = bytesToUtf8(bytes);
  if (text === null) return { ok: false, detail: "no es UTF-8 válido" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, detail: "no es JSON válido" };
  }
  const r = schema.safeParse(json);
  return r.success ? { ok: true, payload: r.data } : { ok: false, detail: z.prettifyError(r.error) };
}

export const encodeHs1Payload = (p: Hs1Payload): Uint8Array => utf8ToBytes(JSON.stringify(p));
export const decodeHs1Payload = (bytes: Uint8Array): Decoded<Hs1Payload> => decode(Hs1Payload, bytes);
export const encodeHs2Payload = (p: Hs2Payload): Uint8Array => utf8ToBytes(JSON.stringify(p));
export const decodeHs2Payload = (bytes: Uint8Array): Decoded<Hs2Payload> => decode(Hs2Payload, bytes);
