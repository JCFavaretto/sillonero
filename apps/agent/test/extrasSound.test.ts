/* eslint-disable @typescript-eslint/no-explicit-any -- los payloads de los mensajes en estos tests se leen sin tipar a propósito */
import { describe, expect, it } from "vitest";
import { ClientMessage, type SoundChunk } from "@proyecto-e/protocol";
import { createCatalog } from "../src/apps/catalog";
import { createExtras } from "../src/apps/extras";
import { createIcons } from "../src/apps/icons";
import { createLaunchService } from "../src/apps/launch";
import { createLibraryService } from "../src/apps/library";
import { createWindowsService } from "../src/apps/windowsService";
import { createScreensService } from "../src/screens/service";
import { createSoundStore } from "../src/sounds/store";
import { APP_CHROME, OUT_H, OUT_R, REALTEK, setup as audioSetup } from "./audioHelpers";
import { FakeCatalog, FakeClock, FakeDisplays, FakeIconExtractor, FakeLauncher, FakeRandom, FakeWindows, MemFs, MemLogger } from "./fakes";

// F4a (D108): disparar un sonido por una salida. El celu manda el archivo en pedazos y después pide tocarlo.

const wav = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE"), ...Buffer.from("fmt "), ...Array.from({ length: 80 }, (_, i) => i)]);
const chunks = (id: string, bytes: Uint8Array): SoundChunk[] => {
  const s = Buffer.from(bytes).toString("base64");
  const parts = Array.from({ length: Math.ceil(s.length / 40) }, (_, i) => s.slice(i * 40, (i + 1) * 40));
  return parts.map((data, seq) => ({ id, ext: "wav", seq, total: parts.length, data }));
};

async function setup(withAudio = true) {
  const clock = new FakeClock(1_000_000);
  const fw = new FakeWindows();
  const log = new MemLogger();
  const screens = createScreensService({ displays: new FakeDisplays(), windows: fw, log });
  await screens.refresh();
  const fs = new MemFs();
  const icons = createIcons({ extractor: new FakeIconExtractor(fs), fs, dir: "icons" });
  const catalog = createCatalog({ source: new FakeCatalog(), clock });
  const windows = createWindowsService({ windows: fw, screens, log, onIcon: (k, p) => icons.register(k, p) });
  let lib = { launchers: [], scenes: [], deck: [] } as any;
  const library = createLibraryService({ store: { get: () => lib, save: async (n: any) => void (lib = n) }, catalog, icons, random: new FakeRandom(), log });
  const launch = createLaunchService({ windows, port: fw, launcher: new FakeLauncher(), screens, clock, log });
  const a = audioSetup();
  await a.service.refresh();
  const sounds = createSoundStore({ fs, dir: "C:/data/sounds", clock });
  const extras = createExtras({ audio: withAudio ? a.service : undefined, sounds, windows, screens, library, launch, catalog, icons, clock, random: new FakeRandom(), log });
  const send = () => undefined;
  const msg = (type: string, payload: unknown) => ClientMessage.parse({ v: 1, id: "c1", type, payload });
  const put = async (id: string, bytes = wav) => {
    let last: any;
    for (const c of chunks(id, bytes)) last = await extras.handle(msg("sound.put", c), send);
    return last;
  };
  return { extras, audio: a.audio, msg, send, put };
}

describe("sonido por una salida", () => {
  it("el agente reconoce los mensajes de sonido", async () => {
    const { extras } = await setup();
    expect(extras.handles("sound.put")).toBe(true);
    expect(extras.handles("sound.play")).toBe(true);
  });

  it("recibir el sonido en pedazos y tocarlo por la salida pedida: la PC lo reproduce ahí, sin cambiar la predeterminada", async () => {
    const { extras, audio, msg, send, put } = await setup();
    expect(await put("s_abc123")).toEqual({ ok: true });
    expect(await extras.handle(msg("sound.play", { id: "s_abc123", ext: "wav", outputId: OUT_R, volume: 40 }), send)).toEqual({ ok: true });
    expect(audio.calls).toEqual([`playSound C:/data/sounds/s_abc123.wav ${REALTEK} 0.4`]);
    expect(audio.calls.some((c) => c.startsWith("setDefault"))).toBe(false);
  });

  it("pedir un sonido que la PC no tiene da not_found: así el celu sabe que tiene que mandarlo", async () => {
    const { extras, audio, msg, send } = await setup();
    expect(await extras.handle(msg("sound.play", { id: "s_nuevo01", ext: "wav", outputId: OUT_H, volume: 50 }), send)).toEqual({ ok: false, reason: "not_found" });
    expect(audio.calls).toEqual([]);
  });

  it("una salida que no existe (o que está desconectada) no reproduce nada", async () => {
    const { extras, audio, msg, send, put } = await setup();
    await put("s_abc123");
    expect(await extras.handle(msg("sound.play", { id: "s_abc123", ext: "wav", outputId: "o_ZZZZZZZZZZZZ", volume: 40 }), send)).toEqual({ ok: false, reason: "not_found" });
    expect(audio.calls).toEqual([]);
  });

  it("un archivo que no es un sonido se rechaza (not_allowed) y no queda guardado", async () => {
    const { extras, msg, send, put } = await setup();
    const exe = Uint8Array.from([...Buffer.from("MZ"), ...new Array(100).fill(1)]);
    expect(await put("s_evil01", exe)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await extras.handle(msg("sound.play", { id: "s_evil01", ext: "wav", outputId: OUT_H, volume: 50 }), send)).toEqual({ ok: false, reason: "not_found" });
  });

  it("si el audio de la PC no está, todo contesta audio_unavailable", async () => {
    const { extras, msg, send } = await setup(false);
    expect(await extras.handle(msg("sound.play", { id: "s_abc123", ext: "wav", outputId: OUT_H, volume: 50 }), send)).toEqual({ ok: false, reason: "audio_unavailable" });
  });

  it("un error del reproductor de Windows se dice como failed (no cuelga al celu)", async () => {
    const { extras, audio, msg, send, put } = await setup();
    await put("s_abc123");
    audio.failNext("playSound", "boom");
    expect(await extras.handle(msg("sound.play", { id: "s_abc123", ext: "wav", outputId: OUT_H, volume: 50 }), send)).toEqual({ ok: false, reason: "failed" });
  });

  it("el volumen 0 a 100 llega como 0 a 1", async () => {
    const { extras, audio, msg, send, put } = await setup();
    await put("s_abc123");
    await extras.handle(msg("sound.play", { id: "s_abc123", ext: "wav", outputId: OUT_H, volume: 100 }), send);
    expect(audio.calls.at(-1)!.endsWith(" 1")).toBe(true);
    void APP_CHROME;
  });
});
