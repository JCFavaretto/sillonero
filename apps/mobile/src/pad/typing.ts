import type { PadKey } from "@proyecto-e/protocol";

// Escribir en vivo (docs/PLAN.md 8.5, cambio 4): lo que se escribe en el campo del celu se escribe en la PC y las
// correcciones también. Puro: se compara el texto que ya tiene la PC con el nuevo y se manda "borrá N y escribí esto".

const MAX = 500;
const CONTROL = /[\u0000-\u001F\u007F]/g;

/** El campo es de una línea: Enter y Tab van como teclas, no como texto. */
export const sanitizeTyped = (s: string): string => s.replace(CONTROL, "");

/** Qué borrar y qué escribir para pasar de `prev` a `next`. Se cuentan caracteres (un emoji es uno), no unidades UTF-16. */
export function diffTyping(prev: string, next: string): { backspaces: number; text: string } {
  const a = Array.from(prev);
  const b = Array.from(next);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return { backspaces: a.length - i, text: b.slice(i).join("") };
}

/** El texto que queda en la PC después de aplicar `piece` (borrar `backspaces` caracteres del final y escribir `text`). */
export function applyTyping(prev: string, piece: { backspaces: number; text: string }): string {
  const chars = Array.from(prev);
  return chars.slice(0, Math.max(0, chars.length - piece.backspaces)).join("") + piece.text;
}

/** Parte un diff en mensajes que el agente acepta (hasta 500 retrocesos y 500 unidades de texto), sin cortar un emoji. */
export function chunkTyping(diff: { backspaces: number; text: string }): { backspaces: number; text: string }[] {
  const out: { backspaces: number; text: string }[] = [];
  let back = diff.backspaces;
  while (back > MAX) {
    out.push({ backspaces: MAX, text: "" });
    back -= MAX;
  }
  const chars = Array.from(diff.text);
  let cur = "";
  let first = true;
  const pushCur = () => {
    out.push({ backspaces: first ? back : 0, text: cur });
    first = false;
    cur = "";
  };
  for (const ch of chars) {
    if (cur.length + ch.length > MAX) pushCur();
    cur += ch;
  }
  if (cur.length > 0) pushCur();
  else if (first && back > 0) out.push({ backspaces: back, text: "" });
  return out;
}

/** La tecla de la PC para un carácter, para combinaciones (Ctrl + letra). Solo letras, números y espacio. */
export function charToPadKey(ch: string): PadKey | null {
  if (ch.length !== 1) return null;
  if (/^[a-zA-Z]$/.test(ch)) return ch.toLowerCase() as PadKey;
  if (/^[0-9]$/.test(ch)) return ch as PadKey;
  if (ch === " ") return "space";
  return null;
}
