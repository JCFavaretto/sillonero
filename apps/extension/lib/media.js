// El reproductor de CUALQUIER página (docs/PLAN.md 8.8, D99 a D102): en vez de un perfil por sitio, se maneja el <video> o
// <audio> principal con lo que todos comparten (reproducir, pausar, saltar, velocidad, silencio, volumen).
// Todo lo que toca una página vive en ESTE archivo, corto, para poder revisarlo entero.

/** Sitios donde saltar o cambiar la velocidad desde afuera rompe la reproducción (D102): ahí solo se pausa y se silencia. */
export const NO_SEEK_HOSTS = ["netflix.com"];

const MAX_MS = 7 * 24 * 3600 * 1000;

/**
 * Se inyecta en la página (en cada marco). Sin acción, devuelve el estado del video o audio principal de ese marco, o `null` si
 * no hay; con acción, la aplica antes. TIENE QUE SER AUTOCONTENIDA: el navegador manda su texto, así que no puede usar nada
 * de este módulo (ni imports ni constantes de afuera).
 *
 * El principal: el que suena con sonido; si no, el que suena mudo (vista previa); si no, el más grande.
 */
export function pageMedia(action, value) {
  let best = null;
  let bestScore = -1;
  for (const el of document.querySelectorAll("video, audio")) {
    if (!el.currentSrc && !el.src && el.readyState === 0) continue; // un elemento vacío: todavía no cargó nada
    const playing = !el.paused && !el.ended;
    const box = el.tagName === "VIDEO" && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
    const area = box ? Math.max(0, box.width) * Math.max(0, box.height) : 0;
    const score = (playing ? 2e9 : 0) + (playing && !el.muted ? 1e9 : 0) + Math.min(area, 9e8);
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  if (!best) return null;
  const hasEnd = Number.isFinite(best.duration) && best.duration > 0;
  try {
    if (action === "playPause") {
      if (best.paused || best.ended) {
        const p = best.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } else best.pause();
    } else if (action === "seekBy" && hasEnd) {
      best.currentTime = Math.min(best.duration, Math.max(0, best.currentTime + Number(value)));
    } else if (action === "rate") {
      best.playbackRate = Number(value);
    } else if (action === "mute") {
      best.muted = value === true;
    } else if (action === "volume") {
      best.volume = Math.min(1, Math.max(0, Number(value) / 100));
      if (Number(value) > 0) best.muted = false;
    }
  } catch {
    // la página no dejó: se devuelve el estado tal como quedó
  }
  return {
    score: bestScore,
    paused: best.paused || best.ended,
    position: best.currentTime,
    duration: hasEnd ? best.duration : null,
    rate: best.playbackRate,
    muted: best.muted,
    volume: best.volume,
  };
}

/** Entre los resultados de todos los marcos de una pestaña, el del reproductor principal; `null` si ninguno tiene. */
export function pickFrame(results) {
  let best = null;
  for (const r of results ?? []) {
    const score = r && r.result && typeof r.result.score === "number" ? r.result.score : null;
    if (score === null) continue;
    if (!best || score > best.result.score) best = r;
  }
  return best;
}

const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** El estado que devolvió la página → la forma que entiende el agente (y que valida antes de mandarla al celu). */
export function toMedia(state, host) {
  if (!state || typeof state !== "object") return null;
  const rawDuration = num(state.duration, 0);
  const durationMs = rawDuration > 0 ? Math.min(MAX_MS, Math.max(1, Math.round(rawDuration * 1000))) : null;
  const positionMs = Math.min(durationMs ?? MAX_MS, Math.max(0, Math.round(num(state.position, 0) * 1000)));
  const rate = num(state.rate, 1);
  const h = String(host ?? "").toLowerCase().replace(/^www\./, "");
  const blocked = NO_SEEK_HOSTS.some((s) => h === s || h.endsWith("." + s));
  return {
    paused: state.paused === true,
    positionMs,
    durationMs,
    rate: rate >= 0.1 && rate <= 16 ? rate : 1,
    muted: state.muted === true,
    volume: Math.min(100, Math.max(0, Math.round(num(state.volume, 1) * 100))),
    canSeek: durationMs !== null && !blocked,
  };
}
