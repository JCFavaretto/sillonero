import { describe, expect, it } from "vitest";
import { AudioState } from "@proyecto-e/protocol";
import { SoundingHistory, appIdFor, artKeyFor, buildAudio, mediaIdFor, outputIdFor } from "../src/audio/model";
import type { AudioConfig } from "../src/config/schema";
import type { RawAudio, RawMedia, RawOutput, RawSession } from "../src/ports";

const HYPER = "{0.0.0.00000000}.{ac5e7cd6-f17f-412f-9e42-9c3a070138e5}";
const REALTEK = "{0.0.0.00000000}.{a5e5c614-b9b1-45f4-81fa-f75f82fccb0a}";
const TV = "{0.0.0.00000000}.{f8737ccc-d03b-41f4-b7a6-33b2ba25c49a}";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SPOTIFY = "C:\\Users\\Jay\\AppData\\Roaming\\Spotify\\Spotify.exe";

const out = (o: Partial<RawOutput> = {}): RawOutput => ({ winId: HYPER, name: "Altavoces (3- HyperX Cloud Flight Wireless)", formFactor: 5, volume: 0.46, muted: false, ...o });
const ses = (o: Partial<RawSession> = {}): RawSession => ({ pid: 100, exePath: CHROME, winOutputId: HYPER, volume: 1, muted: false, peak: 0, routedWinId: null, ...o });
const med = (o: Partial<RawMedia> = {}): RawMedia => ({ aumid: "chrome.exe", index: 0, title: "Un video", artist: "Un canal", status: "playing", controls: { prev: false, playPause: true, next: false }, hasArt: true, isCurrent: true, ...o });
const raw = (o: Partial<RawAudio> = {}): RawAudio => ({ outputs: [out()], sessions: [], defaultWinId: HYPER, media: [], ...o });
const cfg = (o: Partial<AudioConfig> = {}): AudioConfig => ({ outputs: {}, known: {}, disable: { defaultOutput: false, appRouting: false }, ...o });
const AVAIL = { audio: true, defaultOutput: true, appRouting: true };
const NOW = 1_000_000;

function build(r: RawAudio, o: { config?: AudioConfig; history?: SoundingHistory; now?: number; chosen?: string | null; available?: typeof AVAIL } = {}) {
  return buildAudio({ raw: r, config: o.config ?? cfg(), history: o.history ?? new SoundingHistory(), now: o.now ?? NOW, chosenMedia: o.chosen ?? null, available: o.available ?? AVAIL });
}

describe("ids opacos (D28)", () => {
  it("son estables: el mismo id de Windows da siempre el mismo id", () => {
    expect(outputIdFor(HYPER)).toBe(outputIdFor(HYPER));
    expect(outputIdFor(HYPER)).not.toBe(outputIdFor(REALTEK));
    expect(outputIdFor(HYPER)).toMatch(/^o_[A-Za-z0-9_-]{12}$/);
  });
  it("la ruta del .exe no distingue mayúsculas", () => {
    expect(appIdFor(CHROME)).toBe(appIdFor(CHROME.toUpperCase()));
    expect(appIdFor(CHROME)).toMatch(/^a_[A-Za-z0-9_-]{12}$/);
    expect(mediaIdFor("chrome.exe")).toMatch(/^m_[A-Za-z0-9_-]{12}$/);
    expect(artKeyFor("chrome.exe", "t", "a")).toMatch(/^r_[A-Za-z0-9_-]{12}$/);
    expect(artKeyFor("chrome.exe", "t", "a")).not.toBe(artKeyFor("chrome.exe", "t2", "a"));
  });
  it("el estado cumple el esquema del protocolo y NO deja salir ids de Windows, rutas ni PID", () => {
    const { state } = build(raw({ sessions: [ses({ pid: 4242 })], media: [med()] }));
    expect(AudioState.safeParse(state).success).toBe(true);
    const json = JSON.stringify(state);
    expect(json).not.toContain("{0.0.0");
    expect(json).not.toContain("Program Files");
    expect(json).not.toContain("4242");
  });
  it("el lookup lleva cada id opaco de vuelta a lo real", () => {
    const r = raw({ sessions: [ses({ pid: 100 }), ses({ pid: 101 })], media: [med()] });
    const { state, lookup } = build(r);
    expect(lookup.outputs.get(state.outputs[0]!.id)).toBe(HYPER);
    expect(lookup.apps.get(state.apps[0]!.id)).toEqual([100, 101]);
    expect(lookup.media.get(state.media.sessions[0]!.id)).toEqual({ aumid: "chrome.exe", index: 0 });
    expect(lookup.art.get(state.media.sessions[0]!.artKey!)).toEqual({ aumid: "chrome.exe", index: 0 });
  });
});

describe("salidas", () => {
  it("la predeterminada va primero y marcada; el resto por apodo o nombre", () => {
    const r = raw({ outputs: [out({ winId: TV, name: "LG TV", formFactor: 9 }), out({ winId: REALTEK, name: "Altavoces (Realtek)", formFactor: 1 }), out()], defaultWinId: HYPER });
    const { state } = build(r, { config: cfg({ outputs: { [outputIdFor(TV)]: { nick: "Tele", hidden: false } } }) });
    expect(state.outputs.map((o) => o.nick ?? o.name)).toEqual(["Altavoces (3- HyperX Cloud Flight Wireless)", "Altavoces (Realtek)", "Tele"]);
    expect(state.outputs.map((o) => o.isDefault)).toEqual([true, false, false]);
  });
  it("volumen entero de 0 a 100 y silencio", () => {
    const { state } = build(raw({ outputs: [out({ volume: 0.456, muted: true })] }));
    expect(state.outputs[0]).toMatchObject({ volume: 46, muted: true, state: "active" });
    expect(build(raw({ outputs: [out({ volume: 1.2 })] })).state.outputs[0]!.volume).toBe(100);
    expect(build(raw({ outputs: [out({ volume: -0.1 })] })).state.outputs[0]!.volume).toBe(0);
  });
  it("el tipo sale del FormFactor", () => {
    const kind = (formFactor: number) => build(raw({ outputs: [out({ formFactor })] })).state.outputs[0]!.kind;
    expect(kind(3)).toBe("headphones");
    expect(kind(5)).toBe("headphones");
    expect(kind(1)).toBe("speakers");
    expect(kind(9)).toBe("tv");
    expect(kind(7)).toBe("digital");
    expect(kind(8)).toBe("digital");
    expect(kind(10)).toBe("other");
    expect(kind(99)).toBe("other");
  });
  it("apodo y oculta vienen de la config", () => {
    const { state } = build(raw(), { config: cfg({ outputs: { [outputIdFor(HYPER)]: { nick: "Auriculares", hidden: true } } }) });
    expect(state.outputs[0]).toMatchObject({ nick: "Auriculares", hidden: true });
  });
  it("una salida conocida que ya no está activa sale 'unavailable', sin volumen y con el nombre guardado (D32)", () => {
    const known = { [outputIdFor(TV)]: { name: "LG TV (NVIDIA)", kind: "tv" as const } };
    const { state, lookup } = build(raw(), { config: cfg({ known, outputs: { [outputIdFor(TV)]: { nick: "Tele", hidden: false } } }) });
    const tv = state.outputs.find((o) => o.id === outputIdFor(TV))!;
    expect(tv).toMatchObject({ state: "unavailable", volume: null, name: "LG TV (NVIDIA)", nick: "Tele", kind: "tv", isDefault: false, muted: false });
    expect(lookup.outputs.has(tv.id)).toBe(false); // no hay id de Windows al que apuntar: el servicio contesta output_unavailable
  });
  it("una salida conocida que está activa no se repite", () => {
    const known = { [outputIdFor(HYPER)]: { name: "x", kind: "headphones" as const } };
    expect(build(raw(), { config: cfg({ known }) }).state.outputs).toHaveLength(1);
  });
  it("sin predeterminada, ninguna queda marcada", () => {
    expect(build(raw({ defaultWinId: null })).state.outputs.every((o) => !o.isDefault)).toBe(true);
  });
  it("tope de 16: quedan primero las activas", () => {
    const many = Array.from({ length: 20 }, (_, i) => out({ winId: `{0.0.0.00000000}.{${i}}`, name: `Salida ${String(i).padStart(2, "0")}` }));
    const known: AudioConfig["known"] = {};
    for (let i = 0; i < 5; i++) known[outputIdFor(`{viejo}.${i}`)] = { name: `Vieja ${i}`, kind: "other" };
    const { state } = build(raw({ outputs: many, defaultWinId: null }), { config: cfg({ known }) });
    expect(state.outputs).toHaveLength(16);
    expect(state.outputs.every((o) => o.state === "active")).toBe(true);
  });
});

describe("apps con sonido (D33)", () => {
  it("agrupa por .exe (sin distinguir mayúsculas), con todas sus sesiones", () => {
    const r = raw({
      outputs: [out(), out({ winId: REALTEK, name: "Realtek" })],
      sessions: [ses({ pid: 1 }), ses({ pid: 2, exePath: CHROME.toUpperCase() }), ses({ pid: 3, winOutputId: REALTEK })],
    });
    const { state, lookup } = build(r);
    expect(state.apps).toHaveLength(1);
    expect(state.apps[0]).toMatchObject({ name: "chrome", volume: 100, muted: false });
    expect(state.apps[0]!.outputIds).toEqual([outputIdFor(HYPER), outputIdFor(REALTEK)]);
    expect(lookup.apps.get(state.apps[0]!.id)).toEqual([1, 2, 3]);
  });
  it("ignora los sonidos del sistema y los procesos sin .exe (pid 0)", () => {
    expect(build(raw({ sessions: [ses({ pid: 0, exePath: "" })] })).state.apps).toEqual([]);
  });
  it("ignora sesiones de una salida que no está en la lista", () => {
    expect(build(raw({ sessions: [ses({ winOutputId: "{otra}" })] })).state.apps[0]?.outputIds ?? []).toEqual([]);
  });
  it("nombre sin '.exe', ícono por ruta (el mismo hash que usa B3) y volumen redondeado", () => {
    const { state } = build(raw({ sessions: [ses({ exePath: SPOTIFY, volume: 0.604 })] }));
    expect(state.apps[0]).toMatchObject({ name: "Spotify", volume: 60 });
    expect(state.apps[0]!.iconKey).toMatch(/^i_[A-Za-z0-9_-]{16}$/);
  });
  it("routed: la salida a la que la fijó Jay; si esa salida no está, null", () => {
    expect(build(raw({ sessions: [ses({ routedWinId: HYPER })] })).state.apps[0]!.routed).toBe(outputIdFor(HYPER));
    expect(build(raw({ sessions: [ses({ routedWinId: "{no esta}" })] })).state.apps[0]!.routed).toBeNull();
    expect(build(raw({ sessions: [ses()] })).state.apps[0]!.routed).toBeNull();
  });
  it("las que suenan van primero, después por nombre", () => {
    const h = new SoundingHistory();
    const r = raw({ sessions: [ses({ pid: 1, exePath: CHROME }), ses({ pid: 2, exePath: SPOTIFY, peak: 0.5 })] });
    const { state } = build(r, { history: h });
    expect(state.apps.map((a) => a.name)).toEqual(["Spotify", "chrome"]);
  });
  it("tope de 20 apps", () => {
    const sessions = Array.from({ length: 25 }, (_, i) => ses({ pid: i + 1, exePath: `C:\\apps\\app${String(i).padStart(2, "0")}.exe` }));
    expect(build(raw({ sessions })).state.apps).toHaveLength(20);
  });
});

describe("SoundingHistory: 'sonando' sin titilar (D33)", () => {
  it("un pico mayor a 0,001 cuenta durante 3 s; uno más bajo no", () => {
    const h = new SoundingHistory();
    const at = (peak: number, now: number) => build(raw({ sessions: [ses({ peak })] }), { history: h, now }).state.apps[0]!.sounding;
    expect(at(0.0005, NOW)).toBe(false);
    expect(at(0.3, NOW + 1000)).toBe(true);
    expect(at(0, NOW + 2000)).toBe(true); // un silencio corto entre notas no apaga la marca
    expect(at(0, NOW + 4000)).toBe(true); // 3000 ms desde el último pico
    expect(at(0, NOW + 4001)).toBe(false);
  });
  it("lleva la cuenta por app", () => {
    const h = new SoundingHistory();
    const { state } = build(raw({ sessions: [ses({ pid: 1, exePath: CHROME, peak: 0.4 }), ses({ pid: 2, exePath: SPOTIFY, peak: 0 })] }), { history: h });
    expect(Object.fromEntries(state.apps.map((a) => [a.name, a.sounding]))).toEqual({ chrome: true, Spotify: false });
  });
  it("olvida las apps que ya no están (no crece sin límite)", () => {
    const h = new SoundingHistory();
    build(raw({ sessions: [ses({ peak: 0.4 })] }), { history: h });
    expect(h.size()).toBe(1);
    build(raw({ sessions: [] }), { history: h });
    expect(h.size()).toBe(0);
  });
});

describe("media (D34 y D35)", () => {
  it("sin sesiones: targetId null", () => {
    expect(build(raw()).state.media).toEqual({ sessions: [], targetId: null, chosen: false });
  });
  it("sin elegir, los botones van a la sesión actual de Windows", () => {
    const r = raw({ media: [med({ aumid: "chrome.exe", isCurrent: false }), med({ aumid: "Spotify.exe", title: "Tema", isCurrent: true })] });
    const { state } = build(r);
    expect(state.media.targetId).toBe(mediaIdFor("Spotify.exe"));
    expect(state.media.chosen).toBe(false);
  });
  it("la que eligió Jay manda, aunque no sea la actual", () => {
    const r = raw({ media: [med({ aumid: "chrome.exe", isCurrent: true }), med({ aumid: "Spotify.exe", isCurrent: false })] });
    const { state } = build(r, { chosen: mediaIdFor("Spotify.exe") });
    expect(state.media).toMatchObject({ targetId: mediaIdFor("Spotify.exe"), chosen: true });
  });
  it("si la elegida se cerró, vuelve a la actual con chosen: false", () => {
    const r = raw({ media: [med({ aumid: "chrome.exe", isCurrent: true })] });
    const { state } = build(r, { chosen: mediaIdFor("Spotify.exe") });
    expect(state.media).toMatchObject({ targetId: mediaIdFor("chrome.exe"), chosen: false });
  });
  it("si ninguna está marcada como actual, va a la que está reproduciendo, o a la primera", () => {
    const playing = raw({ media: [med({ aumid: "a.exe", status: "paused", isCurrent: false }), med({ aumid: "b.exe", status: "playing", isCurrent: false })] });
    expect(build(playing).state.media.targetId).toBe(mediaIdFor("b.exe"));
    const paused = raw({ media: [med({ aumid: "a.exe", status: "paused", isCurrent: false }), med({ aumid: "b.exe", status: "paused", isCurrent: false })] });
    expect(build(paused).state.media.targetId).toBe(mediaIdFor("a.exe"));
  });
  it("controles, estado y carátula; los textos se recortan", () => {
    const r = raw({ media: [med({ title: "x".repeat(200), artist: "y".repeat(200), controls: { prev: false, playPause: true, next: false } })] });
    const s = build(r).state.media.sessions[0]!;
    expect(s.controls).toEqual({ prev: false, playPause: true, next: false });
    expect(s.title).toHaveLength(120);
    expect(s.artist).toHaveLength(80);
    expect(s.artKey).toBe(artKeyFor("chrome.exe", "x".repeat(200), "y".repeat(200)));
    expect(build(raw({ media: [med({ hasArt: false })] })).state.media.sessions[0]!.artKey).toBeNull();
  });
  it("nombre lindo: sin '.exe' y, en apps de la tienda, lo que viene después de '!'", () => {
    const r = raw({ media: [med({ aumid: "chrome.exe" }), med({ aumid: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", isCurrent: false })] });
    expect(build(r).state.media.sessions.map((s) => s.app).sort()).toEqual(["Spotify", "chrome"]);
  });
  it("S4: si el AUMID fuera una ruta, el celu solo ve el nombre del archivo", () => {
    const r = raw({ media: [med({ aumid: "C:\\Users\\Jay\\AppData\\Local\\Foo\\foo.exe" })] });
    const s = build(r).state.media.sessions[0]!;
    expect(s.app).toBe("foo");
    expect(JSON.stringify(build(r).state)).not.toContain("Users");
  });
  it("dos sesiones de la MISMA app (YouTube y YouTube Music en Chrome) tienen ids y carátulas distintos, y cada una vuelve a su app y número", () => {
    const r = raw({ media: [med({ aumid: "chrome.exe", title: "Video", index: 0, isCurrent: false }), med({ aumid: "chrome.exe", title: "Canción", index: 1, isCurrent: true })] });
    const { state, lookup } = build(r);
    const ids = state.media.sessions.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    const keys = state.media.sessions.map((s) => s.artKey);
    expect(new Set(keys).size).toBe(2);
    expect(state.media.sessions.map((s) => lookup.media.get(s.id))).toEqual([
      { aumid: "chrome.exe", index: 0 },
      { aumid: "chrome.exe", index: 1 },
    ]);
    expect(lookup.art.get(keys[1]!)).toEqual({ aumid: "chrome.exe", index: 1 });
    expect(state.media.targetId).toBe(ids[1]); // la actual
  });
  it("si las dos de la misma app figuran como 'actual', gana la que está reproduciendo", () => {
    const r = raw({ media: [med({ aumid: "chrome.exe", status: "paused", index: 0, isCurrent: true }), med({ aumid: "chrome.exe", status: "playing", index: 1, isCurrent: true })] });
    const { state } = build(r);
    const playing = state.media.sessions.find((s) => s.status === "playing")!;
    expect(state.media.targetId).toBe(playing.id);
  });
  it("toma el ícono de la app con audio que se llama igual", () => {
    const r = raw({ sessions: [ses({ exePath: CHROME })], media: [med({ aumid: "chrome.exe" })] });
    const { state } = build(r);
    expect(state.media.sessions[0]!.iconKey).toBe(state.apps[0]!.iconKey);
    expect(build(raw({ media: [med()] })).state.media.sessions[0]!.iconKey).toBeNull();
  });
  it("las que reproducen van primero; tope de 8", () => {
    const r = raw({ media: [med({ aumid: "a.exe", status: "paused", isCurrent: false }), med({ aumid: "b.exe", status: "playing", isCurrent: false })] });
    expect(build(r).state.media.sessions.map((s) => s.id)).toEqual([mediaIdFor("b.exe"), mediaIdFor("a.exe")]);
    const many = raw({ media: Array.from({ length: 12 }, (_, i) => med({ aumid: `app${i}.exe`, isCurrent: false })) });
    expect(build(many).state.media.sessions).toHaveLength(8);
  });
});

describe("available", () => {
  it("pasa lo que dijo el hijo de audio", () => {
    expect(build(raw(), { available: { audio: true, defaultOutput: false, appRouting: true } }).state.available).toEqual({ audio: true, defaultOutput: false, appRouting: true });
  });
  it("lo apagado a mano en la config (D29 y D30) también cuenta", () => {
    const { state } = build(raw(), { config: cfg({ disable: { defaultOutput: true, appRouting: true } }) });
    expect(state.available).toEqual({ audio: true, defaultOutput: false, appRouting: false });
  });
});
