// Lectores de YouTube (docs/PLAN.md D92). Todo lo que depende de cómo está armada la página de YouTube vive en ESTE archivo:
// si YouTube cambia algo, se arregla acá y los tests (con datos reales guardados) dicen qué se rompió. Son funciones puras.

/** Saca el objeto `ytInitialData` del HTML de una página de YouTube. `null` si no está o no se puede leer. */
export function extractInitialData(html) {
  const marker = html.indexOf("ytInitialData");
  if (marker < 0) return null;
  const start = html.indexOf("{", marker);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** El texto de un campo de YouTube: `{ simpleText }` o `{ runs: [{ text }] }`. */
export function textOf(t) {
  if (!t || typeof t !== "object") return "";
  if (typeof t.simpleText === "string") return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => (r && typeof r.text === "string" ? r.text : "")).join("");
  return "";
}

const MAX = 80;

function isLive(renderer) {
  return (renderer.badges ?? []).some((b) => b?.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_LIVE_NOW");
}

function videoItem(r) {
  if (typeof r.videoId !== "string") return null;
  return {
    kind: "video",
    id: r.videoId,
    title: textOf(r.title),
    subtitle: textOf(r.ownerText) || textOf(r.shortBylineText),
    meta: isLive(r) ? "VIVO" : textOf(r.lengthText),
  };
}

function lockupListItem(l) {
  if (l?.contentType !== "LOCKUP_CONTENT_TYPE_PLAYLIST" || typeof l.contentId !== "string") return null;
  const meta = l.metadata?.lockupMetadataViewModel;
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const byline = rows[0]?.metadataParts?.[0]?.text?.content ?? "";
  let count = "";
  const overlays = l.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.overlays ?? [];
  for (const o of overlays) {
    const badge = o?.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text;
    if (typeof badge === "string") count = badge;
  }
  return { kind: "list", id: l.contentId, title: meta?.title?.content ?? "", subtitle: byline, meta: count };
}

/** Los resultados de una búsqueda: videos y listas, en el orden en que aparecen. */
export function parseSearch(data) {
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
  const items = [];
  for (const sec of sections) {
    for (const c of sec?.itemSectionRenderer?.contents ?? []) {
      const item = c.videoRenderer ? videoItem(c.videoRenderer) : c.lockupViewModel ? lockupListItem(c.lockupViewModel) : c.playlistRenderer ? playlistRendererItem(c.playlistRenderer) : null;
      if (item && item.title) items.push(item);
      if (items.length >= MAX) return items;
    }
  }
  return items;
}

function playlistRendererItem(p) {
  if (typeof p.playlistId !== "string") return null;
  return { kind: "list", id: p.playlistId, title: textOf(p.title), subtitle: textOf(p.longBylineText) || textOf(p.shortBylineText), meta: p.videoCount ? `${p.videoCount} videos` : "" };
}

/**
 * La cola de un video que suena dentro de una lista (lo que dice la página de ese video). Devuelve como mucho 80 temas
 * alrededor del actual, cada uno con su posición real en la lista (para tocarlo con `playVideoAt`).
 */
export function parseQueue(data) {
  const pl = data?.contents?.twoColumnWatchNextResults?.playlist?.playlist;
  if (!pl || !Array.isArray(pl.contents)) return null;
  const listId = typeof pl.playlistId === "string" ? pl.playlistId : undefined;
  const all = pl.contents.map((c, i) => ({ r: c?.playlistPanelVideoRenderer, i })).filter((x) => x.r && typeof x.r.videoId === "string");
  const currentAt = all.findIndex((x) => x.r.selected === true);
  const from = Math.max(0, Math.min(currentAt < 0 ? 0 : currentAt - 10, all.length - MAX));
  return {
    title: typeof pl.title === "string" ? pl.title : "",
    total: typeof pl.totalVideos === "number" ? pl.totalVideos : all.length,
    items: all.slice(from, from + MAX).map(({ r, i }) => ({
      kind: "video",
      id: r.videoId,
      title: textOf(r.title),
      subtitle: textOf(r.shortBylineText),
      meta: textOf(r.lengthText),
      current: r.selected === true,
      index: i,
      ...(listId ? { listId } : {}),
    })),
  };
}

/** "Mis listas": recorre la página de listas de la cuenta buscando lo que parezca una lista (YouTube cambia este formato seguido). */
export function parseLists(data) {
  const found = [];
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 40 || found.length >= MAX) return;
    if (Array.isArray(o)) return void o.forEach((x) => walk(x, depth + 1));
    const item = o.lockupViewModel ? lockupListItem(o.lockupViewModel) : o.gridPlaylistRenderer ? playlistRendererItem(o.gridPlaylistRenderer) : o.playlistRenderer ? playlistRendererItem(o.playlistRenderer) : null;
    if (item && item.title && !seen.has(item.id)) {
      seen.add(item.id);
      found.push(item);
    }
    for (const k of Object.keys(o)) walk(o[k], depth + 1);
  };
  walk(data, 0);
  return found;
}

/** La dirección para poner una lista a sonar desde el principio. Las "mezclas" (RD…) necesitan además el video con el que arrancan. */
export function playListUrl(listId) {
  if (/^RD[A-Za-z0-9_-]{11}$/.test(listId)) return `https://www.youtube.com/watch?v=${listId.slice(2)}&list=${listId}`;
  return `https://www.youtube.com/watch?list=${encodeURIComponent(listId)}`;
}

/** De una dirección de YouTube saca `v` y `list`; `null` si no es una página de YouTube. */
export function idsFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const v = u.searchParams.get("v");
    const list = u.searchParams.get("list");
    return { v: v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null, list: list && /^[A-Za-z0-9_-]{2,64}$/.test(list) ? list : null, music: u.hostname === "music.youtube.com" };
  } catch {
    return null;
  }
}

// ── Funciones que corren DENTRO de la página (executeScript): tienen que ser autocontenidas ──

/** Toca un video con el reproductor de la página, sin recargarla. Corre en el mundo MAIN (ahí está el reproductor). */
export function pagePlay(videoId, listId, index) {
  const player = document.getElementById("movie_player");
  if (!player) return { ok: false, why: "no_player" };
  try {
    if (listId && typeof index === "number" && typeof player.playVideoAt === "function") {
      player.playVideoAt(index);
      return { ok: true };
    }
    if (typeof player.loadVideoById === "function") {
      player.loadVideoById(videoId);
      return { ok: true };
    }
  } catch {
    // cae al "no_api" de abajo
  }
  return { ok: false, why: "no_api" };
}

/** YouTube Music: la cola, leída de la página. */
export function pageMusicQueue() {
  const rows = Array.from(document.querySelectorAll("ytmusic-player-queue-item"));
  const clean = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "");
  return rows.slice(0, 200).map((el, i) => ({
    kind: "track",
    id: String(i),
    title: clean(el.querySelector(".song-title")),
    subtitle: clean(el.querySelector(".byline")),
    meta: clean(el.querySelector(".duration")),
    current: el.hasAttribute("selected"),
    index: i,
  }));
}

/** YouTube Music: toca el tema de esa posición de la cola. */
export function pageMusicPlay(index) {
  const rows = document.querySelectorAll("ytmusic-player-queue-item");
  const el = rows[index];
  if (!el) return { ok: false, why: "no_item" };
  const button = el.querySelector("ytmusic-play-button-renderer") || el.querySelector("#play-button");
  if (button) button.click();
  else el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  return { ok: true };
}
