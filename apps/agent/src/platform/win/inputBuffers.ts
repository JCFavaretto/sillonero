import type { InputKeyEvent } from "../../ports";

// Estructuras INPUT de SendInput armadas a mano (x64: 40 bytes). Puro: se prueba en cualquier sistema.
// Layout verificado contra la doc de INPUT / MOUSEINPUT / KEYBDINPUT (learn.microsoft.com) y contra `pressMediaKey` de win32.ts:
//   0  type (u32: 0 = mouse, 1 = teclado)      4  relleno
//   8  MOUSEINPUT: dx i32, dy i32, mouseData u32, dwFlags u32 @20, time u32, (relleno), dwExtraInfo u64 @32
//   8  KEYBDINPUT: wVk u16, wScan u16, dwFlags u32 @12, time u32, (relleno), dwExtraInfo u64 @24

export const INPUT_SIZE = 40;

export const MOUSEEVENTF = {
  MOVE: 0x0001,
  LEFTDOWN: 0x0002,
  LEFTUP: 0x0004,
  RIGHTDOWN: 0x0008,
  RIGHTUP: 0x0010,
  MIDDLEDOWN: 0x0020,
  MIDDLEUP: 0x0040,
  WHEEL: 0x0800,
  HWHEEL: 0x1000,
  VIRTUALDESK: 0x4000,
  ABSOLUTE: 0x8000,
} as const;

export const KEYEVENTF = {
  EXTENDEDKEY: 0x0001,
  KEYUP: 0x0002,
  UNICODE: 0x0004,
} as const;

export function mouseInput(buf: Buffer, index: number, dx: number, dy: number, mouseData: number, flags: number): void {
  const o = index * INPUT_SIZE;
  buf.writeUInt32LE(0, o);
  buf.writeInt32LE(dx, o + 8);
  buf.writeInt32LE(dy, o + 12);
  buf.writeInt32LE(mouseData, o + 16); // la rueda va con signo; Windows lo lee como DWORD
  buf.writeUInt32LE(flags >>> 0, o + 20);
}

export function keyInput(buf: Buffer, index: number, vk: number, scan: number, flags: number): void {
  const o = index * INPUT_SIZE;
  buf.writeUInt32LE(1, o);
  buf.writeUInt16LE(vk, o + 8);
  buf.writeUInt16LE(scan, o + 10);
  buf.writeUInt32LE(flags >>> 0, o + 12);
}

/** Teclas por código virtual: [vk, soltar, extendida]. Valida los rangos (un vk fuera de 1–254 no se manda). */
export function keysBuffer(events: readonly InputKeyEvent[]): Buffer {
  const buf = Buffer.alloc(events.length * INPUT_SIZE);
  events.forEach(([vk, up, ext], i) => {
    if (!Number.isInteger(vk) || vk < 1 || vk > 254) throw new Error(`código de tecla inválido: ${vk}`);
    keyInput(buf, i, vk, 0, (up ? KEYEVENTF.KEYUP : 0) | (ext ? KEYEVENTF.EXTENDEDKEY : 0));
  });
  return buf;
}

/** Texto: una unidad UTF-16 por vez, abajo y arriba, con `wVk = 0` y KEYEVENTF_UNICODE. */
export function textBuffer(units: readonly number[]): Buffer {
  const buf = Buffer.alloc(units.length * 2 * INPUT_SIZE);
  units.forEach((u, i) => {
    if (!Number.isInteger(u) || u < 0 || u > 0xffff) throw new Error(`unidad de texto inválida: ${u}`);
    keyInput(buf, i * 2, 0, u, KEYEVENTF.UNICODE);
    keyInput(buf, i * 2 + 1, 0, u, KEYEVENTF.UNICODE | KEYEVENTF.KEYUP);
  });
  return buf;
}

export function buttonBuffer(button: "left" | "middle" | "right", action: "click" | "down" | "up"): Buffer {
  const [down, up] =
    button === "left" ? [MOUSEEVENTF.LEFTDOWN, MOUSEEVENTF.LEFTUP] : button === "middle" ? [MOUSEEVENTF.MIDDLEDOWN, MOUSEEVENTF.MIDDLEUP] : [MOUSEEVENTF.RIGHTDOWN, MOUSEEVENTF.RIGHTUP];
  const flags = action === "click" ? [down, up] : action === "down" ? [down] : [up];
  const buf = Buffer.alloc(flags.length * INPUT_SIZE);
  flags.forEach((f, i) => mouseInput(buf, i, 0, 0, 0, f));
  return buf;
}

export function moveAbsBuffer(nx: number, ny: number): Buffer {
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 0 || nx > 65535 || ny < 0 || ny > 65535) throw new Error("coordenada fuera de 0–65535");
  const buf = Buffer.alloc(INPUT_SIZE);
  mouseInput(buf, 0, nx, ny, 0, MOUSEEVENTF.MOVE | MOUSEEVENTF.ABSOLUTE | MOUSEEVENTF.VIRTUALDESK);
  return buf;
}

/** Rueda vertical y horizontal: un evento por eje que no sea cero. */
export function wheelBuffer(dx: number, dy: number): Buffer {
  const parts: Array<[number, number]> = [];
  if (dy !== 0) parts.push([MOUSEEVENTF.WHEEL, dy]);
  if (dx !== 0) parts.push([MOUSEEVENTF.HWHEEL, dx]);
  const buf = Buffer.alloc(parts.length * INPUT_SIZE);
  parts.forEach(([flag, amount], i) => {
    if (!Number.isInteger(amount) || Math.abs(amount) > 1200) throw new Error("rueda fuera de rango");
    mouseInput(buf, i, 0, 0, amount, flag);
  });
  return buf;
}
