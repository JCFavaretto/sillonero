/* global chrome */
import { createBridge } from "./lib/bridge.js";
import { OpError, createOps } from "./lib/ops.js";

// Service worker de la extensión de Sillonero. Solo habla con el programa de esta PC (127.0.0.1); no manda nada a internet.

const ops = createOps(chrome, fetch.bind(globalThis));

async function loadConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL("config.json"));
    const cfg = await res.json();
    if (typeof cfg.port === "number" && typeof cfg.token === "string") return cfg;
  } catch {
    // sin config.json: el programa de la PC todavía no preparó esta carpeta
  }
  return null;
}

function browserName() {
  const brands = (navigator.userAgentData?.brands ?? []).map((b) => b.brand.toLowerCase());
  if (brands.some((b) => b.includes("edge"))) return "edge";
  if (brands.some((b) => b.includes("brave"))) return "brave";
  if (brands.some((b) => b.includes("opera"))) return "opera";
  return "chrome";
}

let bridge = null;
let pushTimer = null;

/** Cada cuánto se vuelve a mirar mientras haya un reproductor a la vista (el celu avanza la barra solo entre una y otra). */
const MEDIA_POLL_MS = 5_000;
let mediaTimer = null;

/** Con algo en pausa se mira más despacio: retomarlo en la PC (mudo) no dispara ningún evento. */
const IDLE_POLL_MS = 15_000;
let pushing = false;
let pushAgain = false;

async function pushTabs() {
  pushTimer = null;
  if (!bridge?.isOpen()) return;
  // Un envío a la vez: si llega otro evento mientras se lee, se vuelve a leer al terminar (una lectura vieja no pisa a una nueva).
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  try {
    bridge.send({ t: "tabs", tabs: await ops.tabs() });
  } finally {
    pushing = false;
    // Pase lo que pase se vuelve a mirar mientras haya un reproductor: un error suelto no corta la actualización.
    if (mediaTimer !== null) clearTimeout(mediaTimer);
    mediaTimer = ops.hasMedia() ? setTimeout(schedulePush, MEDIA_POLL_MS) : ops.hasTracked() ? setTimeout(schedulePush, IDLE_POLL_MS) : null;
    if (pushAgain) {
      pushAgain = false;
      schedulePush();
    }
  }
}

/** Las pestañas cambian a ráfagas (abrir una página dispara varios eventos): se manda una sola vez cada 300 ms. */
function schedulePush() {
  if (pushTimer !== null) return;
  pushTimer = setTimeout(() => void pushTabs(), 300);
}

/** Una sola puesta en marcha a la vez: el arranque, `onInstalled` y la alarma pueden llamar a `start()` casi juntos. */
let starting = null;
async function start() {
  if (bridge) return void bridge.ensure();
  starting ??= create().finally(() => (starting = null));
  await starting;
}

async function create() {
  const cfg = await loadConfig();
  if (!cfg || bridge) return;
  bridge = createBridge({
    url: `ws://127.0.0.1:${cfg.port}/?k=${encodeURIComponent(cfg.token)}`,
    onOpen: (send) => {
      send({ t: "hello", browser: browserName(), version: chrome.runtime.getManifest().version });
      void pushTabs();
    },
    async onRequest(req) {
      try {
        if (req.cmd === "act") {
          await ops.act(req.body);
          schedulePush();
          return { ok: true };
        }
        if (req.cmd === "query") return { ok: true, data: await ops.query(req.body) };
        return { ok: false, error: "failed" };
      } catch (err) {
        return { ok: false, error: err instanceof OpError ? err.code : "failed" };
      }
    },
  });
  bridge.start();
}

for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced]) {
  ev.addListener(schedulePush);
}
chrome.runtime.onStartup.addListener(() => void start());
chrome.runtime.onInstalled.addListener(() => void start());
// Si Chrome durmió el service worker, esta alarma lo despierta y se reconecta.
chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => void start());
void start();
