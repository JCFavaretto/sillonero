import type { Ionicons } from "@expo/vector-icons";
import type { AppAudio, AudioState, OutputInfo, OutputKind } from "@proyecto-e/protocol";

// Cómo se muestra el audio (puro): nombres, íconos y qué salidas se ven.

type IconName = keyof typeof Ionicons.glyphMap;

export const outputLabel = (o: Pick<OutputInfo, "nick" | "name">): string => o.nick ?? o.name;

const ICONS: Record<OutputKind, IconName> = {
  headphones: "headset",
  speakers: "volume-high",
  tv: "tv",
  digital: "hardware-chip",
  other: "musical-notes",
};
export const outputIcon = (kind: OutputKind): IconName => ICONS[kind];

/** Las ocultas no salen salvo que se pidan; la predeterminada siempre sale (si no, no se vería por dónde suena todo). */
export function visibleOutputs(audio: AudioState, showHidden: boolean): OutputInfo[] {
  return audio.outputs.filter((o) => showHidden || !o.hidden || o.isDefault);
}

/** "→ Parlantes (fijada)" o "→ Auriculares" (la predeterminada). */
export function appRouteLabel(app: AppAudio, outputs: OutputInfo[]): { kind: "fixed" | "default"; label: string } {
  if (app.routed) {
    const o = outputs.find((x) => x.id === app.routed);
    return { kind: "fixed", label: o ? outputLabel(o) : "" };
  }
  const d = outputs.find((x) => x.isDefault);
  return { kind: "default", label: d ? outputLabel(d) : "" };
}
