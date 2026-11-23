/* eslint-disable @typescript-eslint/no-explicit-any -- los payloads de los mensajes en estos tests se leen sin tipar a propósito */
import { describe, expect, it } from "vitest";
import { ClientMessage, type BrowserOp, type BrowserQuery, type BrowserState } from "@proyecto-e/protocol";
import { createCatalog } from "../src/apps/catalog";
import { createExtras } from "../src/apps/extras";
import { createIcons } from "../src/apps/icons";
import { createLaunchService } from "../src/apps/launch";
import { createLibraryService } from "../src/apps/library";
import { createWindowsService } from "../src/apps/windowsService";
import type { BrowserQueryOutcome, BrowserService } from "../src/browser/service";
import { createScreensService } from "../src/screens/service";
import { FakeCatalog, FakeClock, FakeDisplays, FakeIconExtractor, FakeLauncher, FakeRandom, FakeWindows, MemFs, MemLogger } from "./fakes";

const VID = "dQw4w9WgXcQ";

/** Una extensión de mentira: anota lo que se le pide y contesta lo que se le dice. */
function fakeBrowser() {
  let state: BrowserState = { connected: true, browser: "chrome", tabs: [] };
  const listeners = new Set<(s: BrowserState) => void>();
  const calls: unknown[] = [];
  const answers: { act: { ok: true } | { ok: false; reason: "unsupported" | "failed" }; query: BrowserQueryOutcome } = { act: { ok: true }, query: { ok: true, items: [] } };
  const svc: BrowserService = {
    state: () => state,
    subscribe: (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    act: async (op: BrowserOp) => (calls.push(op), answers.act),
    query: async (q: BrowserQuery) => (calls.push(q), answers.query),
    start: async () => 0,
    stop: async () => undefined,
  };
  return { svc, calls, answers, set: (s: BrowserState) => ((state = s), listeners.forEach((cb) => cb(s))) };
}

async function setup(withBrowser = true) {
  const clock = new FakeClock();
  const displays = new FakeDisplays();
  const fw = new FakeWindows();
  const log = new MemLogger();
  const screens = createScreensService({ displays, windows: fw, log });
  await screens.refresh();
  const fs = new MemFs();
  const icons = createIcons({ extractor: new FakeIconExtractor(fs), fs, dir: "icons" });
  const catalog = createCatalog({ source: new FakeCatalog(), clock });
  const windows = createWindowsService({ windows: fw, screens, log });
  let lib = { launchers: [], scenes: [], deck: [] } as ReturnType<typeof library.state>;
  const library = createLibraryService({ store: { get: () => lib, save: async (n) => void (lib = n) }, catalog, icons, random: new FakeRandom(), log });
  const launch = createLaunchService({ windows, port: fw, launcher: new FakeLauncher(), screens, clock, log });
  const browser = fakeBrowser();
  const extras = createExtras({ browser: withBrowser ? browser.svc : undefined, windows, screens, library, launch, catalog, icons, clock, random: new FakeRandom(), log });
  const sent: { type: string; payload: any }[] = [];
  const pushed: { type: string; payload: any }[] = [];
  extras.subscribe((type, payload) => pushed.push({ type, payload }));
  const send = (type: string, payload: unknown) => void sent.push({ type, payload });
  const msg = (type: string, payload: unknown, id = "c1") => ClientMessage.parse({ v: 1, id, type, payload });
  return { extras, browser, sent, pushed, send, msg };
}

describe("extras · navegador", () => {
  it("reconoce los mensajes del navegador", async () => {
    const { extras } = await setup();
    expect(extras.handles("browser.act")).toBe(true);
    expect(extras.handles("browser.query")).toBe(true);
  });

  it("el celu recién autenticado recibe el estado del navegador", async () => {
    const { extras, browser } = await setup();
    browser.set({ connected: true, browser: "chrome", tabs: [{ id: 1, windowId: 1, title: "Instagram", host: "instagram.com", active: true, audible: false, pinned: false }] });
    const snap = (await extras.snapshots()).find((s) => s.type === "browser.state");
    expect((snap!.payload as BrowserState).tabs).toHaveLength(1);
  });

  it("sin la pieza del navegador (otro sistema) no hay estado de navegador", async () => {
    const { extras } = await setup(false);
    expect((await extras.snapshots()).some((s) => s.type === "browser.state")).toBe(false);
  });

  it("cuando cambian las pestañas, se avisa a todos los celus", async () => {
    const { browser, pushed } = await setup();
    browser.set({ connected: true, browser: "chrome", tabs: [] });
    expect(pushed.at(-1)).toEqual({ type: "browser.state", payload: { connected: true, browser: "chrome", tabs: [] } });
  });

  it("browser.act pasa la operación a la extensión y devuelve su resultado", async () => {
    const { extras, browser, msg, send } = await setup();
    expect(await extras.handle(msg("browser.act", { op: "tab.activate", tabId: 4 }), send)).toEqual({ ok: true });
    browser.answers.act = { ok: false, reason: "failed" };
    expect(await extras.handle(msg("browser.act", { op: "tab.close", tabId: 4 }), send)).toEqual({ ok: false, reason: "failed" });
    expect(browser.calls).toEqual([{ op: "tab.activate", tabId: 4 }, { op: "tab.close", tabId: 4 }]);
  });

  it("browser.query contesta con browser.data para ESE pedido", async () => {
    const { extras, browser, msg, send, sent } = await setup();
    browser.answers.query = { ok: true, items: [{ kind: "video", id: VID, title: "Tema", index: 0, current: true }] };
    expect(await extras.handle(msg("browser.query", { kind: "yt.queue", tabId: 3 }, "q7"), send)).toBe("replied");
    expect(sent).toEqual([{ type: "browser.data", payload: { replyTo: "q7", kind: "yt.queue", ok: true, items: [{ kind: "video", id: VID, title: "Tema", index: 0, current: true }] } }]);
  });

  it("si la pregunta falla, el celu recibe el motivo", async () => {
    const { extras, browser, msg, send, sent } = await setup();
    browser.answers.query = { ok: false, reason: "timeout" };
    await extras.handle(msg("browser.query", { kind: "bookmarks" }, "q8"), send);
    expect(sent[0]).toEqual({ type: "browser.data", payload: { replyTo: "q8", kind: "bookmarks", ok: false, reason: "timeout" } });
  });

  it("sin la pieza del navegador: las acciones dicen unsupported y las preguntas no_extension", async () => {
    const { extras, msg, send, sent } = await setup(false);
    expect(await extras.handle(msg("browser.act", { op: "tab.reopen" }), send)).toEqual({ ok: false, reason: "unsupported" });
    await extras.handle(msg("browser.query", { kind: "yt.lists" }, "q9"), send);
    expect(sent[0]).toEqual({ type: "browser.data", payload: { replyTo: "q9", kind: "yt.lists", ok: false, reason: "no_extension" } });
  });
});
