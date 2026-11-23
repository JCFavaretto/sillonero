import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import type { AdminStatus } from "../src/admin/routes";
import { PAGE_CSS, PAGE_HTML, PAGE_JS } from "../src/admin/page";

// ── DOM falso mínimo, suficiente para correr app.js ─────────────────────────
class FakeNode {
  className = "";
  textContent = "";
  value = "";
  children: FakeNode[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, (e?: unknown) => void>();
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  addEventListener(name: string, fn: (e?: unknown) => void) {
    this.listeners.set(name, fn);
  }
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = nodes;
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
  text(): string {
    return this.all()
      .map((n) => n.textContent)
      .join(" | ");
  }
  click() {
    this.listeners.get("click")?.();
  }
}

const IDLE: AdminStatus = {
  remote: { enabled: true, port: 47800 },
  addresses: [{ name: "Wi-Fi 2", address: "192.168.100.5" }],
  selected: { name: "Wi-Fi 2", address: "192.168.100.5" },
  pairing: { state: "idle" },
  devices: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Pixel de Jay",
      platform: "android",
      pairedAt: "2026-11-06T12:00:00.000Z",
      lastSeenAt: null,
      connected: true,
      fingerprint: "AbCdEfGh",
    },
  ],
  firewallHint: false,
};

type Init = { method?: string; body?: string };

async function run(status: AdminStatus | 401, opts: { confirm?: boolean } = {}) {
  const root = new FakeNode("main");
  const doc = { title: "", getElementById: () => root, createElement: (t: string) => new FakeNode(t) };
  const requests: { url: string; init?: Init }[] = [];
  const fetchStub = async (url: string, init?: Init) => {
    requests.push({ url, init });
    if (status === 401) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (init?.method === "POST" ? { ok: true } : status) };
  };
  const timers: (() => void)[] = [];
  runInNewContext(PAGE_JS, {
    document: doc,
    fetch: fetchStub,
    setInterval: (fn: () => void) => timers.push(fn),
    confirm: () => opts.confirm ?? true,
    encodeURIComponent,
    JSON,
    Date,
    Math,
    Object,
    String,
  });
  await settle();
  return { root, doc, requests, timers };
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
};
const button = (root: FakeNode, label: string) =>
  root.all().find((n) => n.tag === "button" && n.textContent === label);
const posts = (requests: { url: string; init?: Init }[]) => requests.filter((r) => r.init?.method === "POST");

describe("página del panel · archivos", () => {
  it("el HTML no tiene scripts ni estilos inline (la CSP los bloquea)", () => {
    expect(PAGE_HTML).toContain('<script src="/app.js"></script>');
    expect(PAGE_HTML).toContain('href="/app.css"');
    expect(PAGE_HTML).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(PAGE_HTML).not.toMatch(/<style/i);
    expect(PAGE_HTML).not.toMatch(/\sstyle=/i);
    expect(PAGE_HTML).not.toMatch(/\son\w+=/i);
    expect(PAGE_HTML).toContain('lang="es"');
  });

  it("el JS compila, no usa innerHTML y el CSS no está vacío", () => {
    expect(() => new Script(PAGE_JS)).not.toThrow();
    expect(PAGE_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(PAGE_CSS.length).toBeGreaterThan(200);
  });
});

describe("página del panel · comportamiento", () => {
  it("sin sesión (401) muestra el aviso de abrir desde la bandeja", async () => {
    const { root } = await run(401);
    expect(root.text()).toContain("Abrí el panel desde la bandeja");
  });

  it("estado normal: red, celulares emparejados y botón para generar el QR", async () => {
    const { root } = await run(IDLE);
    const t = root.text();
    expect(t).toContain("192.168.100.5");
    expect(t).toContain("Pixel de Jay");
    expect(t).toContain("En línea");
    expect(button(root, "Generar QR")).toBeDefined();
    expect(button(root, "Revocar")).toBeDefined();
  });

  it("sin red local avisa y no deja emparejar", async () => {
    const { root } = await run({ ...IDLE, addresses: [], selected: null });
    expect(root.text()).toContain("No encontré una red local");
    expect(button(root, "Generar QR")?.attrs.has("disabled")).toBe(true);
  });

  it("con el remoto apagado el botón de QR está deshabilitado", async () => {
    const { root } = await run({ ...IDLE, remote: { enabled: false, port: 47800 } });
    expect(button(root, "Generar QR")?.attrs.has("disabled")).toBe(true);
  });

  it("mostrando el código: dibuja el QR como imagen data: y la cuenta regresiva", async () => {
    const { root } = await run({
      ...IDLE,
      pairing: { state: "showing", qrSvg: "<svg xmlns='http://www.w3.org/2000/svg'/>", expiresAt: Date.now() + 90_000 },
    });
    const img = root.all().find((n) => n.tag === "img");
    expect(img?.attrs.get("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(root.text()).toMatch(/Vence en \d:\d\d/);
  });

  it("pedido pendiente: muestra el nombre como texto, cambia el título y permite", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { root, doc, requests } = await run({
      ...IDLE,
      pairing: {
        state: "awaiting",
        pending: { deviceName: evil, platform: "android", ip: "192.168.1.9" },
        expiresAt: Date.now() + 60_000,
      },
    });
    expect(root.text()).toContain(evil); // como texto, no como HTML
    expect(root.all().some((n) => n.tag === "img")).toBe(false);
    expect(doc.title).toContain("(1)");
    button(root, "Permitir")?.click();
    await settle();
    const post = posts(requests)[0];
    expect(post?.url).toBe("/api/pairing/decision");
    expect(JSON.parse(post?.init?.body ?? "{}")).toEqual({ allow: true });
  });

  it("Rechazar manda allow:false", async () => {
    const { root, requests } = await run({
      ...IDLE,
      pairing: {
        state: "awaiting",
        pending: { deviceName: "X", platform: "ios", ip: "192.168.1.9" },
        expiresAt: Date.now() + 1000,
      },
    });
    button(root, "Rechazar")?.click();
    await settle();
    expect(JSON.parse(posts(requests)[0]?.init?.body ?? "{}")).toEqual({ allow: false });
  });

  it("Revocar pide confirmación y solo después manda el POST", async () => {
    const no = await run(IDLE, { confirm: false });
    button(no.root, "Revocar")?.click();
    await settle();
    expect(posts(no.requests)).toHaveLength(0);

    const yes = await run(IDLE, { confirm: true });
    button(yes.root, "Revocar")?.click();
    await settle();
    expect(posts(yes.requests)[0]?.url).toBe("/api/devices/11111111-1111-4111-8111-111111111111/revoke");
  });

  it("Generar QR y el interruptor del remoto llaman a su ruta", async () => {
    const { root, requests } = await run(IDLE);
    button(root, "Generar QR")?.click();
    await settle();
    button(root, "Apagar")?.click();
    await settle();
    const p = posts(requests);
    expect(p.map((x) => x.url)).toEqual(["/api/pairing/start", "/api/remote"]);
    expect(JSON.parse(p[1]?.init?.body ?? "{}")).toEqual({ enabled: false });
  });

  it("Salir pide confirmación y llama a /api/quit", async () => {
    const { root, requests } = await run(IDLE);
    button(root, "Salir del agente")?.click();
    await settle();
    expect(posts(requests)[0]?.url).toBe("/api/quit");
  });

  it("avisos: firewall, bandeja y config", async () => {
    const { root } = await run({
      ...IDLE,
      firewallHint: true,
      notices: ["tray_failed", "config_newer", "config_recovered"],
    });
    const t = root.text();
    expect(t).toContain("red de Windows sea Privada");
    expect(t).toContain("bandeja");
    expect(t).toContain("más nueva");
    expect(t).toContain("copia");
  });

  it("error del remoto visible", async () => {
    const { root } = await run({
      ...IDLE,
      remote: { enabled: false, port: 47800, error: "El puerto 47800 está ocupado" },
    });
    expect(root.text()).toContain("El puerto 47800 está ocupado");
  });

  it("vuelve a consultar el estado cada segundo", async () => {
    const { timers } = await run(IDLE);
    expect(timers.length).toBeGreaterThan(0);
  });
});

describe("página del panel · atajos (B6.1)", () => {
  const HOTKEYS: NonNullable<AdminStatus["hotkeys"]> = {
    available: true,
    enabled: true,
    keys: [
      { id: 1, label: "T", status: "active" },
      { id: 2, label: "M", status: "busy" },
      { id: 10, label: "Esc", status: "active" },
    ],
    tv: { monitorId: null, options: [{ id: "m_abcdefghijklmnop", name: "Samsung TV" }] },
  };

  it("sin atajos en esta PC no hay tarjeta", async () => {
    const { root } = await run(IDLE);
    expect(root.text()).not.toContain("Atajos de teclado");
  });

  it("muestra la tarjeta con cada tecla, marca las ocupadas con ⚠ y ofrece la lista de pantallas para la tele", async () => {
    const { root } = await run({ ...IDLE, hotkeys: HOTKEYS });
    const t = root.text();
    expect(t).toContain("Atajos de teclado");
    expect(t).toContain("Ctrl+Alt+T");
    expect(t).toContain("⚠");
    expect(t).toContain("Samsung TV");
    expect(t).toContain("Ctrl+Alt+Esc");
  });

  it("el interruptor manda la llave opuesta a /api/hotkeys", async () => {
    const { root, requests } = await run({ ...IDLE, hotkeys: HOTKEYS });
    button(root, "Apagar atajos")!.click();
    await settle();
    expect(posts(requests).at(-1)).toMatchObject({ url: "/api/hotkeys", init: { body: JSON.stringify({ enabled: false }) } });
  });

  it("elegir la tele manda el id a /api/hotkeys/tv y 'Ninguna' manda null", async () => {
    const { root, requests } = await run({ ...IDLE, hotkeys: HOTKEYS });
    const select = root.all().find((n) => n.tag === "select" && n.attrs.get("aria-label") === "Pantalla de la tele")!;
    select.listeners.get("change")!({ target: { value: "m_abcdefghijklmnop" } });
    await settle();
    expect(posts(requests).at(-1)).toMatchObject({ url: "/api/hotkeys/tv", init: { body: JSON.stringify({ monitorId: "m_abcdefghijklmnop" }) } });
    select.listeners.get("change")!({ target: { value: "" } });
    await settle();
    expect(posts(requests).at(-1)).toMatchObject({ url: "/api/hotkeys/tv", init: { body: JSON.stringify({ monitorId: null }) } });
  });

  it("con la llave apagada lo dice y ofrece prenderla", async () => {
    const { root } = await run({ ...IDLE, hotkeys: { ...HOTKEYS, enabled: false, keys: HOTKEYS.keys.map((k) => (k.label === "Esc" ? k : { ...k, status: "off" as const })) } });
    expect(root.text()).toContain("Apagados");
    expect(button(root, "Prender atajos")).toBeDefined();
  });

  it("si el hijo no arrancó lo dice", async () => {
    const { root } = await run({ ...IDLE, hotkeys: { ...HOTKEYS, available: false } });
    expect(root.text()).toContain("no arrancó");
  });

  it("lista cada escena con su tecla y marca la ocupada (B6.3)", async () => {
    const { root } = await run({
      ...IDLE,
      hotkeys: {
        available: true,
        enabled: true,
        keys: [
          { id: 109, label: "J", status: "active", scene: { id: "s_AAAAAAAAAA", name: "Juego" } },
          { id: 110, label: "K", status: "busy", scene: { id: "s_BBBBBBBBBB", name: "Trabajo" } },
        ],
        tv: { monitorId: null, options: [] },
      },
    });
    const t = root.text();
    expect(t).toContain("Ctrl+Alt+J");
    expect(t).toContain("Escena “Juego”");
    expect(t).toContain("Ctrl+Alt+K");
    expect(t).toContain("en uso por otro programa");
  });
});

describe("página del panel · iniciar con Windows (B6.2)", () => {
  it("sin soporte en esta PC no hay tarjeta", async () => {
    const { root } = await run(IDLE);
    expect(root.text()).not.toContain("Iniciar con Windows");
  });

  it("apagado: ofrece prenderlo y manda enabled:true", async () => {
    const { root, requests } = await run({ ...IDLE, autostart: { enabled: false } });
    expect(root.text()).toContain("Iniciar con Windows");
    button(root, "Prender inicio")!.click();
    await settle();
    expect(posts(requests).at(-1)).toMatchObject({ url: "/api/autostart", init: { body: JSON.stringify({ enabled: true }) } });
  });

  it("prendido: ofrece apagarlo", async () => {
    const { root, requests } = await run({ ...IDLE, autostart: { enabled: true } });
    expect(root.text()).toContain("Prendido");
    button(root, "Apagar inicio")!.click();
    await settle();
    expect(posts(requests).at(-1)).toMatchObject({ url: "/api/autostart", init: { body: JSON.stringify({ enabled: false }) } });
  });

  it("con error lo muestra", async () => {
    const { root } = await run({ ...IDLE, autostart: { enabled: false, error: "No se pudo escribir la entrada de inicio: Acceso denegado" } });
    expect(root.text()).toContain("No se pudo escribir la entrada de inicio");
  });
});

describe("página del panel · clave perdida (B6.4)", () => {
  it("el aviso explica qué pasó y el botón pide confirmación antes de generar la clave nueva", async () => {
    const { root, requests } = await run({ ...IDLE, notices: ["identity_lost"] }, { confirm: false });
    expect(root.text()).toContain("otra cuenta de Windows");
    button(root, "Generar clave nueva")!.click();
    await settle();
    expect(posts(requests)).toHaveLength(0); // dijo que no
    const yes = await run({ ...IDLE, notices: ["identity_lost"] }, { confirm: true });
    button(yes.root, "Generar clave nueva")!.click();
    await settle();
    expect(posts(yes.requests).at(-1)).toMatchObject({ url: "/api/identity/reset" });
  });

  it("sin el aviso no hay botón", async () => {
    const { root } = await run(IDLE);
    expect(button(root, "Generar clave nueva")).toBeUndefined();
  });
});
