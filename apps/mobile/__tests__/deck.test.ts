import type { Library, Monitor } from "@proyecto-e/protocol";
import { moveKey, resolveDeck } from "@/apps/deck";
import { zoneFraction } from "@/apps/zonesPreview";

const LIB: Library = {
  launchers: [{ id: "l_AAAAAAAAAA", name: "Discord", target: { kind: "app", appId: "Discord" }, iconKey: "i_AAAAAAAAAAAAAAAA" }],
  scenes: [{ id: "s_AAAAAAAAAA", name: "Juego", steps: [{ kind: "bringAll" }] }],
  deck: [
    { kind: "scene", id: "s_AAAAAAAAAA" },
    { kind: "launcher", id: "l_AAAAAAAAAA" },
    { kind: "monitorToggle", monitorId: "m_DemoMonitorTres3" },
    { kind: "bringAll" },
    { kind: "identify" },
  ],
};
const TELE = { id: "m_DemoMonitorTres3", nickname: "Tele living", name: "Samsung TV", enabled: false } as Monitor;

describe("resolveDeck", () => {
  it("cada tecla trae su nombre, ícono y si está disponible", () => {
    const keys = resolveDeck(LIB, [TELE]);
    expect(keys.map((k) => k.kind)).toEqual(["scene", "launcher", "monitorToggle", "bringAll", "identify"]);
    expect(keys[0]).toMatchObject({ label: "Juego", available: true });
    expect(keys[1]).toMatchObject({ label: "Discord", iconKey: "i_AAAAAAAAAAAAAAAA", available: true });
    expect(keys[2]).toMatchObject({ label: "Tele living", available: true, on: false });
    expect(keys[3]).toMatchObject({ labelKey: "home.deck.bringAll", available: true });
  });
  it("una escena o lanzador borrado, o una pantalla desconectada, quedan no disponibles", () => {
    const keys = resolveDeck({ ...LIB, scenes: [], launchers: [] }, []);
    expect(keys[0]).toMatchObject({ available: false, reason: "missing" });
    expect(keys[1]).toMatchObject({ available: false });
    expect(keys[2]).toMatchObject({ available: false, reason: "disconnected" });
  });
  it("sin biblioteca (todavía no llegó) no hay teclas", () => {
    expect(resolveDeck(null, [])).toEqual([]);
  });
});

describe("moveKey", () => {
  const a = [1, 2, 3];
  it("mueve un lugar y no se sale por los bordes", () => {
    expect(moveKey(a, 1, -1)).toEqual([2, 1, 3]);
    expect(moveKey(a, 1, 1)).toEqual([1, 3, 2]);
    expect(moveKey(a, 0, -1)).toEqual(a);
    expect(moveKey(a, 2, 1)).toEqual(a);
    expect(a).toEqual([1, 2, 3]);
  });
});

describe("zoneFraction", () => {
  it("devuelve el rectángulo relativo de cada zona", () => {
    expect(zoneFraction("keep")).toBeNull();
    expect(zoneFraction("full")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(zoneFraction("fullscreen")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(zoneFraction("right")).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(zoneFraction("bl")).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
  });
});

describe("resolveDeck · teclas de audio (B4)", () => {
  const audio = {
    available: { audio: true, defaultOutput: true, appRouting: true },
    outputs: [
      { id: "o_AAAAAAAAAAAA", name: "Altavoces", nick: "Parlantes", kind: "speakers", state: "active", isDefault: true, volume: 40, muted: false, hidden: false },
      { id: "o_BBBBBBBBBBBB", name: "LG TV", nick: "Tele", kind: "tv", state: "unavailable", isDefault: false, volume: null, muted: false, hidden: false },
    ],
    apps: [],
    media: { sessions: [], targetId: null, chosen: false },
  } as const;
  const lib = (deck: Library["deck"]): Library => ({ launchers: [], scenes: [], deck });

  it("Media, volumen y silencio: nombre propio y disponibles si el audio anda", () => {
    const keys = resolveDeck(lib([{ kind: "media", key: "playPause" }, { kind: "volume", delta: 5 }, { kind: "volume", delta: -5 }, { kind: "mute" }]), [], audio as never);
    expect(keys.map((k) => k.labelKey)).toEqual(["home.deck.media.playPause", "home.deck.volumeUp", "home.deck.volumeDown", "home.deck.mute"]);
    expect(keys.every((k) => k.available)).toBe(true);
  });
  it("sin audio (todavía no llegó o caído) las teclas de audio quedan no disponibles", () => {
    expect(resolveDeck(lib([{ kind: "mute" }]), [], null)[0]).toMatchObject({ available: false, reason: "audioOff" });
    const off = { ...audio, available: { audio: false, defaultOutput: false, appRouting: false } };
    expect(resolveDeck(lib([{ kind: "volume", delta: 5 }]), [], off as never)[0]).toMatchObject({ available: false });
  });
  it("⏮ ⏭ quedan no disponibles si la app elegida no los acepta", () => {
    const media = { sessions: [{ id: "m_CCCCCCCCCCCC", app: "chrome", iconKey: null, title: "t", artist: "a", status: "playing", controls: { prev: false, playPause: true, next: false }, artKey: null }], targetId: "m_CCCCCCCCCCCC", chosen: false };
    const keys = resolveDeck(lib([{ kind: "media", key: "prev" }, { kind: "media", key: "playPause" }, { kind: "media", key: "next" }]), [], { ...audio, media } as never);
    expect(keys.map((k) => k.available)).toEqual([false, true, false]);
    expect(keys[0]).toMatchObject({ reason: "unsupported" });
  });
  it("la tecla de salida lleva el apodo; 'unavailable' o desconocida queda gris; la predeterminada va marcada", () => {
    const keys = resolveDeck(lib([{ kind: "output", outputId: "o_AAAAAAAAAAAA" }, { kind: "output", outputId: "o_BBBBBBBBBBBB" }, { kind: "output", outputId: "o_ZZZZZZZZZZZZ" }]), [], audio as never);
    expect(keys[0]).toMatchObject({ label: "Parlantes", available: true, on: true });
    expect(keys[1]).toMatchObject({ label: "Tele", available: false, reason: "disconnected" });
    expect(keys[2]).toMatchObject({ available: false, reason: "missing" });
  });
  it("cambiar la salida necesita que la función exista en esta PC", () => {
    const noDefault = { ...audio, available: { audio: true, defaultOutput: false, appRouting: true } };
    expect(resolveDeck(lib([{ kind: "output", outputId: "o_AAAAAAAAAAAA" }]), [], noDefault as never)[0]).toMatchObject({ available: false, reason: "unsupported" });
  });
});
