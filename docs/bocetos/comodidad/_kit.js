// Marco común de los bocetos de la fase C (Comodidad: Inicio compacto, Apps visual, navegador). Copia del kit de Audio.
const TABS = ["Inicio", "Pantallas", "Apps", "Audio", "Pad"];
const nav = (on) => `<div class="nav">${TABS.map((t) => `<div class="${t === on ? "on" : ""}"><i></i>${t}</div>`).join("")}</div>`;
const topBar = (title, right = "") => `<div class="top"><b>${title}</b>${right}</div>`;
function V({ title, right = "", body, tab = "Inicio", over = "", back = false }) {
  return `<div class="phone"><div class="notch"></div>${topBar(back ? `‹ ${title}` : title, right)}<div class="body">${body}</div>${nav(tab)}${over}</div>`;
}
function L({ title, right = "", body, over = "", back = false }) {
  return `<div class="phoneL"><div class="notchL"></div><button class="hamb" aria-label="Menú">☰</button><div class="mainL">${topBar(back ? `‹ ${title}` : title, right)}<div class="bodyL">${body}</div></div>${over}</div>`;
}
const sheet = (html) => `<div class="sheetwrap"><div class="sheet">${html}</div></div>`;
function pair(id, h2, why, v, l) {
  const s = document.createElement("section");
  s.className = "pair";
  s.innerHTML = `<h2>${id} · ${h2}</h2><p class="why">${why}</p><div class="both"><div><p class="lbl">Vertical</p>${v}</div><div><p class="lbl">Apaisado</p>${l}</div></div>`;
  document.body.appendChild(s);
}
const head = (title, text, prev, next) => {
  document.title = `Boceto · Comodidad · ${title}`;
  document.body.classList.add("neo");
  document.body.insertAdjacentHTML("afterbegin", `<div class="wrap"><h1>Comodidad · ${title}</h1><p>${text}</p><p class="nav-links">${prev ? `<a href="${prev[0]}">← ${prev[1]}</a> · ` : ""}<a href="index.html">Todos juntos</a> · <a href="../README.md">Índice de bocetos</a>${next ? ` · <a href="${next[0]}">${next[1]} →</a>` : ""}</p></div>`);
};
if (window.parent !== window) {
  const report = () => window.parent.postMessage({ boceto: location.pathname.split("/").pop(), h: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  window.addEventListener("load", report);
  window.addEventListener("resize", report);
}

// ── Piezas de la fase C ──
const APPS = { code: ["#2b7bd6", "VS"], chrome: ["#d9a400", "Ch"], discord: ["#5865f2", "Di"], spotify: ["#1db954", "Sp"], game: ["#7a3fd1", "EL"], yt: ["#e22", "▶"], ytm: ["#c00", "♪"], edge: ["#0a7ac9", "Ed"], files: ["#c98a0a", "Ex"], ig: ["#c13584", "Ig"], tw: ["#9146ff", "Tw"], gh: ["#444", "Gh"] };
const ic = (k, size = 30) => `<span class="app" style="background:${APPS[k][0]};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;border-radius:${Math.round(size * 0.27)}px">${APPS[k][1]}</span>`;
const STRIP = `<div class="strip"><span class="dot"></span><b>DESKTOP-PSB9K0R</b><span>CPU 23 % · RAM 61 %</span></div>`;
const K = (label, g) => `<div class="key"><span style="font-size:18px">${g}</span><b>${label}</b></div>`;
const DECK = [K("Traer todo", "◫"), K("Trabajo", "▶"), K("Juego", "▶"), K("Modo sillón", "▶"), K("Tele", "📺"), `<div class="key add">+<b>Agregar</b></div>`];
/** Barra de volumen de la salida predeterminada: ⏻ de silencio, barra, número y salida. */
const volbar = (v, o = {}) => `<div class="vol ${o.off ? "off" : ""}"><span class="pw">⏻</span><div class="grad"><b style="width:${v}%"></b><em style="left:${v}%"></em></div><span class="num">${v}</span><span class="outc">🎧 ▾</span></div>`;
/** Botón de acción de app (contextual). */
const act = (g, label, o = {}) => `<span class="act ${o.on ? "on" : ""} ${o.dim ? "dim" : ""}"><i>${g}</i>${label}</span>`;
/**
 * Tarjeta compacta "Ahora": carátula cuadrada, título (el texto ocupa ~70 % del ancho), datos, controles,
 * barra de volumen y una fila de botones propios de la app.
 */
function now(o = {}) {
  const cover = `<div class="cv ${o.cls || ""}">${o.inner || ""}</div>`;
  const ctl = `<div class="mc"><span class="${o.noPrev ? "dim" : ""}">⏮</span><span class="big ${o.idle ? "dim" : ""}">${o.paused ? "▶" : "⏸"}</span><span class="${o.noNext ? "dim" : ""}">⏭</span></div>`;
  const prog = o.prog == null ? "" : `<div class="prog"><b style="width:${o.prog}%"></b></div>`;
  return `<div class="now ${o.cmp ? "cmp" : ""}"><div class="nrow">${cover}<div class="ninfo"><div class="t1">${o.t1 || "Nombre del tema"}</div><div class="t2">${o.t2 || "Artista"}</div><div class="src">${o.src || ""}</div></div>${o.sideCtl ? ctl : ""}</div>${prog}${o.sideCtl ? "" : ctl}${volbar(o.v ?? 46, o)}${o.acts ? `<div class="acts2">${o.acts}</div>` : ""}${o.foot || ""}</div>`;
}
