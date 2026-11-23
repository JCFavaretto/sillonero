import type { BrowserState, ServerMessage } from "@proyecto-e/protocol";
import { setAppsBridge } from "@/apps/commands";
import { initialApps, useApps } from "@/apps/store";
import { ASK_TIMEOUT_MS, browserActions } from "@/browser/actions";
import { youtubeTabFor } from "@/browser/match";
import { applyBrowser, initialBrowser, useBrowser } from "@/browser/store";

const tab = (id: number, title: string, host: string, over: Partial<BrowserState["tabs"][number]> = {}) => ({ id, windowId: 1, title, host, active: false, audible: false, pinned: false, ...over });
const state = (tabs: BrowserState["tabs"], connected = true): BrowserState => ({ connected, browser: "chrome", tabs });
const msg = (type: string, payload: unknown) => ({ v: 1, id: "abcdefgh", type, payload }) as unknown as ServerMessage;

beforeEach(() => {
  useBrowser.setState(initialBrowser, true);
  useApps.setState(initialApps, true);
  setAppsBridge(null);
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("youtubeTabFor: qué pestaña es la que suena", () => {
  const tabs = [tab(1, "Instagram", "instagram.com"), tab(2, "Otro video - YouTube", "youtube.com"), tab(3, "lofi hip hop radio - YouTube", "youtube.com", { audible: true }), tab(4, "Tema - YouTube Music", "music.youtube.com")];

  it("primero la que tiene el mismo título que el tema", () => {
    expect(youtubeTabFor(state(tabs), { title: "Otro video" })!.tab.id).toBe(2);
    expect(youtubeTabFor(state(tabs), { title: "Tema" })).toMatchObject({ site: "youtubeMusic", tab: { id: 4 } });
  });
  it("si no coincide, la que está haciendo ruido", () => {
    expect(youtubeTabFor(state(tabs), { title: "algo que no está" })!.tab.id).toBe(3);
    expect(youtubeTabFor(state(tabs), null)!.tab.id).toBe(3);
  });
  it("sin ruido y con varias, no adivina; con una sola, esa", () => {
    expect(youtubeTabFor(state([tab(2, "A - YouTube", "youtube.com"), tab(3, "B - YouTube", "youtube.com")]), { title: "otro" })).toBeNull();
    expect(youtubeTabFor(state([tab(2, "A - YouTube", "youtube.com")]), { title: "otro" })!.tab.id).toBe(2);
  });
  it("sin extensión o sin pestañas de YouTube, null", () => {
    expect(youtubeTabFor(null, { title: "x" })).toBeNull();
    expect(youtubeTabFor(state(tabs, false), { title: "x" })).toBeNull();
    expect(youtubeTabFor(state([tab(1, "Instagram", "instagram.com")]), { title: "x" })).toBeNull();
  });
});

describe("store: estado y respuestas", () => {
  it("browser.state se guarda y al cortarse la conexión se limpia", () => {
    applyBrowser(msg("browser.state", state([tab(1, "A", "a.com")])));
    expect(useBrowser.getState().browser!.tabs).toHaveLength(1);
    applyBrowser(null);
    expect(useBrowser.getState().browser).toBeNull();
  });

  it("ask: manda la pregunta y entrega la respuesta de ESE pedido", async () => {
    const sent: unknown[] = [];
    setAppsBridge({ command: (async () => ({ ok: true })) as never, query: (t, p) => (sent.push([t, p]), "q1") });
    const answer = browserActions.ask({ kind: "bookmarks" });
    applyBrowser(msg("browser.data", { replyTo: "otro", kind: "bookmarks", ok: true, items: [] })); // de otro pedido: se ignora
    applyBrowser(msg("browser.data", { replyTo: "q1", kind: "bookmarks", ok: true, items: [{ kind: "bookmark", id: "1", title: "A", url: "https://a.com" }] }));
    expect(await answer).toEqual({ ok: true, items: [{ kind: "bookmark", id: "1", title: "A", url: "https://a.com" }] });
    expect(sent).toEqual([["browser.query", { kind: "bookmarks" }]]);
  });

  it("ask: el motivo de la falla llega tal cual", async () => {
    setAppsBridge({ command: (async () => ({ ok: true })) as never, query: () => "q2" });
    const answer = browserActions.ask({ kind: "yt.lists" });
    applyBrowser(msg("browser.data", { replyTo: "q2", kind: "yt.lists", ok: false, reason: "unreadable" }));
    expect(await answer).toEqual({ ok: false, reason: "unreadable" });
  });

  it("ask: si no contesta en el plazo, timeout (y una respuesta tardía no pasa nada)", async () => {
    setAppsBridge({ command: (async () => ({ ok: true })) as never, query: () => "q3" });
    const answer = browserActions.ask({ kind: "bookmarks" });
    jest.advanceTimersByTime(ASK_TIMEOUT_MS + 1);
    expect(await answer).toEqual({ ok: false, reason: "timeout" });
    expect(() => applyBrowser(msg("browser.data", { replyTo: "q3", kind: "bookmarks", ok: true, items: [] }))).not.toThrow();
  });

  it("ask: sin conexión, offline; y si la conexión se corta esperando, no queda colgado", async () => {
    expect(await browserActions.ask({ kind: "bookmarks" })).toEqual({ ok: false, reason: "offline" });
    setAppsBridge({ command: (async () => ({ ok: true })) as never, query: () => "q4" });
    const waiting = browserActions.ask({ kind: "bookmarks" });
    applyBrowser(null);
    expect(await waiting).toEqual({ ok: false, reason: "no_extension" });
  });

  it("act: el error de la PC se traduce a un texto del navegador", async () => {
    setAppsBridge({ command: (async () => ({ ok: false, reason: "unsupported" })) as never, query: () => null });
    expect(await browserActions.act({ op: "tab.reopen" })).toEqual({ ok: false, error: "browser.error.unsupported" });
  });
});
