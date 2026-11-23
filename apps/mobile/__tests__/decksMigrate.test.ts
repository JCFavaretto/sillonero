import type { Library } from "@proyecto-e/protocol";
import { applyMigration, buildMigration } from "@/decks/migrate";
import { createDeck, emptyDecks, parseDecks, type DecksData } from "@/decks/model";

// D107: la primera vez, las teclas del Inicio y los lanzadores de la PC pasan a decks del celu.

const SCENE = "s_AAAAAAAAAA";
const L1 = "l_AAAAAAAAAA";
const L2 = "l_BBBBBBBBBB";
const L3 = "l_CCCCCCCCCC";
const MON = "m_AAAAAAAAAAAAAAAA";
let n = 0;
const ids = (p: "d" | "k") => `${p}_m${++n}`;
beforeEach(() => (n = 0));

const library = (over: Partial<Library> = {}): Library => ({
  launchers: [
    { id: L1, name: "Discord", target: { kind: "app", appId: "Discord" }, iconKey: "i_DemoIconDiscord01" },
    { id: L2, name: "YouTube", target: { kind: "url", url: "https://www.youtube.com", open: "window" }, iconKey: null },
    { id: L3, name: "Twitch", target: { kind: "url", url: "https://twitch.tv" }, iconKey: null },
  ],
  scenes: [{ id: SCENE, name: "Trabajo", steps: [{ kind: "bringAll" }] }],
  deck: [{ kind: "scene", id: SCENE }, { kind: "launcher", id: L1 }, { kind: "monitorToggle", monitorId: MON }, { kind: "bringAll" }, { kind: "media", key: "playPause" }],
  ...over,
});

describe("buildMigration", () => {
  it("las teclas del Inicio pasan al deck Principal con sus acciones; los lanzadores se vuelven links y apps", () => {
    const m = buildMigration(library(), { main: "Principal", open: "Abrir", names: { [MON]: "Tele" } }, ids);
    const main = m.decks[0]!;
    expect(main.name).toBe("Principal");
    const slots = main.slots.filter(Boolean);
    expect(slots.map((s) => s!.action)).toEqual([
      { kind: "scene", id: SCENE },
      { kind: "app", appId: "Discord" },
      { kind: "monitorToggle", monitorId: MON },
      { kind: "bringAll" },
      { kind: "media", key: "playPause" },
    ]);
    // lo que tiene nombre propio lo guarda; las acciones fijas se rotulan solas
    expect(slots[0]!.label).toBe("Trabajo");
    expect(slots[1]).toMatchObject({ label: "Discord", iconKey: "i_DemoIconDiscord01" });
    expect(slots[2]!.label).toBe("Tele");
    expect(slots[3]!.label).toBe("");
  });

  it("los lanzadores que no estaban en el Inicio van a un deck Abrir; los que ya estaban no se repiten", () => {
    const m = buildMigration(library(), { main: "Principal", open: "Abrir", names: {} }, ids);
    expect(m.decks.map((d) => d.name)).toEqual(["Principal", "Abrir"]);
    expect(m.decks[1]!.slots.filter(Boolean).map((s) => s!.label)).toEqual(["YouTube", "Twitch"]);
    expect(m.decks[1]!.slots[0]!.action).toEqual({ kind: "link", url: "https://www.youtube.com", open: "window" });
    expect(m.keys).toBe(7);
  });

  it("la grilla se ajusta a la cantidad de teclas (3 columnas, las filas que hagan falta)", () => {
    const m = buildMigration(library({ deck: [], launchers: [] }), { main: "P", open: "A", names: {} }, ids);
    expect(m.decks).toEqual([]);
    const many = library({ deck: Array.from({ length: 14 }, () => ({ kind: "bringAll" as const })), launchers: [] });
    const d = buildMigration(many, { main: "P", open: "A", names: {} }, ids).decks[0]!;
    expect([d.cols, d.rows]).toEqual([3, 5]);
    expect(d.slots).toHaveLength(15);
  });

  it("más de 30 teclas se reparten en varios decks", () => {
    const many = library({ deck: [], launchers: Array.from({ length: 40 }, (_, i) => ({ id: `l_${String(i).padStart(10, "0")}`, name: `L${i}`, target: { kind: "url" as const, url: `https://a.com/${i}` }, iconKey: null })) });
    const m = buildMigration(many, { main: "P", open: "Abrir", names: {} }, ids);
    expect(m.decks.map((d) => d.name)).toEqual(["Abrir", "Abrir 2"]);
    expect(m.decks.flatMap((d) => d.slots.filter(Boolean))).toHaveLength(40);
  });

  it("una tecla que apunta a un lanzador que ya no existe se descarta, sin romper", () => {
    const m = buildMigration(library({ deck: [{ kind: "launcher", id: "l_ZZZZZZZZZZ" }, { kind: "bringAll" }], launchers: [] }), { main: "P", open: "A", names: {} }, ids);
    expect(m.decks[0]!.slots.filter(Boolean)).toHaveLength(1);
  });

  it("el resultado cumple el esquema (se puede guardar y exportar)", () => {
    const m = buildMigration(library(), { main: "Principal", open: "Abrir", names: {} }, ids);
    expect(parseDecks({ v: 1, decks: m.decks })).not.toBeNull();
  });
});

describe("applyMigration", () => {
  const names = { main: "Principal", open: "Abrir", names: {} };
  it("reemplaza el deck vacío de la primera vez y marca la mudanza como hecha", () => {
    const first = createDeck(emptyDecks(), "Principal", "d_first") as DecksData;
    const r = applyMigration(first, buildMigration(library(), names, ids));
    expect(r.migrated).toBe("copied");
    expect(r.decks.map((d) => d.name)).toEqual(["Principal", "Abrir"]);
    expect(r.decks.some((d) => d.id === "d_first")).toBe(false);
  });

  it("si no había nada que pasar, queda marcada como \"none\" (no se ofrece borrar nada)", () => {
    const first = createDeck(emptyDecks(), "Principal", "d_first") as DecksData;
    expect(applyMigration(first, buildMigration(library({ deck: [], launchers: [] }), names, ids)).migrated).toBe("none");
  });

  it("si no entran todos los decks (tope de 32) NO se ofrece borrar de la PC: lo que quedó afuera se perdería", () => {
    let mine = emptyDecks() as DecksData;
    for (let i = 0; i < 31; i++) mine = createDeck(mine, `M${i}`, `d_m${i}`) as DecksData;
    mine = { ...mine, decks: mine.decks.map((d, i) => (i === 0 ? { ...d, slots: d.slots.map((s, k) => (k === 0 ? { id: "k_x", label: "x", action: { kind: "bringAll" as const }, image: null } : s)) } : d)) };
    const r = applyMigration(mine, buildMigration(library(), names, ids));
    expect(r.decks).toHaveLength(32);
    expect(r.migrated).toBe("none");
  });
});
