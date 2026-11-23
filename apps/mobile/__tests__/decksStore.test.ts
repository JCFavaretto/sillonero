import { emptyDecks, createDeck, type DeckSlot } from "@/decks/model";
import { createMemoryStorage } from "@/decks/storage";
import { currentDeck, decksActions, decksSaved, initialDecks, setDecksStorage, setIdGenerator, useDecks, usedImages } from "@/decks/store";

// D103: los decks se guardan en el celu en cada cambio; lo roto se guarda aparte; las imágenes sin tecla se borran.

const slot = (id: string, image?: string): DeckSlot => ({ id, label: id, action: { kind: "bringAll" }, image: image ? { file: image, animated: false } : null });
let n = 0;
beforeEach(() => {
  n = 0;
  useDecks.setState(initialDecks, true);
  setIdGenerator((p) => `${p}_t${++n}`);
});
afterEach(() => setDecksStorage(null));

describe("decks: carga", () => {
  it("la primera vez crea un deck con el nombre dado y lo guarda", async () => {
    const st = createMemoryStorage();
    setDecksStorage(st);
    await decksActions.load("Principal");
    await decksSaved();
    expect(useDecks.getState().data!.decks.map((d) => d.name)).toEqual(["Principal"]);
    expect(currentDeck(useDecks.getState())!.name).toBe("Principal");
    expect(JSON.parse((await st.readIndex())!).decks).toHaveLength(1);
  });

  it("lee lo que había guardado", async () => {
    const d = createDeck(createDeck(emptyDecks(), "Uno", "d_1"), "Dos", "d_2");
    setDecksStorage(createMemoryStorage({ index: JSON.stringify(d) }));
    await decksActions.load("Principal");
    expect(useDecks.getState().data!.decks.map((x) => x.name)).toEqual(["Uno", "Dos"]);
    expect(useDecks.getState().recovered).toBe(false);
  });

  it("un archivo roto se guarda aparte, se empieza de cero y se avisa", async () => {
    const st = createMemoryStorage({ index: "{esto no es json" });
    setDecksStorage(st);
    await decksActions.load("Principal");
    expect(st.corrupt).toEqual(["{esto no es json"]);
    expect(useDecks.getState().recovered).toBe(true);
    expect(useDecks.getState().data!.decks).toHaveLength(1);
  });

  it("un archivo con un esquema que no cierra (o de otra versión) también se trata como roto", async () => {
    const st = createMemoryStorage({ index: JSON.stringify({ v: 9, decks: [] }) });
    setDecksStorage(st);
    await decksActions.load("Principal");
    expect(st.corrupt).toHaveLength(1);
    expect(useDecks.getState().recovered).toBe(true);
  });

  it("sin almacenamiento (tests o demo) igual arma el primer deck", async () => {
    await decksActions.load("Principal");
    expect(useDecks.getState().data!.decks).toHaveLength(1);
  });
});

describe("decks: cambios y guardado", () => {
  async function ready() {
    const st = createMemoryStorage();
    setDecksStorage(st);
    await decksActions.load("Principal");
    await decksSaved();
    return st;
  }

  it("cada cambio se guarda; uno que no cambia nada no vuelve a escribir", async () => {
    const st = await ready();
    const before = st.writes;
    const id = useDecks.getState().currentId!;
    expect(decksActions.addSlot(id, slot("k_a"))).toBe(true);
    await decksSaved();
    expect(st.writes).toBe(before + 1);
    expect(decksActions.setGrid(id, 3, 4)).toBe(false);
    await decksSaved();
    expect(st.writes).toBe(before + 1);
    expect(JSON.parse((await st.readIndex())!).decks[0].slots[0].id).toBe("k_a");
  });

  it("crear un deck lo deja como el que se ve; borrar el que se ve pasa a otro; no se borra el último", async () => {
    await ready();
    const first = useDecks.getState().currentId!;
    const second = decksActions.createDeck("Stream")!;
    expect(useDecks.getState().currentId).toBe(second);
    expect(decksActions.deleteDeck(second)).toBe(true);
    expect(useDecks.getState().currentId).toBe(first);
    expect(decksActions.deleteDeck(first)).toBe(false);
  });

  it("las imágenes que ya no usa ninguna tecla se borran del disco; las que se usan se quedan", async () => {
    const st = await ready();
    const id = useDecks.getState().currentId!;
    await st.writeImage("k_a.jpg", "AAAA");
    await st.writeImage("k_b.jpg", "BBBB");
    decksActions.setSlot(id, 0, slot("k_a", "k_a.jpg"));
    decksActions.setSlot(id, 1, slot("k_b", "k_b.jpg"));
    await decksSaved();
    expect([...(await st.listImages())].sort()).toEqual(["k_a.jpg", "k_b.jpg"]);
    decksActions.setSlot(id, 0, null);
    await decksSaved();
    expect(await st.listImages()).toEqual(["k_b.jpg"]);
    // una tecla que quedó afuera de la grilla sigue usando su imagen
    decksActions.setGrid(id, 2, 2);
    decksActions.setSlot(id, 3, slot("k_c", "k_b.jpg"));
    await decksSaved();
    expect(usedImages(useDecks.getState().data!).has("k_b.jpg")).toBe(true);
  });

  it("borrar un deck borra las imágenes de sus teclas", async () => {
    const st = await ready();
    const id = decksActions.createDeck("Stream")!;
    await st.writeImage("k_a.jpg", "AAAA");
    decksActions.setSlot(id, 0, slot("k_a", "k_a.jpg"));
    await decksSaved();
    expect(await st.listImages()).toEqual(["k_a.jpg"]);
    decksActions.deleteDeck(id);
    await decksSaved();
    expect(await st.listImages()).toEqual([]);
  });

  it("si no se puede guardar se avisa, y lo que está en pantalla sigue valiendo", async () => {
    const st = await ready();
    st.writeIndex = async () => {
      throw new Error("disco lleno");
    };
    decksActions.addSlot(useDecks.getState().currentId!, slot("k_a"));
    await decksSaved();
    expect(useDecks.getState().saveError).toBe(true);
    expect(useDecks.getState().data!.decks[0]!.slots[0]!.id).toBe("k_a");
  });

  it("dos cambios seguidos no se pisan: el disco queda con el último", async () => {
    const st = await ready();
    const id = useDecks.getState().currentId!;
    decksActions.addSlot(id, slot("k_a"));
    decksActions.addSlot(id, slot("k_b"));
    decksActions.renameDeck(id, "Final");
    await decksSaved();
    const saved = JSON.parse((await st.readIndex())!);
    expect(saved.decks[0].name).toBe("Final");
    expect(saved.decks[0].slots.slice(0, 2).map((s: { id: string }) => s.id)).toEqual(["k_a", "k_b"]);
  });
});

describe("decks: imágenes huérfanas", () => {
  it("al arrancar se borran las que ninguna tecla usa", async () => {
    const d = createDeck(emptyDecks(), "Uno", "d_1");
    const st = createMemoryStorage({ index: JSON.stringify(d), images: { "k_sobra.jpg": "AAAA" } });
    setDecksStorage(st);
    await decksActions.load("Principal");
    await decksSaved();
    expect(await st.listImages()).toEqual([]);
  });

  it("una imagen recién guardada que todavía no tiene tecla NO se borra al guardar otro cambio (importar o elegir una imagen)", async () => {
    const st = createMemoryStorage();
    setDecksStorage(st);
    await decksActions.load("Principal");
    await decksSaved();
    await st.writeImage("k_nueva.jpg", "BBBB");
    decksActions.renameDeck(useDecks.getState().currentId!, "Otro nombre");
    await decksSaved();
    expect(await st.listImages()).toEqual(["k_nueva.jpg"]);
  });
});

describe("decks: lectura que falla", () => {
  it("si el disco no se puede leer al arrancar, se avisa y NO se escribe un deck vacío encima de lo que haya", async () => {
    const st = createMemoryStorage({ index: "{}" });
    st.readIndex = async () => {
      throw new Error("error de disco");
    };
    setDecksStorage(st);
    await decksActions.load("Principal");
    await decksSaved();
    expect(useDecks.getState().saveError).toBe(true);
    expect(useDecks.getState().data!.decks).toHaveLength(1);
    expect(st.writes).toBe(0);
  });
});
