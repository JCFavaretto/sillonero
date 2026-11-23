// Marco común de los bocetos de Apps y Escenas (B3). Cada archivo llama a pair(...) con el contenido.
const TABS = ["Inicio", "Pantallas", "Apps", "Audio", "Pad"];
const nav = (on) => `<div class="nav">${TABS.map((t) => `<div class="${t === on ? "on" : ""}"><i></i>${t}</div>`).join("")}</div>`;
const topBar = (title, right = "") => `<div class="top"><b>${title}</b>${right}</div>`;
/** Vertical: título, botón derecho, cuerpo, pestaña activa y una capa encima (hoja, cuadro, menú). */
function V({ title, right = "", body, tab = "Inicio", over = "", dim = false, back = false }) {
  const t = back ? `‹ ${title}` : title;
  return `<div class="phone"><div class="notch"></div>${topBar(t, right)}<div class="body" style="${dim ? "opacity:.5" : ""}">${body}</div>${nav(tab)}${over}</div>`;
}
/** Apaisado: botón ☰, título, cuerpo y capa encima. */
function L({ title, right = "", body, over = "", dim = false, back = false }) {
  const t = back ? `‹ ${title}` : title;
  return `<div class="phoneL"><div class="notchL"></div><button class="hamb" aria-label="Menú">☰</button><div class="mainL" style="${dim ? "opacity:.5" : ""}">${topBar(t, right)}<div class="bodyL">${body}</div></div>${over}</div>`;
}
const sheet = (html, center = false) => `<div class="sheetwrap${center ? " center" : ""}"><div class="sheet">${html}</div></div>`;
function pair(id, h2, why, v, l) {
  const s = document.createElement("section");
  s.className = "pair";
  s.innerHTML = `<h2>${id} · ${h2}</h2><p class="why">${why}</p><div class="both"><div><p class="lbl">Vertical</p>${v}</div><div><p class="lbl">Apaisado</p>${l}</div></div>`;
  document.body.appendChild(s);
}
const APPS = { code: ["#2b7bd6", "VS"], chrome: ["#d9a400", "Ch"], discord: ["#5865f2", "Di"], spotify: ["#1db954", "Sp"], calc: ["#0a63c9", "Ca"], cursor: ["#222", "Cu"], yt: ["#e22", "▶"], stremio: ["#6c3db8", "St"] };
const ic = (k) => `<span class="app" style="background:${APPS[k][0]}">${APPS[k][1]}</span>`;
const head = (title, text, prev, next) => {
  document.title = `Boceto · Apps y Escenas · ${title}`;
  document.body.insertAdjacentHTML("afterbegin", `<div class="wrap"><h1>Apps y Escenas · ${title}</h1><p>${text}</p><p class="nav-links">${prev ? `<a href="${prev[0]}">← ${prev[1]}</a> · ` : ""}<a href="../README.md">Índice de bocetos</a>${next ? ` · <a href="${next[0]}">${next[1]} →</a>` : ""}</p></div>`);
};

// Dentro de index.html (iframe): avisa el alto para que el índice muestre el boceto entero, sin scroll propio.
// postMessage anda aunque los archivos se abran con file:// (ahí el índice no puede leer el iframe directo).
if (window.parent !== window) {
  const report = () => window.parent.postMessage({ boceto: location.pathname.split("/").pop(), h: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  window.addEventListener("load", report);
  window.addEventListener("resize", report);
}
