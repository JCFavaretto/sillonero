import type { Shortcut } from "@proyecto-e/protocol";

/** La grilla fija de atajos (boceto 04). Alt+Tab es especial: abre su propio panel porque necesita dejar Alt apretado. */
export type ShortcutId = Shortcut | "altTab";
export interface ShortcutItem {
  id: ShortcutId;
  /** La combinación a la vista (en mono, ámbar). No se manda: la PC sabe qué teclas son. */
  combo: string;
}
export interface ShortcutGroup {
  id: "windows" | "browser" | "youtube" | "player" | "edit";
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "windows",
    items: [
      { id: "altTab", combo: "Alt+Tab" },
      { id: "desktop", combo: "Win+D" },
      { id: "fullscreen", combo: "F11" },
    ],
  },
  {
    id: "browser",
    items: [
      { id: "back", combo: "Alt+←" },
      { id: "forward", combo: "Alt+→" },
      { id: "reload", combo: "F5" },
      { id: "addressBar", combo: "Ctrl+L" },
      { id: "newTab", combo: "Ctrl+T" },
      { id: "closeTab", combo: "Ctrl+W" },
    ],
  },
  {
    id: "youtube",
    items: [
      { id: "ytPlayPause", combo: "K" },
      { id: "ytBack10", combo: "J" },
      { id: "ytForward10", combo: "L" },
      { id: "ytFullscreen", combo: "F" },
      { id: "ytCaptions", combo: "C" },
      { id: "escape", combo: "Esc" },
    ],
  },
  {
    id: "player",
    items: [
      { id: "mediaPlayPause", combo: "Espacio" },
      { id: "mediaBack", combo: "←" },
      { id: "mediaForward", combo: "→" },
      { id: "mediaMute", combo: "M" },
      { id: "mediaFullscreen", combo: "F" },
    ],
  },
  {
    id: "edit",
    items: [
      { id: "copy", combo: "Ctrl+C" },
      { id: "paste", combo: "Ctrl+V" },
      { id: "undo", combo: "Ctrl+Z" },
    ],
  },
];

export const shortcutNames = (): ShortcutId[] => SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.id));
