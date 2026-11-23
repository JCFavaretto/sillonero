import { describe, expect, it } from "vitest";
import { AppAudio, AudioState, AudioTarget, MediaSession, MediaState, OutputInfo } from "../src/audio";
import { ArtKey, AudioAppId, MediaId, MediaKey, OutputId, Volume } from "../src/audioIds";
import { DeckItem, Step } from "../src/library";
import { CommandError, parseClientMessage, parseServerMessage } from "../src/messages";

const OUT = "o_AAAAAAAAAAAA";
const APP = "a_BBBBBBBBBBBB";
const MED = "m_CCCCCCCCCCCC";
const ART = "r_DDDDDDDDDDDD";
const KEY = "i_AAAAAAAAAAAAAAAA";
const env = (type: string, payload: unknown) => JSON.stringify({ v: 1, id: "c1", type, payload });

const output = { id: OUT, name: "Altavoces (HyperX)", nick: "Auriculares", kind: "headphones", state: "active", isDefault: true, volume: 46, muted: false, hidden: false };
const app = { id: APP, name: "Spotify", iconKey: KEY, outputIds: [OUT], volume: 60, muted: false, sounding: true, routed: null };
const session = { id: MED, app: "Spotify", iconKey: KEY, title: "Tema", artist: "Artista", status: "playing", controls: { prev: true, playPause: true, next: true }, artKey: ART };
const media = { sessions: [session], targetId: MED, chosen: false };
const state = { available: { audio: true, defaultOutput: true, appRouting: true }, outputs: [output], apps: [app], media };

describe("audioIds.ts", () => {
  it("los ids tienen forma fija", () => {
    expect(OutputId.safeParse(OUT).success).toBe(true);
    expect(OutputId.safeParse("o_corto").success).toBe(false);
    expect(OutputId.safeParse("{0.0.0.00000000}.{abc}").success).toBe(false);
    expect(AudioAppId.safeParse(APP).success).toBe(true);
    expect(AudioAppId.safeParse(OUT).success).toBe(false);
    expect(MediaId.safeParse(MED).success).toBe(true);
    expect(ArtKey.safeParse(ART).success).toBe(true);
  });
  it("Volume es un entero de 0 a 100", () => {
    for (const ok of [0, 1, 50, 100]) expect(Volume.safeParse(ok).success, String(ok)).toBe(true);
    for (const bad of [-1, 101, 2.5, "50", NaN]) expect(Volume.safeParse(bad).success, String(bad)).toBe(false);
  });
  it("MediaKey", () => {
    for (const k of ["prev", "playPause", "next"]) expect(MediaKey.safeParse(k).success).toBe(true);
    expect(MediaKey.safeParse("stop").success).toBe(false);
  });
});

describe("audio.ts", () => {
  it("OutputInfo: volumen null solo si no está activa tiene sentido, pero el esquema lo deja", () => {
    expect(OutputInfo.safeParse(output).success).toBe(true);
    expect(OutputInfo.safeParse({ ...output, state: "unavailable", volume: null }).success).toBe(true);
    expect(OutputInfo.safeParse({ ...output, kind: "radio" }).success).toBe(false);
    expect(OutputInfo.safeParse({ ...output, nick: "" }).success).toBe(false);
    expect(OutputInfo.safeParse({ ...output, extra: 1 }).success).toBe(false);
  });
  it("AppAudio", () => {
    expect(AppAudio.safeParse(app).success).toBe(true);
    expect(AppAudio.safeParse({ ...app, routed: OUT }).success).toBe(true);
    expect(AppAudio.safeParse({ ...app, volume: 101 }).success).toBe(false);
    expect(AppAudio.safeParse({ ...app, outputIds: Array.from({ length: 5 }, () => OUT) }).success).toBe(false);
  });
  it("MediaSession · línea de tiempo (D97): opcional; posición dentro de la duración y velocidad razonable", () => {
    const timeline = { positionMs: 60_000, durationMs: 243_000, rate: 1 };
    expect(MediaSession.safeParse({ ...session, timeline }).success).toBe(true);
    // sin el campo sigue valiendo (apps que no informan por dónde van)
    expect(MediaSession.safeParse(session).success).toBe(true);
    for (const bad of [
      { ...timeline, positionMs: -1 },
      { ...timeline, positionMs: 1.5 },
      { ...timeline, durationMs: 0 },
      { ...timeline, positionMs: 243_001 },
      { ...timeline, rate: 0 },
      { ...timeline, rate: 17 },
      { ...timeline, durationMs: 8 * 24 * 3600 * 1000 },
      { ...timeline, extra: 1 },
      { positionMs: 1, durationMs: 2 },
    ]) {
      expect(MediaSession.safeParse({ ...session, timeline: bad }).success).toBe(false);
    }
    expect(MediaSession.safeParse({ ...session, timeline: null }).success).toBe(false);
  });

  it("MediaSession y MediaState", () => {
    expect(MediaSession.safeParse(session).success).toBe(true);
    expect(MediaSession.safeParse({ ...session, artKey: null }).success).toBe(true);
    expect(MediaSession.safeParse({ ...session, title: "x".repeat(121) }).success).toBe(false);
    expect(MediaSession.safeParse({ ...session, artist: "x".repeat(81) }).success).toBe(false);
    expect(MediaState.safeParse(media).success).toBe(true);
    expect(MediaState.safeParse({ sessions: [], targetId: null, chosen: false }).success).toBe(true);
    expect(MediaState.safeParse({ ...media, sessions: Array.from({ length: 9 }, () => session) }).success).toBe(false);
  });
  it("AudioState: topes de 16 salidas y 20 apps", () => {
    expect(AudioState.safeParse(state).success).toBe(true);
    expect(AudioState.safeParse({ ...state, outputs: Array.from({ length: 16 }, () => output) }).success).toBe(true);
    expect(AudioState.safeParse({ ...state, outputs: Array.from({ length: 17 }, () => output) }).success).toBe(false);
    expect(AudioState.safeParse({ ...state, apps: Array.from({ length: 21 }, () => app) }).success).toBe(false);
  });
  it("AudioTarget distingue salida de app", () => {
    expect(AudioTarget.safeParse({ kind: "output", id: OUT }).success).toBe(true);
    expect(AudioTarget.safeParse({ kind: "app", id: APP }).success).toBe(true);
    expect(AudioTarget.safeParse({ kind: "app", id: OUT }).success).toBe(false);
    expect(AudioTarget.safeParse({ kind: "output", id: "{0.0.0.00000000}.{x}" }).success).toBe(false);
  });
});

describe("library.ts: audio en pasos y teclas", () => {
  it("el paso audio necesita hacer algo (D37)", () => {
    expect(Step.safeParse({ kind: "audio", outputId: OUT, makeDefault: true, volume: null }).success).toBe(true);
    expect(Step.safeParse({ kind: "audio", outputId: OUT, makeDefault: false, volume: 30 }).success).toBe(true);
    expect(Step.safeParse({ kind: "audio", outputId: OUT, makeDefault: false, volume: null }).success).toBe(false);
    expect(Step.safeParse({ kind: "audio", outputId: OUT, makeDefault: true, volume: 101 }).success).toBe(false);
    expect(Step.safeParse({ kind: "audio", outputId: "x", makeDefault: true, volume: null }).success).toBe(false);
  });
  it("teclas nuevas del Inicio", () => {
    for (const ok of [
      { kind: "media", key: "playPause" },
      { kind: "volume", delta: 5 },
      { kind: "volume", delta: -5 },
      { kind: "mute" },
      { kind: "output", outputId: OUT },
    ]) expect(DeckItem.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    for (const bad of [{ kind: "volume", delta: 3 }, { kind: "volume", delta: 0 }, { kind: "media", key: "stop" }, { kind: "output", outputId: "x" }]) {
      expect(DeckItem.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("messages.ts: audio", () => {
  it("el celu manda ids opacos y volúmenes enteros", () => {
    const cases: [string, unknown][] = [
      ["audio.setVolume", { target: { kind: "output", id: OUT }, volume: 30 }],
      ["audio.setVolume", { target: { kind: "app", id: APP }, volume: 0 }],
      ["audio.setMute", { target: { kind: "app", id: APP }, muted: true }],
      ["audio.nudge", { delta: 5 }],
      ["audio.nudge", { delta: -5 }],
      ["audio.toggleMute", {}],
      ["audio.setDefault", { outputId: OUT }],
      ["audio.route", { appId: APP, outputId: OUT }],
      ["audio.route", { appId: APP, outputId: null }],
      ["audio.rename", { outputId: OUT, nick: "Parlantes" }],
      ["audio.rename", { outputId: OUT, nick: null }],
      ["audio.hide", { outputId: OUT, hidden: true }],
      ["media.key", { key: "playPause" }],
      ["media.select", { id: MED }],
      ["media.select", { id: null }],
      ["media.art", { keys: [ART] }],
    ];
    for (const [type, payload] of cases) expect(parseClientMessage(env(type, payload)).ok, `${type} ${JSON.stringify(payload)}`).toBe(true);
  });
  it("rechaza lo que no es un id opaco, un volumen entero o un delta de 5", () => {
    const bad: [string, unknown][] = [
      ["audio.setVolume", { target: { kind: "output", id: "{0.0.0.00000000}.{a5e5c614}" }, volume: 30 }],
      ["audio.setVolume", { target: { kind: "output", id: OUT }, volume: 30.5 }],
      ["audio.setVolume", { target: { kind: "output", id: OUT }, volume: 101 }],
      ["audio.nudge", { delta: 10 }],
      ["audio.setDefault", { outputId: "C:\\Windows\\cmd.exe" }],
      ["audio.route", { appId: OUT, outputId: OUT }],
      ["audio.rename", { outputId: OUT, nick: "" }],
      ["audio.rename", { outputId: OUT, nick: "x".repeat(33) }],
      ["media.key", { key: "stop" }],
      ["media.art", { keys: [] }],
      ["media.art", { keys: [ART, ART, ART, ART] }],
      ["media.select", { id: "chrome.exe" }],
    ];
    for (const [type, payload] of bad) expect(parseClientMessage(env(type, payload)).ok, `${type} ${JSON.stringify(payload)}`).toBe(false);
  });
  it("el agente manda el estado y la carátula; el celu no puede mandarlos", () => {
    expect(parseServerMessage(env("audio.snapshot", state)).ok).toBe(true);
    expect(parseServerMessage(env("audio.update", state)).ok).toBe(true);
    expect(parseServerMessage(env("media.artData", { key: ART, jpeg: "/9j/4AAQSkZJRg==" })).ok).toBe(true);
    expect(parseServerMessage(env("media.artData", { key: ART, jpeg: null })).ok).toBe(true);
    expect(parseServerMessage(env("media.artData", { key: ART, jpeg: "no es base64!" })).ok).toBe(false);
    expect(parseServerMessage(env("media.artData", { key: ART, jpeg: "A".repeat(22_001) })).ok).toBe(false);
    for (const t of ["audio.snapshot", "audio.update", "media.artData"]) {
      expect(parseClientMessage(env(t, state)), t).toMatchObject({ ok: false, code: "unknown_type" });
    }
    expect(parseServerMessage(env("audio.setVolume", { target: { kind: "output", id: OUT }, volume: 1 }))).toMatchObject({ ok: false, code: "unknown_type" });
  });
  it("CommandError suma los motivos de audio", () => {
    for (const r of ["audio_unavailable", "output_unavailable", "not_supported"]) expect(CommandError.safeParse(r).success, r).toBe(true);
  });
});
