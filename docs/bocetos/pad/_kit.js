// Marco común de los bocetos del Pad (B5). Copia del kit de Audio, en color (grafito + ámbar de theme.ts).
// Cada archivo llama a head(...) y a pair(...) con el contenido. Solo dibuja.
const TABS = ["Inicio", "Pantallas", "Apps", "Audio", "Pad"];
const nav = (on) => `<div class="nav">${TABS.map((t) => `<div class="${t === on ? "on" : ""}"><i></i>${t}</div>`).join("")}</div>`;
const topBar = (title, right = "") => `<div class="top"><b>${title}</b>${right}</div>`;
function V({ title = "Pad", right = "", body, tab = "Pad", over = "", kb = false }) {
  return `<div class="phone"><div class="notch"></div>${topBar(title, right)}<div class="body padbody${kb ? " kbon" : ""}">${body}</div>${kb ? KB_V : nav(tab)}${over}</div>`;
}
function L({ title = "Pad", right = "", body, over = "", kb = false }) {
  return `<div class="phoneL"><div class="notchL"></div><button class="hamb" aria-label="Menú">☰</button><div class="mainL">${topBar(title, right)}<div class="bodyL padbody">${body}</div></div>${kb ? KB_L : ""}${over}</div>`;
}
const sheet = (html, center = false) => `<div class="sheetwrap${center ? " center" : ""}"><div class="sheet">${html}</div></div>`;
function pair(id, h2, why, v, l) {
  const s = document.createElement("section");
  s.className = "pair";
  s.innerHTML = `<h2>${id} · ${h2}</h2><p class="why">${why}</p><div class="both"><div><p class="lbl">Vertical</p>${v}</div><div><p class="lbl">Apaisado</p>${l}</div></div>`;
  document.body.appendChild(s);
}
const head = (title, text, prev, next) => {
  document.title = `Boceto · Pad · ${title}`;
  document.body.classList.add("neo");
  document.body.insertAdjacentHTML("afterbegin", `<div class="wrap"><h1>Pad · ${title}</h1><p>${text}</p><p class="nav-links">${prev ? `<a href="${prev[0]}">← ${prev[1]}</a> · ` : ""}<a href="index.html">Todos los del Pad</a> · <a href="../README.md">Índice de bocetos</a>${next ? ` · <a href="${next[0]}">${next[1]} →</a>` : ""}</p></div>`);
};
if (window.parent !== window) {
  const report = () => window.parent.postMessage({ boceto: location.pathname.split("/").pop(), h: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  window.addEventListener("load", report);
  window.addEventListener("resize", report);
}

// ── Piezas del Pad ──
/** Chip de estado arriba a la derecha: on = control activo (punto ámbar quieto, sin latido). */
const chip = (state) => ({
  on: `<span class="pchip on"><i></i>Control activo</span>`,
  off: `<span class="pchip"><i></i>Sin control</span>`,
  na: `<span class="pchip na"><i></i>Sin permiso</span>`,
  lost: `<span class="pchip na"><i></i>Sin conexión</span>`,
}[state]);
/** Botón de pánico: siempre visible mientras hay control. */
const stopBtn = `<span class="stop" title="Cortar el control">■ Cortar</span>`;
/** Segmentos Touchpad / Teclado / Atajos. */
const seg = (on, short = false) => `<div class="seg">${(short ? ["Pad", "Teclado", "Atajos"] : ["Touchpad", "Teclado", "Atajos"]).map((t, i) => `<span class="${i === on ? "on" : ""}">${t}</span>`).join("")}</div>`;
/** La superficie: grilla de puntos, luz ámbar bajo el dedo, etiqueta mono del destino. */
function surface({ h = 330, finger = null, ring = false, drag = false, two = false, hint = true, dim = false, label = "→ PANTALLA 1 · 100 %", lat = "18 ms", note = "" } = {}) {
  const f = finger ? `<div class="glow" style="left:${finger[0]}%;top:${finger[1]}%"></div><div class="dot1 ${drag ? "drag" : ""}" style="left:${finger[0]}%;top:${finger[1]}%"></div>${two ? `<div class="dot1" style="left:${finger[0] + 14}%;top:${finger[1] + 4}%"></div>` : ""}${ring ? `<div class="ring1" style="left:${finger[0]}%;top:${finger[1]}%"></div>` : ""}` : "";
  const hints = hint && !finger ? `<div class="hints">Mové un dedo para el cursor<br>toque: clic · dos dedos: clic derecho y scroll<br>mantené quieto: arrastrar</div>` : "";
  return `<div class="surf ${drag ? "drag" : ""}" style="height:${h}px;${dim ? "opacity:.35" : ""}"><span class="tag">${label}</span><span class="tag r">${lat}</span>${hints}${f}${note}</div>`;
}
/** Barra de clic partida, pegada al borde de abajo de la superficie (como una notebook). */
const clickbar = (o = {}) => `<div class="clickbar"><span class="${o.left ? "on" : ""}">${o.left ? "Clic izq. mantenido" : "Clic izq."}</span><span class="mid">${o.lock ? "🔒" : "⇕"}</span><span class="${o.right ? "on" : ""}">Clic der.</span></div>`;
/** Fila de teclas especiales. mods = enganchados. */
const KEYS = ["Esc", "Tab", "⌫", "Enter", "←", "↑", "↓", "→"];
const modrow = (mods = []) => `<div class="krow">${["Ctrl", "Alt", "Shift", "Win"].map((m) => `<span class="k mod ${mods.includes(m) ? "on" : ""}">${m}</span>`).join("")}</div>`;
const keyrow = (keys = KEYS) => `<div class="krow">${keys.map((k) => `<span class="k">${k}</span>`).join("")}</div>`;
/** Teclado del celu abierto (gris, es el de Android). */
const KB_V = `<div class="osk">${"qwertyuiop asdfghjklñ ⇧zxcvbnm⌫".split(" ").map((r) => `<div>${[...r].map((c) => `<span>${c}</span>`).join("")}</div>`).join("")}<div><span style="flex:1.4">?123</span><span style="flex:5">espacio</span><span style="flex:1.4">↵</span></div></div>`;
const KB_L = `<div class="osk L">${"qwertyuiop asdfghjklñ ⇧zxcvbnm⌫".split(" ").map((r) => `<div>${[...r].map((c) => `<span>${c}</span>`).join("")}</div>`).join("")}</div>`;
/** Campo de texto que se manda a la PC. */
const field = (text, o = {}) => `<div class="tfield ${o.err ? "err" : ""}"><span class="${text ? "" : "ph"}">${text || "Escribí y mandalo a la PC"}</span><span class="send ${o.busy ? "busy" : ""}">${o.busy ? '<span class="spin"></span>' : o.ok ? "✓ Enviado" : "Enviar ↵"}</span></div>`;
const toggle = (on) => `<span class="tgl ${on ? "on" : ""}"><b></b></span>`;

document.head.insertAdjacentHTML("beforeend", `<style>
body.neo .phone,body.neo .phoneL{background:#17161D;border-color:#000;color:#F1EEE8}
body.neo .top b,body.neo .nav div{color:#F1EEE8}
body.neo .nav{background:#1B1A22;border-color:#3B3746}body.neo .nav i{border-color:#6a6577}
body.neo .nav .on{color:#F5A524}body.neo .nav .on i{border-color:#F5A524;background:rgba(245,165,36,.18)}
body.neo .hamb{background:#2C2935;border-color:#3B3746;color:#F1EEE8}
body.neo .sub,body.neo .lbl{color:#A29DAE}
body.neo .sub{white-space:normal}
body.neo .btn{background:#2C2935;border-color:#3B3746;color:#F1EEE8}
body.neo .btn.p{background:#F5A524;border-color:#F5A524;color:#1B1405;font-weight:600}
body.neo .box{background:#211F29;border-color:#3B3746}
body.neo .row{border-color:#3B3746}
body.neo .err{background:#3A1E22;color:#FF8A8A}
body.neo .note{background:rgba(245,165,36,.12);color:#F5C46A}
body.neo .sheet{background:#211F29;color:#F1EEE8}
body.neo .sheet h3{color:#F1EEE8}
.padbody{display:flex;flex-direction:column;gap:8px}
.padbody.kbon{justify-content:flex-end}
.phoneL .seg{flex-direction:column}.phoneL .seg span{padding:6px 0}
.pchip{display:inline-flex;align-items:center;gap:6px;font:500 10px "IBM Plex Mono",monospace;letter-spacing:.8px;text-transform:uppercase;color:#A29DAE;border:1px solid #3B3746;border-radius:20px;padding:3px 9px}
.pchip i{width:7px;height:7px;border-radius:50%;background:#6a6577}
.pchip.on{color:#F5A524;border-color:#F5A524;background:rgba(245,165,36,.12)}.pchip.on i{background:#F5A524;box-shadow:0 0 6px #F5A524}
.pchip.na{color:#FF8A8A;border-color:#5a2a30}.pchip.na i{background:#FF5C5C}
.stop{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#FF5C5C;border:1.5px solid #FF5C5C;border-radius:10px;padding:5px 9px;background:#3A1E22;min-height:20px}
.seg{display:flex;background:#211F29;border:1px solid #3B3746;border-radius:12px;padding:3px}
.seg span{flex:1;text-align:center;padding:7px 0;font-size:12px;color:#A29DAE;border-radius:9px}
.seg span.on{background:#2C2935;color:#F1EEE8;font-weight:600;box-shadow:inset 0 -2px 0 #F5A524}
.surf{position:relative;border-radius:18px 18px 6px 6px;background-color:#1C1B22;background-image:radial-gradient(#34303f 1px,transparent 1.2px);background-size:14px 14px;border:1px solid #3B3746;box-shadow:inset 0 2px 10px rgba(0,0,0,.55);overflow:hidden;flex:none}
.surf.drag{border-color:#F5A524;box-shadow:inset 0 2px 10px rgba(0,0,0,.55),0 0 0 1px #F5A524}
.surf .tag{position:absolute;top:8px;left:10px;font:500 9px "IBM Plex Mono",monospace;letter-spacing:1px;color:#6a6577}
.surf .tag.r{left:auto;right:10px}
.hints{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;line-height:1.7;color:#6a6577;padding:20px}
.glow{position:absolute;width:150px;height:150px;margin:-75px;border-radius:50%;background:radial-gradient(circle,rgba(245,165,36,.30),rgba(255,107,74,.10) 45%,transparent 70%)}
.dot1{position:absolute;width:34px;height:34px;margin:-17px;border-radius:50%;border:2px solid rgba(245,165,36,.85);background:rgba(245,165,36,.12)}
.dot1.drag{background:#F5A524;border-color:#FF6B4A}
.ring1{position:absolute;width:58px;height:58px;margin:-29px;border-radius:50%;border:2px solid rgba(245,165,36,.45)}
.clickbar{display:flex;gap:2px;margin-top:-6px;flex:none}
.clickbar span{flex:1;text-align:center;padding:13px 0;font-size:12px;background:#211F29;border:1px solid #3B3746;color:#F1EEE8}
.clickbar span:first-child{border-radius:6px 0 0 18px}.clickbar span:last-child{border-radius:0 6px 18px 0}
.clickbar .mid{flex:0 0 46px;color:#A29DAE}
.clickbar .on{background:rgba(245,165,36,.18);border-color:#F5A524;color:#F5A524;font-weight:600}
.krow{display:flex;gap:5px}
.k{flex:1;min-height:20px;text-align:center;padding:9px 0;font:500 11px "IBM Plex Mono",monospace;background:#211F29;border:1px solid #3B3746;border-radius:9px;color:#F1EEE8}
.k.mod{color:#A29DAE}.k.on{background:#F5A524;border-color:#F5A524;color:#1B1405;font-weight:700}
.tfield{display:flex;align-items:center;gap:8px;border:1.5px solid #F5A524;border-radius:12px;padding:6px 6px 6px 12px;background:#211F29;font-size:13px}
.tfield>span:first-child{flex:1}.tfield .ph{color:#6a6577}
.tfield.err{border-color:#FF5C5C}
.send{background:#F5A524;color:#1B1405;font-weight:700;font-size:12px;padding:8px 10px;border-radius:9px;white-space:nowrap}
.send.busy{background:#2C2935;color:#F5A524}
.osk{background:#2a2a2e;padding:6px 4px 10px;display:flex;flex-direction:column;gap:5px;flex:none}
.osk div{display:flex;gap:3px}.osk span{flex:1;text-align:center;background:#3d3d43;color:#ddd;border-radius:5px;padding:7px 0;font-size:11px}
.osk.L{position:absolute;left:0;right:0;bottom:0;padding:4px 40px 6px;gap:3px}.osk.L span{padding:5px 0;font-size:10px}
.sc{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.sc div{background:#211F29;border:1px solid #3B3746;border-radius:14px;padding:9px 6px;text-align:center;min-height:30px}
.sc b{display:block;font:500 11px "IBM Plex Mono",monospace;color:#F5A524}.sc small{font-size:10px;color:#A29DAE}
.sc .grp{grid-column:1/-1;background:none;border:0;padding:4px 0 0;text-align:left;font:500 10px "IBM Plex Mono",monospace;letter-spacing:1px;color:#6a6577;min-height:0}
.tgl{display:inline-block;width:36px;height:20px;border-radius:12px;background:#3B3746;position:relative;flex:none}
.tgl b{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#A29DAE}
.tgl.on{background:#F5A524}.tgl.on b{left:18px;background:#1B1405}
.pcbox{font-size:13px;color:#222;background:#fff;border:2px solid #333;border-radius:10px;width:300px;overflow:hidden}
.pcbox .bar{background:#e6e6e3;padding:7px 12px;font-size:12px;color:#555;border-bottom:1.5px solid #ccc}
.pcbox .page{padding:12px 14px}.pcbox .rowp{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eee}
</style>`);
