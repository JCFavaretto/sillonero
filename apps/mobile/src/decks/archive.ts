import { DECK_FILE, MAX_DECKS, parseDecks, slotFiles, type Deck, type DecksData, type DeckSlot } from "./model";
import type { DecksStorage } from "./storage";

// Exportar e importar los decks (docs/PLAN.md D106): un solo archivo con los decks y sus imágenes en base64. El archivo que se
// importa viene de afuera: se valida entero y, si algo no cierra, no se importa nada.

export const ARCHIVE_APP = "sillonero-decks";
/** Tope del archivo (en caracteres) y de cada imagen (ya decodificada): para no colgar el celu con un archivo enorme. */
export const MAX_ARCHIVE_CHARS = 16 * 1024 * 1024;
/** Cuántas imágenes puede traer un archivo: una por tecla como mucho. */
export const MAX_ARCHIVE_IMAGES = 32 * 30;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
// Solo caracteres de base64 y relleno al final; el largo múltiplo de 4 se mira aparte (una regex con grupos repetidos revienta la pila con strings grandes).
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type ImageMap = Record<string, string>;
export type ParsedArchive = { ok: true; data: DecksData; images: ImageMap } | { ok: false; reason: "invalid" | "too_big" };

const keysOf = (d: Deck): DeckSlot[] => [...d.slots.filter((s): s is DeckSlot => s !== null), ...d.extra];
const extOf = (file: string) => file.slice(file.lastIndexOf("."));

/** Quita de los decks lo que usa un archivo que no está: la imagen de una tecla (queda con su dibujo) o una tecla de sonido entera. */
function dropMissing(decks: Deck[], has: (file: string) => boolean): Deck[] {
  const fix = (s: DeckSlot | null): DeckSlot | null => {
    if (!s) return s;
    if (s.action.kind === "sound" && !has(s.action.file)) return null; // sin su sonido no hay nada que tocar
    return s.image && !has(s.image.file) ? { ...s, image: null } : s;
  };
  return decks.map((d) => ({ ...d, slots: d.slots.map(fix), extra: d.extra.map(fix).filter((s): s is DeckSlot => s !== null) }));
}

/** El texto del archivo de respaldo. Las imágenes que ya no están en el disco se exportan sin ellas. */
export async function buildArchive(data: DecksData, storage: DecksStorage, now: Date): Promise<string> {
  const images: ImageMap = {};
  for (const d of data.decks) {
    for (const s of keysOf(d)) {
      for (const f of slotFiles(s)) {
        if (images[f] !== undefined) continue;
        const b64 = await storage.readImage(f);
        if (b64 !== null) images[f] = b64;
      }
    }
  }
  const decks = dropMissing(data.decks, (f) => images[f] !== undefined);
  return JSON.stringify({ v: 1, app: ARCHIVE_APP, exportedAt: now.toISOString(), decks, images });
}

export function parseArchive(raw: string): ParsedArchive {
  if (raw.length > MAX_ARCHIVE_CHARS) return { ok: false, reason: "too_big" };
  let a: unknown;
  try {
    a = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof a !== "object" || a === null || Array.isArray(a)) return { ok: false, reason: "invalid" };
  const o = a as Record<string, unknown>;
  if (o.v !== 1 || o.app !== ARCHIVE_APP || typeof o.images !== "object" || o.images === null || Array.isArray(o.images)) return { ok: false, reason: "invalid" };
  const data = parseDecks({ v: 1, decks: o.decks });
  if (!data) return { ok: false, reason: "invalid" };
  const images: ImageMap = {};
  const entries = Object.entries(o.images as Record<string, unknown>);
  if (entries.length > MAX_ARCHIVE_IMAGES) return { ok: false, reason: "invalid" };
  for (const [name, b64] of entries) {
    if (!DECK_FILE.test(name) || typeof b64 !== "string" || !BASE64.test(b64) || b64.length % 4 !== 0 || Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES) return { ok: false, reason: "invalid" };
    images[name] = b64;
  }
  return { ok: true, data: { ...data, decks: dropMissing(data.decks, (f) => images[f] !== undefined) }, images };
}

export interface ImportPlan {
  /** Los decks que quedan después de importar. */
  data: DecksData;
  /** Las imágenes a guardar (ya con el nombre nuevo). */
  images: ImageMap;
  added: number;
  /** Decks del archivo que no entraron por pasarse de 32. */
  dropped: number;
}

/**
 * Arma lo que quedaría al importar. Los decks y las teclas del archivo reciben ids nuevos (no pisan nada) y sus imágenes se
 * renombran con ellos. Las escenas no se tocan: la tecla cita el id de la escena en la PC.
 */
export function planImport(current: DecksData, incoming: DecksData, incomingImages: ImageMap, mode: "add" | "replace", idGen: (prefix: "d" | "k") => string): ImportPlan {
  const base = mode === "replace" ? [] : current.decks;
  const take = incoming.decks.slice(0, Math.max(0, MAX_DECKS - base.length));
  const images: ImageMap = {};
  const remap = (s: DeckSlot): DeckSlot | null => {
    const id = idGen("k");
    let out: DeckSlot = { ...s, id };
    if (s.image) {
      const b64 = incomingImages[s.image.file];
      if (b64 === undefined) out = { ...out, image: null };
      else {
        const file = `${id}${extOf(s.image.file)}`;
        images[file] = b64;
        out = { ...out, image: { ...s.image, file } };
      }
    }
    if (s.action.kind === "sound") {
      const b64 = incomingImages[s.action.file];
      if (b64 === undefined) return null;
      // El sonido se renombra con el id nuevo de la tecla; mantiene la forma `s_<id>.<ext>` que entiende la PC.
      const file = `s_snd_${id.slice(2)}${extOf(s.action.file)}`;
      images[file] = b64;
      out = { ...out, action: { ...s.action, file } };
    }
    return out;
  };
  const added = take.map((d): Deck => ({ ...d, id: idGen("d"), slots: d.slots.map((s) => (s ? remap(s) : null)), extra: d.extra.map(remap).filter((s): s is DeckSlot => s !== null) }));
  return { data: { ...current, decks: [...base, ...added] }, images, added: added.length, dropped: incoming.decks.length - take.length };
}
