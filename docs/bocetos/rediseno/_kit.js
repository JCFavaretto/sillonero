// Marco común de los bocetos del rediseño (14/11/2026). Copia del kit de Comodidad con la barra nueva y las piezas de abajo.
const TABS = ["Escenas", "Pantallas", "Apps", "Audio", "Pad"];
const nav = (on) => `<div class="nav">${TABS.map((t) => `<div class="${t === on ? "on" : ""}"><i></i>${t}</div>`).join("")}</div>`;
const topBar = (title, right = "") => `<div class="top"><b>${title}</b>${right}</div>`;
function V({ title, right = "", body, tab = "Apps", over = "", back = false }) {
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
  document.title = `Boceto · Rediseño · ${title}`;
  document.body.classList.add("neo");
  document.body.insertAdjacentHTML("afterbegin", `<div class="wrap"><h1>Rediseño · ${title}</h1><p>${text}</p><p class="nav-links">${prev ? `<a href="${prev[0]}">← ${prev[1]}</a> · ` : ""}<a href="index.html">Todos juntos</a> · <a href="../README.md">Índice de bocetos</a>${next ? ` · <a href="${next[0]}">${next[1]} →</a>` : ""}</p></div>`);
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

// ── Piezas del rediseño (14/11/2026) ──
const STRIP_OFF = `<div class="strip"><span class="dot" style="background:#6a6577"></span><b>DESKTOP-PSB9K0R</b><span>Sin conexión · Reintentar</span></div>`;
/** Volumen de la app dentro de su tarjeta: ícono (toque = silencio), barra y número. `hint` aclara de quién es el volumen. */
const slim = (v, o = {}) => `<div class="slim ${o.off ? "off" : ""}"><span class="ic">${o.off ? "🔇" : "🔉"}</span><div class="grad"><b style="width:${v}%"></b><em style="left:${v}%"></em></div><span class="num">${v}</span>${o.hint ? `<span class="hint">${o.hint}</span>` : ""}</div>`;
/** Barra de reproducción con tiempos: por dónde va y cuánto falta. `live` = transmisión en vivo. */
const pt = (pct, cur, left, o = {}) => (o.live ? `<div class="pt live"><span>● VIVO</span><div class="prog"><b style="width:100%"></b></div></div>` : `<div class="pt"><span>${cur}</span><div class="prog"><b style="width:${pct}%"></b></div><span>−${left}</span></div>`);
/** Tarjeta de reproducción: carátula, título, ⏮ ⏯ ⏭, barra de reproducción, volumen y (desplegada) acciones. */
function pcard(o = {}) {
  // `ctl`: "one" (por defecto) = solo ⏯ al lado del título; "row" = ⏮ ⏯ ⏭ en su propia fila; "none" = sin controles.
  const pp = `<span class="big">${o.paused ? "▶" : "⏸"}</span>`;
  const mode = o.ctl || "one";
  const side = mode === "one" ? `<div class="mc">${pp}</div>` : "";
  const row = mode === "row" ? `<div class="mc"><span class="${o.noPrev ? "dim" : ""}">⏮</span>${pp}<span class="${o.noNext ? "dim" : ""}">⏭</span></div>` : "";
  const meta = `<div class="src">${o.src || ""}</div>`;
  return `<div class="pcard ${o.front ? "front" : ""}" style="${o.glow ? `--glow:${o.glow}` : ""}"><div class="nrow"><div class="cv ${o.cls || ""}">${o.inner || ""}</div><div class="ninfo" style="max-width:none"><div class="t1">${o.t1}</div><div class="t2">${o.t2 || ""}</div>${meta}</div>${side}<span class="chev">${o.open ? "▴" : "▾"}</span></div>${o.prog === undefined ? "" : o.prog}${row}${o.vol === undefined ? "" : o.vol}${o.open || ""}</div>`;
}
/** Tarjeta de ventana (sección Abiertas): como la de Comodidad 05, con barra de volumen si la app suena o puede sonar. */
const wmeta = (o) => `<span class="meta">${o.min ? "▁ minimizada" : `📺 ${o.scr}`}${o.full ? "<span>⛶</span>" : ""}${o.cnt ? `<span>▭ ${o.cnt}</span>` : ""}${o.front ? '<span class="bg amb">al frente</span>' : ""}</span>`;
const wcard = (a, n, o = {}) => `<div class="card ${o.front ? "front" : ""} ${o.min ? "min" : ""}"><div class="chead">${ic(a, 36)}<div class="grow"><b>${n}</b>${wmeta(o)}</div><span class="chev">${o.open ? "▴" : "▾"}</span></div>${o.vol || ""}${o.open || ""}</div>`;
/** Tira con los nombres de los decks; el elegido en ámbar. */
const dbar = (names, on, extra = "") => `<div class="dbar">${names.map((n) => `<span class="${n === on ? "on" : ""}">${n}</span>`).join("")}${extra}</div>`;
const dots = (n, on) => `<div class="dots">${Array.from({ length: n }, (_, i) => `<i class="${i === on ? "on" : ""}"></i>`).join("")}</div>`;
/** Una tecla de deck. `bg` simula la imagen; `g` es el dibujo cuando no hay imagen; `tag` = "GIF". */
const dk = (label, o = {}) => `<div class="dk ${o.bg ? "img" : ""} ${o.cls || ""}" style="${o.bg ? `background:${o.bg}` : ""}">${o.rm ? '<span class="rm">×</span>' : ""}${o.tag ? `<span class="tag">${o.tag}</span>` : ""}${o.g ? `<span class="g">${o.g}</span>` : ""}<b>${label}</b></div>`;
const dkEmpty = `<div class="dk empty">+</div>`;
const dgrid = (cols, keys, ar = "1/1") => `<div class="dgrid" style="--ar:${ar};grid-template-columns:repeat(${cols},1fr)">${keys.join("")}</div>`;
const IMG = { fire: "linear-gradient(135deg,#ff8a00,#7a1d00)", sea: "linear-gradient(135deg,#1fa2ff,#12357a)", grape: "linear-gradient(135deg,#a855f7,#3b0764)", moss: "linear-gradient(135deg,#34d399,#064e3b)", rose: "linear-gradient(135deg,#fb7185,#881337)", night: "linear-gradient(135deg,#475569,#0f172a)", red: "linear-gradient(135deg,#ef4444,#450a0a)" };
