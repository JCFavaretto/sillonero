import type { Monitor, SceneHotkey, SceneTrigger } from "@proyecto-e/protocol";

// Atajo y disparador de una escena (docs/PLAN.md 8.6, D70 y D71). Lógica pura; los textos salen de i18n.

/** Las teclas que ya tienen dueño (la paridad con el .ahk): la hoja las muestra tachadas. */
export const RESERVED_KEYS = ["T", "M", "1", "2", "3", "4", "5", "6", "7"] as const;
export type ReservedKey = (typeof RESERVED_KEYS)[number];

export const isReserved = (key: string): key is ReservedKey => (RESERVED_KEYS as readonly string[]).includes(key);

/** "J" → "Ctrl+Alt+J". */
export const hotkeyText = (key: SceneHotkey | ReservedKey): string => `Ctrl+Alt+${key}`;

export type TriggerKind = "manual" | "agentStart" | "displayOn";
export const triggerKind = (t: SceneTrigger | null | undefined): TriggerKind => (t ? t.type : "manual");

/** El nombre con el que Jay reconoce una pantalla: el apodo, o "Pantalla N", o null si ya no se conoce. */
export function monitorName(monitors: readonly Monitor[], id: string, screenLabel: (n: number) => string): string | null {
  const m = monitors.find((x) => x.id === id);
  if (!m) return null;
  return m.nickname ?? (m.index !== null ? screenLabel(m.index) : m.name);
}

/** Dos escenas no pueden compartir tecla: de quién es cada una (sin contar la escena que se edita). */
export function takenByScenes(scenes: readonly { id: string; name: string; hotkey?: SceneHotkey }[], editingId: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of scenes) if (s.hotkey && s.id !== editingId) out.set(s.hotkey, s.name);
  return out;
}
