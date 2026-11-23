// Panel local de Sillonero (docs/PLAN.md 5.5): HTML, CSS y JS como cadenas, sin framework.
// La CSP (`default-src 'self'`) no permite scripts ni estilos inline: cada cosa va en su ruta
// (`/`, `/app.css`, `/app.js`). Todo el contenido que viene del celu se escribe con textContent.

export const PAGE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sillonero</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main id="root"><p class="muted">Cargando…</p></main>
<script src="/app.js"></script>
</body>
</html>
`;

export const PAGE_CSS = String.raw`
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #1F2430; color: #E6E8EF; font: 15px/1.45 system-ui, "Segoe UI", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 0 0 12px; }
.muted { color: #9AA3B8; }
.card { background: #2A3040; border: 1px solid #4A5268; border-radius: 12px; padding: 16px; margin-top: 16px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.grow { flex: 1; min-width: 0; }
button, select { font: inherit; border-radius: 8px; border: 1px solid #4A5268; background: #3A4155; color: #E6E8EF; padding: 8px 14px; min-height: 40px; }
button { cursor: pointer; }
button:hover:not([disabled]) { background: #46506A; }
button[disabled] { opacity: 0.5; cursor: not-allowed; }
button.primary { background: #3B6FE0; border-color: #3B6FE0; color: #fff; }
button.primary:hover:not([disabled]) { background: #4D7FF0; }
button.danger { background: #3A2328; border-color: #E5484D; color: #FF8A8E; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #9AA3B8; margin-right: 8px; }
.dot.ok { background: #3FB950; }
.dot.off { background: #9AA3B8; }
.notice { background: #3A3320; border: 1px solid #E0A020; border-radius: 8px; padding: 10px 12px; margin-top: 12px; }
.error { background: #3A2328; border: 1px solid #E5484D; border-radius: 8px; padding: 10px 12px; margin-top: 12px; }
.qr { width: 240px; height: 240px; background: #fff; border-radius: 8px; padding: 8px; }
.pending { border-color: #3B6FE0; }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 10px 0; border-top: 1px solid #4A5268; }
li:first-child { border-top: 0; }
kbd { font: 13px ui-monospace, "Cascadia Mono", Consolas, monospace; background: #1F2430; border: 1px solid #4A5268; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.warn { color: #FFB84D; }
.footer { margin-top: 24px; text-align: right; }
`;

export const PAGE_JS = String.raw`
(function () {
  "use strict";

  var root = document.getElementById("root");
  var status = null;
  var unauthorized = false;
  var message = "";
  var lastKey = "";
  var countdownEl = null;

  var PLATFORM = { android: "Android", ios: "iPhone" };
  var NOTICES = {
    config_recovered: "El archivo de configuración estaba dañado: se guardó una copia (agent.json.bak) y se arrancó con los valores de fábrica.",
    config_newer: "La configuración es de una versión más nueva del agente: no se toca y el acceso remoto queda apagado.",
    tray_failed: "No se pudo crear el ícono de la bandeja. El agente sigue funcionando desde esta página.",
    identity_lost: "La clave de la PC está cifrada con otra cuenta de Windows (o el perfil se restauró) y no se pudo abrir. No inventé una nueva por mi cuenta: el archivo quedó como estaba. Si querés seguir, generá una clave nueva; después hay que volver a emparejar los celus.",
    security_upgraded: "Actualizamos la seguridad: ahora el celu y la PC hablan cifrado. Hay que volver a emparejar tu celu (tocá Emparejar y escaneá el QR nuevo)."
  };

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, String(v));
    });
    (children || []).forEach(function (c) { if (c) el.append(c); });
    return el;
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (j) { return j; }, function () { return {}; }).then(function (j) {
        message = r.ok ? "" : (j.error || ("Error " + r.status));
        return refresh(true);
      });
    }, function () {
      message = "No se pudo hablar con el agente.";
      render(true);
    });
  }

  function refresh(force) {
    return fetch("/api/status", { cache: "no-store" }).then(function (r) {
      if (r.status === 401) { unauthorized = true; status = null; render(true); return; }
      return r.json().then(function (j) { unauthorized = false; status = j; render(force); });
    }, function () {
      message = "No se pudo hablar con el agente.";
      render(true);
    });
  }

  function two(n) { return n < 10 ? "0" + n : String(n); }
  function remaining(expiresAt) {
    var s = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    return Math.floor(s / 60) + ":" + two(s % 60);
  }
  function when(iso) { return iso ? new Date(iso).toLocaleString("es-AR") : "nunca"; }

  function remoteCard(s) {
    var on = s.remote.enabled;
    return h("section", { class: "card" }, [
      h("div", { class: "row between" }, [
        h("div", { class: "grow" }, [
          h("h2", { text: "Acceso remoto" }),
          h("div", { class: "muted", text: on ? "Encendido en el puerto " + s.remote.port + ". Solo red local." : "Apagado. El celu no puede conectarse." })
        ]),
        h("button", { class: on ? "" : "primary", text: on ? "Apagar" : "Encender", onclick: function () { post("/api/remote", { enabled: !on }); } })
      ]),
      s.remote.error ? h("div", { class: "error", text: s.remote.error }) : null
    ]);
  }

  function audioCard(s) {
    var a = s.audio;
    if (!a) return null;
    function sw(which, title, detail) {
      var off = a.disabled[which];
      return h("div", { class: "row between" }, [
        h("div", { class: "grow" }, [h("div", { text: title }), h("div", { class: "muted", text: detail })]),
        h("button", { class: off ? "primary" : "", text: off ? "Prender" : "Apagar", onclick: function () { post("/api/audio", { which: which, disabled: !off }); } })
      ]);
    }
    return h("section", { class: "card" }, [
      h("h2", { text: "Audio" }),
      h("div", { class: "muted", text: a.available ? "Disponible." : "No disponible: el agente no pudo hablar con el audio de Windows." }),
      sw("defaultOutput", "Cambiar la salida predeterminada", a.disabled.defaultOutput ? "Apagado a mano." : a.defaultOutput ? "Usa una función de Windows que no está documentada." : "No anda en esta PC."),
      sw("appRouting", "Mandar apps a otra salida", a.disabled.appRouting ? "Apagado a mano." : a.appRouting ? "Usa una función de Windows que no está documentada." : "No anda en esta PC.")
    ]);
  }

  function inputCard(s) {
    var i = s.input;
    if (!i) return null;
    var held = [];
    if (i.holding.left) held.push("el botón izquierdo");
    if (i.holding.alt) held.push("Alt");
    return h("section", { class: "card" }, [
      h("h2", { text: "Mouse y teclado remotos" }),
      h("div", { class: "muted", text: "Con esto prendido, cualquier celu emparejado puede mover el mouse y escribir en esta PC (el Pad de la app). Apagarlo no desempareja a nadie." }),
      h("div", { class: "row between" }, [
        h("div", { class: "grow" }, [
          h("div", { text: i.enabled ? "Prendido" : "Apagado" }),
          h("div", { class: "muted", text: !i.available ? "No disponible: el agente no pudo hablar con Windows." : i.elevated ? "La ventana del frente es de administrador: Windows no deja escribirle." : "Listo." })
        ]),
        h("button", { class: i.enabled ? "" : "primary", text: i.enabled ? "Apagar" : "Prender", onclick: function () { post("/api/input", { enabled: !i.enabled }); } })
      ]),
      held.length ? h("div", { class: "notice", text: "Tiene apretado: " + held.join(" y ") + "." }) : null,
      h("div", { class: "row" }, [
        h("button", { class: "danger", text: "Soltar todo", onclick: function () { post("/api/input/release", {}); } })
      ])
    ]);
  }

  function autostartCard(s) {
    var a = s.autostart;
    if (!a) return null;
    return h("section", { class: "card" }, [
      h("h2", { text: "Iniciar con Windows" }),
      h("div", { class: "muted", text: "El agente arranca solo al iniciar sesión, sin abrir el panel. Es una entrada del usuario actual: no pide permisos de administrador y apagarlo la borra." }),
      h("div", { class: "row between" }, [
        h("div", { class: "grow", text: a.enabled ? "Prendido" : "Apagado" }),
        h("button", { class: a.enabled ? "" : "primary", text: a.enabled ? "Apagar inicio" : "Prender inicio", onclick: function () { post("/api/autostart", { enabled: !a.enabled }); } })
      ]),
      a.error ? h("div", { class: "error", text: a.error }) : null
    ]);
  }

  var HOTKEY_TEXT = {
    T: "Prender / apagar la tele",
    M: "Abrir el panel",
    "1": "Mandar la ventana activa a la pantalla 1 (de izquierda a derecha)",
    "2": "Mandar la ventana activa a la pantalla 2",
    "3": "Mandar la ventana activa a la pantalla 3",
    "4": "Pantalla completa de la ventana activa (otra vez: vuelve)",
    "5": "Música: anterior",
    "6": "Música: play / pausa",
    "7": "Música: siguiente",
    Esc: "Cortar el control del celu (suelta todo y apaga la llave del Pad)"
  };

  function hotkeysCard(s) {
    var k = s.hotkeys;
    if (!k) return null;
    var tv = k.tv;
    var rows = k.keys.map(function (key) {
      var kids = [
        h("kbd", { text: "Ctrl+Alt+" + key.label }),
        h("span", { class: "grow", text: key.scene ? "Escena “" + key.scene.name + "”" : (HOTKEY_TEXT[key.label] || "") })
      ];
      if (key.label === "T") {
        var select = h("select", {
          "aria-label": "Pantalla de la tele",
          onchange: function (e) {
            var v = e && e.target ? e.target.value : "";
            post("/api/hotkeys/tv", { monitorId: v === "" ? null : v });
          }
        }, [h("option", { value: "", text: "Ninguna" })].concat(tv.options.map(function (o) {
          var attrs = { value: o.id, text: o.name };
          if (tv.monitorId === o.id) attrs.selected = true;
          return h("option", attrs);
        })));
        kids.push(select);
      }
      if (key.status === "busy") kids.push(h("span", { class: "warn", text: "⚠ en uso por otro programa" }));
      else if (key.status === "failed") kids.push(h("span", { class: "warn", text: "⚠ no se pudo registrar" }));
      else if (key.status === "off") kids.push(h("span", { class: "muted", text: "apagado" }));
      return h("li", { class: "row" }, kids);
    });
    return h("section", { class: "card" }, [
      h("h2", { text: "Atajos de teclado" }),
      h("div", { class: "muted", text: "Atajos globales del agente: reemplazan a los del .ahk. Funcionan aunque no haya ningún celu conectado." }),
      h("div", { class: "row between" }, [
        h("div", { class: "grow" }, [
          h("div", { text: k.enabled ? "Prendidos" : "Apagados" }),
          k.enabled ? null : h("div", { class: "muted", text: "Con esto apagado solo funciona Ctrl+Alt+Esc (cortar el control del celu); las demás teclas quedan libres para otros programas." })
        ]),
        h("button", { class: k.enabled ? "" : "primary", text: k.enabled ? "Apagar atajos" : "Prender atajos", onclick: function () { post("/api/hotkeys", { enabled: !k.enabled }); } })
      ]),
      k.available ? null : h("div", { class: "error", text: "No se pudo activar ninguno: el programa auxiliar de teclas no arrancó. El resto del agente anda." }),
      h("ul", {}, rows)
    ]);
  }

  function networkCard(s) {
    var body;
    if (s.addresses.length === 0) {
      body = h("div", { class: "notice", text: "No encontré una red local. Conectá la PC al Wi-Fi o al cable del router." });
    } else {
      var select = h("select", {
        onchange: function (e) {
          var v = e && e.target ? e.target.value : "";
          post("/api/interface", { name: v === "" ? null : v });
        }
      }, [h("option", { value: "", text: "Automática" })].concat(s.addresses.map(function (a) {
        var attrs = { value: a.name, text: a.name + " · " + a.address };
        if (s.selected && s.selected.name === a.name) attrs.selected = true;
        return h("option", attrs);
      })));
      body = h("div", { class: "row" }, [
        select,
        h("span", { class: "muted", text: s.selected ? "En el QR: " + s.selected.address : "" })
      ]);
    }
    return h("section", { class: "card" }, [h("h2", { text: "IP que va en el QR" }), body]);
  }

  function pairingCard(s) {
    var p = s.pairing;
    var canStart = s.remote.enabled && s.selected !== null;
    var kids = [h("h2", { text: "Emparejar un celu" })];
    countdownEl = null;

    if (p.state === "awaiting" && p.pending) {
      var who = p.pending.deviceName + " (" + (PLATFORM[p.pending.platform] || p.pending.platform) + ", " + p.pending.ip + ")";
      kids.push(h("p", { text: "¿Permitir a " + who + "?" }));
      kids.push(h("div", { class: "row" }, [
        h("button", { class: "primary", text: "Permitir", onclick: function () { post("/api/pairing/decision", { allow: true }); } }),
        h("button", { class: "danger", text: "Rechazar", onclick: function () { post("/api/pairing/decision", { allow: false }); } })
      ]));
      countdownEl = h("div", { class: "muted", text: "" });
      kids.push(countdownEl);
    } else if (p.state === "showing" && p.qrSvg) {
      kids.push(h("p", { class: "muted", text: "Escaneá este código con la app del celu." }));
      kids.push(h("img", { class: "qr", alt: "Código QR para emparejar", src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(p.qrSvg) }));
      countdownEl = h("div", { class: "muted", text: "" });
      kids.push(countdownEl);
      kids.push(h("div", { class: "row" }, [h("button", { text: "Generar otro", onclick: function () { post("/api/pairing/start", {}); } })]));
    } else {
      kids.push(h("p", { class: "muted", text: s.remote.enabled ? "Generá un código QR y escanealo desde la app." : "Encendé el acceso remoto para poder emparejar." }));
      kids.push(h("div", { class: "row" }, [
        h("button", { class: "primary", text: "Generar QR", disabled: !canStart, onclick: function () { post("/api/pairing/start", {}); } })
      ]));
    }
    return h("section", { class: p.state === "awaiting" ? "card pending" : "card" }, kids);
  }

  function devicesCard(s) {
    var items = s.devices.map(function (d) {
      return h("li", {}, [
        h("div", { class: "row between" }, [
          h("div", { class: "grow" }, [
            h("div", {}, [
              h("span", { class: d.connected ? "dot ok" : "dot off" }),
              h("strong", { text: d.name }),
              h("span", { class: "muted", text: " · " + (PLATFORM[d.platform] || d.platform) + " · " + (d.connected ? "En línea" : "Desconectado") + " · clave " + d.fingerprint })
            ]),
            h("div", { class: "muted", text: "Emparejado: " + when(d.pairedAt) + " · Última vez: " + when(d.lastSeenAt) })
          ]),
          h("button", {
            class: "danger",
            text: "Revocar",
            onclick: function () {
              if (confirm("¿Quitarle el acceso a " + d.name + "?")) post("/api/devices/" + d.id + "/revoke", {});
            }
          })
        ])
      ]);
    });
    return h("section", { class: "card" }, [
      h("h2", { text: "Celulares emparejados" }),
      items.length ? h("ul", {}, items) : h("div", { class: "muted", text: "Todavía no hay ninguno." })
    ]);
  }

  function render(force) {
    var key = JSON.stringify([status, unauthorized, message]);
    if (!force && key === lastKey) return;
    lastKey = key;

    if (unauthorized) {
      root.replaceChildren(h("div", { class: "card" }, [
        h("h2", { text: "Sillonero" }),
        h("p", { text: "Abrí el panel desde la bandeja de Sillonero (ícono junto al reloj → Abrir panel)." })
      ]));
      document.title = "Sillonero";
      return;
    }
    if (!status) {
      root.replaceChildren(h("p", { class: "muted", text: message || "Cargando…" }));
      return;
    }

    var s = status;
    var awaiting = s.pairing.state === "awaiting";
    document.title = (awaiting ? "(1) Permitir… · " : "") + "Sillonero";

    var children = [
      h("h1", { text: "Sillonero" }),
      h("div", { class: "muted", text: "Panel del agente de la PC" })
    ];
    (s.notices || []).forEach(function (n) {
      if (!NOTICES[n]) return;
      children.push(h("div", { class: "notice", text: NOTICES[n] }));
      if (n === "identity_lost") {
        children.push(h("div", { class: "row" }, [
          h("button", {
            class: "danger",
            text: "Generar clave nueva",
            onclick: function () {
              if (confirm("¿Generar una clave nueva para esta PC? Los celus emparejados dejan de funcionar y hay que emparejarlos de nuevo. El archivo actual se guarda como copia.")) post("/api/identity/reset", {});
            }
          })
        ]));
      }
    });
    if (s.firewallHint) {
      children.push(h("div", { class: "notice", text: "Si el celu no conecta, revisá que la red de Windows sea Privada (Configuración → Red e Internet → Propiedades de la red)." }));
    }
    if (message) children.push(h("div", { class: "error", text: message }));
    children.push(remoteCard(s), networkCard(s), pairingCard(s), devicesCard(s));
    var audio = audioCard(s);
    if (audio) children.push(audio);
    var input = inputCard(s);
    if (input) children.push(input);
    var autostart = autostartCard(s);
    if (autostart) children.push(autostart);
    var hotkeys = hotkeysCard(s);
    if (hotkeys) children.push(hotkeys);
    children.push(h("div", { class: "footer" }, [
      h("button", {
        class: "danger",
        text: "Salir del agente",
        onclick: function () {
          if (confirm("¿Cerrar el agente? El celu dejará de conectarse.")) post("/api/quit", {});
        }
      })
    ]));
    root.replaceChildren.apply(root, children);
    tickCountdown();
  }

  function tickCountdown() {
    if (!countdownEl || !status) return;
    var p = status.pairing;
    if (p.expiresAt === undefined) return;
    countdownEl.textContent = (p.state === "awaiting" ? "Decidí en " : "Vence en ") + remaining(p.expiresAt);
  }

  refresh(true);
  setInterval(function () { refresh(false); }, 1000);
  setInterval(tickCountdown, 1000);
})();
`;
