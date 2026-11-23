import type { AudioState, Library, Monitor } from "@proyecto-e/protocol";
import { resolveItem, type DeckKey } from "@/apps/deck";
import { siteOf } from "@/links";
import type { DeckSlot } from "./model";

// Qué dice y si se puede usar la tecla de un deck (D104). Las acciones de la PC usan el mismo resolvedor que tenían las teclas
// del Inicio; los links y las apps viven en el celu, así que siempre se pueden tocar (la PC dice si no puede abrirlos).

export function resolveSlot(slot: DeckSlot, library: Library | null, monitors: Monitor[], audio: AudioState | null): DeckKey {
  const a = slot.action;
  if (a.kind === "link") {
    // Se dibuja como un lanzador: con el ícono de la app si hay, y el sitio como nombre si la tecla no tiene uno propio.
    return { item: { kind: "launcher", id: "l_AAAAAAAAAA" }, kind: "launcher", label: slot.label || siteOf(a.url), iconKey: slot.iconKey ?? null, available: true };
  }
  if (a.kind === "app") {
    return { item: { kind: "launcher", id: "l_AAAAAAAAAA" }, kind: "launcher", label: slot.label || a.appId.slice(0, 24), iconKey: slot.iconKey ?? null, available: true };
  }
  if (a.kind === "sound") {
    // Suena por una salida de la PC: hace falta el audio de la PC y que esa salida esté conectada.
    const base = { item: { kind: "bringAll" } as const, kind: "sound" as const, iconKey: null, ...(slot.label ? { label: slot.label } : { labelKey: "decks.action.soundName" }) };
    if (!audio?.available.audio) return { ...base, available: false, reason: "audioOff" };
    const o = audio.outputs.find((x) => x.id === a.outputId);
    if (!o) return { ...base, available: false, reason: "missing" };
    if (o.state !== "active") return { ...base, available: false, reason: "disconnected" };
    return { ...base, available: true };
  }
  const key = resolveItem(a, library, monitors, audio);
  // Lo que el usuario nombró manda sobre el rótulo automático (una escena puede tener su propio nombre en el deck).
  return slot.label && key.available ? { ...key, label: slot.label, labelKey: undefined } : key;
}
