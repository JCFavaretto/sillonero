import { siteKind, type BrowserState, type BrowserTab, type MediaSession } from "@proyecto-e/protocol";

// Qué pestaña del navegador es la que suena (puro). El celu sabe qué suena por Windows (título y app) y qué pestañas hay por
// la extensión; se unen por el título y por cuál está haciendo ruido.

export interface YouTubeTab {
  tab: BrowserTab;
  site: "youtube" | "youtubeMusic";
}

/** El título de una pestaña de YouTube termina en " - YouTube" o " - YouTube Music": se saca para compararlo con el tema. */
const bare = (title: string) => title.replace(/\s+-\s+YouTube( Music)?$/i, "").trim().toLowerCase();

/**
 * La pestaña de YouTube (o YouTube Music) a la que pertenece lo que suena: primero la que tiene el mismo título que el tema,
 * después una que esté haciendo ruido, y si no, la única de YouTube que haya. `null` si no hay extensión o ninguna pestaña.
 */
export function youtubeTabFor(state: BrowserState | null, playing: Pick<MediaSession, "title"> | null): YouTubeTab | null {
  if (!state?.connected) return null;
  const yt = state.tabs.flatMap((tab) => {
    const site = siteKind(tab.host);
    return site ? [{ tab, site }] : [];
  });
  if (yt.length === 0) return null;
  const title = playing?.title.trim().toLowerCase() ?? "";
  if (title) {
    const same = yt.find((y) => bare(y.tab.title) === title || bare(y.tab.title).startsWith(title) || title.startsWith(bare(y.tab.title)));
    if (same) return same;
  }
  return yt.find((y) => y.tab.audible) ?? (yt.length === 1 ? yt[0]! : null);
}

/**
 * Las pestañas de UNA ventana del navegador. Windows dice el título de la ventana ("Pestaña activa - Google Chrome") y la
 * extensión dice las pestañas de cada ventana con cuál está a la vista; se unen por ese título. `null` si no hay extensión o
 * ninguna ventana coincide (con dos ventanas con la misma pestaña activa se toma la primera).
 */
export function windowTabs(windowTitle: string, state: BrowserState | null): { windowId: number; tabs: BrowserTab[] } | null {
  if (!state?.connected) return null;
  const title = windowTitle.trim().toLowerCase();
  if (!title) return null;
  const byWindow = new Map<number, BrowserTab[]>();
  for (const tab of state.tabs) byWindow.set(tab.windowId, [...(byWindow.get(tab.windowId) ?? []), tab]);
  for (const [windowId, tabs] of byWindow) {
    const active = tabs.find((t) => t.active);
    const name = active?.title.trim().toLowerCase() ?? "";
    if (name && title.startsWith(name)) return { windowId, tabs };
  }
  return null;
}
