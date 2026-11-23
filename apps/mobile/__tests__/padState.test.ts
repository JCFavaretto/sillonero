import { SHORTCUTS, type ServerMessage } from "@proyecto-e/protocol";
import { padActions } from "@/pad/actions";
import { applyPad, initialPad, usePad } from "@/pad/store";
import { SHORTCUT_GROUPS, shortcutNames } from "@/pad/shortcuts";
import { DEFAULT_SETTINGS } from "@/pad/controller";
import { loadPadSettings, savePadSettings } from "@/storage/prefs";
import { setAppsBridge } from "@/apps/commands";

const mockMem = new Map<string, string>();
let mockFail = false;
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => {
    if (mockFail) throw new Error("keystore");
    return mockMem.get(k) ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (mockFail) throw new Error("keystore");
    mockMem.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => void mockMem.delete(k)),
}));

const msg = (type: string, payload: unknown) => ({ v: 1, id: "x", type, payload }) as unknown as ServerMessage;
const STATE = { available: true, enabled: true, elevated: false, holding: { left: false, alt: false } };

beforeEach(() => {
  usePad.setState({ ...initialPad });
  mockMem.clear();
  mockFail = false;
  setAppsBridge(null);
});

describe("applyPad", () => {
  it("pad.state reemplaza el estado", () => {
    applyPad(msg("pad.state", STATE));
    expect(usePad.getState().state).toEqual(STATE);
    applyPad(msg("pad.state", { ...STATE, elevated: true }));
    expect(usePad.getState().state?.elevated).toBe(true);
  });
  it("null (olvidó la PC) borra el estado, la latencia y lo enganchado", () => {
    applyPad(msg("pad.state", STATE));
    usePad.getState().addLatency(40);
    usePad.getState().setLock(true);
    applyPad(null);
    const s = usePad.getState();
    expect(s.state).toBeNull();
    expect(s.rtt).toBeNull();
    expect(s.lock).toBe(false);
  });
  it("otros mensajes no tocan nada", () => {
    applyPad(msg("audio.update", {}));
    expect(usePad.getState().state).toBeNull();
  });
  it("la latencia: mediana y 'lento'", () => {
    const s = usePad.getState();
    for (const v of [100, 100, 100]) s.addLatency(v);
    expect(usePad.getState().rtt).toBe(100);
    expect(usePad.getState().slow).toBe(true);
    usePad.getState().addLatency(10);
    expect(usePad.getState().slow).toBe(false);
    usePad.getState().resetLatency();
    expect(usePad.getState().rtt).toBeNull();
  });
  it("sin conexión se corta lo que quedó enganchado (modificadores, candado, Alt+Tab)", () => {
    usePad.getState().setAltTab(true);
    usePad.getState().setLock(true);
    usePad.getState().clearTransient();
    expect(usePad.getState().altTab).toBe(false);
    expect(usePad.getState().lock).toBe(false);
  });
});

describe("acciones", () => {
  const calls: Array<[string, unknown]> = [];
  const bridge = (result: { ok: true } | { ok: false; reason: string }) =>
    setAppsBridge({
      command: (async (type: string, payload: unknown) => {
        calls.push([type, payload]);
        return result;
      }) as never,
      query: () => null,
    });
  beforeEach(() => (calls.length = 0));

  it("cada acción manda su comando", async () => {
    bridge({ ok: true });
    expect(await padActions.key("l", ["ctrl"])).toEqual({ ok: true });
    await padActions.shortcut("closeTab");
    await padActions.type(2, "ñ");
    await padActions.altTab("start");
    await padActions.release();
    await padActions.button("right", "click");
    expect(calls).toEqual([
      ["pad.key", { key: "l", mods: ["ctrl"] }],
      ["pad.shortcut", { name: "closeTab" }],
      ["pad.type", { backspaces: 2, text: "ñ" }],
      ["pad.altTab", { step: "start" }],
      ["pad.release", {}],
      ["pad.button", { button: "right", action: "click" }],
    ]);
  });

  it("un error de la PC vuelve con su clave de texto", async () => {
    bridge({ ok: false, reason: "input_blocked" });
    expect(await padActions.key("a", [])).toEqual({ ok: false, error: "pad.error.input_blocked" });
  });

  it("sin conexión: pad.error.offline", async () => {
    expect(await padActions.key("a", [])).toEqual({ ok: false, error: "pad.error.offline" });
  });
});

describe("atajos (boceto 04)", () => {
  it("cubren toda la lista cerrada del protocolo, una sola vez cada uno, más Alt+Tab", () => {
    const names = shortcutNames();
    expect([...names].filter((n) => n !== "altTab").sort()).toEqual([...SHORTCUTS].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("altTab");
  });
  it("cinco grupos: los cuatro del boceto y el reproductor genérico (D101)", () => {
    expect(SHORTCUT_GROUPS.map((g) => g.id)).toEqual(["windows", "browser", "youtube", "player", "edit"]);
  });
  it("cada atajo trae su combinación para mostrar", () => {
    for (const g of SHORTCUT_GROUPS) for (const i of g.items) expect(i.combo.length).toBeGreaterThan(0);
  });
});

describe("ajustes del pad guardados en el celu", () => {
  it("sin nada guardado: los de fábrica", async () => {
    expect(await loadPadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("recuerda lo que se guardó", async () => {
    const s = { sensitivity: 2.2, scrollSpeed: 1.5, naturalScroll: false, vibrateClick: true, keepAwake: false };
    await savePadSettings(s);
    expect(await loadPadSettings()).toEqual(s);
  });
  it("un valor roto o fuera de rango vuelve a lo de fábrica o se recorta", async () => {
    mockMem.set("ui.pad.v1", "no es json");
    expect(await loadPadSettings()).toEqual(DEFAULT_SETTINGS);
    mockMem.set("ui.pad.v1", JSON.stringify({ sensitivity: 99, scrollSpeed: -4, naturalScroll: "si", vibrateClick: 1, keepAwake: null }));
    const s = await loadPadSettings();
    expect(s.sensitivity).toBeLessThanOrEqual(3.4);
    expect(s.scrollSpeed).toBeGreaterThanOrEqual(0.4);
    expect(s.naturalScroll).toBe(DEFAULT_SETTINGS.naturalScroll);
    expect(s.vibrateClick).toBe(DEFAULT_SETTINGS.vibrateClick);
    expect(s.keepAwake).toBe(DEFAULT_SETTINGS.keepAwake);
  });
  it("si el almacenamiento falla no se rompe nada", async () => {
    mockFail = true;
    expect(await loadPadSettings()).toEqual(DEFAULT_SETTINGS);
    await expect(savePadSettings(DEFAULT_SETTINGS)).resolves.toBeUndefined();
  });
});
