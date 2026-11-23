import type { AppAudio, AudioState, BrowserState, BrowserTab, MediaSession, WindowInfo } from "@proyecto-e/protocol";
import { windowCards, type WindowCard } from "@/apps/groups";
import { isBrowser } from "@/apps/profiles";
import { windowTabs } from "@/browser/match";

// Qué se está reproduciendo y en qué ventana (puro). Nació como las "páginas" del carrusel de la tarjeta Ahora; desde el
// rediseño (D95, docs/PLAN.md 8.8) cada página es una tarjeta de la sección Reproduciendo de Apps (ver `appsView`, abajo).
// Las "páginas": Son las reproducciones que Windows informa MÁS una por cada ventana
// de navegador que parezca estar reproduciendo YouTube y que Windows no haya separado (Jay, 12/11/2026: sin extensión, que
// al menos cada ventana de navegador cuente como un reproductor distinto; con la extensión llegan los detalles por pestaña).

export const WINDOW_PAGE = "win:";
export const isWindowPage = (id: string) => id.startsWith(WINDOW_PAGE);

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "Video - YouTube - Google Chrome" → "Video"; `null` si la ventana no es de YouTube (o YouTube Music). */
export function mediaTitleOfWindow(title: string): string | null {
  const noBrowser = title.replace(/\s+-\s+(Google Chrome|Microsoft​? Edge|Brave|Mozilla Firefox|Opera|Vivaldi|Chromium)(\s+-\s+.*)?$/i, "").replace(/\s+and \d+ more pages?.*$/i, "");
  const m = /^(.*?)\s+-\s+YouTube( Music)?$/i.exec(noBrowser.trim());
  const bare = m?.[1]?.trim();
  return bare ? bare : null;
}

/**
 * Una reproducción por cada ventana de navegador con YouTube que NO figure ya entre las que Windows informa (se compara por el
 * título del video). Son de mentira: no tienen carátula y solo se las puede pausar (con la tecla de YouTube).
 */
export function windowPages(audio: AudioState, windows: readonly WindowInfo[]): { session: MediaSession; win: WindowInfo }[] {
  const out: { session: MediaSession; win: WindowInfo }[] = [];
  const seen = new Set<string>();
  for (const win of windows) {
    if (!isBrowser(win.app) || win.state === "minimized") continue;
    const title = mediaTitleOfWindow(win.title);
    if (!title || seen.has(title.toLowerCase())) continue;
    const known = audio.media.sessions.some((s) => same(s.title, title) || (s.title.trim() !== "" && title.toLowerCase().startsWith(s.title.trim().toLowerCase())) || (s.title.trim() !== "" && s.title.toLowerCase().startsWith(title.toLowerCase())));
    if (known) continue;
    seen.add(title.toLowerCase());
    out.push({
      win,
      session: { id: WINDOW_PAGE + win.id, app: win.app, iconKey: win.iconKey, title, artist: "", status: "playing", controls: { prev: false, playPause: true, next: false }, artKey: null },
    });
  }
  return out;
}

export interface Pages {
  /** Todas, en orden: primero las de Windows, después las ventanas. */
  list: MediaSession[];
  /** De qué ventana es cada página de ventana. */
  windowOf: Map<string, WindowInfo>;
}

export function buildPages(audio: AudioState, windows: readonly WindowInfo[]): Pages {
  const extra = windowPages(audio, windows);
  return { list: [...audio.media.sessions, ...extra.map((e) => e.session)], windowOf: new Map(extra.map((e) => [e.session.id, e.win])) };
}

/** La página elegida: la que se tocó en el celu (si sigue existiendo) o la que Windows dice que obedece. */
export function selectedPage(pages: Pages, localId: string | null, audio: AudioState): MediaSession | null {
  const local = localId ? pages.list.find((p) => p.id === localId) : undefined;
  return local ?? pages.list.find((p) => p.id === audio.media.targetId) ?? null;
}

/** La página de al lado (1 = siguiente, -1 = anterior); `null` en las puntas o con una sola. */
export function neighborId(pages: Pages, selectedId: string | null, dir: 1 | -1): string | null {
  if (pages.list.length < 2) return null;
  const i = pages.list.findIndex((p) => p.id === selectedId);
  if (i < 0) return null;
  return pages.list[i + dir]?.id ?? null;
}

// ── Apps: Reproduciendo y Abiertas (D95) ──

/** Una tarjeta de la sección Reproduciendo: una reproducción, con su ventana y su app del mezclador si se las encuentra. */
export interface PlayCard {
  /** El id de la reproducción: es la clave de la tarjeta. */
  key: string;
  session: MediaSession;
  /** La ventana donde suena; null si no tiene ninguna (Spotify en la bandeja) o no se sabe cuál es. */
  window: WindowInfo | null;
  /** Su app en el mezclador de la PC (volumen y salida); null si no figura. */
  app: AppAudio | null;
  /** Salió del título de una ventana de navegador, no de Windows: solo se la puede pausar con la tecla de YouTube. */
  fromWindow: boolean;
  /** Con la extensión (D99): la pestaña cuyo video o audio manda en esta tarjeta; los controles son los de ese reproductor. */
  web: BrowserTab | null;
}

/** El título de una pestaña sin el sufijo de YouTube, en minúsculas: para reconocer el mismo video en Windows. */
const bareTitle = (t: string) => t.replace(/\s+-\s+YouTube( Music)?$/i, "").trim().toLowerCase();

/** La reproducción de una pestaña con reproductor, en la forma de las de Windows (así la tarjeta es una sola). */
function webSession(tab: BrowserTab, win: WindowInfo): MediaSession {
  const m = tab.media!;
  return {
    id: `tab:${tab.id}`,
    app: win.app,
    iconKey: win.iconKey,
    title: tab.title.slice(0, 120),
    artist: tab.host.slice(0, 80),
    status: m.paused ? "paused" : "playing",
    controls: { prev: false, playPause: true, next: false },
    artKey: null,
    ...(m.durationMs !== null ? { timeline: { positionMs: m.positionMs, durationMs: m.durationMs, rate: m.rate } } : {}),
  };
}

/**
 * Las ventanas de navegador cuya pestaña tiene un reproductor que la extensión puede manejar (D99). Por ventana, la pestaña a
 * la vista; si esa no tiene, otra de la misma ventana que sí.
 */
function webCards(windows: readonly WindowInfo[], browser: BrowserState | null): { win: WindowInfo; tab: BrowserTab }[] {
  if (!browser?.connected) return [];
  const out: { win: WindowInfo; tab: BrowserTab }[] = [];
  const used = new Set<number>();
  for (const win of windows) {
    if (!isBrowser(win.app)) continue;
    const tabs = windowTabs(win.title, browser)?.tabs.filter((t) => t.media && !used.has(t.id)) ?? [];
    // La que reproduce (o suena) gana sobre la que solo está a la vista: si no, un video pausado al frente taparía la música de fondo.
    const tab = tabs.find((t) => t.active && !t.media!.paused) ?? tabs.find((t) => !t.media!.paused) ?? tabs.find((t) => t.active) ?? tabs[0];
    if (!tab) continue;
    used.add(tab.id);
    out.push({ win, tab });
  }
  return out;
}

export interface AppsView {
  playing: PlayCard[];
  /** Las ventanas que no están reproduciendo nada. */
  open: WindowCard[];
}

/**
 * La ventana de una reproducción entre las que nadie tomó. Un navegador con varias ventanas: la que lleva el título de lo
 * que suena; si ninguna lo lleva no se adivina (queda sin ventana), salvo que tenga una sola. Las demás apps: la que está al
 * frente; si no, una que no esté minimizada; si no, cualquiera.
 */
function windowFor(session: MediaSession, windows: readonly WindowInfo[], taken: ReadonlySet<string>): WindowInfo | null {
  const mine = windows.filter((w) => same(w.app, session.app) && !taken.has(w.id));
  if (mine.length === 0) return null;
  const title = session.title.trim().toLowerCase();
  const byTitle = title === "" ? undefined : mine.find((w) => w.title.trim().toLowerCase().startsWith(title));
  if (byTitle) return byTitle;
  if (isBrowser(session.app)) return mine.length === 1 ? mine[0]! : null;
  return mine.find((w) => w.focused) ?? mine.find((w) => w.state !== "minimized") ?? mine[0]!;
}

/**
 * Las dos secciones de Apps. `order` es el orden en que el celu vio las reproducciones (ver `stableOrder`): la PC manda
 * primero lo que suena, y sin esto las tarjetas se cruzarían cada vez que algo se pausa.
 */
export function appsView(windows: readonly WindowInfo[], audio: AudioState | null, order: readonly string[], browser: BrowserState | null = null): AppsView {
  const audioOn = audio?.available.audio === true;
  const web = webCards(windows, browser);
  if (!audioOn && web.length === 0) return { playing: [], open: windowCards(windows, audio) };
  const pages = audioOn ? buildPages(audio, windows) : { list: [] as MediaSession[], windowOf: new Map<string, WindowInfo>() };
  const taken = new Set<string>();
  // La extensión manda: la ventana de una pestaña con reproductor es de esa tarjeta, y la reproducción de Windows del mismo
  // video (o la que salió del título de la ventana) no se repite.
  for (const { win } of web) taken.add(win.id);
  const webTitles = web.map(({ tab }) => bareTitle(tab.title)).filter(Boolean);
  const sameVideo = (s: MediaSession) => isBrowser(s.app) && webTitles.some((t) => { const x = bareTitle(s.title); return x !== "" && (x === t || (x.length >= 8 && t.length >= 8 && (t.startsWith(x) || x.startsWith(t)))); });
  const sessions = pages.list.filter((s) => !sameVideo(s) && !(pages.windowOf.get(s.id) && taken.has(pages.windowOf.get(s.id)!.id)));
  // Primero las que ya traen su ventana (salieron de ella): así nadie más se la queda.
  for (const s of sessions) {
    const own = pages.windowOf.get(s.id);
    if (own) taken.add(own.id);
  }
  const cards: PlayCard[] = [
    ...sessions.map((session): PlayCard => {
      const own = pages.windowOf.get(session.id);
      const window = own ?? windowFor(session, windows, taken);
      if (window) taken.add(window.id);
      return { key: session.id, session, window, app: audio?.apps.find((a) => same(a.name, session.app)) ?? null, fromWindow: own !== undefined, web: null };
    }),
    ...web.map(({ win, tab }): PlayCard => ({ key: `tab:${tab.id}`, session: webSession(tab, win), window: win, app: audio?.apps.find((a) => same(a.name, win.app)) ?? null, fromWindow: false, web: tab })),
  ];
  const rank = new Map(order.map((id, i) => [id, i]));
  const playing = cards
    .map((card, i) => ({ card, i }))
    .sort((a, b) => (rank.get(a.card.key) ?? order.length + a.i) - (rank.get(b.card.key) ?? order.length + b.i))
    .map((x) => x.card);
  return { playing, open: windowCards(windows.filter((w) => !taken.has(w.id)), audio) };
}

/** El orden de las tarjetas: las conocidas en su lugar, sin las que ya no están, y las nuevas al final. Misma lista si nada cambió. */
export function stableOrder(prev: readonly string[], ids: readonly string[]): readonly string[] {
  const now = new Set(ids);
  const kept = prev.filter((id) => now.has(id));
  const known = new Set(kept);
  const next = [...kept, ...ids.filter((id) => !known.has(id))];
  return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
}
