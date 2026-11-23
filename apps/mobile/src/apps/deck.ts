import type { AudioState, DeckItem, Library, Monitor } from "@proyecto-e/protocol";
import { outputLabel } from "@/audio/view";

// Las teclas del Inicio (docs/PLAN.md 8.3.5): la biblioteca de la PC + las pantallas → lo que se dibuja. Puro.

export interface DeckKey {
  item: DeckItem;
  /** Los tipos de tecla de la PC y, en los decks del celu, "sound" (F4a). */
  kind: DeckItem["kind"] | "sound";
  /** Texto ya resuelto (escena, lanzador, pantalla); las acciones fijas usan `labelKey` (i18n). */
  label?: string;
  labelKey?: string;
  iconKey: string | null;
  available: boolean;
  /** Por qué no está disponible (borrada, pantalla desconectada). */
  reason?: "missing" | "disconnected" | "audioOff" | "unsupported";
  /** Para `monitorToggle`: si la pantalla está prendida ahora. */
  on?: boolean;
}

export function resolveDeck(library: Library | null, monitors: Monitor[], audio: AudioState | null = null): DeckKey[] {
  if (!library) return [];
  return library.deck.map((item) => resolveItem(item, library, monitors, audio));
}

/** Una tecla: lo que dice (texto), si se puede usar ahora y por qué no. Sirve para las teclas de la PC y para las de los decks. */
export function resolveItem(item: DeckItem, library: Library | null, monitors: Monitor[], audio: AudioState | null = null): DeckKey {
  {
    switch (item.kind) {
      case "scene": {
        const s = library?.scenes.find((x) => x.id === item.id);
        return s ? { item, kind: item.kind, label: s.name, iconKey: null, available: true } : { item, kind: item.kind, label: "", iconKey: null, available: false, reason: "missing" };
      }
      case "launcher": {
        const l = library?.launchers.find((x) => x.id === item.id);
        return l ? { item, kind: item.kind, label: l.name, iconKey: l.iconKey, available: true } : { item, kind: item.kind, label: "", iconKey: null, available: false, reason: "missing" };
      }
      case "monitorToggle": {
        const m = monitors.find((x) => x.id === item.monitorId);
        return m
          ? { item, kind: item.kind, label: m.nickname ?? m.name, iconKey: null, available: true, on: m.enabled }
          : { item, kind: item.kind, label: "", iconKey: null, available: false, reason: "disconnected" };
      }
      case "bringAll":
        return { item, kind: item.kind, labelKey: "home.deck.bringAll", iconKey: null, available: true };
      case "identify":
        return { item, kind: item.kind, labelKey: "home.deck.identify", iconKey: null, available: true };
      // B4: teclas de audio. Sin el estado de audio (todavía no llegó, o el audio de la PC está caído) quedan no disponibles.
      case "media": {
        const labelKey = `home.deck.media.${item.key}`;
        if (!audio?.available.audio) return { item, kind: item.kind, labelKey, iconKey: null, available: false, reason: "audioOff" };
        const target = audio.media.sessions.find((s) => s.id === audio.media.targetId);
        // Si hay una app de destino y no acepta este botón (Chrome no tiene ⏮ ⏭), la tecla queda gris.
        if (target && !target.controls[item.key]) return { item, kind: item.kind, labelKey, iconKey: null, available: false, reason: "unsupported" };
        return { item, kind: item.kind, labelKey, iconKey: null, available: true };
      }
      case "volume":
      case "mute": {
        const labelKey = item.kind === "mute" ? "home.deck.mute" : item.delta > 0 ? "home.deck.volumeUp" : "home.deck.volumeDown";
        const ok = audio?.available.audio === true && audio.outputs.some((o) => o.isDefault);
        return { item, kind: item.kind, labelKey, iconKey: null, available: ok, ...(ok ? {} : { reason: "audioOff" as const }) };
      }
      case "output": {
        const o = audio?.outputs.find((x) => x.id === item.outputId);
        if (!audio?.available.audio) return { item, kind: item.kind, labelKey: "home.deck.output", iconKey: null, available: false, reason: "audioOff" };
        if (!o) return { item, kind: item.kind, labelKey: "home.deck.output", iconKey: null, available: false, reason: "missing" };
        if (o.state !== "active") return { item, kind: item.kind, label: outputLabel(o), iconKey: null, available: false, reason: "disconnected" };
        if (!audio.available.defaultOutput) return { item, kind: item.kind, label: outputLabel(o), iconKey: null, available: false, reason: "unsupported" };
        return { item, kind: item.kind, label: outputLabel(o), iconKey: null, available: true, on: o.isDefault };
      }
    }
  }
}

/** Mueve el elemento `i` un lugar (`-1` izquierda, `+1` derecha). No se sale de los bordes ni toca el original. */
export function moveKey<T>(items: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  const out = [...items];
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
