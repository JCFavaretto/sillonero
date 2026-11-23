import { buildArchive, parseArchive, planImport } from "@/decks/archive";
import { createDeck, emptyDecks, setSlot, type DecksData, type DeckSlot } from "@/decks/model";
import { createMemoryStorage } from "@/decks/storage";

// D106: exportar e importar los decks a un archivo (para pasarlos a otro celu o no perderlos). El archivo es un dato no confiable.

const link = (id: string, image?: { file: string; animated: boolean }): DeckSlot => ({ id, label: "Twitch", action: { kind: "link", url: "https://twitch.tv/directory", open: "window" }, image: image ?? null });
const sample = (): DecksData => {
  let d = createDeck(createDeck(emptyDecks(), "Stream", "d_a"), "Juego", "d_b") as DecksData;
  d = setSlot(d, "d_a", 0, link("k_one", { file: "k_one.jpg", animated: false })) as DecksData;
  d = setSlot(d, "d_a", 1, link("k_two", { file: "k_two.gif", animated: true })) as DecksData;
  d = setSlot(d, "d_b", 0, { id: "k_three", label: "Traer todo", action: { kind: "bringAll" }, image: null }) as DecksData;
  return d;
};
const IMAGES = { "k_one.jpg": "AAAA", "k_two.gif": "R0lGODlh" };
let n = 0;
const ids = (p: "d" | "k") => `${p}_n${++n}`;
beforeEach(() => (n = 0));

describe("exportar", () => {
  it("el archivo lleva los decks y las imágenes que usan, y se lee de vuelta igual", async () => {
    const st = createMemoryStorage({ images: { ...IMAGES, "k_sobra.jpg": "ZZZZ" } });
    const raw = await buildArchive(sample(), st, new Date("2026-11-17T12:00:00Z"));
    const back = parseArchive(raw);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data).toEqual(sample());
    expect(back.images).toEqual(IMAGES);
    expect(raw).not.toContain("ZZZZ");
    expect(JSON.parse(raw)).toMatchObject({ v: 1, app: "sillonero-decks", exportedAt: "2026-11-17T12:00:00.000Z" });
  });

  it("una imagen que ya no está en el disco se exporta sin ella (la tecla queda con su dibujo)", async () => {
    const st = createMemoryStorage({ images: { "k_one.jpg": "AAAA" } });
    const back = parseArchive(await buildArchive(sample(), st, new Date()));
    expect(back.ok && back.data.decks[0]!.slots[1]!.image).toBeNull();
  });
});

describe("importar: el archivo es un dato no confiable", () => {
  const good = async () => buildArchive(sample(), createMemoryStorage({ images: IMAGES }), new Date());

  it("lo que no es un archivo de decks se rechaza", () => {
    for (const bad of ["no es json", "null", "[]", "{}", JSON.stringify({ v: 2, app: "sillonero-decks", decks: [] }), JSON.stringify({ v: 1, app: "otra-cosa", decks: [] })]) {
      expect(parseArchive(bad).ok).toBe(false);
    }
  });

  it("un deck roto adentro rechaza TODO el archivo (nunca a medias)", async () => {
    const a = JSON.parse(await good());
    a.decks[1].cols = 99;
    expect(parseArchive(JSON.stringify(a)).ok).toBe(false);
  });

  it("imágenes con nombres de ruta, contenido que no es base64, o enormes se rechazan", async () => {
    const base = JSON.parse(await good());
    for (const images of [{ ...base.images, "../x.jpg": "AAAA" }, { ...base.images, "k_one.jpg": "no es base64 !!" }, { ...base.images, "k_one.jpg": "A".repeat(5 * 1024 * 1024) }]) {
      expect(parseArchive(JSON.stringify({ ...base, images })).ok).toBe(false);
    }
  });

  it("un base64 con largo inválido (no múltiplo de 4) o demasiadas imágenes se rechazan", async () => {
    const base = JSON.parse(await good());
    expect(parseArchive(JSON.stringify({ ...base, images: { ...base.images, "k_one.jpg": "AAAAA" } })).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k_${i}.jpg`, "AAAA"]));
    expect(parseArchive(JSON.stringify({ ...base, images: many })).ok).toBe(false);
  });

  it("una tecla que cita una imagen que el archivo no trae queda sin imagen, en vez de romper", async () => {
    const base = JSON.parse(await good());
    delete base.images["k_one.jpg"];
    const r = parseArchive(JSON.stringify(base));
    expect(r.ok && r.data.decks[0]!.slots[0]!.image).toBeNull();
  });

  it("un archivo gigante se rechaza sin intentar leerlo", () => {
    const r = parseArchive("x".repeat(60 * 1024 * 1024));
    expect(r).toEqual({ ok: false, reason: "too_big" });
  });
});

describe("planImport: sumar o reemplazar", () => {
  const incoming = () => {
    const r = parseArchive(JSON.stringify({ v: 1, app: "sillonero-decks", exportedAt: "x", decks: sample().decks, images: IMAGES }));
    if (!r.ok) throw new Error("fixture");
    return r;
  };

  it("sumar: los decks del archivo se agregan a los míos, con ids nuevos (no pisan nada)", () => {
    const mine = createDeck(emptyDecks(), "Mío", "d_a") as DecksData; // mismo id que uno del archivo
    const p = planImport(mine, incoming().data, incoming().images, "add", ids);
    expect(p.data.decks.map((d) => d.name)).toEqual(["Mío", "Stream", "Juego"]);
    expect(new Set(p.data.decks.map((d) => d.id)).size).toBe(3);
    expect(p.added).toBe(2);
    expect(p.dropped).toBe(0);
  });

  it("las teclas y sus imágenes se renombran juntas: cada imagen sigue en su tecla", () => {
    const p = planImport(createDeck(emptyDecks(), "Mío", "d_m") as DecksData, incoming().data, incoming().images, "add", ids);
    const imported = p.data.decks[1]!;
    const first = imported.slots[0]!;
    expect(first.id).not.toBe("k_one");
    expect(first.image).toEqual({ file: `${first.id}.jpg`, animated: false });
    expect(p.images[first.image!.file]).toBe("AAAA");
    const second = imported.slots[1]!;
    expect(second.image).toEqual({ file: `${second.id}.gif`, animated: true });
    expect(p.images[second.image!.file]).toBe("R0lGODlh");
    expect(Object.keys(p.images)).toHaveLength(2);
  });

  it("sumar con más de 32 decks: entran los que caben y se dice cuántos quedaron afuera", () => {
    let mine = emptyDecks() as DecksData;
    for (let i = 0; i < 31; i++) mine = createDeck(mine, `M${i}`, `d_m${i}`) as DecksData;
    const p = planImport(mine, incoming().data, incoming().images, "add", ids);
    expect(p.data.decks).toHaveLength(32);
    expect(p.added).toBe(1);
    expect(p.dropped).toBe(1);
  });

  it("reemplazar: quedan solo los del archivo", () => {
    const mine = createDeck(emptyDecks(), "Mío", "d_m") as DecksData;
    const p = planImport(mine, incoming().data, incoming().images, "replace", ids);
    expect(p.data.decks.map((d) => d.name)).toEqual(["Stream", "Juego"]);
    expect(p.added).toBe(2);
  });

  it("las teclas que corren escenas conservan el id de la escena (la PC la busca por ese id)", () => {
    let d = sample();
    d = setSlot(d, "d_b", 1, { id: "k_scene", label: "Modo sillón", action: { kind: "scene", id: "s_AAAAAAAAAA" }, image: null }) as DecksData;
    const p = planImport(createDeck(emptyDecks(), "Mío", "d_m") as DecksData, d, IMAGES, "add", ids);
    expect(p.data.decks[2]!.slots[1]!.action).toEqual({ kind: "scene", id: "s_AAAAAAAAAA" });
  });
});
