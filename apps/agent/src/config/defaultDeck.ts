import type { DeckItem } from "@proyecto-e/protocol";
import type { AgentConfig } from "./schema";

// El Inicio de una instalación nueva no arranca vacío: trae los botones que la app ya ofrece y que no dependen de nada
// instalado en la PC de cada uno (Media, volumen, silencio, traer todo e identificar). Escenas, lanzadores y pantallas
// los arma Jay. Se siembra una sola vez: si después vacía su Inicio, no se vuelve a llenar.

export const DEFAULT_DECK: DeckItem[] = [
  { kind: "media", key: "prev" },
  { kind: "media", key: "playPause" },
  { kind: "media", key: "next" },
  { kind: "volume", delta: -5 },
  { kind: "volume", delta: 5 },
  { kind: "mute" },
  { kind: "bringAll" },
  { kind: "identify" },
];

/**
 * Devuelve la config con el Inicio sembrado, o `null` si no hay nada que hacer (ya se sembró antes).
 * Si el Inicio ya tiene teclas (el de Jay de antes), solo se marca como sembrado y no se toca.
 */
export function seedDeck(config: AgentConfig): AgentConfig | null {
  if (config.deckSeeded) return null;
  const deck = config.library.deck.length > 0 ? config.library.deck : DEFAULT_DECK.map((d) => ({ ...d }));
  return { ...config, library: { ...config.library, deck }, deckSeeded: true };
}
