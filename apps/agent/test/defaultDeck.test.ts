import { describe, expect, it } from "vitest";
import { DeckItem } from "@proyecto-e/protocol";
import { DEFAULT_DECK, seedDeck } from "../src/config/defaultDeck";
import { defaultConfig } from "../src/config/schema";

describe("Inicio con botones por defecto", () => {
  it("los botones por defecto son los que ya ofrece la app: Media, volumen, silencio, traer todo e identificar", () => {
    expect(DEFAULT_DECK.map((d) => d.kind)).toEqual(["media", "media", "media", "volume", "volume", "mute", "bringAll", "identify"]);
    for (const d of DEFAULT_DECK) expect(DeckItem.safeParse(d).success).toBe(true);
  });

  it("una instalación nueva (Inicio vacío, nunca sembrado) recibe los botones y queda marcada", () => {
    const next = seedDeck(defaultConfig());
    expect(next).not.toBeNull();
    expect(next!.library.deck).toEqual(DEFAULT_DECK);
    expect(next!.deckSeeded).toBe(true);
  });

  it("si Jay ya armó su Inicio, no se toca: solo se marca como sembrado", () => {
    const base = defaultConfig();
    const mine = { ...base, library: { ...base.library, deck: [{ kind: "bringAll" as const }] } };
    const next = seedDeck(mine);
    expect(next!.library.deck).toEqual([{ kind: "bringAll" }]);
    expect(next!.deckSeeded).toBe(true);
  });

  it("si ya se sembró una vez, no se vuelve a sembrar aunque Jay haya vaciado el Inicio", () => {
    const base = defaultConfig();
    expect(seedDeck({ ...base, deckSeeded: true })).toBeNull();
  });

  it("no pisa escenas ni lanzadores", () => {
    const base = defaultConfig();
    const scene = { id: "s_AAAAAAAAAA", name: "Juego", steps: [{ kind: "bringAll" as const }] };
    const next = seedDeck({ ...base, library: { ...base.library, scenes: [scene] } });
    expect(next!.library.scenes).toEqual([scene]);
  });

  it("cabe en el tope del Inicio (30) y no repite teclas", () => {
    expect(DEFAULT_DECK.length).toBeLessThanOrEqual(30);
    expect(new Set(DEFAULT_DECK.map((d) => JSON.stringify(d))).size).toBe(DEFAULT_DECK.length);
  });
});
