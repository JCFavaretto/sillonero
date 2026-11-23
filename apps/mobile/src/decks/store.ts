import { create } from "zustand";
import {
  addSlot,
  createDeck,
  deleteDeck,
  emptyDecks,
  moveDeck,
  moveSlot,
  parseDecks,
  renameDeck,
  setGrid,
  setSlot,
  slotFiles,
  type Deck,
  type DecksData,
  type DeckSlot,
} from "./model";
import { loadDecksPrefs, saveDecksPrefs } from "@/storage/prefs";
import type { DecksStorage } from "./storage";

// El estado de los decks y su guardado (D103). Cada cambio se guarda enseguida; las imágenes que ya no usa ninguna tecla se
// borran del disco. Las pantallas leen con selectores; los cambios pasan por `decksActions`.

export interface DecksState {
  /** `null` hasta que se leyó el disco. */
  data: DecksData | null;
  /** El deck que se está viendo. */
  currentId: string | null;
  /** Se leyó un archivo roto: se guardó aparte y se empezó de cero (se le dice a Jay). */
  recovered: boolean;
  /** No se pudo guardar: se muestra el aviso, lo que está en pantalla sigue valiendo en esta sesión. */
  saveError: boolean;
  /** Las imágenes animadas se mueven (D105); el interruptor de Ajustes. */
  animate: boolean;
  /** Cuándo se exportó por última vez (ISO), o `null`. */
  lastExport: string | null;
}

export const initialDecks: DecksState = { data: null, currentId: null, recovered: false, saveError: false, animate: true, lastExport: null };
export const useDecks = create<DecksState>(() => initialDecks);

let storage: DecksStorage | null = null;
let idGen: (prefix: "d" | "k") => string = (p) => `${p}_${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`;
/** El guardado es de a uno: dos cambios seguidos no se pisan. */
let queue: Promise<void> = Promise.resolve();

export function setDecksStorage(s: DecksStorage | null): void {
  storage = s;
}
export const getDecksStorage = (): DecksStorage | null => storage;
export function setIdGenerator(fn: typeof idGen): void {
  idGen = fn;
}
export const newDeckId = () => idGen("d");
export const newKeyId = () => idGen("k");

/** Las imágenes que usan las teclas de estos decks (en la grilla y afuera). */
export function usedImages(data: DecksData): Set<string> {
  const out = new Set<string>();
  for (const d of data.decks) for (const s of [...d.slots, ...d.extra]) if (s) for (const f of slotFiles(s)) out.add(f);
  return out;
}

/**
 * Guarda el índice. released son las imágenes que este cambio dejó sin tecla: se borran DESPUÉS de guardar (si el guardado
 * falla se conservan). Solo esas: una imagen recién guardada que todavía no tiene tecla (se está importando o eligiendo) no se toca.
 */
function persist(data: DecksData, released: readonly string[] = []): Promise<void> {
  const st = storage;
  if (!st) return Promise.resolve();
  queue = queue
    .then(async () => {
      await st.writeIndex(JSON.stringify(data));
      const used = usedImages(useDecks.getState().data ?? data);
      for (const name of released) if (!used.has(name)) await st.removeImage(name);
      useDecks.setState({ saveError: false });
    })
    .catch(() => useDecks.setState({ saveError: true }));
  return queue;
}

/** Espera a que termine lo que se está guardando (para los tests y para cerrar bien). */
export const decksSaved = (): Promise<void> => queue;

function ensureOne(data: { v: 1; decks: Deck[] }, name: string): DecksData {
  const made = data.decks.length ? data : createDeck(data, name, newDeckId());
  return made as DecksData;
}

export const decksActions = {
  /** Lee los decks del disco. Si no hay nada, crea el primero. Un archivo roto se guarda aparte y se empieza de cero. */
  async load(firstDeckName: string): Promise<void> {
    let data: DecksData | null = null;
    let recovered = false;
    let readFailed = false;
    if (storage) {
      let raw: string | null = null;
      try {
        raw = await storage.readIndex();
      } catch {
        readFailed = true;
      }
      if (raw !== null) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
        data = parseDecks(parsed);
        if (!data) {
          recovered = true;
          await storage.backupCorrupt(raw).catch(() => undefined);
        }
      }
    }
    const fresh = !data;
    const ready = data ?? ensureOne(emptyDecks(), firstDeckName);
    useDecks.setState({ data: ready, currentId: ready.decks[0]!.id, recovered, saveError: readFailed });
    // Si no se pudo LEER, no se escribe encima: lo que haya en el disco no se pisa con un deck vacío.
    if (fresh && !readFailed) await persist(ready);
    // Al arrancar nada está a medio hacer: las imágenes que ninguna tecla usa son huérfanas y se borran.
    if (storage && !readFailed) {
      const used = usedImages(ready);
      const orphans = (await storage.listImages().catch(() => [] as string[])).filter((n) => !used.has(n));
      const st = storage;
      queue = queue.then(() => Promise.all(orphans.map((n) => st.removeImage(n))).then(() => undefined)).catch(() => undefined);
    }
  },

  /** Aplica un cambio puro y lo guarda. Devuelve `false` si no cambió nada (no se vuelve a escribir el disco). */
  mutate(fn: (d: DecksData) => DecksData): boolean {
    const cur = useDecks.getState().data;
    if (!cur) return false;
    const next = fn(cur);
    if (next === cur) return false;
    const currentId = next.decks.some((x) => x.id === useDecks.getState().currentId) ? useDecks.getState().currentId : next.decks[0]!.id;
    useDecks.setState({ data: next, currentId });
    const after = usedImages(next);
    void persist(next, [...usedImages(cur)].filter((n) => !after.has(n)));
    return true;
  },

  select: (id: string) => useDecks.setState({ currentId: id }),
  /** Lee las preferencias (animar imágenes, última exportación). */
  async loadPrefs(): Promise<void> {
    useDecks.setState(await loadDecksPrefs());
  },
  setAnimate(animate: boolean): void {
    useDecks.setState({ animate });
    void saveDecksPrefs({ animate, lastExport: useDecks.getState().lastExport });
  },
  markExported(iso: string): void {
    useDecks.setState({ lastExport: iso });
    void saveDecksPrefs({ animate: useDecks.getState().animate, lastExport: iso });
  },
  createDeck(name: string): string | null {
    const id = newDeckId();
    const ok = decksActions.mutate((d) => createDeck(d, name, id));
    if (ok) useDecks.setState({ currentId: id });
    return ok ? id : null;
  },
  renameDeck: (id: string, name: string) => decksActions.mutate((d) => renameDeck(d, id, name) as DecksData),
  moveDeck: (id: string, dir: -1 | 1) => decksActions.mutate((d) => moveDeck(d, id, dir) as DecksData),
  deleteDeck: (id: string) => decksActions.mutate((d) => deleteDeck(d, id) as DecksData),
  setGrid: (id: string, cols: number, rows: number) => decksActions.mutate((d) => setGrid(d, id, cols, rows) as DecksData),
  setSlot: (id: string, index: number, slot: DeckSlot | null) => decksActions.mutate((d) => setSlot(d, id, index, slot) as DecksData),
  addSlot: (id: string, slot: DeckSlot) => decksActions.mutate((d) => addSlot(d, id, slot) as DecksData),
  moveSlot: (id: string, from: number, to: number) => decksActions.mutate((d) => moveSlot(d, id, from, to) as DecksData),
  /** Reemplaza todo (importar). Ya tiene que estar validado. */
  replaceAll(data: DecksData): void {
    decksActions.mutate(() => data);
  },
};

export const currentDeck = (s: DecksState): Deck | null => s.data?.decks.find((d) => d.id === s.currentId) ?? s.data?.decks[0] ?? null;
