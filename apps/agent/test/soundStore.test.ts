import { describe, expect, it } from "vitest";
import { MAX_SOUND_BYTES, SOUND_CHUNK_CHARS, type SoundChunk } from "@proyecto-e/protocol";
import { MAX_SOUNDS, createSoundStore, sniffExt } from "../src/sounds/store";
import { FakeClock, MemFs } from "./fakes";

// F4a (D108): la PC recibe el sonido en pedazos, lo valida y lo guarda; el celu es el dueño del archivo.

const wav = (n = 64) => Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE"), ...Buffer.from("fmt "), ...Array.from({ length: n }, (_, i) => i % 251)]);
const mp3 = Uint8Array.from([...Buffer.from("ID3"), 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const chunks = (id: string, ext: SoundChunk["ext"], bytes: Uint8Array, size = 24): SoundChunk[] => {
  const s = b64(bytes);
  const parts = Array.from({ length: Math.ceil(s.length / size) }, (_, i) => s.slice(i * size, (i + 1) * size));
  return parts.map((data, seq) => ({ id, ext, seq, total: parts.length, data }));
};
function setup() {
  const fs = new MemFs();
  const clock = new FakeClock(1_000_000);
  const store = createSoundStore({ fs, dir: "C:/data/sounds", clock });
  return { fs, clock, store };
}
const sendAll = async (store: ReturnType<typeof setup>["store"], cs: SoundChunk[]) => {
  let last;
  for (const c of cs) last = await store.put(c);
  return last!;
};

describe("sniffExt: qué es de verdad el archivo", () => {
  it("reconoce wav, mp3, ogg y m4a por sus primeros bytes", () => {
    expect(sniffExt(wav())).toBe("wav");
    expect(sniffExt(mp3)).toBe("mp3");
    expect(sniffExt(Uint8Array.from([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("mp3");
    expect(sniffExt(Uint8Array.from([...Buffer.from("OggS"), 0, 2, 0, 0, 0, 0, 0, 0]))).toBe("ogg");
    expect(sniffExt(Uint8Array.from([0, 0, 0, 0x20, ...Buffer.from("ftypM4A "), 0, 0, 0, 0]))).toBe("m4a");
  });
  it("un ejecutable o cualquier otra cosa no es un sonido", () => {
    expect(sniffExt(Uint8Array.from([...Buffer.from("MZ"), 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]))).toBeNull();
    expect(sniffExt(new Uint8Array(4))).toBeNull();
  });
});

describe("recibir un sonido en pedazos", () => {
  it("junta los pedazos, lo guarda y lo deja listo", async () => {
    const { store, fs } = setup();
    const bytes = wav(200);
    const r = await sendAll(store, chunks("s_abc123", "wav", bytes));
    expect(r).toEqual({ ok: true, complete: true });
    expect(store.path("s_abc123", "wav")).toBe("C:/data/sounds/s_abc123.wav");
    
    expect(fs.bytes.get("C:/data/sounds/s_abc123.wav")).toEqual(bytes);
  });

  it("los pedazos pueden llegar en cualquier orden y repetidos", async () => {
    const { store } = setup();
    const cs = chunks("s_abc123", "wav", wav(200));
    const shuffled = [cs[2]!, cs[0]!, cs[2]!, ...cs.slice(3), cs[1]!];
    const results = [];
    for (const c of shuffled) results.push(await store.put(c));
    expect(results.at(-1)).toEqual({ ok: true, complete: true });
    expect(results.slice(0, -1).every((r) => r.ok && !r.complete)).toBe(true);
  });

  it("un archivo cuyo contenido no es lo que dice su extensión se rechaza y no se guarda", async () => {
    const { store, fs } = setup();
    const r = await sendAll(store, chunks("s_abc123", "mp3", wav(100)));
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(store.path("s_abc123", "mp3")).toBeNull();
    expect(fs.bytes.size).toBe(0);
  });

  it("un ejecutable disfrazado de sonido se rechaza", async () => {
    const { store } = setup();
    const exe = Uint8Array.from([...Buffer.from("MZ"), ...new Array(80).fill(7)]);
    expect(await sendAll(store, chunks("s_evil01", "wav", exe))).toEqual({ ok: false, reason: "invalid" });
  });

  it("pasado el tope de peso se rechaza", async () => {
    const { store } = setup();
    const big = new Uint8Array(MAX_SOUND_BYTES + 100);
    big.set(wav(8));
    const r = await sendAll(store, chunks("s_big001", "wav", big, SOUND_CHUNK_CHARS));
    expect(r).toEqual({ ok: false, reason: "too_big" });
  });

  it("pedazos que no cierran (otro total u otra extensión a mitad) cancelan esa subida", async () => {
    const { store } = setup();
    const cs = chunks("s_abc123", "wav", wav(200));
    expect((await store.put(cs[0]!)).ok).toBe(true);
    expect(await store.put({ ...cs[1]!, total: cs[1]!.total + 1 })).toEqual({ ok: false, reason: "invalid" });
    // la subida quedó cancelada: reenviar todo desde el principio sirve
    expect(await sendAll(store, cs)).toEqual({ ok: true, complete: true });
  });

  it("una subida a medias se descarta sola con el tiempo (no se acumula memoria)", async () => {
    const { store, clock } = setup();
    const cs = chunks("s_abc123", "wav", wav(200));
    await store.put(cs[0]!);
    clock.advance(5 * 60_000);
    // el pedazo 1 solo no completa: la subida vieja ya no existe, empieza otra
    const r = await store.put(cs[1]!);
    expect(r).toEqual({ ok: true, complete: false });
    expect(store.pending()).toBe(1);
  });

  it("no más de 4 subidas a la vez", async () => {
    const { store } = setup();
    for (let i = 0; i < 4; i++) expect((await store.put(chunks(`s_up00${i}`, "wav", wav(200))[0]!)).ok).toBe(true);
    expect(await store.put(chunks("s_up009", "wav", wav(200))[0]!)).toEqual({ ok: false, reason: "busy" });
  });

  it("guarda como mucho 40 sonidos: al pasarse se borra el más viejo", async () => {
    const { store, fs, clock } = setup();
    for (let i = 0; i < MAX_SOUNDS + 2; i++) {
      await sendAll(store, chunks(`s_snd${String(i).padStart(3, "0")}`, "wav", wav(30), 4000));
      clock.advance(1000);
    }
    expect(store.path("s_snd000", "wav")).toBeNull();
    expect(store.path("s_snd001", "wav")).toBeNull();
    expect(store.path(`s_snd${String(MAX_SOUNDS + 1).padStart(3, "0")}`, "wav")).not.toBeNull();
    expect([...fs.bytes.keys()].filter((k) => k.endsWith(".wav"))).toHaveLength(MAX_SOUNDS);
  });

  it("volver a mandar un sonido que ya está no lo duplica", async () => {
    const { store } = setup();
    await sendAll(store, chunks("s_abc123", "wav", wav(100)));
    expect(await sendAll(store, chunks("s_abc123", "wav", wav(100)))).toEqual({ ok: true, complete: true });
    expect(store.count()).toBe(1);
  });

  it("al arrancar recuerda los sonidos que ya había en el disco", async () => {
    const a = setup();
    await sendAll(a.store, chunks("s_abc123", "wav", wav(100)));
    const b = createSoundStore({ fs: a.fs, dir: "C:/data/sounds", clock: a.clock });
    await b.load();
    expect(b.path("s_abc123", "wav")).toBe("C:/data/sounds/s_abc123.wav");
  });
});

describe("sniffExt: validación de estructura (revisión de seguridad de F4a)", () => {
  it("un RIFF/WAVE sin su bloque fmt, un mp3 con encabezado inválido y un m4a de otro contenedor no pasan", () => {
    expect(sniffExt(Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE"), ...Buffer.from("junk"), 1, 2, 3]))).toBeNull();
    expect(sniffExt(Uint8Array.from([0xff, 0xe0, 0x00, 0x00, 0, 0, 0, 0]))).toBeNull();
    expect(sniffExt(Uint8Array.from([0xff, 0xfb, 0xf0, 0x00, 0, 0, 0, 0]))).toBeNull();
    expect(sniffExt(Uint8Array.from([0, 0, 0, 0x20, ...Buffer.from("ftypheic"), 0, 0, 0, 0]))).toBeNull();
    expect(sniffExt(Uint8Array.from([0, 0, 0, 0x20, ...Buffer.from("ftypisom"), 0, 0, 0, 0]))).toBe("m4a");
  });

  it("las mayúsculas del id no duplican el sonido (Windows no las distingue)", async () => {
    const { store } = setup();
    await sendAll(store, chunks("s_ABCdef", "wav", wav(100)));
    await sendAll(store, chunks("s_abcDEF", "wav", wav(100)));
    expect(store.count()).toBe(1);
    expect(store.path("s_ABCDEF", "wav")).not.toBeNull();
  });

  it("dos subidas que terminan a la vez no se pisan", async () => {
    const { store } = setup();
    const a = chunks("s_aaaaaa", "wav", wav(100));
    const b = chunks("s_bbbbbb", "wav", wav(120));
    const results = await Promise.all([...a, ...b].map((c) => store.put(c)));
    expect(results.filter((r) => r.ok && r.complete)).toHaveLength(2);
    expect(store.count()).toBe(2);
  });
});
