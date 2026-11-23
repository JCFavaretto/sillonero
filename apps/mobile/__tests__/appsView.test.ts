import type { MediaSession, WindowInfo } from "@proyecto-e/protocol";
import { DEMO_WINDOWS } from "@/apps/demo";
import { appsView, stableOrder } from "@/apps/playing";
import { DEMO_AUDIO } from "@/audio/demo";

// D95 (docs/PLAN.md 8.8): Apps tiene dos secciones. "Reproduciendo": una tarjeta por reproducción, con su ventana y su app del
// mezclador si se las encuentra. "Abiertas": las demás ventanas. Una ventana que reproduce figura solo arriba.

const w = (over: Partial<WindowInfo>): WindowInfo => ({ ...DEMO_WINDOWS[1]!, ...over });
const session = (over: Partial<MediaSession>): MediaSession => ({ ...DEMO_AUDIO.media.sessions[0]!, ...over });
const audioWith = (sessions: MediaSession[]) => ({ ...structuredClone(DEMO_AUDIO), media: { sessions, targetId: sessions[0]?.id ?? null, chosen: false } });

describe("appsView: Reproduciendo y Abiertas", () => {
  it("sin audio todavía, o con el audio de la PC caído: no hay Reproduciendo y están todas las ventanas", () => {
    expect(appsView(DEMO_WINDOWS, null, [])).toMatchObject({ playing: [] });
    expect(appsView(DEMO_WINDOWS, null, []).open.map((c) => c.key)).toEqual(["w_1", "w_2", "w_3", "w_4"]);
    const off = { ...structuredClone(DEMO_AUDIO), available: { audio: false, defaultOutput: false, appRouting: false } };
    expect(appsView(DEMO_WINDOWS, off, []).playing).toEqual([]);
  });

  it("cada reproducción es una tarjeta con su ventana y su app del mezclador; esas ventanas salen de Abiertas", () => {
    const v = appsView(DEMO_WINDOWS, DEMO_AUDIO, []);
    expect(v.playing.map((p) => [p.key, p.window?.id ?? null, p.app?.id ?? null])).toEqual([
      ["m_DemoSpotify1", "w_4", "a_DemoSpotify1"],
      ["m_DemoChrome01", "w_2", "a_DemoChrome01"],
    ]);
    expect(v.open.map((c) => c.key)).toEqual(["w_1", "w_3"]);
  });

  it("una reproducción sin ventana (Spotify cerrado a la bandeja) igual tiene su tarjeta, sin ventana", () => {
    const v = appsView(DEMO_WINDOWS.filter((x) => x.app !== "Spotify"), DEMO_AUDIO, []);
    expect(v.playing[0]).toMatchObject({ key: "m_DemoSpotify1", window: null });
    expect(v.playing[0]!.app?.id).toBe("a_DemoSpotify1");
  });

  it("navegador con varias ventanas: la reproducción se queda con la ventana cuyo título es el de lo que suena", () => {
    const windows = [w({ id: "w_a", title: "Instagram - Google Chrome" }), w({ id: "w_b", title: "Título del video de YouTube - YouTube - Google Chrome" })];
    const v = appsView(windows, audioWith([session({ id: "m_C", app: "chrome", title: "Título del video de YouTube" })]), []);
    expect(v.playing[0]!.window?.id).toBe("w_b");
    expect(v.open.map((c) => c.key)).toEqual(["w_a"]);
  });

  it("navegador con varias ventanas y ninguna con ese título: la tarjeta queda sin ventana (no se adivina) y no saca ninguna de Abiertas", () => {
    const windows = [w({ id: "w_a", title: "Instagram - Google Chrome" }), w({ id: "w_b", title: "Twitch - Google Chrome" })];
    const v = appsView(windows, audioWith([session({ id: "m_C", app: "chrome", title: "Un podcast" })]), []);
    expect(v.playing[0]!.window).toBeNull();
    expect(v.open.map((c) => c.key)).toEqual(["w_a", "w_b"]);
  });

  it("dos reproducciones de la misma app no comparten ventana", () => {
    const windows = [w({ id: "w_a", app: "vlc", title: "Uno" }), w({ id: "w_b", app: "vlc", title: "Dos" })];
    const v = appsView(windows, audioWith([session({ id: "m_1", app: "vlc", title: "Uno" }), session({ id: "m_2", app: "vlc", title: "Dos" })]), []);
    expect(new Set(v.playing.map((p) => p.window?.id)).size).toBe(2);
    expect(v.open).toEqual([]);
  });

  it("una ventana de YouTube que Windows no informó suma su propia tarjeta (sin extensión) y deja de estar en Abiertas", () => {
    const windows = [...DEMO_WINDOWS, w({ id: "w_yt", title: "lofi hip hop radio - YouTube - Google Chrome" })];
    const v = appsView(windows, audioWith([session({})]), []);
    const extra = v.playing.find((p) => p.fromWindow)!;
    expect(extra).toMatchObject({ window: { id: "w_yt" }, session: { title: "lofi hip hop radio" } });
    expect(v.open.some((c) => c.key === "w_yt")).toBe(false);
  });

  it("las tarjetas de ventana traen la app del mezclador para su barra de volumen (null si no figura)", () => {
    const v = appsView(DEMO_WINDOWS, audioWith([]), []);
    expect(v.open.map((c) => [c.app, c.audio?.id ?? null])).toEqual([
      ["Code", null],
      ["chrome", "a_DemoChrome01"],
      ["Discord", "a_DemoDiscord1"],
      ["Spotify", "a_DemoSpotify1"],
    ]);
  });
});

describe("el orden de Reproduciendo no cambia solo (D95)", () => {
  it("la PC manda primero lo que suena; el celu conserva el orden en que las vio", () => {
    const spotify = session({ id: "m_S", app: "Spotify", status: "playing" });
    const chrome = session({ id: "m_C", app: "chrome", status: "paused" });
    const order = stableOrder([], ["m_S", "m_C"]);
    // Se pausa Spotify y arranca Chrome: la PC las manda al revés, la pantalla no las cruza.
    const v = appsView(DEMO_WINDOWS, audioWith([{ ...chrome, status: "playing" }, { ...spotify, status: "paused" }]), order);
    expect(v.playing.map((p) => p.key)).toEqual(["m_S", "m_C"]);
  });

  it("stableOrder: conserva las conocidas en su orden, saca las que ya no están y suma las nuevas al final", () => {
    expect(stableOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
    expect(stableOrder(["a", "b"], ["x", "b", "a", "y"])).toEqual(["a", "b", "x", "y"]);
    expect(stableOrder([], [])).toEqual([]);
  });

  it("stableOrder devuelve la misma lista si nada cambió (no provoca otro render)", () => {
    const prev = ["a", "b"];
    expect(stableOrder(prev, ["b", "a"])).toBe(prev);
  });
});

// F2 (D99): con la extensión, una ventana de navegador cuya pestaña tiene un reproductor es una tarjeta de Reproduciendo,
// con los controles del video (no los de Windows ni los de teclado).
describe("appsView con la extensión del navegador (D99)", () => {
  const tabMedia = { paused: false, positionMs: 60_000, durationMs: 243_000, rate: 1, muted: false, volume: 80, canSeek: true };
  const tab = (over: Record<string, unknown> = {}) => ({ id: 7, windowId: 1, title: "YouTube — Age of Empires", host: "twitch.tv", active: true, audible: true, pinned: false, media: tabMedia, ...over });
  const browser = (tabs: unknown[], connected = true) => ({ connected, browser: "chrome", tabs }) as never;

  it("la ventana del navegador con un reproductor pasa a Reproduciendo con los datos de la pestaña, y sale de Abiertas", () => {
    const v = appsView(DEMO_WINDOWS, audioWith([]), [], browser([tab()]));
    const web = v.playing.find((p) => p.web);
    expect(web).toMatchObject({ key: "tab:7", window: { id: "w_2" }, web: { id: 7 } });
    expect(web!.session).toMatchObject({ app: "chrome", title: "YouTube — Age of Empires", status: "playing", timeline: { positionMs: 60_000, durationMs: 243_000, rate: 1 } });
    expect(web!.session.controls).toEqual({ prev: false, playPause: true, next: false });
    expect(v.open.some((c) => c.key === "w_2")).toBe(false);
  });

  it("en pausa, el estado es pausa; un vivo no trae línea de tiempo", () => {
    const paused = appsView(DEMO_WINDOWS, audioWith([]), [], browser([tab({ media: { ...tabMedia, paused: true } })]));
    expect(paused.playing[0]!.session.status).toBe("paused");
    const live = appsView(DEMO_WINDOWS, audioWith([]), [], browser([tab({ media: { ...tabMedia, durationMs: null, canSeek: false } })]));
    expect(live.playing[0]!.session.timeline).toBeUndefined();
  });

  it("la reproducción de Windows de ese mismo video no se repite: manda la de la extensión", () => {
    const windows = [w({ id: "w_a", title: "Título del video de YouTube - YouTube - Google Chrome" })];
    const audio = audioWith([session({ id: "m_C", app: "chrome", title: "Título del video de YouTube" })]);
    const v = appsView(windows, audio, [], browser([tab({ title: "Título del video de YouTube - YouTube", host: "youtube.com" })]));
    expect(v.playing.map((p) => p.key)).toEqual(["tab:7"]);
  });

  it("las reproducciones de otras apps (Spotify) siguen donde estaban", () => {
    const v = appsView(DEMO_WINDOWS, DEMO_AUDIO, [], browser([tab()]));
    expect(v.playing.map((p) => p.key)).toContain("m_DemoSpotify1");
    expect(v.playing.find((p) => p.web)).toBeDefined();
  });

  it("sin extensión conectada, o sin reproductor en la pestaña, todo queda como antes", () => {
    const base = appsView(DEMO_WINDOWS, audioWith([]), []);
    expect(appsView(DEMO_WINDOWS, audioWith([]), [], browser([tab()], false))).toEqual(base);
    expect(appsView(DEMO_WINDOWS, audioWith([]), [], browser([tab({ media: undefined })]))).toEqual(base);
  });

  it("funciona aunque el audio de la PC esté caído", () => {
    const off = { ...structuredClone(DEMO_AUDIO), available: { audio: false, defaultOutput: false, appRouting: false } };
    expect(appsView(DEMO_WINDOWS, off, [], browser([tab()])).playing.map((p) => p.key)).toEqual(["tab:7"]);
  });

  it("con dos pestañas con reproductor en la misma ventana, gana la que reproduce; si ambas, la que está a la vista", () => {
    const both = appsView(DEMO_WINDOWS, audioWith([]), [], browser([tab({ id: 8, active: false, title: "Otra" }), tab({ id: 7 })]));
    expect(both.playing.filter((p) => p.web)).toHaveLength(1);
    expect(both.playing.find((p) => p.web)!.web!.id).toBe(7);
    // un video pausado al frente no tapa la música de fondo
    const bg = appsView(DEMO_WINDOWS, audioWith([]), [], browser([tab({ id: 7, media: { ...tabMedia, paused: true } }), tab({ id: 8, active: false, title: "Música" })]));
    expect(bg.playing.find((p) => p.web)!.web!.id).toBe(8);
  });

  it("un título corto de Windows no esconde un video largo de otra ventana (prefijo mínimo)", () => {
    const windows = [w({ id: "w_a", title: "The Office S01E01 - Google Chrome" })];
    const v = appsView(windows, audioWith([session({ id: "m_X", app: "chrome", title: "The" })]), [], browser([tab({ title: "The Office S01E01" })]));
    expect(v.playing.map((p) => p.key)).toContain("m_X");
  });
});
