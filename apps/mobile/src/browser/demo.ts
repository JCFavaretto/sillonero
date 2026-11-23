import type { BrowserItem, BrowserQueryKind, BrowserState } from "@proyecto-e/protocol";
import { useBrowser } from "./store";

// Datos de mentira para "Ver demo" (solo desarrollo): las pantallas del navegador se ven sin la PC ni la extensión.

export const DEMO_BROWSER: BrowserState = {
  connected: true,
  browser: "chrome",
  tabs: [
    { id: 1, windowId: 1, title: "Instagram", host: "instagram.com", active: false, audible: false, pinned: false },
    { id: 2, windowId: 1, title: "YouTube — Age of Empires", host: "youtube.com", active: true, audible: true, pinned: false },
    { id: 3, windowId: 1, title: "proyecto-e · GitHub", host: "github.com", active: false, audible: false, pinned: false },
    { id: 4, windowId: 1, title: "Twitch", host: "twitch.tv", active: false, audible: false, pinned: true },
  ],
};

const V = "dQw4w9WgXcQ";
export const DEMO_BROWSER_ITEMS: Record<BrowserQueryKind, BrowserItem[]> = {
  bookmarks: [
    { kind: "bookmark", id: "b1", title: "YouTube", subtitle: "Barra de marcadores", url: "https://www.youtube.com/" },
    { kind: "bookmark", id: "b2", title: "Twitch", subtitle: "Barra de marcadores", url: "https://www.twitch.tv/" },
    { kind: "bookmark", id: "b3", title: "Pizza", subtitle: "Recetas", url: "https://pizza.com/masa" },
  ],
  "yt.queue": [
    { kind: "video", id: V, title: "Tema que suena ahora", subtitle: "Canal", meta: "3:42", current: true, index: 0, listId: "PLdemo123" },
    { kind: "video", id: V, title: "Siguiente tema", subtitle: "Canal", meta: "4:05", index: 1, listId: "PLdemo123" },
    { kind: "video", id: V, title: "Otro tema de la lista", subtitle: "Otro canal", meta: "2:58", index: 2, listId: "PLdemo123" },
  ],
  "ytm.queue": [
    { kind: "track", id: "0", title: "Tema 1", subtitle: "Artista", meta: "3:21", current: true, index: 0 },
    { kind: "track", id: "1", title: "Tema 2", subtitle: "Artista", meta: "2:50", index: 1 },
  ],
  "yt.search": [
    { kind: "video", id: V, title: "lofi hip hop radio", subtitle: "Lofi Girl", meta: "VIVO" },
    { kind: "list", id: "RDdQw4w9WgXcQ", title: "Mix: lofi para jugar", subtitle: "YouTube", meta: "Mix" },
    { kind: "video", id: V, title: "Resultado de la búsqueda", subtitle: "Canal", meta: "12:40" },
  ],
  "yt.lists": [
    { kind: "list", id: "LL", title: "Videos que me gustan", subtitle: "" },
    { kind: "list", id: "WL", title: "Ver más tarde", subtitle: "" },
    { kind: "list", id: "PLdemo123", title: "Mix para jugar", subtitle: "24 videos" },
  ],
};

export function loadBrowserDemo(): void {
  useBrowser.setState({ browser: structuredClone(DEMO_BROWSER), demo: true });
}
