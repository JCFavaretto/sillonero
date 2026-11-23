import { describe, expect, it } from "vitest";
import { createCommands } from "../src/commands";
import type { RawDisplay, RawWindow, RawWindowFull } from "../src/ports";
import { monitorId } from "../src/screens/model";
import { createScreensService } from "../src/screens/service";
import { FakeDisplays, FakeWindows, MemLogger } from "./fakes";

const disp = (path: string, over: Partial<RawDisplay> = {}): RawDisplay => ({
  devicePath: path,
  friendlyName: path,
  outputTechnology: 10,
  active: true,
  primary: false,
  gdiName: null,
  bounds: { x: 0, y: 0, w: 1920, h: 1080 },
  workArea: null,
  ...over,
});
const WIN: RawWindow = {
  handle: "0x1",
  title: "Video",
  exe: "chrome.exe",
  className: "Chrome_WidgetWin_1",
  rect: { x: 2100, y: 100, w: 800, h: 600 },
  state: "normal",
};

function setup(opts: { tv?: string | null; pad?: boolean; scenes?: boolean } = {}) {
  const displays = new FakeDisplays();
  const windows = new FakeWindows();
  const log = new MemLogger();
  displays.raw = [
    disp("izq"),
    disp("prin", { primary: true, bounds: { x: 1920, y: 0, w: 2560, h: 1440 } }),
    disp("tele", { active: false, bounds: null, outputTechnology: 5 }),
  ];
  windows.win = WIN;
  windows.all = [{ ...WIN, pid: 1, exePath: "C:\\chrome.exe", focused: true, fullscreen: false } satisfies RawWindowFull];
  const screens = createScreensService({ displays, windows, log });
  const media: string[] = [];
  const scenesRun: string[] = [];
  const opened: string[] = [];
  const pad = { cut: 0 };
  const commands = createCommands({
    screens,
    windows,
    pad: opts.pad === false ? undefined : { async setEnabled(on) { if (!on) pad.cut++; } },
    media: async (key) => void media.push(key),
    openPanel: async () => void opened.push("panel"),
    runScene:
      opts.scenes === false
        ? undefined
        : async (id) => {
            scenesRun.push(id);
            return id === "s_noexiste00" ? { ok: false, reason: "not_found" } : { ok: true };
          },
    tvMonitorId: () => (opts.tv === undefined ? monitorId("tele") : opts.tv),
    log,
  });
  return { displays, windows, screens, commands, media, opened, pad, scenesRun };
}

describe("commands · escenas (B6.3)", () => {
  it("scene: corre la escena y devuelve su resultado", async () => {
    const { commands, scenesRun } = setup();
    expect(await commands.run({ kind: "scene", sceneId: "s_AAAAAAAAAA" })).toEqual({ ok: true });
    expect(scenesRun).toEqual(["s_AAAAAAAAAA"]);
    expect(await commands.run({ kind: "scene", sceneId: "s_noexiste00" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("scene: sin ejecutor de escenas, unsupported", async () => {
    expect(await setup({ scenes: false }).commands.run({ kind: "scene", sceneId: "s_AAAAAAAAAA" })).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("commands", () => {
  it("tv: prende la pantalla elegida si está apagada y la apaga si está prendida", async () => {
    const { commands, displays } = setup();
    expect(await commands.run({ kind: "tv" })).toEqual({ ok: true });
    expect(displays.sets).toEqual([expect.objectContaining({ devicePath: "tele", on: true })]);
    expect(await commands.run({ kind: "tv" })).toEqual({ ok: true });
    expect(displays.sets.at(-1)).toMatchObject({ devicePath: "tele", on: false });
  });

  it("tv: sin pantalla elegida, o una que ya no existe, responde not_found", async () => {
    expect(await setup({ tv: null }).commands.run({ kind: "tv" })).toEqual({ ok: false, reason: "not_found" });
    expect(await setup({ tv: "m_inexistente0000" }).commands.run({ kind: "tv" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("tv: no apaga la principal (el servicio de pantallas lo impide)", async () => {
    const { commands, displays } = setup({ tv: monitorId("prin") });
    expect(await commands.run({ kind: "tv" })).toEqual({ ok: false, reason: "primary" });
    expect(displays.sets).toEqual([]);
  });

  it("moveActive N: manda la ventana activa a la pantalla N de izquierda a derecha", async () => {
    const { commands, windows } = setup();
    expect(await commands.run({ kind: "moveActive", index: 1 })).toEqual({ ok: true });
    expect(windows.placed.at(-1)!.rect.x).toBeLessThan(1920); // cae en la pantalla "izq"
  });

  it("moveActive N: si no hay tantas pantallas prendidas, not_found", async () => {
    const { commands, windows } = setup();
    expect(await commands.run({ kind: "moveActive", index: 3 })).toEqual({ ok: false, reason: "not_found" });
    expect(windows.placed).toEqual([]);
  });

  it("fullscreen: pone la ventana al frente a pantalla completa en la pantalla donde está", async () => {
    const { commands, windows } = setup();
    expect(await commands.run({ kind: "fullscreen" })).toEqual({ ok: true });
    expect(windows.calls).toEqual(["fullscreen 0x1"]);
    expect(windows.all[0]!.rect).toEqual({ x: 1920, y: 0, w: 2560, h: 1440 }); // la principal: ahí está su centro
  });

  it("fullscreen: sin ventana al frente, no_window", async () => {
    const { commands, windows } = setup();
    windows.win = null;
    expect(await commands.run({ kind: "fullscreen" })).toEqual({ ok: false, reason: "no_window" });
  });

  it("fullscreen: una ventana de administrador responde elevated", async () => {
    const { commands, windows } = setup();
    windows.failActionNext(new Error("access is denied (elevated)"));
    expect(await commands.run({ kind: "fullscreen" })).toEqual({ ok: false, reason: "elevated" });
  });

  it("media: manda la tecla", async () => {
    const { commands, media } = setup();
    await commands.run({ kind: "media", key: "next" });
    expect(media).toEqual(["next"]);
  });

  it("panel: abre el panel", async () => {
    const { commands, opened } = setup();
    expect(await commands.run({ kind: "panel" })).toEqual({ ok: true });
    expect(opened).toEqual(["panel"]);
  });

  it("cutPad: apaga la llave del Pad", async () => {
    const { commands, pad } = setup();
    expect(await commands.run({ kind: "cutPad" })).toEqual({ ok: true });
    expect(pad.cut).toBe(1);
  });

  it("cutPad: sin Pad en esta PC, unsupported", async () => {
    expect(await setup({ pad: false }).commands.run({ kind: "cutPad" })).toEqual({ ok: false, reason: "unsupported" });
  });
});
