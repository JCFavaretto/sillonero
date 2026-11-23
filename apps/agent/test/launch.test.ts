import { describe, expect, it } from "vitest";
import { createLaunchService } from "../src/apps/launch";
import { createWindowsService } from "../src/apps/windowsService";
import type { RawDisplay, RawWindowFull } from "../src/ports";
import { monitorId } from "../src/screens/model";
import { createScreensService } from "../src/screens/service";
import { FakeClock, FakeDisplays, FakeLauncher, FakeWindows, MemLogger } from "./fakes";

const disp = (path: string, over: Partial<RawDisplay> = {}): RawDisplay => ({
  devicePath: path, friendlyName: path, outputTechnology: 10, active: true, primary: false, gdiName: null,
  bounds: { x: 0, y: 0, w: 1920, h: 1080 }, workArea: { x: 0, y: 0, w: 1920, h: 1040 }, ...over,
});
const win = (handle: string, exePath: string, over: Partial<RawWindowFull> = {}): RawWindowFull => ({
  handle, title: "Ventana " + handle, exe: exePath.slice(exePath.lastIndexOf("\\") + 1), className: "Cls",
  rect: { x: 100, y: 100, w: 800, h: 600 }, state: "normal", pid: 1, exePath, focused: false, fullscreen: false, ...over,
});
const DISCORD = "C:\\Users\\Jay\\AppData\\Local\\Discord\\Discord.exe";
const IZQ = monitorId("izq");
const PRIN = monitorId("prin");

async function setup(initial: RawWindowFull[] = []) {
  const clock = new FakeClock();
  const displays = new FakeDisplays();
  displays.raw = [disp("izq"), disp("prin", { primary: true, bounds: { x: 1920, y: 0, w: 2560, h: 1440 }, workArea: { x: 1920, y: 0, w: 2560, h: 1400 } })];
  const fw = new FakeWindows();
  fw.all = initial;
  const log = new MemLogger();
  const screens = createScreensService({ displays, windows: fw, log });
  await screens.refresh();
  const windows = createWindowsService({ windows: fw, screens, log });
  const launcher = new FakeLauncher();
  const launch = createLaunchService({ windows, port: fw, launcher, screens, clock, log });
  return { clock, fw, launcher, launch, screens };
}

/** Avanza el reloj de a poco hasta que la promesa se cumple (los esperas de la escena usan timers). */
async function drive<T>(p: Promise<T>, clock: FakeClock, step = 200, max = 80): Promise<T> {
  let done = false;
  const tracked = p.finally(() => (done = true));
  for (let i = 0; i < max && !done; i++) {
    for (let j = 0; j < 6; j++) await Promise.resolve();
    clock.advance(step);
    for (let j = 0; j < 6; j++) await Promise.resolve();
  }
  return tracked;
}

describe("launch: apps", () => {
  it("si ya está abierta (misma ruta de .exe), la trae al frente en vez de abrir otra", async () => {
    const { launch, launcher, fw, clock } = await setup([win("0x1", DISCORD)]);
    const out = await drive(launch.runTarget({ kind: "app", appId: DISCORD }, null), clock);
    expect(out).toEqual({ status: "ok" });
    expect(fw.calls).toEqual(["focus 0x1"]);
    expect(launcher.opened).toEqual([]);
  });
  it("ya abierta con zona pedida: la enfoca y la ubica", async () => {
    const { launch, fw, clock } = await setup([win("0x1", DISCORD)]);
    const out = await drive(launch.runTarget({ kind: "app", appId: DISCORD }, { monitorId: PRIN, zone: "right" }), clock);
    expect(out).toEqual({ status: "ok" });
    expect(fw.placed).toEqual([{ handle: "0x1", rect: { x: 3200, y: 0, w: 1280, h: 1400 }, maximize: false }]);
  });
  it("sin zona no espera: abre y listo", async () => {
    const { launch, launcher, clock } = await setup();
    const out = await drive(launch.runTarget({ kind: "app", appId: "Anysphere.Cursor" }, null), clock);
    expect(out).toEqual({ status: "ok" });
    expect(launcher.opened).toEqual(["app:Anysphere.Cursor"]);
  });
  it("abre y, cuando aparece la ventana nueva, la ubica en la zona", async () => {
    const { launch, launcher, fw, clock } = await setup([win("0x9", "C:\\otra.exe")]);
    launcher.onOpen = () => void clock.setTimeout(() => void fw.all.push(win("0x2", DISCORD)), 1200);
    const out = await drive(launch.runTarget({ kind: "app", appId: DISCORD }, { monitorId: IZQ, zone: "left" }), clock);
    // Discord ya no estaba abierta antes de lanzar: se abrió y se ubicó la nueva
    expect(launcher.opened).toEqual([`app:${DISCORD}`]);
    expect(out).toEqual({ status: "ok" });
    expect(fw.placed.map((p) => p.handle)).toEqual(["0x2"]);
    expect(fw.placed[0]!.rect).toEqual({ x: 0, y: 0, w: 960, h: 1040 });
  });
  it("una ventana nueva de otra app no se confunde con la que se abrió", async () => {
    const { launch, launcher, fw, clock } = await setup();
    launcher.onOpen = () => void clock.setTimeout(() => void fw.all.push(win("0x5", "C:\\Otra\\otra.exe")), 400);
    const out = await drive(launch.runTarget({ kind: "app", appId: DISCORD }, { monitorId: IZQ, zone: "left" }), clock);
    expect(out).toEqual({ status: "partial", reason: "not_placed" });
    expect(fw.placed).toEqual([]);
  });
  it("si la ventana nunca aparece: abierta pero sin ubicar (partial) a los 8 s", async () => {
    const { launch, clock } = await setup();
    const out = await drive(launch.runTarget({ kind: "app", appId: "Anysphere.Cursor" }, { monitorId: IZQ, zone: "full" }), clock);
    expect(out).toEqual({ status: "partial", reason: "not_placed" });
  });
  it("apps sin ruta conocida (AUMID): sirve cualquier ventana nueva", async () => {
    const { launch, launcher, fw, clock } = await setup();
    launcher.onOpen = () => void clock.setTimeout(() => void fw.all.push(win("0x7", "C:\\Windows\\System32\\ApplicationFrameHost.exe")), 600);
    const out = await drive(launch.runTarget({ kind: "app", appId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" }, { monitorId: PRIN, zone: "tl" }), clock);
    expect(out).toEqual({ status: "ok" });
    expect(fw.placed[0]!.rect).toEqual({ x: 1920, y: 0, w: 1280, h: 700 });
  });
  it("si no se pudo lanzar: launch_failed", async () => {
    const { launch, launcher, clock } = await setup();
    launcher.failNext();
    expect(await drive(launch.runTarget({ kind: "app", appId: "x" }, null), clock)).toEqual({ status: "failed", reason: "launch_failed" });
  });
  it("zona keep no mueve nada; fullscreen usa el monitor entero", async () => {
    const { launch, fw, clock } = await setup([win("0x1", DISCORD)]);
    await drive(launch.runTarget({ kind: "app", appId: DISCORD }, { monitorId: PRIN, zone: "keep" }), clock);
    expect(fw.placed).toEqual([]);
    await drive(launch.runTarget({ kind: "app", appId: DISCORD }, { monitorId: PRIN, zone: "fullscreen" }), clock);
    expect(fw.calls).toContain("fullscreen 0x1");
    expect(fw.all[0]!.rect).toEqual({ x: 1920, y: 0, w: 2560, h: 1440 });
  });
  it("pantalla apagada o desconectada: queda abierta, sin ubicar", async () => {
    const { launch, clock } = await setup([win("0x1", DISCORD)]);
    expect(await drive(launch.runTarget({ kind: "app", appId: DISCORD }, { monitorId: "m_XXXXXXXXXXXXXXXX", zone: "left" }), clock)).toEqual({ status: "partial", reason: "not_placed" });
  });
});

describe("launch: ventana que estaba en pantalla completa", () => {
  it("al ubicarla en otra zona, primero sale de la pantalla completa", async () => {
    const { launch, fw, clock } = await setup([win("0x1", DISCORD, { fullscreen: true })]);
    await drive(launch.runTarget({ kind: "app", appId: DISCORD }, { monitorId: IZQ, zone: "left" }), clock);
    expect(fw.calls).toEqual(["focus 0x1", "fullscreen 0x1"]); // el toggle deshace la pantalla completa
    expect(fw.placed.map((p) => p.handle)).toEqual(["0x1"]);
  });
});

describe("launch: links", () => {
  const URL = "https://www.youtube.com/watch?v=1&t=2";
  it("abre el link y ubica la ventana nueva del navegador", async () => {
    const { launch, launcher, fw, clock } = await setup();
    launcher.onOpen = () => void clock.setTimeout(() => void fw.all.push(win("0x3", "C:\\Chrome\\chrome.exe")), 800);
    const out = await drive(launch.runTarget({ kind: "url", url: URL }, { monitorId: PRIN, zone: "fullscreen" }), clock);
    expect(launcher.opened).toEqual([`url:${URL}`]);
    expect(out).toEqual({ status: "ok" });
    expect(fw.calls).toContain("fullscreen 0x3");
  });
  it("el link se abre como lo pide: pestaña (por defecto), ventana nueva o incógnito (D93)", async () => {
    const { launch, launcher, clock } = await setup();
    expect(await drive(launch.runTarget({ kind: "url", url: URL, open: "private" }, null), clock)).toEqual({ status: "ok" });
    await drive(launch.runTarget({ kind: "url", url: URL, open: "window" }, null), clock);
    await drive(launch.runTarget({ kind: "url", url: URL, open: "tab" }, null), clock);
    await drive(launch.runTarget({ kind: "url", url: URL }, null), clock);
    expect(launcher.opened).toEqual([`private-url:${URL}`, `window-url:${URL}`, `url:${URL}`, `url:${URL}`]);
  });
  it("si no se puede abrir en privado, falla y no abre una ventana común", async () => {
    const { launch, launcher, clock } = await setup();
    launcher.failNext(new Error("not_supported: no sé abrir una ventana privada"));
    expect(await drive(launch.runTarget({ kind: "url", url: URL, open: "private" }, null), clock)).toEqual({ status: "failed", reason: "launch_failed" });
    expect(launcher.opened).toEqual([]);
  });
  it("si abrió como pestaña de una ventana que ya estaba, ubica la ventana activa del navegador", async () => {
    const chrome = win("0x4", "C:\\Chrome\\chrome.exe", { focused: true });
    const { launch, fw, clock } = await setup([chrome]);
    fw.win = { handle: "0x4", title: "t", exe: "chrome.exe", className: "Cls", rect: chrome.rect, state: "normal" };
    const out = await drive(launch.runTarget({ kind: "url", url: URL }, { monitorId: PRIN, zone: "right" }), clock);
    expect(out).toEqual({ status: "ok" });
    expect(fw.placed.map((p) => p.handle)).toEqual(["0x4"]);
  });
  it("si la ventana activa no es un navegador, no la toca", async () => {
    const other = win("0x6", "C:\\Notepad\\notepad.exe", { focused: true });
    const { launch, fw, clock } = await setup([other]);
    fw.win = { handle: "0x6", title: "t", exe: "notepad.exe", className: "Cls", rect: other.rect, state: "normal" };
    const out = await drive(launch.runTarget({ kind: "url", url: URL }, { monitorId: PRIN, zone: "right" }), clock);
    expect(out).toEqual({ status: "partial", reason: "not_placed" });
    expect(fw.placed).toEqual([]);
  });
});
