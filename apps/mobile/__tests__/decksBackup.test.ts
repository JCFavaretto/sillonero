import { buildArchive, parseArchive } from "@/decks/archive";
import { exportDecks, importDecks, readImportFile } from "@/decks/backup";
import { createDeck, emptyDecks, setSlot, type DecksData } from "@/decks/model";
import { createMemoryStorage } from "@/decks/storage";
import { decksActions, decksSaved, initialDecks, setDecksStorage, setIdGenerator, useDecks } from "@/decks/store";

// D106: exportar es armar el archivo y compartirlo; importar es leer, validar, elegir sumar o reemplazar y guardar.

let n = 0;
beforeEach(() => {
  n = 0;
  useDecks.setState(initialDecks, true);
  setIdGenerator((p) => `${p}_b${++n}`);
});
afterEach(() => setDecksStorage(null));

async function boot() {
  const st = createMemoryStorage();
  setDecksStorage(st);
  await decksActions.load("Principal");
  await st.writeImage("k_a.jpg", "AAAA");
  const id = useDecks.getState().currentId!;
  decksActions.setSlot(id, 0, { id: "k_a", label: "Twitch", action: { kind: "link", url: "https://twitch.tv" }, image: { file: "k_a.jpg", animated: false } });
  await decksSaved();
  return st;
}

describe("exportDecks", () => {
  it("arma el archivo, lo comparte y recuerda cuándo", async () => {
    await boot();
    const shared: { name: string; text: string }[] = [];
    const r = await exportDecks({ share: async (name, text) => void shared.push({ name, text }), now: () => new Date("2026-11-17T12:00:00Z") });
    expect(r).toEqual({ ok: true });
    expect(shared).toHaveLength(1);
    expect(shared[0]!.name).toBe("decks-2026-11-17.json");
    expect(JSON.parse(shared[0]!.text).images["k_a.jpg"]).toBe("AAAA");
    expect(useDecks.getState().lastExport).toBe("2026-11-17T12:00:00.000Z");
  });

  it("si compartir falla, se dice y no se marca como exportado", async () => {
    await boot();
    const r = await exportDecks({
      share: async () => {
        throw new Error("cancelado");
      },
      now: () => new Date(),
    });
    expect(r).toEqual({ ok: false });
    expect(useDecks.getState().lastExport).toBeNull();
  });
});

describe("readImportFile", () => {
  it("un archivo bueno se lee; basura, vacío o enorme se rechaza con el motivo", async () => {
    const st = await boot();
    const archive = await buildArchive(useDecks.getState().data!, st, new Date());
    expect((await readImportFile(async () => archive)).ok).toBe(true);
    expect(await readImportFile(async () => "esto no es un archivo")).toEqual({ ok: false, reason: "invalid" });
    expect(await readImportFile(async () => null)).toEqual({ ok: false, reason: "canceled" });
    expect(await readImportFile(async () => "x".repeat(60 * 1024 * 1024))).toEqual({ ok: false, reason: "too_big" });
    expect(
      await readImportFile(async () => {
        throw new Error("no se pudo leer");
      }),
    ).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("importDecks", () => {
  async function incoming() {
    const st = createMemoryStorage({ images: { "k_x.jpg": "XXXX" } });
    let d = createDeck(emptyDecks(), "Del otro celu", "d_x") as DecksData;
    d = setSlot(d, "d_x", 0, { id: "k_x", label: "Tecla", action: { kind: "scene", id: "s_AAAAAAAAAA" }, image: { file: "k_x.jpg", animated: false } }) as DecksData;
    const p = parseArchive(await buildArchive(d, st, new Date()));
    if (!p.ok) throw new Error("fixture");
    return p;
  }

  it("sumar: los decks nuevos se agregan, sus imágenes se guardan en este celu y los míos quedan", async () => {
    const st = await boot();
    const p = await incoming();
    const r = await importDecks(p.data, p.images, "add");
    await decksSaved();
    expect(r).toMatchObject({ added: 1, dropped: 0 });
    const names = useDecks.getState().data!.decks.map((d) => d.name);
    expect(names).toEqual(["Principal", "Del otro celu"]);
    const key = useDecks.getState().data!.decks[1]!.slots[0]!;
    expect(await st.readImage(key.image!.file)).toBe("XXXX");
    expect(await st.readImage("k_a.jpg")).toBe("AAAA");
  });

  it("reemplazar: quedan solo los del archivo y se borran las imágenes de los míos", async () => {
    const st = await boot();
    const p = await incoming();
    await importDecks(p.data, p.images, "replace");
    await decksSaved();
    expect(useDecks.getState().data!.decks.map((d) => d.name)).toEqual(["Del otro celu"]);
    expect(await st.readImage("k_a.jpg")).toBeNull();
    expect(await st.listImages()).toHaveLength(1);
  });

  it("lo importado conserva la marca de mudanza de este celu (no se vuelve a copiar la biblioteca de la PC)", async () => {
    await boot();
    decksActions.mutate((d) => ({ ...d, migrated: "copied" }));
    const p = await incoming();
    await importDecks(p.data, p.images, "add");
    expect(useDecks.getState().data!.migrated).toBe("copied");
  });
});

describe("importDecks: nunca a medias", () => {
  it("si el disco falla a la mitad no se importa nada y se borra lo ya escrito", async () => {
    const st = await boot();
    const { buildArchive: build, parseArchive: parse } = { buildArchive, parseArchive };
    const src = createMemoryStorage({ images: { "k_x.jpg": "XXXX", "k_y.jpg": "YYYY" } });
    let d = createDeck(emptyDecks(), "Otro", "d_x") as DecksData;
    d = setSlot(d, "d_x", 0, { id: "k_x", label: "A", action: { kind: "bringAll" }, image: { file: "k_x.jpg", animated: false } }) as DecksData;
    d = setSlot(d, "d_x", 1, { id: "k_y", label: "B", action: { kind: "bringAll" }, image: { file: "k_y.jpg", animated: false } }) as DecksData;
    const p = parse(await build(d, src, new Date()));
    if (!p.ok) throw new Error("fixture");
    const before = useDecks.getState().data!.decks.length;
    const real = st.writeImage.bind(st);
    let calls = 0;
    st.writeImage = async (name: string, b64: string) => {
      if (++calls === 2) throw new Error("disco lleno");
      return real(name, b64);
    };
    const r = await importDecks(p.data, p.images, "add");
    expect(r.failed).toBe(true);
    expect(useDecks.getState().data!.decks).toHaveLength(before);
    expect((await st.listImages()).filter((n) => n !== "k_a.jpg")).toEqual([]);
  });
});
