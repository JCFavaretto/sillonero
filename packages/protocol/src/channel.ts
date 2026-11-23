import { bytesToUtf8, utf8ToBytes } from "./bytes";
import { encodeFrame } from "./frame";
import { NoiseError, type Transport } from "./noise";

// Mensajes de aplicación sobre el canal cifrado: el mismo código lo usan el agente y el celu.

/** Cifra un mensaje de aplicación (JSON) y lo mete en un marco `data`, listo para mandar por el WebSocket. */
export function sealToFrame(transport: Transport, messageJson: string): string {
  return encodeFrame("data", transport.encrypt(utf8ToBytes(messageJson)));
}

/**
 * Abre el contenido de un marco `data`. Tira `NoiseError` si no descifra o no es UTF-8:
 * después de eso el canal no sirve más (los contadores quedan desfasados) y hay que cortar.
 */
export function openFrame(transport: Transport, data: Uint8Array): string {
  const text = bytesToUtf8(transport.decrypt(data));
  if (text === null) throw new NoiseError("el mensaje descifrado no es UTF-8 válido");
  return text;
}
