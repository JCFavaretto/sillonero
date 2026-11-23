// Las cuentas de las imágenes de las teclas (D105), sin nada nativo: se prueban solas.

/** La imagen fija se guarda cuadrada y de este lado (alcanza de sobra para una tecla). */
export const STATIC_SIZE = 256;
/** Una imagen animada se guarda tal cual, hasta este peso. */
export const MAX_ANIMATED_BYTES = 2 * 1024 * 1024;

const ascii = (bytes: Uint8Array, at: number, text: string): boolean => {
  if (at < 0 || at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/**
 * ¿Es una imagen animada? GIF: más de un cuadro (se cuentan las extensiones de control de gráfico). WebP: tiene el bloque ANIM.
 * JPG y PNG nunca. Si el tipo no viene, se reconoce por los primeros bytes.
 */
export function detectAnimated(bytes: Uint8Array, mime?: string): boolean {
  const kind = mime?.toLowerCase();
  const isGif = (kind === undefined || kind === "image/gif") && (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a"));
  const isWebp = (kind === undefined || kind === "image/webp") && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP");
  if (isGif) {
    let frames = 0;
    for (let i = 6; i + 3 < bytes.length; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
        frames++;
        if (frames > 1) return true;
      }
    }
    return false;
  }
  if (isWebp) {
    for (let i = 12; i + 4 <= bytes.length; i++) if (ascii(bytes, i, "ANIM")) return true;
    return false;
  }
  return false;
}

/** El cuadrado del centro de una imagen de `w × h` (la parte que se ve en la tecla). */
export function squareCrop(w: number, h: number): { originX: number; originY: number; width: number; height: number } {
  const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const side = ok ? Math.max(1, Math.floor(Math.min(w, h))) : 1;
  return { originX: ok ? Math.floor((w - side) / 2) : 0, originY: ok ? Math.floor((h - side) / 2) : 0, width: side, height: side };
}
