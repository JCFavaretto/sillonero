import { pageMedia, pickFrame, toMedia } from "./media.js";
import { flattenBookmarks, toTabs } from "./tabs.js";
import { extractInitialData, idsFromUrl, pageMusicPlay, pageMusicQueue, pagePlay, parseLists, parseQueue, parseSearch, playListUrl } from "./youtube.js";

// Lo que el agente le pide al navegador. `chrome` y `fetchFn` se reciben de afuera para poder probarlo con piezas falsas.
// Regla: nada de esto trae una ventana al frente (por eso solo se cambia la pestaña activa de SU ventana, nunca la ventana).

/** Una falla que el agente entiende: "unreadable" = la página no se pudo leer; cualquier otra cosa = "failed". */
export class OpError extends Error {
  constructor(code, detail) {
    super(detail ?? code);
    this.code = code;
  }
}

const FETCH_TIMEOUT_MS = 7_000;

/** Cuánto se espera a que una página conteste antes de darla por "sin reproductor". */
const MEDIA_TIMEOUT_MS = 1_500;

const hostFromUrl = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

export function createOps(chrome, fetchFn) {
  /** La pestaña pedida, solo si es de YouTube: nunca se inyecta nada en otra página. */
  async function youtubeTab(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || typeof tab.url !== "string") throw new OpError("failed", "la pestaña ya no está");
    const ids = idsFromUrl(tab.url);
    if (!ids) throw new OpError("failed", "esa pestaña no es de YouTube");
    return { tab, ids };
  }

  async function getHtml(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { credentials: "include", signal: ctl.signal, headers: { "Accept-Language": "es-419,es;q=0.9" } });
      if (!res.ok) throw new OpError("unreadable", `HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (err instanceof OpError) throw err;
      throw new OpError("unreadable", String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  async function readData(url) {
    const data = extractInitialData(await getHtml(url));
    if (!data) throw new OpError("unreadable", "no se encontraron los datos de la página");
    return data;
  }

  /** Las pestañas donde se vio un reproductor: se las sigue mirando aunque dejen de sonar (en pausa), para poder reanudarlas. */
  const tracked = new Set();
  /** ¿Alguno de esos reproductores está reproduciendo ahora? (según la última lectura) */
  let playing = false;

  /**
   * El reproductor principal de una pestaña (D99): se pregunta en todos sus marcos y gana el de mejor puntaje. `null` si no
   * tiene, o si la página no se deja leer (las del navegador, la tienda de extensiones).
   */
  async function mediaOf(tabId) {
    // Una pestaña colgada o que no termina de cargar no puede dejar sin respuesta a todas las demás: se la da por "sin reproductor".
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), MEDIA_TIMEOUT_MS));
    const read = chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, func: pageMedia, args: [null, null], injectImmediately: true })
      .then(pickFrame)
      .catch(() => null);
    return Promise.race([read, timeout]);
  }

  /** Aplica una acción al reproductor de la pestaña, SOLO en el marco donde está. */
  async function mediaAct(tabId, action, value, needsSeek) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    // Solo pestañas comunes: nunca incógnito (aunque la extensión esté habilitada ahí) ni páginas que no son http(s).
    if (!tab || tab.incognito === true || !/^https?:\/\//i.test(String(tab.url ?? ""))) throw new OpError("failed", "esa pestaña no se puede manejar");
    const best = await mediaOf(tabId);
    if (!best) throw new OpError("failed", "esa pestaña no tiene un video ni un audio");
    const state = toMedia(best.result, hostFromUrl(tab.url));
    if (needsSeek && !state?.canSeek) throw new OpError("failed", "ahí no se puede saltar ni cambiar la velocidad");
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [best.frameId] }, func: pageMedia, args: [action, value] });
    } catch (err) {
      throw new OpError("failed", String(err));
    }
    tracked.add(tabId);
  }

  async function runInTab(tabId, world, func, args) {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world, func, args });
    return res?.result;
  }

  return {
    async act(op) {
      switch (op.op) {
        case "tab.activate":
          await chrome.tabs.update(op.tabId, { active: true }); // solo la pestaña: la ventana no se trae al frente
          return;
        case "tab.close":
          await chrome.tabs.remove(op.tabId);
          return;
        case "tab.reload":
          await chrome.tabs.reload(op.tabId);
          return;
        case "tab.reopen":
          await chrome.sessions.restore();
          return;
        case "tab.open":
          if (op.mode === "window") await chrome.windows.create({ url: op.url });
          else await chrome.tabs.create({ url: op.url });
          return;
        case "yt.play": {
          const { ids } = await youtubeTab(op.tabId);
          const res = await runInTab(op.tabId, "MAIN", pagePlay, [op.videoId, op.listId ?? null, op.index ?? null]);
          if (res?.ok) return;
          // El reproductor de la página no contestó: se navega la pestaña (corta lo que sonaba, pero suena lo que se pidió).
          const list = op.listId ?? ids.list;
          await chrome.tabs.update(op.tabId, { url: `https://www.youtube.com/watch?v=${op.videoId}${list ? `&list=${list}` : ""}` });
          return;
        }
        case "yt.playList": {
          const url = playListUrl(op.listId);
          if (op.tabId !== undefined) {
            await youtubeTab(op.tabId);
            await chrome.tabs.update(op.tabId, { url });
          } else await chrome.tabs.create({ url, active: false });
          return;
        }
        case "media.playPause":
          return mediaAct(op.tabId, "playPause", null, false);
        case "media.seekBy":
          return mediaAct(op.tabId, "seekBy", op.seconds, true);
        case "media.rate":
          return mediaAct(op.tabId, "rate", op.rate, true);
        case "media.mute":
          return mediaAct(op.tabId, "mute", op.muted, false);
        case "media.volume":
          return mediaAct(op.tabId, "volume", op.volume, false);
        case "ytm.play": {
          await youtubeTab(op.tabId);
          const res = await runInTab(op.tabId, "MAIN", pageMusicPlay, [op.index]);
          if (!res?.ok) throw new OpError("unreadable", "no se pudo tocar ese tema");
          return;
        }
        default:
          throw new OpError("failed", "operación desconocida");
      }
    },

    async query(q) {
      switch (q.kind) {
        case "bookmarks":
          return flattenBookmarks(await chrome.bookmarks.getTree());
        case "yt.search": {
          const data = await readData(`https://www.youtube.com/results?search_query=${encodeURIComponent(q.text)}&hl=es`);
          return parseSearch(data);
        }
        case "yt.lists": {
          const data = await readData("https://www.youtube.com/feed/playlists?hl=es");
          const lists = parseLists(data);
          const fixed = [
            { kind: "list", id: "LL", title: "Videos que me gustan", subtitle: "", meta: "" },
            { kind: "list", id: "WL", title: "Ver más tarde", subtitle: "", meta: "" },
          ];
          return [...fixed, ...lists.filter((l) => l.id !== "LL" && l.id !== "WL")].slice(0, 80);
        }
        case "yt.queue": {
          const { tab, ids } = await youtubeTab(q.tabId);
          if (!ids.v) throw new OpError("unreadable", "esa pestaña no está reproduciendo un video");
          if (!ids.list) {
            // Un video suelto: no hay lista, solo lo que suena.
            return [{ kind: "video", id: ids.v, title: String(tab.title ?? "").replace(/ - YouTube$/, ""), current: true, index: 0 }];
          }
          const data = await readData(`https://www.youtube.com/watch?v=${ids.v}&list=${ids.list}&hl=es`);
          const queue = parseQueue(data);
          if (!queue) throw new OpError("unreadable", "la página no trae la lista");
          return queue.items;
        }
        case "ytm.queue": {
          await youtubeTab(q.tabId);
          return (await runInTab(q.tabId, "MAIN", pageMusicQueue, [])) ?? [];
        }
        default:
          throw new OpError("failed", "pregunta desconocida");
      }
    },

    /**
     * Las pestañas. Traen el estado de su reproductor las que suenan, la que está a la vista en cada ventana (un video en pausa o
     * silenciado en la página no "suena", pero es el que se está mirando) y las que ya tenían uno. En las demás no se inyecta nada.
     */
    async tabs() {
      const list = toTabs(await chrome.tabs.query({}));
      const alive = new Set(list.map((t) => t.id));
      for (const id of tracked) if (!alive.has(id)) tracked.delete(id);
      let anyPlaying = false;
      await Promise.all(
        list
          .filter((t) => t.audible || t.active || tracked.has(t.id))
          .map(async (t) => {
            const best = await mediaOf(t.id);
            const media = best ? toMedia(best.result, t.host) : null;
            // Una pestaña que no sonaba ni se seguía solo cuenta si el video está reproduciendo con sonido: un video de portada
            // mudo o uno pausado y olvidado no es un reproductor (ruido en el celu).
            const worth = media && (t.audible || tracked.has(t.id) || (!media.paused && !media.muted));
            if (worth) {
              t.media = media;
              tracked.add(t.id);
              if (!media.paused) anyPlaying = true;
            } else tracked.delete(t.id);
          }),
      );
      playing = anyPlaying;
      return list;
    },

    /** ¿Hay algo reproduciendo? Mientras lo haya, conviene volver a mirar cada tanto (la posición avanza). */
    hasMedia: () => playing,

    /** ¿Se sigue alguna pestaña con reproductor (aunque esté en pausa)? Para volver a mirar de vez en cuando: si se la retoma en la PC sin sonido no hay evento. */
    hasTracked: () => tracked.size > 0,
  };
}
