import { z } from "zod";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from "./constants";
import type { ErrorCode } from "./errors";

export const Id = z.string().min(1).max(64);

/**
 * Sobre de la versión 1: el payload va en claro.
 * La versión 2 (B2) será `{ v: 2, id, enc: { nonce, ct } }`; por eso `v` se mira primero.
 */
export const Envelope = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  id: Id,
  type: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()),
});
export type Envelope = z.infer<typeof Envelope>;

export type ParseFailure = { ok: false; code: ErrorCode; detail: string };

/** Largo en bytes UTF-8, sin depender de TextEncoder (que no está en todos los runtimes). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4; // par sustituto = un carácter fuera del plano básico
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Valida el sobre de un mensaje crudo. Orden fijo:
 * tamaño → JSON → es objeto → `v` (entero) → `v` compatible → resto del sobre.
 * No mira el contenido del payload: eso lo hace `messages.ts` según el `type`.
 */
export function parseEnvelope(raw: string, maxBytes: number = MAX_MESSAGE_BYTES): { ok: true; envelope: Envelope } | ParseFailure {
  if (utf8ByteLength(raw) > maxBytes) {
    return { ok: false, code: "too_large", detail: `más de ${maxBytes} bytes` };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: "bad_json", detail: "no es JSON válido" };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, code: "bad_message", detail: "el mensaje tiene que ser un objeto" };
  }

  const v = (data as Record<string, unknown>)["v"];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return { ok: false, code: "bad_message", detail: "falta `v` o no es un entero" };
  }
  if (v !== PROTOCOL_VERSION) {
    return { ok: false, code: "incompatible", detail: `versión ${v}; esta es la ${PROTOCOL_VERSION}` };
  }

  const parsed = Envelope.safeParse(data);
  if (!parsed.success) {
    return { ok: false, code: "bad_message", detail: z.prettifyError(parsed.error) };
  }
  return { ok: true, envelope: parsed.data };
}
