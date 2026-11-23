import { AppId, MediaKey, MonitorId, OutputId, SafeUrl, SceneId, Volume } from "@proyecto-e/protocol";
import { z } from "zod";

// Los decks del celu (docs/PLAN.md 8.8, D103 a D107): hasta 32, cada uno con su nombre y su grilla de teclas. Todo puro; el
// guardado y las imágenes están en `store.ts` y `images.ts`. Lo que se lee del disco o de un archivo importado se valida entero.

export const MAX_DECKS = 32;
export const MAX_NAME = 24;
export const MIN_GRID = { cols: 2, rows: 2 } as const;
export const MAX_GRID = { cols: 5, rows: 6 } as const;
export const DEFAULT_GRID = { cols: 3, rows: 4 } as const;
/** Una tecla del deck: 30 es el tope de la grilla más grande (5×6). */
export const MAX_SLOTS = MAX_GRID.cols * MAX_GRID.rows;

/** El nombre de un archivo de imagen del deck: solo letras, números, guiones y una extensión de imagen. Nunca una ruta. */
export const IMAGE_FILE = /^[A-Za-z0-9_-]{1,64}\.(jpg|png|webp|gif)$/;
/** El nombre de un archivo de sonido (F4a): el mismo id que usa la PC (`s_<id>.<ext>`). */
export const SOUND_FILE = /^s_[A-Za-z0-9_-]{6,40}\.(mp3|wav|ogg|m4a)$/;
/** Cualquier archivo que un deck guarda en el celu: imagen o sonido. Nunca una ruta. */
export const DECK_FILE = /^(?:[A-Za-z0-9_-]{1,64}\.(?:jpg|png|webp|gif)|s_[A-Za-z0-9_-]{6,40}\.(?:mp3|wav|ogg|m4a))$/;

/** Qué hace una tecla. Las acciones de la PC que ya existían (D104) más los links y las apps, que se guardan en el celu. */
export const KeyAction = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scene"), id: SceneId }),
  z.strictObject({ kind: z.literal("link"), url: SafeUrl, open: z.enum(["tab", "window", "private"]).optional() }),
  z.strictObject({ kind: z.literal("app"), appId: AppId }),
  z.strictObject({ kind: z.literal("monitorToggle"), monitorId: MonitorId }),
  z.strictObject({ kind: z.literal("bringAll") }),
  z.strictObject({ kind: z.literal("identify") }),
  z.strictObject({ kind: z.literal("media"), key: MediaKey }),
  z.strictObject({ kind: z.literal("volume"), delta: z.union([z.literal(-5), z.literal(5)]) }),
  z.strictObject({ kind: z.literal("mute") }),
  z.strictObject({ kind: z.literal("output"), outputId: OutputId }),
  /** F4a: un sonido del celu que suena por una salida de la PC (sin cambiar la predeterminada). */
  z.strictObject({ kind: z.literal("sound"), file: z.string().regex(SOUND_FILE), outputId: OutputId, volume: Volume }),
]);
export type KeyAction = z.infer<typeof KeyAction>;

export const DeckImage = z.strictObject({ file: z.string().regex(IMAGE_FILE), animated: z.boolean() });
export type DeckImage = z.infer<typeof DeckImage>;

export const DeckSlot = z.strictObject({
  id: z.string().regex(/^k_[A-Za-z0-9_-]{1,32}$/),
  /** Vacío = la tecla muestra solo su imagen. */
  label: z.string().max(MAX_NAME),
  action: KeyAction,
  /** Falta o `null` = el dibujo de la acción (o el ícono de la app). */
  image: DeckImage.nullable().optional(),
  /** La clave del ícono de una app de la PC (para dibujarlo si no hay imagen). */
  iconKey: z.string().max(64).nullable().optional(),
});
export type DeckSlot = z.infer<typeof DeckSlot>;

export const Deck = z
  .strictObject({
    id: z.string().regex(/^d_[A-Za-z0-9_-]{1,32}$/),
    name: z.string().trim().min(1).max(MAX_NAME),
    cols: z.number().int().min(MIN_GRID.cols).max(MAX_GRID.cols),
    rows: z.number().int().min(MIN_GRID.rows).max(MAX_GRID.rows),
    /** `cols × rows` lugares, en orden de lectura; `null` = vacío. */
    slots: z.array(DeckSlot.nullable()).max(MAX_SLOTS),
    /** Teclas que no entran en la grilla actual (se achicó): no se borran, vuelven si se agranda. */
    extra: z.array(DeckSlot).max(MAX_SLOTS),
  })
  .refine((d) => d.slots.length === d.cols * d.rows, "la grilla no coincide con sus lugares")
  .refine((d) => d.slots.filter(Boolean).length + d.extra.length <= MAX_SLOTS, "demasiadas teclas");
export type Deck = z.infer<typeof Deck>;

export const DecksData = z
  .strictObject({
    v: z.literal(1),
    decks: z.array(Deck).min(1).max(MAX_DECKS),
    /** D107: ya se pasaron las teclas y los lanzadores de la PC (`copied`) o no había nada que pasar (`none`). */
    migrated: z.enum(["copied", "none"]).optional(),
  })
  .refine((d) => new Set(d.decks.map((x) => x.id)).size === d.decks.length, "decks repetidos");
export type DecksData = z.infer<typeof DecksData>;

/** Sin decks todavía (el celu crea el primero al abrir). No es un archivo válido: `parseDecks` pide al menos uno. */
export const emptyDecks = (): { v: 1; decks: Deck[]; migrated?: "copied" | "none" } => ({ v: 1, decks: [] });

/** Valida lo que viene de afuera (disco, archivo importado). `null` si algo no cierra: nunca se acepta a medias. */
export function parseDecks(raw: unknown): DecksData | null {
  const r = DecksData.safeParse(raw);
  return r.success ? r.data : null;
}

export const cleanName = (name: string): string => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();

type Data = { v: 1; decks: Deck[]; migrated?: "copied" | "none" };
const patch = <T extends Data>(d: T, decks: Deck[]): T => ({ ...d, decks });
const find = (d: Data, id: string) => d.decks.find((x) => x.id === id);
const update = <T extends Data>(d: T, id: string, fn: (deck: Deck) => Deck): T => {
  const cur = find(d, id);
  if (!cur) return d;
  const next = fn(cur);
  return next === cur ? d : patch(d, d.decks.map((x) => (x.id === id ? next : x)));
};

export function createDeck<T extends Data>(d: T, name: string, id: string): T {
  const clean = cleanName(name);
  if (!clean || d.decks.length >= MAX_DECKS || find(d, id)) return d;
  const { cols, rows } = DEFAULT_GRID;
  return patch(d, [...d.decks, { id, name: clean, cols, rows, slots: Array.from({ length: cols * rows }, () => null), extra: [] }]);
}

export const renameDeck = <T extends Data>(d: T, id: string, name: string): T => {
  const clean = cleanName(name);
  return clean ? update(d, id, (x) => (x.name === clean ? x : { ...x, name: clean })) : d;
};

export function moveDeck<T extends Data>(d: T, id: string, dir: -1 | 1): T {
  const i = d.decks.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.decks.length) return d;
  const out = [...d.decks];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return patch(d, out);
}

/** Borra un deck. Siempre queda al menos uno: el último no se puede borrar. */
export const deleteDeck = <T extends Data>(d: T, id: string): T => (d.decks.length <= 1 || !find(d, id) ? d : patch(d, d.decks.filter((x) => x.id !== id)));

/** Los archivos que usa una tecla en el celu: su imagen y, si es de sonido, el sonido. */
export const slotFiles = (s: DeckSlot): string[] => [...(s.image ? [s.image.file] : []), ...(s.action.kind === "sound" ? [s.action.file] : [])];

export const slotCount = (deck: Deck): number => deck.slots.filter(Boolean).length + deck.extra.length;
export const deckIsFull = (deck: Deck): boolean => !deck.slots.includes(null);

export const setSlot = <T extends Data>(d: T, id: string, index: number, slot: DeckSlot | null): T =>
  update(d, id, (x) => (index < 0 || index >= x.slots.length ? x : { ...x, slots: x.slots.map((s, i) => (i === index ? slot : s)) }));

/** Pone la tecla en el primer lugar libre; si el deck está lleno, no entra. */
export function addSlot<T extends Data>(d: T, id: string, slot: DeckSlot): T {
  const deck = find(d, id);
  const free = deck ? deck.slots.indexOf(null) : -1;
  return free < 0 ? d : setSlot(d, id, free, slot);
}

/** Mueve una tecla a otro lugar: si está vacío la lleva, si está ocupado se intercambian. */
export const moveSlot = <T extends Data>(d: T, id: string, from: number, to: number): T =>
  update(d, id, (x) => {
    if (from === to || from < 0 || to < 0 || from >= x.slots.length || to >= x.slots.length || !x.slots[from]) return x;
    const slots = [...x.slots];
    [slots[from], slots[to]] = [slots[to]!, slots[from]!];
    return { ...x, slots };
  });

/**
 * Cambia la grilla (D103). Cada tecla conserva su fila y su columna; las que ya no entran pasan a `extra` (en orden de lectura)
 * y NO se borran. Si la grilla se agranda, las de `extra` vuelven a los primeros lugares libres.
 */
export function setGrid<T extends Data>(d: T, id: string, cols: number, rows: number): T {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < MIN_GRID.cols || cols > MAX_GRID.cols || rows < MIN_GRID.rows || rows > MAX_GRID.rows) return d;
  return update(d, id, (x) => {
    if (x.cols === cols && x.rows === rows) return x;
    const slots: (DeckSlot | null)[] = Array.from({ length: cols * rows }, () => null);
    const out: DeckSlot[] = [];
    x.slots.forEach((s, i) => {
      if (!s) return;
      const r = Math.floor(i / x.cols);
      const c = i % x.cols;
      if (r < rows && c < cols) slots[r * cols + c] = s;
      else out.push(s);
    });
    const extra: DeckSlot[] = [];
    for (const s of [...x.extra, ...out]) {
      const free = slots.indexOf(null);
      if (free >= 0) slots[free] = s;
      else extra.push(s);
    }
    return { ...x, cols, rows, slots, extra };
  });
}
