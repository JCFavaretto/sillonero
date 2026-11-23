import { z } from "zod";
import { Base64Url, base64UrlDecode, base64UrlEncode } from "./base64url";
import { isPrivateIPv4 } from "./net";

const PREFIX = "pe2:";
/** Los QR de B1 (sin cifrado): se reconocen para poder explicar que hay que actualizar. */
const OLD_PREFIX = "pe1:";

const fields = {
  v: z.literal(2),
  host: z.string(),
  port: z.number().int().min(1024).max(65535),
  name: z.string().min(1).max(64), // hostname de la PC
  code: Base64Url.length(22), // 16 bytes de código de un solo uso
  exp: z.number().int(), // epoch ms; el celu lo usa solo para avisar "venció"
  pk: Base64Url.length(43), // clave pública X25519 de la PC (32 bytes): con ella el celu cifra el handshake
};

/** Para decodificar: sin la regla de host, así se distingue `host_not_private` de `bad_format`. */
const QrShape = z.strictObject(fields);

/** Para codificar: el agente nunca puede generar un QR con un host que no sea de red privada. */
export const QrPayload = z.strictObject({
  ...fields,
  host: z.string().refine(isPrivateIPv4, "host_not_private"),
});
export type QrPayload = z.infer<typeof QrPayload>;

/** Texto del QR: `pe2:` + base64url(JSON). El prefijo identifica y versiona. */
export function encodeQr(payload: QrPayload): string {
  return PREFIX + base64UrlEncode(JSON.stringify(QrPayload.parse(payload)));
}

export type QrFailure = "not_ours" | "old_version" | "bad_format" | "host_not_private" | "expired";

/** `now` entra como parámetro para que el test sea puro. Orden: old_version → not_ours → bad_format → host_not_private → expired. */
export function decodeQr(text: string, now: number): { ok: true; payload: QrPayload } | { ok: false; reason: QrFailure } {
  if (text.startsWith(OLD_PREFIX)) return { ok: false, reason: "old_version" };
  if (!text.startsWith(PREFIX)) return { ok: false, reason: "not_ours" };

  const json = base64UrlDecode(text.slice(PREFIX.length));
  if (json === null) return { ok: false, reason: "bad_format" };

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, reason: "bad_format" };
  }

  const shape = QrShape.safeParse(data);
  if (!shape.success) return { ok: false, reason: "bad_format" };
  if (!isPrivateIPv4(shape.data.host)) return { ok: false, reason: "host_not_private" };
  if (now >= shape.data.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload: shape.data };
}
