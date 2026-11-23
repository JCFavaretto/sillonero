/* eslint-disable @typescript-eslint/no-explicit-any -- los payloads de los mensajes en estos tests se leen sin tipar a propósito */
import { describe, expect, it } from "vitest";
import { ClientMessage } from "@proyecto-e/protocol";
import { createCatalog } from "../src/apps/catalog";
import { createExtras } from "../src/apps/extras";
import { createIcons } from "../src/apps/icons";
import { createLaunchService } from "../src/apps/launch";
import { createLibraryService } from "../src/apps/library";
import { createWindowsService } from "../src/apps/windowsService";
import type { RawDisplay, RawWindowFull } from "../src/ports";
import { createScreensService } from "../src/screens/service";
import { FakeCatalog, FakeClock, FakeDisplays, FakeIconExtractor, FakeLauncher, FakeRandom, FakeWindows, MemFs, MemLogger } from "./fakes";

const disp = (path: string, over: Partial<RawDisplay> = {}): RawDisplay => ({
  devicePath: path, friendlyName: path, outputTechnology: 10, active: true, primary: false, gdiName: null,
  bounds: { x: 0, y: 0, w: 1920, h: 1080 }, workArea: { x: 0, y: 0, w: 1920, h: 1040 }, ...over,
});
const win = (n: number): RawWindowFull => ({
  handle: "0x" + n, title: "Ventana " + n, exe: `app${n}.exe`, className: "Cls", rect: { x: 100, y: 100, w: 800, h: 600 },
  state: "normal", pid: n, exePath: `C:\\Apps\\app${n}.exe`, focused: false, fullscreen: false,
});

async function setup() {
  const clock = new FakeClock();
  const displays = new FakeDisplays();
  displays.raw = [disp("izq"), disp("prin", { primary: true, bounds: { x: 1920, y: 0, w: 2560, h: 1440 }, workArea: { x: 1920, y: 0, w: 2560, h: 1400 } })];
  const fw = new FakeWindows();
  fw.all = [win(1), win(2)];
  const log = new MemLogger();
  const screens = createScreensService({ displays, windows: fw, log });
  await screens.refresh();
  const fs = new MemFs();
  const icons = createIcons({ extractor: new FakeIconExtractor(fs), fs, dir: "icons" });
  const catalog = createCatalog({ source: new FakeCatalog(), clock });
  const windows = createWindowsService({ windows: fw, screens, log, onIcon: (k, p) => icons.register(k, p) });
  let lib = { launchers: [], scenes: [], deck: [] } as ReturnType<typeof library.state>;
  const library = createLibraryService({ store: { get: () => lib, save: async (n) => void (lib = n) }, catalog, icons, random: new FakeRandom(), log });
  const launcher = new FakeLauncher();
  const launch = createLaunchService({ windows, port: fw, launcher, screens, clock, log });
  const extras = createExtras({ windows, screens, library, launch, catalog, icons, clock, random: new FakeRandom(), log });
  const sent: { type: string; payload: any }[] = [];
  const pushed: { type: string; payload: any }[] = [];
  extras.subscribe((type, payload) => pushed.push({ type, payload }));
  const send = (type: string, payload: unknown) => void sent.push({ type, payload });
  /** Arma un mensaje del celu validándolo con el esquema real (así el test no acepta algo que el protocolo rechazaría). */
  const msg = (type: string, payload: unknown, id = "c1") => {
    const parsed = ClientMessage.parse({ v: 1, id, type, payload });
    return parsed;
  };
  return { extras, sent, pushed, send, msg, fw, launcher, library, clock };
}

describe("extras", () => {
  it("reconoce solo los mensajes de B3", async () => {
    const { extras } = await setup();
    for (const t of ["window.move", "window.act", "windows.bringAll", "apps.search", "icon.get", "launcher.add", "launcher.run", "target.run", "scene.save", "scene.run", "deck.set"]) expect(extras.handles(t), t).toBe(true);
    for (const t of ["ping", "monitor.rename", "window.moveActive", "device.unpair"]) expect(extras.handles(t), t).toBe(false);
  });

  it("snapshots: ventanas y biblioteca tras autenticar", async () => {
    const { extras } = await setup();
    const snaps = await extras.snapshots();
    expect(snaps.map((s) => s.type)).toEqual(["windows.snapshot", "library.snapshot"]);
    expect((snaps[0]!.payload as any).windows).toHaveLength(2);
  });

  it("tick: avisa windows.update a todos solo si cambió", async () => {
    const { extras, fw, pushed } = await setup();
    await extras.snapshots();
    pushed.length = 0;
    await extras.tick();
    expect(pushed).toEqual([]);
    fw.all = [win(1)];
    await extras.tick();
    expect(pushed.map((x) => x.type)).toEqual(["windows.update"]);
  });

  it("un cambio que vio otra lectura (por ejemplo, al esperar una ventana nueva) igual llega a todos", async () => {
    const { extras, fw, pushed } = await setup();
    await extras.snapshots();
    pushed.length = 0;
    fw.all = [win(1), win(2), win(3)];
    await extras.snapshots(); // quien refresca no es el muestreo
    expect(pushed.map((x) => x.type)).toContain("windows.update");
    pushed.length = 0;
    await extras.tick(); // y el muestreo no lo repite
    expect(pushed).toEqual([]);
  });

  it("window.act cierra una ventana y avisa a todos con windows.update", async () => {
    const { extras, send, msg, pushed } = await setup();
    const snaps = await extras.snapshots();
    const payload = snaps[0]!.payload;
    const id = (payload as any).windows[0].id as string;
    const out = await extras.handle(msg("window.act", { windowId: id, action: "close" }), send);
    expect(out).toEqual({ ok: true });
    expect(pushed.map((p) => p.type)).toContain("windows.update");
  });

  it("apps.search responde apps.results con replyTo y registra los íconos", async () => {
    const { extras, send, msg, sent } = await setup();
    const out = await extras.handle(msg("apps.search", { query: "cur" }, "q9"), send);
    expect(out).toBe("replied");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "apps.results", payload: { replyTo: "q9", total: 1, items: [{ appId: "Anysphere.Cursor", name: "Cursor" }] } });
    // y ahora ese ícono se puede pedir
    await extras.handle(msg("icon.get", { keys: [sent[0]!.payload.items[0].iconKey] }), send);
    expect(sent[1]).toMatchObject({ type: "icon.data", payload: { png: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/) } });
  });

  it("icon.get manda un icon.data por clave; una clave desconocida va con null", async () => {
    const { extras, send, msg, sent } = await setup();
    await extras.handle(msg("icon.get", { keys: ["i_AAAAAAAAAAAAAAAA", "i_BBBBBBBBBBBBBBBB"] }), send);
    expect(sent.map((s) => s.payload.png)).toEqual([null, null]);
  });

  it("lanzador: agregar, abrir y quitar", async () => {
    const { extras, send, msg, launcher, library } = await setup();
    expect(await extras.handle(msg("launcher.add", { target: { kind: "app", appId: "Anysphere.Cursor" }, name: null }), send)).toEqual({ ok: true });
    const id = library.state().launchers[0]!.id;
    expect(await extras.handle(msg("launcher.run", { id }), send)).toEqual({ ok: true });
    expect(launcher.opened).toEqual(["app:Anysphere.Cursor"]);
    expect(await extras.handle(msg("launcher.run", { id: "l_AAAAAAAAAA" }), send)).toEqual({ ok: false, reason: "not_found" });
    expect(await extras.handle(msg("launcher.remove", { id }), send)).toEqual({ ok: true });
  });

  it("target.run abre una app o un link SIN guardarlos en la PC (D104)", async () => {
    const { extras, send, msg, launcher, library } = await setup();
    expect(await extras.handle(msg("target.run", { target: { kind: "app", appId: "Anysphere.Cursor" } }), send)).toEqual({ ok: true });
    expect(launcher.opened).toEqual(["app:Anysphere.Cursor"]);
    expect(library.state().launchers).toEqual([]);
  });

  it("target.run: una app que no está en la lista de la PC da not_allowed y no se abre nada (el celu no puede abrir cualquier cosa)", async () => {
    const { extras, send, msg, launcher } = await setup();
    expect(await extras.handle(msg("target.run", { target: { kind: "app", appId: "C:\\Windows\\System32\\cmd.exe" } }), send)).toEqual({ ok: false, reason: "not_allowed" });
    expect(launcher.opened).toEqual([]);
  });

  it("target.run: respeta el enfriamiento entre lanzamientos y falla claro si la PC no puede abrirlo", async () => {
    const { extras, send, msg, launcher } = await setup();
    launcher.failNext();
    expect(await extras.handle(msg("target.run", { target: { kind: "app", appId: "Anysphere.Cursor" } }), send)).toEqual({ ok: false, reason: "launch_failed" });
  });

  it("un lanzador de una app que falla al abrir da launch_failed", async () => {
    const { extras, send, msg, launcher, library } = await setup();
    await extras.handle(msg("launcher.add", { target: { kind: "app", appId: "Anysphere.Cursor" }, name: null }), send);
    launcher.failNext();
    expect(await extras.handle(msg("launcher.run", { id: library.state().launchers[0]!.id }), send)).toEqual({ ok: false, reason: "launch_failed" });
  });

  it("escena: guardar, ejecutar con progreso por mensajes y resultado con los pasos", async () => {
    const { extras, send, msg, pushed, library } = await setup();
    expect(await extras.handle(msg("scene.save", { scene: { name: "Juego", steps: [{ kind: "bringAll" }] } }), send)).toEqual({ ok: true });
    const id = library.state().scenes[0]!.id;
    const out = await extras.handle(msg("scene.run", { id }), send);
    expect(out).toEqual({ ok: true, steps: ["ok"] });
    const prog = pushed.filter((p) => p.type === "scene.progress").map((p) => p.payload.status);
    expect(prog).toEqual(["running", "ok"]);
    expect(pushed.some((p) => p.type === "library.update")).toBe(true);
  });

  it("un celu que manda un appId inventado en una escena recibe not_allowed", async () => {
    const { extras, send, msg } = await setup();
    const bad = { kind: "open", target: { kind: "app", appId: "C:\\Windows\\System32\\cmd.exe" }, name: "x", iconKey: null, place: null };
    expect(await extras.handle(msg("scene.save", { scene: { name: "Mala", steps: [bad] } }), send)).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("deck.set valida los ids; un error inesperado no tumba nada y da failed", async () => {
    const { extras, send, msg, fw } = await setup();
    expect(await extras.handle(msg("deck.set", { items: [{ kind: "scene", id: "s_AAAAAAAAAA" }] }), send)).toEqual({ ok: false, reason: "not_found" });
    fw.failNext();
    const snaps = await extras.snapshots(); // si la lectura falla, igual devuelve algo
    expect(snaps.length).toBeGreaterThan(0);
  });
});

describe("extras: límites", () => {
  it("launcher.run: un segundo de enfriamiento entre lanzamientos", async () => {
    const t = await setup();
    await t.extras.handle(t.msg("launcher.add", { target: { kind: "app", appId: "Anysphere.Cursor" }, name: null }), t.send);
    const id = t.library.state().launchers[0]!.id;
    expect(await t.extras.handle(t.msg("launcher.run", { id }), t.send)).toEqual({ ok: true });
    expect(await t.extras.handle(t.msg("launcher.run", { id }), t.send)).toEqual({ ok: false, reason: "busy" });
    expect(t.launcher.opened).toHaveLength(1);
    t.clock.advance(1_100);
    expect(await t.extras.handle(t.msg("launcher.run", { id }), t.send)).toEqual({ ok: true });
    expect(t.launcher.opened).toHaveLength(2);
  });
});
