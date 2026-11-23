import { createFsStorage } from "./fsStorage";
import { decksActions, getDecksStorage, setDecksStorage, useDecks } from "./store";

let starting: Promise<void> | null = null;

/**
 * Deja listos los decks: el almacenamiento real (si nadie puso otro, como en los tests) y la lectura del disco. Se llama al abrir
 * la pestaña Escenas; las veces siguientes no hace nada.
 */
export function initDecks(firstDeckName: string): Promise<void> {
  if (useDecks.getState().data) return Promise.resolve();
  starting ??= (async () => {
    if (!getDecksStorage()) setDecksStorage(createFsStorage());
    await decksActions.loadPrefs();
    await decksActions.load(firstDeckName);
  })().finally(() => (starting = null));
  return starting;
}
