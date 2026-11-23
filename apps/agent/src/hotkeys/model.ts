import { SCENE_KEYS, type MediaKey, type SceneHotkey } from "@proyecto-e/protocol";

// Tabla de atajos globales (docs/PLAN.md 8.6.1, D69). Puro: no toca Windows. Todos son Ctrl+Alt+<tecla>.

export type HotkeyAction =
  | { kind: "tv" }
  | { kind: "panel" }
  | { kind: "moveActive"; index: number }
  | { kind: "fullscreen" }
  | { kind: "media"; key: MediaKey }
  | { kind: "cutPad" }
  | { kind: "scene"; sceneId: string };

export interface HotkeyDef {
  /** Identificador que viaja al hijo y vuelve en `WM_HOTKEY`. */
  id: number;
  /** Cómo se muestra la tecla ("T", "1", "Esc"). */
  label: string;
  /** Código virtual de Windows. */
  vk: number;
  action: HotkeyAction;
  /** Sigue activo aunque la llave global "Atajos de teclado" esté apagada (el botón de pánico). */
  always: boolean;
  /** Solo en los atajos de escenas: el nombre de la escena, para el panel. */
  sceneName?: string;
}

const def = (id: number, label: string, vk: number, action: HotkeyAction, always = false): HotkeyDef => ({ id, label, vk, action, always });

/** La paridad con `docs/historia/prototipo-ahk/PanelMonitores.ahk` más `Ctrl+Alt+Esc` para cortar el control del Pad. */
export const HOTKEYS: readonly HotkeyDef[] = [
  def(1, "T", 0x54, { kind: "tv" }),
  def(2, "M", 0x4d, { kind: "panel" }),
  def(3, "1", 0x31, { kind: "moveActive", index: 1 }),
  def(4, "2", 0x32, { kind: "moveActive", index: 2 }),
  def(5, "3", 0x33, { kind: "moveActive", index: 3 }),
  def(6, "4", 0x34, { kind: "fullscreen" }),
  def(7, "5", 0x35, { kind: "media", key: "prev" }),
  def(8, "6", 0x36, { kind: "media", key: "playPause" }),
  def(9, "7", 0x37, { kind: "media", key: "next" }),
  def(10, "Esc", 0x1b, { kind: "cutPad" }, true),
];

/** Los que tienen que estar registrados según la llave global. */
export function activeHotkeys(enabled: boolean): HotkeyDef[] {
  return HOTKEYS.filter((h) => enabled || h.always);
}

export function hotkeyById(id: number): HotkeyDef | undefined {
  return HOTKEYS.find((h) => h.id === id);
}

/** Los ids de las escenas empiezan acá: cada tecla posible tiene el suyo, siempre el mismo (no depende de qué otras escenas haya). */
const SCENE_ID_BASE = 100;

/** Un atajo por escena que tenga tecla (si dos traen la misma, gana la primera). */
export function sceneHotkeys(scenes: readonly { id: string; name: string; hotkey?: SceneHotkey }[]): HotkeyDef[] {
  const out: HotkeyDef[] = [];
  const seen = new Set<string>();
  for (const s of scenes) {
    if (!s.hotkey || seen.has(s.hotkey)) continue;
    seen.add(s.hotkey);
    out.push({
      id: SCENE_ID_BASE + SCENE_KEYS.indexOf(s.hotkey),
      label: s.hotkey,
      vk: s.hotkey.charCodeAt(0), // A–Z y 0–9 son su ASCII en los códigos virtuales de Windows
      action: { kind: "scene", sceneId: s.id },
      always: false,
      sceneName: s.name,
    });
  }
  return out;
}
