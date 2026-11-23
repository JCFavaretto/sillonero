import { describe, expect, it } from "vitest";
import { BrowserDataPayload, BrowserItem, BrowserOp, BrowserQuery, BrowserState, BrowserTab, MEDIA_RATES, siteKind } from "../src/browser";
import { parseClientMessage, parseServerMessage } from "../src/messages";
import { Target } from "../src/library";

const env = (type: string, payload: unknown) => JSON.stringify({ v: 1, id: "abcdefgh", type, payload });
const VID = "dQw4w9WgXcQ";

describe("browser: lo que el celu le manda al navegador", () => {
  it("las operaciones válidas", () => {
    for (const op of [
      { op: "tab.activate", tabId: 5 },
      { op: "tab.close", tabId: 5 },
      { op: "tab.reload", tabId: 5 },
      { op: "tab.reopen" },
      { op: "tab.open", url: "https://youtube.com", mode: "window" },
      { op: "yt.play", tabId: 3, videoId: VID },
      { op: "yt.play", tabId: 3, videoId: VID, listId: "PLabc123", index: 4 },
      { op: "yt.playList", listId: "PLabc123" },
      { op: "ytm.play", tabId: 3, index: 2 },
    ]) expect(BrowserOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
  });

  it("rechaza lo raro: ids de video mal formados, direcciones que no son http(s), campos de más", () => {
    for (const op of [
      { op: "yt.play", tabId: 3, videoId: "corto" },
      { op: "yt.play", tabId: 3, videoId: "dQw4w9WgXc'" },
      { op: "yt.playList", listId: "PL abc" },
      { op: "yt.playList", listId: "a;b" },
      { op: "tab.open", url: "javascript:alert(1)", mode: "tab" },
      { op: "tab.open", url: "file:///C:/x", mode: "tab" },
      { op: "tab.open", url: "https://a.com", mode: "popup" },
      { op: "tab.close", tabId: -1 },
      { op: "tab.close", tabId: 1.5 },
      { op: "tab.close", tabId: 1, extra: true },
      { op: "nuevo" },
    ]) expect(BrowserOp.safeParse(op).success, JSON.stringify(op)).toBe(false);
  });

  it("las preguntas: el texto de búsqueda no puede estar vacío ni ser enorme", () => {
    expect(BrowserQuery.safeParse({ kind: "bookmarks" }).success).toBe(true);
    expect(BrowserQuery.safeParse({ kind: "yt.queue", tabId: 1 }).success).toBe(true);
    expect(BrowserQuery.safeParse({ kind: "yt.search", text: "  lofi  " }).success).toBe(true);
    expect(BrowserQuery.safeParse({ kind: "yt.search", text: "   " }).success).toBe(false);
    expect(BrowserQuery.safeParse({ kind: "yt.search", text: "x".repeat(101) }).success).toBe(false);
  });

  it("viajan como mensajes del celu", () => {
    expect(parseClientMessage(env("browser.act", { op: "tab.activate", tabId: 7 })).ok).toBe(true);
    expect(parseClientMessage(env("browser.query", { kind: "yt.lists" })).ok).toBe(true);
    expect(parseClientMessage(env("browser.act", { op: "yt.play", tabId: 7, videoId: "mal" })).ok).toBe(false);
  });
});

describe("browser: lo que el agente le cuenta al celu", () => {
  const tab = { id: 1, windowId: 2, title: "Instagram", host: "instagram.com", active: true, audible: false, pinned: false };

  it("el estado con y sin extensión", () => {
    expect(BrowserState.safeParse({ connected: false, browser: null, tabs: [] }).success).toBe(true);
    expect(BrowserState.safeParse({ connected: true, browser: "chrome", tabs: [tab] }).success).toBe(true);
    expect(BrowserState.safeParse({ connected: true, browser: "chrome", tabs: Array.from({ length: 61 }, () => tab) }).success).toBe(false);
    expect(BrowserState.safeParse({ connected: true, browser: "chrome", tabs: [{ ...tab, url: "https://x.com" }] }).success).toBe(false); // la dirección completa no viaja
  });

  it("los resultados: lista o motivo del fallo", () => {
    const ok = { replyTo: "q1", kind: "yt.queue", ok: true, items: [{ kind: "video", id: VID, title: "Tema", subtitle: "Canal", meta: "3:42", current: true, index: 0, listId: "PLabc123" }] };
    expect(BrowserDataPayload.safeParse(ok).success).toBe(true);
    expect(BrowserDataPayload.safeParse({ replyTo: "q1", kind: "yt.queue", ok: false, reason: "unreadable" }).success).toBe(true);
    expect(BrowserDataPayload.safeParse({ replyTo: "q1", kind: "yt.queue", ok: false, reason: "otra" }).success).toBe(false);
    expect(BrowserItem.safeParse({ kind: "bookmark", id: "9", title: "Sitio", url: "javascript:x" }).success).toBe(false);
  });

  it("una respuesta con 80 elementos entra en un mensaje del agente", () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ kind: "video", id: VID, title: "T".repeat(120), subtitle: "S".repeat(80), meta: "12:34", index: i, listId: "PL" + "a".repeat(60) }));
    const raw = env("browser.data", { replyTo: "q1", kind: "yt.queue", ok: true, items });
    expect(raw.length).toBeLessThan(61_440); // solo ASCII: caracteres = bytes
    expect(parseServerMessage(raw).ok).toBe(true);
  });
});

describe("el link elige cómo se abre", () => {
  it("pestaña, ventana o incógnito; sin el campo vale como pestaña", () => {
    for (const open of ["tab", "window", "private"]) expect(Target.safeParse({ kind: "url", url: "https://a.com", open }).success).toBe(true);
    expect(Target.safeParse({ kind: "url", url: "https://a.com" }).success).toBe(true);
    expect(Target.safeParse({ kind: "url", url: "https://a.com", open: "incognito" }).success).toBe(false);
  });
});

describe("siteKind", () => {
  it("reconoce YouTube y YouTube Music por el sitio", () => {
    expect(siteKind("youtube.com")).toBe("youtube");
    expect(siteKind("music.youtube.com")).toBe("youtubeMusic");
    expect(siteKind("instagram.com")).toBeNull();
    expect(siteKind("youtube.com.evil.com")).toBeNull();
  });
});

// F2 del rediseño (docs/PLAN.md 8.8, D99): el reproductor de CUALQUIER pestaña, sin perfiles por sitio.
describe("browser: reproductor genérico de una pestaña (D99)", () => {
  const media = { paused: false, positionMs: 60_000, durationMs: 243_000, rate: 1, muted: false, volume: 80, canSeek: true };
  const tab = { id: 4, windowId: 1, title: "Final del torneo", host: "twitch.tv", active: true, audible: true, pinned: false };

  it("una pestaña puede traer el estado de su video o audio; sin el campo sigue valiendo", () => {
    expect(BrowserTab.safeParse(tab).success).toBe(true);
    expect(BrowserTab.safeParse({ ...tab, media }).success).toBe(true);
    // un vivo: sin duración
    expect(BrowserTab.safeParse({ ...tab, media: { ...media, durationMs: null, canSeek: false } }).success).toBe(true);
  });

  it("rechaza estados rotos", () => {
    for (const bad of [
      { ...media, positionMs: -1 },
      { ...media, durationMs: 0 },
      { ...media, positionMs: 300_000 },
      { ...media, rate: 0 },
      { ...media, rate: 20 },
      { ...media, volume: 101 },
      { ...media, volume: 50.5 },
      { ...media, extra: 1 },
      { paused: false },
    ]) expect(BrowserTab.safeParse({ ...tab, media: bad }).success, JSON.stringify(bad)).toBe(false);
  });

  it("las órdenes: reproducir/pausar, saltar, velocidad, silencio y volumen", () => {
    for (const op of [
      { op: "media.playPause", tabId: 4 },
      { op: "media.seekBy", tabId: 4, seconds: -10 },
      { op: "media.seekBy", tabId: 4, seconds: 10 },
      { op: "media.rate", tabId: 4, rate: 1.5 },
      { op: "media.mute", tabId: 4, muted: true },
      { op: "media.volume", tabId: 4, volume: 35 },
    ]) expect(BrowserOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
    expect(parseClientMessage(env("browser.act", { op: "media.playPause", tabId: 4 })).ok).toBe(true);
  });

  it("rechaza saltos de cero o enormes, velocidades fuera de la lista y volúmenes fuera de rango", () => {
    for (const op of [
      { op: "media.seekBy", tabId: 4, seconds: 0 },
      { op: "media.seekBy", tabId: 4, seconds: 5000 },
      { op: "media.seekBy", tabId: 4, seconds: 1.5 },
      { op: "media.rate", tabId: 4, rate: 3 },
      { op: "media.rate", tabId: 4, rate: 1.1 },
      { op: "media.volume", tabId: 4, volume: -1 },
      { op: "media.mute", tabId: 4 },
      { op: "media.playPause" },
      { op: "media.playPause", tabId: 4, extra: 1 },
    ]) expect(BrowserOp.safeParse(op).success, JSON.stringify(op)).toBe(false);
  });

  it("las velocidades que ofrece el celu son las del protocolo", () => {
    expect(MEDIA_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  });
});
