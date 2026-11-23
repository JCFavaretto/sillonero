import { describe, expect, it } from "vitest";
import { createWindowsService } from "../src/apps/windowsService";
import type { RawDisplay, RawWindowFull } from "../src/ports";
import { monitorId } from "../src/screens/model";
import { createScreensService } from "../src/screens/service";
import { FakeDisplays, FakeLauncher, FakeWindows, MemLogger } from "./fakes";

const disp = (path: string, over: Partial<RawDisplay> = {}): RawDisplay => ({
  devicePath: path, friendlyName: path, outputTechnology: 10, active: true, primary: false, gdiName: null,
  bounds: { x: 0, y: 0, w: 1920, h: 1080 }, workArea: { x: 0, y: 0, w: 1920, h: 1040 }, ...over,
});
const win = (n: number, over: Partial<RawWindowFull> = {}): RawWindowFull => ({
  handle: "0x" + n, title: "Ventana " + n, exe: `app${n}.exe`, className: "Cls", rect: { x: 100, y: 100, w: 800, h: 600 },
  state: "normal", pid: n, exePath: `C:\\Apps\\app${n}.exe`, focused: false, fullscreen: false, ...over,
});
const IZQ = monitorId("izq");
const PRIN = monitorId("prin");

async function setup(windows: RawWindowFull[] = [win(1), win(2, { rect: { x: 2000, y: 100, w: 800, h: 600 } })]) {
  const displays = new FakeDisplays();
  displays.raw = [disp("izq"), disp("prin", { primary: true, bounds: { x: 1920, y: 0, w: 2560, h: 1440 }, workArea: { x: 1920, y: 0, w: 2560, h: 1400 } })];
  const fw = new FakeWindows();
  fw.all = windows;
  const log = new MemLogger();
  const screens = createScreensService({ displays, windows: fw, log });
  await screens.refresh();
  const icons: [string, string][] = [];
  const service = createWindowsService({ windows: fw, screens, log, onIcon: (k, p) => icons.push([k, p]) });
  return { fw, screens, service, icons, displays };
}
const idOf = (s: Awaited<ReturnType<typeof setup>>["service"], title: string) => s.current()!.windows.find((w) => w.title === title)!.id;

describe("windowsService: lectura", () => {
  it("arma el estado y registra el ícono de cada .exe", async () => {
    const { service, icons } = await setup();
    const r = await service.refresh();
    expect(r.changed).toBe(true);
    expect(r.state!.windows.map((w) => w.title)).toEqual(["Ventana 1", "Ventana 2"]);
    expect(icons.map(([, p]) => p)).toEqual(["C:\\Apps\\app1.exe", "C:\\Apps\\app2.exe"]);
  });
  it("solo avisa si cambió", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    expect((await service.refresh()).changed).toBe(false);
    fw.all = [win(1)];
    expect((await service.refresh()).changed).toBe(true);
  });
  it("si Windows falla, conserva lo último y no rechaza", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    fw.failNext();
    const r = await service.refresh();
    expect(r.changed).toBe(false);
    expect(r.state).not.toBeNull();
  });
});

describe("windowsService: window.move", () => {
  it("manda una ventana a otra pantalla (reusa la lógica de moverla de B2)", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    const out = await service.move(idOf(service, "Ventana 1"), PRIN);
    expect(out).toEqual({ ok: true });
    expect(fw.placed).toHaveLength(1);
    expect(fw.placed[0]!.handle).toBe("0x1");
    expect(fw.placed[0]!.rect.x).toBeGreaterThanOrEqual(1920);
  });
  it("misma pantalla: no hace nada", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    expect(await service.move(idOf(service, "Ventana 1"), IZQ)).toEqual({ ok: true });
    expect(fw.placed).toHaveLength(0);
  });
  it("id viejo o pantalla desconocida → not_found", async () => {
    const { service } = await setup();
    await service.refresh();
    expect(await service.move("w_999", PRIN)).toEqual({ ok: false, reason: "not_found" });
    expect(await service.move(idOf(service, "Ventana 1"), "m_XXXXXXXXXXXXXXXX")).toEqual({ ok: false, reason: "not_found" });
  });
  it("ventana de administrador → elevated", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    fw.failPlaceNext(new Error("elevated: acceso denegado"));
    expect(await service.move(idOf(service, "Ventana 1"), PRIN)).toEqual({ ok: false, reason: "elevated" });
  });
});

describe("windowsService: window.act", () => {
  it("focus, minimize, maximize, restore y close llaman a Windows con el handle real", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    const id = idOf(service, "Ventana 1");
    for (const a of ["focus", "minimize", "maximize", "restore", "close"] as const) expect(await service.act(id, a)).toEqual({ ok: true });
    expect(fw.calls).toEqual(["focus 0x1", "show 0x1 minimize", "show 0x1 maximize", "show 0x1 restore", "close 0x1"]);
  });
  it("después de cerrar, la ventana desaparece de la lista", async () => {
    const { service } = await setup();
    await service.refresh();
    await service.act(idOf(service, "Ventana 1"), "close");
    expect(service.current()!.windows.map((w) => w.title)).toEqual(["Ventana 2"]);
  });
  it("fullscreen usa todo el monitor donde está la ventana", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    expect(await service.act(idOf(service, "Ventana 2"), "fullscreen")).toEqual({ ok: true });
    expect(fw.calls).toEqual(["fullscreen 0x2"]);
    expect(fw.all.find((w) => w.handle === "0x2")!.rect).toEqual({ x: 1920, y: 0, w: 2560, h: 1440 });
  });
  it("Windows no deja traerla al frente → focus_denied", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    fw.failActionNext(new Error("focus_denied: Windows no dejó"));
    expect(await service.act(idOf(service, "Ventana 1"), "focus")).toEqual({ ok: false, reason: "focus_denied" });
  });
  it("otro error → failed; ventana de administrador → elevated; id viejo → not_found", async () => {
    const { service, fw } = await setup();
    await service.refresh();
    const id = idOf(service, "Ventana 1");
    fw.failActionNext(new Error("boom"));
    expect(await service.act(id, "minimize")).toEqual({ ok: false, reason: "failed" });
    fw.failActionNext(new Error("Access is denied"));
    expect(await service.act(id, "close")).toEqual({ ok: false, reason: "elevated" });
    expect(await service.act("w_777", "focus")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("windowsService: traer todo", () => {
  it("junta en la principal solo las ventanas de otras pantallas", async () => {
    const { service, fw } = await setup([win(1), win(2, { rect: { x: 2000, y: 100, w: 800, h: 600 } }), win(3, { state: "minimized", rect: { x: -32000, y: -32000, w: 160, h: 28 } })]);
    await service.refresh();
    expect(await service.bringAll()).toEqual({ ok: true });
    expect(fw.placed.map((p) => p.handle)).toEqual(["0x1"]); // la 2 ya está en la principal; la minimizada no se toca
    expect(fw.placed[0]!.rect.x).toBeGreaterThanOrEqual(1920);
  });
  it("se avisa a los que escuchan después de una acción", async () => {
    const { service } = await setup();
    await service.refresh();
    const seen: number[] = [];
    service.subscribe((s) => seen.push(s.windows.length));
    await service.act(idOf(service, "Ventana 1"), "close");
    expect(seen).toEqual([1]);
  });
});

describe("windowsService: ventana privada del navegador (D93)", () => {
  async function withLauncher(exePath: string) {
    const displays = new FakeDisplays();
    displays.raw = [disp("prin", { primary: true })];
    const fw = new FakeWindows();
    fw.all = [win(1, { exePath, exe: exePath.slice(exePath.lastIndexOf("\\") + 1) })];
    const log = new MemLogger();
    const screens = createScreensService({ displays, windows: fw, log });
    await screens.refresh();
    const launcher = new FakeLauncher();
    const service = createWindowsService({ windows: fw, screens, log, launcher });
    await service.refresh();
    return { service, launcher };
  }

  it("abre una ventana privada con el .exe de esa ventana", async () => {
    const exe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const { service, launcher } = await withLauncher(exe);
    expect(await service.act(idOf(service, "Ventana 1"), "newPrivate")).toEqual({ ok: true });
    expect(launcher.opened).toEqual([`private-window:${exe}`]);
  });

  it("newWindow abre una ventana común y nueva del mismo navegador", async () => {
    const exe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const { service, launcher } = await withLauncher(exe);
    expect(await service.act(idOf(service, "Ventana 1"), "newWindow")).toEqual({ ok: true });
    expect(launcher.opened).toEqual([`window-window:${exe}`]);
  });

  it("si la ventana no es de un navegador, contesta not_supported y no abre nada", async () => {
    const { service, launcher } = await withLauncher("C:\\Windows\\System32\\notepad.exe");
    expect(await service.act(idOf(service, "Ventana 1"), "newPrivate")).toEqual({ ok: false, reason: "not_supported" });
    expect(launcher.opened).toEqual([]);
  });

  it("sin lanzador en esta PC, not_supported", async () => {
    const { service } = await setup();
    await service.refresh();
    expect(await service.act(idOf(service, "Ventana 1"), "newPrivate")).toEqual({ ok: false, reason: "not_supported" });
  });
});
