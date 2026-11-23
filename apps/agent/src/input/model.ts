import type { PadKey, PadMod, Shortcut } from "@proyecto-e/protocol";

// Lo puro del Pad (docs/PLAN.md 8.5, D44, D49–D51): cuentas del cursor y traducción a teclas de Windows.
// Nada acá toca Windows: el hijo de entrada recibe estos números ya armados.

/** Un monitor en píxeles físicos del escritorio virtual, con su escala (1 = 100 %, 1.5 = 150 %, 3 = 300 %). */
export interface MonitorGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface VirtualRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const contains = (m: MonitorGeom, p: Point) => p.x >= m.x && p.x <= m.x + m.w - 1 && p.y >= m.y && p.y <= m.y + m.h - 1;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const nearestIn = (m: MonitorGeom, p: Point): Point => ({ x: clamp(p.x, m.x, m.x + m.w - 1), y: clamp(p.y, m.y, m.y + m.h - 1) });
const dist2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Siguiente posición del cursor (D44). `dx` y `dy` vienen en píxeles lógicos (a 100 %) y se multiplican por la escala del
 * monitor donde ESTÁ el cursor: el mismo gesto recorre lo mismo a la vista en la tele al 300 % que en un monitor al 100 %.
 * Devuelve posiciones con decimales (el servicio guarda el resto para el próximo movimiento y redondea al mandar).
 * Si cae fuera de toda pantalla (hueco entre pantallas de distinto alto, borde del escritorio) queda en el punto más cercano de alguna.
 */
export function nextCursor(pos: Point, dx: number, dy: number, monitors: readonly MonitorGeom[]): Point {
  if (monitors.length === 0) return { x: pos.x, y: pos.y };
  const here = monitors.find((m) => contains(m, pos)) ?? monitors.reduce((best, m) => (dist2(nearestIn(m, pos), pos) < dist2(nearestIn(best, pos), pos) ? m : best));
  const target: Point = { x: pos.x + dx * here.scale, y: pos.y + dy * here.scale };
  if (monitors.some((m) => contains(m, target))) return target;
  let best: Point | null = null;
  let bestD = Infinity;
  for (const m of monitors) {
    const p = nearestIn(m, target);
    const d = dist2(p, target);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best ?? pos;
}

/**
 * Píxel del escritorio virtual → coordenadas normalizadas 0–65535 de `MOUSEEVENTF_ABSOLUTE | VIRTUALDESK`.
 * Windows hace `floor(n · ancho / 65536)`; `ceil(px · 65536 / ancho)` es su inversa exacta (a verificar en el spike S1).
 */
export function toVirtual(x: number, y: number, v: VirtualRect): Point {
  const nx = Math.ceil((clamp(Math.round(x), v.x, v.x + v.w - 1) - v.x) * 65536 / v.w);
  const ny = Math.ceil((clamp(Math.round(y), v.y, v.y + v.h - 1) - v.y) * 65536 / v.h);
  return { x: clamp(nx, 0, 65535), y: clamp(ny, 0, 65535) };
}

/** Códigos virtuales de Windows que usamos. */
export const VK = {
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  SHIFT: 0x10,
  CTRL: 0x11,
  ALT: 0x12, // VK_MENU
  ESC: 0x1b,
  SPACE: 0x20,
  LWIN: 0x5b,
} as const;

/** [vk, soltar, extendida]. `extendida` pone KEYEVENTF_EXTENDEDKEY (flechas y bloque de navegación). */
export type KeyEvent = readonly [vk: number, up: boolean, ext: boolean];

const NAMED: Record<string, readonly [vk: number, ext: boolean]> = {
  esc: [0x1b, false],
  tab: [0x09, false],
  backspace: [0x08, false],
  enter: [0x0d, false],
  space: [0x20, false],
  left: [0x25, true],
  up: [0x26, true],
  right: [0x27, true],
  down: [0x28, true],
  home: [0x24, true],
  end: [0x23, true],
  delete: [0x2e, true],
  insert: [0x2d, true],
  pageUp: [0x21, true],
  pageDown: [0x22, true],
};

function keyInfo(key: PadKey): readonly [vk: number, ext: boolean] {
  const named = NAMED[key];
  if (named) return named;
  if (/^f([1-9]|1[0-2])$/.test(key)) return [0x70 + Number(key.slice(1)) - 1, false];
  if (/^[a-z]$/.test(key)) return [key.toUpperCase().charCodeAt(0), false];
  if (/^[0-9]$/.test(key)) return [key.charCodeAt(0), false];
  throw new Error(`tecla desconocida: ${key}`);
}

const MOD_VK: Record<PadMod, readonly [vk: number, ext: boolean]> = {
  ctrl: [VK.CTRL, false],
  alt: [VK.ALT, false],
  shift: [VK.SHIFT, false],
  win: [VK.LWIN, false],
};

/** Una pulsación completa y atómica: modificadores abajo, tecla abajo y arriba, modificadores arriba (en orden inverso). */
export function keyEvents(key: PadKey, mods: readonly PadMod[]): KeyEvent[] {
  const [vk, ext] = keyInfo(key);
  return [
    ...mods.map((m): KeyEvent => [MOD_VK[m][0], false, MOD_VK[m][1]]),
    [vk, false, ext],
    [vk, true, ext],
    ...[...mods].reverse().map((m): KeyEvent => [MOD_VK[m][0], true, MOD_VK[m][1]]),
  ];
}

const SHORTCUT_KEYS: Record<Shortcut, readonly [PadKey, readonly PadMod[]]> = {
  desktop: ["d", ["win"]],
  fullscreen: ["f11", []],
  back: ["left", ["alt"]],
  forward: ["right", ["alt"]],
  reload: ["f5", []],
  addressBar: ["l", ["ctrl"]],
  newTab: ["t", ["ctrl"]],
  closeTab: ["w", ["ctrl"]],
  ytPlayPause: ["k", []],
  ytBack10: ["j", []],
  ytForward10: ["l", []],
  ytFullscreen: ["f", []],
  ytCaptions: ["c", []],
  mediaPlayPause: ["space", []],
  mediaBack: ["left", []],
  mediaForward: ["right", []],
  mediaMute: ["m", []],
  mediaFullscreen: ["f", []],
  escape: ["esc", []],
  copy: ["c", ["ctrl"]],
  paste: ["v", ["ctrl"]],
  undo: ["z", ["ctrl"]],
};

export function shortcutEvents(name: Shortcut): KeyEvent[] {
  const [key, mods] = SHORTCUT_KEYS[name];
  return keyEvents(key, mods);
}

/** Unidades UTF-16 del texto: lo que se manda con KEYEVENTF_UNICODE (un emoji son dos). */
export function textUnits(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
  return out;
}

/** `n` retrocesos (VK_BACK abajo y arriba). */
export function backspaceEvents(n: number): KeyEvent[] {
  const out: KeyEvent[] = [];
  for (let i = 0; i < n; i++) out.push([VK.BACK, false, false], [VK.BACK, true, false]);
  return out;
}
