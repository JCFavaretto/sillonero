import type { Library } from "@proyecto-e/protocol";
import { DEFAULT_GRID, MAX_DECKS, MAX_GRID, MAX_NAME, MAX_SLOTS, MIN_GRID, slotCount, type Deck, type DecksData, type DeckSlot, type KeyAction } from "./model";

// La mudanza (D107): las teclas del Inicio y los lanzadores de la PC pasan a decks del celu, una sola vez.

export interface MigrationNames {
  /** Nombre del deck con las teclas del Inicio. */
  main: string;
  /** Nombre del deck con los lanzadores que no estaban en el Inicio. */
  open: string;
  /** Nombre a mostrar de cada pantalla (apodo), para rotular la tecla que la prende o apaga. */
  names: Record<string, string>;
}

export interface Migration {
  decks: Deck[];
  /** Cuántas teclas se pasaron. */
  keys: number;
}

/** La grilla más chica que entra: 3 columnas, las filas que hagan falta; si no alcanzan, 4 y después 5. */
function gridFor(n: number): { cols: number; rows: number } {
  for (const cols of [DEFAULT_GRID.cols, 4, MAX_GRID.cols]) {
    const rows = Math.max(MIN_GRID.rows, Math.ceil(n / cols));
    if (rows <= MAX_GRID.rows) return { cols, rows };
  }
  return { cols: MAX_GRID.cols, rows: MAX_GRID.rows };
}

function toDeck(name: string, slots: DeckSlot[], idGen: (p: "d") => string): Deck {
  const { cols, rows } = gridFor(slots.length);
  const grid: (DeckSlot | null)[] = Array.from({ length: cols * rows }, (_, i) => slots[i] ?? null);
  return { id: idGen("d"), name: name.slice(0, MAX_NAME), cols, rows, slots: grid, extra: [] };
}

/** Reparte las teclas en decks de hasta 30; el primero lleva el nombre solo y los demás un número. */
function chunked(name: string, slots: DeckSlot[], idGen: (p: "d") => string): Deck[] {
  const out: Deck[] = [];
  for (let i = 0; i * MAX_SLOTS < slots.length; i++) out.push(toDeck(i === 0 ? name : `${name} ${i + 1}`, slots.slice(i * MAX_SLOTS, (i + 1) * MAX_SLOTS), idGen));
  return out;
}

export function buildMigration(library: Library, names: MigrationNames, idGen: (prefix: "d" | "k") => string): Migration {
  const label = (s: string) => s.slice(0, MAX_NAME);
  const launcherSlot = (l: Library["launchers"][number]): DeckSlot => {
    const action: KeyAction = l.target.kind === "app" ? { kind: "app", appId: l.target.appId } : { kind: "link", url: l.target.url, ...(l.target.open ? { open: l.target.open } : {}) };
    return { id: idGen("k"), label: label(l.name), action, image: null, iconKey: l.iconKey };
  };

  const used = new Set<string>();
  const main: DeckSlot[] = [];
  for (const item of library.deck) {
    if (item.kind === "launcher") {
      const l = library.launchers.find((x) => x.id === item.id);
      if (!l) continue; // un lanzador que ya no existe
      used.add(l.id);
      main.push(launcherSlot(l));
      continue;
    }
    const lab = item.kind === "scene" ? (library.scenes.find((s) => s.id === item.id)?.name ?? "") : item.kind === "monitorToggle" ? (names.names[item.monitorId] ?? "") : "";
    main.push({ id: idGen("k"), label: label(lab), action: item, image: null });
  }
  const rest = library.launchers.filter((l) => !used.has(l.id)).map(launcherSlot);
  const decks = [...chunked(names.main, main, idGen), ...chunked(names.open, rest, idGen)];
  return { decks, keys: main.length + rest.length };
}

/**
 * Pone lo migrado en los decks. Si lo único que hay es el deck vacío que se crea la primera vez, se reemplaza; si no, se suman
 * (hasta el tope de 32). Marca la mudanza como hecha: `copied` si se pasó algo, `none` si no había nada.
 */
export function applyMigration(data: DecksData, m: Migration): DecksData {
  if (m.decks.length === 0) return { ...data, migrated: "none" };
  const fresh = data.decks.length === 1 && slotCount(data.decks[0]!) === 0;
  const base = fresh ? [] : data.decks;
  // Si no entra todo (tope de 32), se copia lo que cabe pero NO se ofrece borrar de la PC: lo que quedó afuera se perdería.
  const fits = base.length + m.decks.length <= MAX_DECKS;
  return { ...data, decks: [...base, ...m.decks].slice(0, MAX_DECKS), migrated: fits ? "copied" : "none" };
}
