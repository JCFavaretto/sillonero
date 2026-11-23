import {
  MAX_DECKS,
  MAX_GRID,
  MIN_GRID,
  addSlot,
  createDeck,
  deleteDeck,
  deckIsFull,
  emptyDecks,
  moveDeck,
  moveSlot,
  parseDecks,
  renameDeck,
  setGrid,
  setSlot,
  slotCount,
  type Deck,
  type DecksData,
  type DeckSlot,
} from "@/decks/model";

// F3 (docs/PLAN.md 8.8, D103 a D107): los decks viven en el celu. Hasta 32, cada uno con su nombre y su grilla.

const slot = (id: string, label = id): DeckSlot => ({ id, label, action: { kind: "bringAll" }, image: null });
const data = (n = 1): DecksData => {
  let d = emptyDecks();
  for (let i = 0; i < n; i++) d = createDeck(d, `Deck ${i + 1}`, `d_${i}`);
  return d;
};
const only = (d: DecksData): Deck => d.decks[0]!;

describe("decks: crear, renombrar, ordenar y borrar", () => {
  it("un deck nuevo trae una grilla de 3×4 vacía", () => {
    const d = createDeck(emptyDecks(), "Principal", "d_a");
    expect(d.decks).toHaveLength(1);
    expect(d.decks[0]).toMatchObject({ id: "d_a", name: "Principal", cols: 3, rows: 4, extra: [] });
    expect(d.decks[0]!.slots).toHaveLength(12);
    expect(d.decks[0]!.slots.every((s) => s === null)).toBe(true);
  });

  it("el nombre se limpia y se recorta; vacío no vale", () => {
    expect(createDeck(emptyDecks(), "  Juego   rápido ", "d_a").decks[0]!.name).toBe("Juego rápido");
    expect(createDeck(emptyDecks(), "x".repeat(80), "d_a").decks[0]!.name).toHaveLength(24);
    expect(createDeck(emptyDecks(), "   ", "d_a").decks).toHaveLength(0);
    expect(renameDeck(data(), "d_0", "  ").decks[0]!.name).toBe("Deck 1");
    expect(renameDeck(data(), "d_0", "Nuevo").decks[0]!.name).toBe("Nuevo");
  });

  it("hasta 32 decks; el 33 no se crea", () => {
    const full = data(MAX_DECKS);
    expect(full.decks).toHaveLength(32);
    expect(createDeck(full, "Uno más", "d_x")).toBe(full);
  });

  it("no se repite un id", () => {
    const d = data();
    expect(createDeck(d, "Otro", "d_0")).toBe(d);
  });

  it("mover un deck un lugar, sin salirse de los bordes", () => {
    const d = data(3);
    expect(moveDeck(d, "d_1", -1).decks.map((x) => x.id)).toEqual(["d_1", "d_0", "d_2"]);
    expect(moveDeck(d, "d_1", 1).decks.map((x) => x.id)).toEqual(["d_0", "d_2", "d_1"]);
    expect(moveDeck(d, "d_0", -1)).toBe(d);
    expect(moveDeck(d, "d_2", 1)).toBe(d);
  });

  it("borrar un deck; el último no se puede borrar", () => {
    expect(deleteDeck(data(3), "d_1").decks.map((x) => x.id)).toEqual(["d_0", "d_2"]);
    const one = data(1);
    expect(deleteDeck(one, "d_0")).toBe(one);
  });
});

describe("decks: teclas", () => {
  it("poner una tecla en un lugar, y sacarla", () => {
    const d = setSlot(data(), "d_0", 2, slot("k_1"));
    expect(only(d).slots[2]).toMatchObject({ id: "k_1" });
    expect(only(setSlot(d, "d_0", 2, null)).slots[2]).toBeNull();
  });

  it("un lugar que no existe no se toca", () => {
    const d = data();
    expect(setSlot(d, "d_0", 99, slot("k_1"))).toBe(d);
    expect(setSlot(d, "d_0", -1, slot("k_1"))).toBe(d);
  });

  it("agregar una tecla la pone en el primer lugar libre; si no hay, no entra", () => {
    let d = data();
    d = addSlot(d, "d_0", slot("k_1"));
    d = addSlot(d, "d_0", slot("k_2"));
    expect(only(d).slots.slice(0, 2).map((s) => s?.id)).toEqual(["k_1", "k_2"]);
    for (let i = 0; i < 10; i++) d = addSlot(d, "d_0", slot(`k_f${i}`));
    expect(deckIsFull(only(d))).toBe(true);
    expect(addSlot(d, "d_0", slot("k_nope"))).toBe(d);
  });

  it("mover una tecla a un lugar vacío la lleva; a uno ocupado se intercambian", () => {
    let d = setSlot(setSlot(data(), "d_0", 0, slot("k_a")), "d_0", 1, slot("k_b"));
    d = moveSlot(d, "d_0", 0, 5);
    expect(only(d).slots[0]).toBeNull();
    expect(only(d).slots[5]!.id).toBe("k_a");
    d = moveSlot(d, "d_0", 5, 1);
    expect(only(d).slots[1]!.id).toBe("k_a");
    expect(only(d).slots[5]!.id).toBe("k_b");
  });

  it("mover un lugar vacío o al mismo lugar no cambia nada", () => {
    const d = setSlot(data(), "d_0", 0, slot("k_a"));
    expect(moveSlot(d, "d_0", 3, 4)).toBe(d);
    expect(moveSlot(d, "d_0", 0, 0)).toBe(d);
    expect(moveSlot(d, "d_0", 0, 99)).toBe(d);
  });

  it("slotCount cuenta las teclas y las que quedaron fuera de la grilla", () => {
    expect(slotCount(only(setSlot(data(), "d_0", 0, slot("k_a"))))).toBe(1);
  });
});

describe("decks: cambiar la grilla (D103)", () => {
  const withKeys = () => {
    let d = data();
    for (let i = 0; i < 12; i++) d = setSlot(d, "d_0", i, slot(`k_${i}`));
    return d;
  };

  it("columnas de 2 a 5 y filas de 2 a 6", () => {
    expect([MIN_GRID.cols, MAX_GRID.cols, MIN_GRID.rows, MAX_GRID.rows]).toEqual([2, 5, 2, 6]);
    const d = data();
    expect(setGrid(d, "d_0", 1, 4)).toBe(d);
    expect(setGrid(d, "d_0", 6, 4)).toBe(d);
    expect(setGrid(d, "d_0", 3, 7)).toBe(d);
    expect(only(setGrid(d, "d_0", 5, 6)).slots).toHaveLength(30);
  });

  it("agrandar conserva cada tecla en su fila y columna", () => {
    const d = setGrid(withKeys(), "d_0", 4, 4);
    // en 3×4 la tecla 4 era fila 1, columna 1; en 4×4 es el lugar 5
    expect(only(d).slots[5]!.id).toBe("k_4");
    expect(only(d).slots[0]!.id).toBe("k_0");
    expect(only(d).slots).toHaveLength(16);
  });

  it("achicar manda afuera las teclas que no entran, SIN borrarlas", () => {
    const d = setGrid(withKeys(), "d_0", 3, 3);
    expect(only(d).slots).toHaveLength(9);
    expect(only(d).extra.map((s) => s.id)).toEqual(["k_9", "k_10", "k_11"]);
    expect(slotCount(only(d))).toBe(12);
  });

  it("al volver a agrandar, las que estaban afuera vuelven a un lugar libre", () => {
    const small = setGrid(withKeys(), "d_0", 3, 3);
    const back = setGrid(small, "d_0", 3, 4);
    expect(only(back).extra).toEqual([]);
    expect(only(back).slots.map((s) => s?.id)).toEqual(Array.from({ length: 12 }, (_, i) => `k_${i}`));
  });

  it("si la grilla nueva es la misma, no hace nada", () => {
    const d = withKeys();
    expect(setGrid(d, "d_0", 3, 4)).toBe(d);
  });
});

describe("decks: lo que se lee del disco o de un archivo importado es un dato no confiable", () => {
  it("un archivo bien formado se acepta tal cual", () => {
    const d = setSlot(data(2), "d_0", 0, { id: "k_a", label: "Twitch", action: { kind: "link", url: "https://twitch.tv/directory", open: "window" }, image: { file: "k_a.jpg", animated: false } });
    expect(parseDecks(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("todas las acciones que puede tener una tecla", () => {
    const actions = [
      { kind: "scene", id: "s_AAAAAAAAAA" },
      { kind: "link", url: "https://a.com/x?y=1" },
      { kind: "link", url: "https://a.com", open: "private" },
      { kind: "app", appId: "Discord" },
      { kind: "monitorToggle", monitorId: "m_AAAAAAAAAAAAAAAA" },
      { kind: "bringAll" },
      { kind: "identify" },
      { kind: "media", key: "playPause" },
      { kind: "volume", delta: 5 },
      { kind: "mute" },
    ];
    for (const action of actions) {
      const d = setSlot(data(), "d_0", 0, { id: "k_a", label: "x", action: action as never, image: null });
      expect(parseDecks(JSON.parse(JSON.stringify(d)))).not.toBeNull();
    }
  });

  it("basura, versiones futuras o campos de más: se rechaza TODO (nunca se importa a medias)", () => {
    for (const bad of [null, "x", 7, {}, { v: 2, decks: [] }, { v: 1, decks: [] }, { v: 1, decks: [{ id: "d_a" }] }, { ...data(), extra: 1 }]) {
      expect(parseDecks(bad as never)).toBeNull();
    }
  });

  it("direcciones peligrosas y acciones desconocidas se rechazan", () => {
    const withAction = (action: unknown) => JSON.parse(JSON.stringify(setSlot(data(), "d_0", 0, { id: "k_a", label: "x", action: action as never, image: null })));
    expect(parseDecks(withAction({ kind: "link", url: "javascript:alert(1)" }))).toBeNull();
    expect(parseDecks(withAction({ kind: "link", url: "file:///C:/x" }))).toBeNull();
    expect(parseDecks(withAction({ kind: "ejecutar", cmd: "calc" }))).toBeNull();
    expect(parseDecks(withAction({ kind: "app", appId: "" }))).toBeNull();
  });

  it("nombres de archivo de imagen con rutas ('../') o raros se rechazan", () => {
    const withImage = (file: string) => JSON.parse(JSON.stringify(setSlot(data(), "d_0", 0, { id: "k_a", label: "x", action: { kind: "bringAll" }, image: { file, animated: false } })));
    expect(parseDecks(withImage("k_a.jpg"))).not.toBeNull();
    for (const f of ["../secreto.jpg", "a/b.jpg", "C:\\x.jpg", "k a.jpg", ".jpg", "k_a.exe", ""]) expect(parseDecks(withImage(f))).toBeNull();
  });

  it("más de 32 decks, grillas fuera de rango, teclas de más o ids repetidos se rechazan", () => {
    expect(parseDecks(JSON.parse(JSON.stringify({ v: 1, decks: Array.from({ length: 33 }, (_, i) => ({ ...only(data()), id: `d_${i}` })) })))).toBeNull();
    expect(parseDecks({ v: 1, decks: [{ ...only(data()), cols: 9 }] })).toBeNull();
    expect(parseDecks({ v: 1, decks: [{ ...only(data()), slots: [] }] })).toBeNull();
    expect(parseDecks({ v: 1, decks: [only(data()), only(data())] })).toBeNull();
  });
});
