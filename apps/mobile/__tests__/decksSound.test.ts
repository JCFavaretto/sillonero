import { SOUND_CHUNK_CHARS } from "@proyecto-e/protocol";
import { createDeck, emptyDecks, parseDecks, setSlot, slotFiles, type DecksData, type DeckSlot } from "@/decks/model";
import { buildArchive, parseArchive, planImport } from "@/decks/archive";
import { resolveSlot } from "@/decks/resolve";
import { playSoundKey } from "@/decks/sound";
import { createMemoryStorage } from "@/decks/storage";
import { DEMO_AUDIO } from "@/audio/demo";

// F4a (D108): una tecla de sonido. El archivo vive en el celu; la PC lo recibe la primera vez y lo toca por la salida elegida.

const OUT = DEMO_AUDIO.outputs[0]!.id;
const action = { kind: "sound" as const, file: "s_abc123.wav", outputId: OUT, volume: 40 };
const slot = (over: Partial<DeckSlot> = {}): DeckSlot => ({ id: "k_s1", label: "Aplausos", action, image: null, ...over });

type Sent = [string, Record<string, unknown>];
function fakePc(opts: { has?: boolean; failPut?: number } = {}) {
  const sent: Sent[] = [];
  let has = opts.has ?? false;
  let puts = 0;
  const send = async (type: string, payload: unknown) => {
    sent.push([type, payload as Record<string, unknown>]);
    if (type === "sound.put") {
      puts++;
      if (opts.failPut && puts === opts.failPut) return { ok: false as const, reason: "limit" };
      if ((payload as { seq: number; total: number }).seq === (payload as { total: number }).total - 1) has = true;
      return { ok: true as const };
    }
    return has ? { ok: true as const } : { ok: false as const, reason: "not_found" };
  };
  return { sent, send };
}

describe("tocar una tecla de sonido", () => {
  it("si la PC ya lo tiene, un solo mensaje: tocarlo", async () => {
    const st = createMemoryStorage({ images: { "s_abc123.wav": "AAAA" } });
    const pc = fakePc({ has: true });
    expect(await playSoundKey(action, st, pc.send)).toEqual({ ok: true });
    expect(pc.sent).toEqual([["sound.play", { id: "s_abc123", ext: "wav", outputId: OUT, volume: 40 }]]);
  });

  it("si la PC no lo tiene (primera vez, o lo perdió), lo manda en pedazos y vuelve a pedir tocarlo", async () => {
    const big = "A".repeat(SOUND_CHUNK_CHARS * 2 + 100);
    const st = createMemoryStorage({ images: { "s_abc123.wav": big } });
    const pc = fakePc();
    expect(await playSoundKey(action, st, pc.send)).toEqual({ ok: true });
    const types = pc.sent.map((s) => s[0]);
    expect(types).toEqual(["sound.play", "sound.put", "sound.put", "sound.put", "sound.play"]);
    const puts = pc.sent.filter((s) => s[0] === "sound.put").map((s) => s[1]);
    expect(puts.map((p) => [p.seq, p.total])).toEqual([[0, 3], [1, 3], [2, 3]]);
    expect(puts.every((p) => p.id === "s_abc123" && p.ext === "wav" && (p.data as string).length <= SOUND_CHUNK_CHARS)).toBe(true);
    expect((puts.map((p) => p.data) as string[]).join("")).toBe(big);
  });

  it("otro error de la PC al tocar (no es que falte el archivo) no sube nada", async () => {
    const st = createMemoryStorage({ images: { "s_abc123.wav": "AAAA" } });
    const send = async () => ({ ok: false as const, reason: "output_unavailable" });
    expect(await playSoundKey(action, st, send)).toEqual({ ok: false, error: "audio.error.output_unavailable" });
  });

  it("si el archivo ya no está en el celu, lo dice", async () => {
    const st = createMemoryStorage();
    const pc = fakePc();
    expect(await playSoundKey(action, st, pc.send)).toEqual({ ok: false, error: "decks.sound.missingFile" });
    expect(pc.sent.map((s) => s[0])).toEqual(["sound.play"]);
  });

  it("si la PC rechaza un pedazo (muy grande, no es un sonido) se corta y se explica", async () => {
    const st = createMemoryStorage({ images: { "s_abc123.wav": "A".repeat(SOUND_CHUNK_CHARS * 3) } });
    const pc = fakePc({ failPut: 2 });
    expect(await playSoundKey(action, st, pc.send)).toEqual({ ok: false, error: "decks.sound.tooBig" });
    expect(pc.sent.filter((s) => s[0] === "sound.put")).toHaveLength(2);
  });

  it("si después de subirlo la PC igual no lo toca, se dice el motivo real", async () => {
    const st = createMemoryStorage({ images: { "s_abc123.wav": "AAAA" } });
    let plays = 0;
    const send = async (type: string) => (type === "sound.put" ? { ok: true as const } : ++plays === 1 ? { ok: false as const, reason: "not_found" } : { ok: false as const, reason: "audio_unavailable" });
    expect(await playSoundKey(action, st, send)).toEqual({ ok: false, error: "audio.error.audio_unavailable" });
  });
});

describe("la tecla de sonido en los decks", () => {
  it("el esquema la acepta con su archivo, salida y volumen; rechaza rutas y volúmenes raros", () => {
    const d = (a: unknown) => parseDecks(JSON.parse(JSON.stringify(setSlot(createDeck(emptyDecks(), "A", "d_a"), "d_a", 0, { id: "k_a", label: "x", action: a as never, image: null }))));
    expect(d(action)).not.toBeNull();
    expect(d({ ...action, file: "../x.wav" })).toBeNull();
    expect(d({ ...action, file: "s_abc123.exe" })).toBeNull();
    expect(d({ ...action, volume: 101 })).toBeNull();
    expect(d({ ...action, outputId: "x" })).toBeNull();
  });

  it("usa un archivo (para limpiarlo si se borra la tecla) además de su imagen", () => {
    expect(slotFiles(slot())).toEqual(["s_abc123.wav"]);
    expect(slotFiles(slot({ image: { file: "k_s1.jpg", animated: false } }))).toEqual(["k_s1.jpg", "s_abc123.wav"]);
  });

  it("se dibuja con su nombre, o 'Sonido' si no tiene; gris si la salida no está o no hay audio", () => {
    const on = resolveSlot(slot(), null, [], DEMO_AUDIO);
    expect(on).toMatchObject({ kind: "sound", label: "Aplausos", available: true });
    expect(resolveSlot(slot({ label: "" }), null, [], DEMO_AUDIO)).toMatchObject({ labelKey: "decks.action.soundName", available: true });
    expect(resolveSlot(slot(), null, [], { ...DEMO_AUDIO, outputs: [] })).toMatchObject({ available: false, reason: "missing" });
    expect(resolveSlot(slot(), null, [], { ...DEMO_AUDIO, outputs: DEMO_AUDIO.outputs.map((o) => ({ ...o, state: "unavailable" as const })) })).toMatchObject({ available: false, reason: "disconnected" });
    expect(resolveSlot(slot(), null, [], null)).toMatchObject({ available: false, reason: "audioOff" });
  });
});

describe("el respaldo lleva los sonidos", () => {
  let n = 0;
  const ids = (p: "d" | "k") => `${p}_z${++n}`;
  beforeEach(() => (n = 0));
  const deck = () => setSlot(createDeck(emptyDecks(), "Sonidos", "d_a"), "d_a", 0, slot()) as DecksData;

  it("exportar incluye el archivo de sonido; importar lo renombra junto con la tecla (la PC lo vuelve a recibir con su id nuevo)", async () => {
    const st = createMemoryStorage({ images: { "s_abc123.wav": "AAAA" } });
    const p = parseArchive(await buildArchive(deck(), st, new Date()));
    if (!p.ok) throw new Error("no se pudo leer");
    expect(p.images).toEqual({ "s_abc123.wav": "AAAA" });
    const plan = planImport(createDeck(emptyDecks(), "Mío", "d_m") as DecksData, p.data, p.images, "add", ids);
    const key = plan.data.decks[1]!.slots[0]!;
    expect(key.action.kind === "sound" && key.action.file).toMatch(/^s_snd_z\d+\.wav$/);
    expect(Object.keys(plan.images)).toEqual([(key.action as { file: string }).file]);
    expect(parseDecks(plan.data)).not.toBeNull();
  });

  it("una tecla de sonido cuyo archivo no vino en el respaldo no se importa (no podría sonar)", async () => {
    const p = parseArchive(await buildArchive(deck(), createMemoryStorage(), new Date()));
    if (!p.ok) throw new Error("no se pudo leer");
    expect(p.data.decks[0]!.slots[0]).toBeNull();
  });
});
