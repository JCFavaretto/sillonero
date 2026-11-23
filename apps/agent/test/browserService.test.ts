import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { sanitizeItems, sanitizeTabs } from "../src/browser/sanitize";
import { EXTENSION_ID, EXTENSION_ORIGIN, loadOrCreateToken, prepareExtension } from "../src/browser/install";
import { createBrowserService, type BrowserService } from "../src/browser/service";
import { FakeClock, MemFs, FakeRandom, MemLogger } from "./fakes";

const TOKEN = "t".repeat(32);
const VID = "dQw4w9WgXcQ";
const tab = { id: 1, windowId: 1, title: "Instagram", host: "instagram.com", active: true, audible: false, pinned: false };

describe("el id de la extensión sale de la clave de su manifest", () => {
  it("coincide con EXTENSION_ID (si alguien cambia la clave, esto avisa)", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../extension/manifest.json", import.meta.url), "utf8"));
    const hash = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16);
    const id = [...hash].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join("");
    expect(id).toBe(EXTENSION_ID);
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${id}`);
  });
  // D100 (aprobado por Jay el 15/11/2026): para manejar el video de cualquier página hace falta permiso sobre todos los sitios.
  // Los permisos de API siguen siendo los mínimos; si alguien suma otro, esto avisa.
  it("pide solo los permisos que usa; como sitios, todos (D100)", () => {
    const m = JSON.parse(readFileSync(new URL("../../extension/manifest.json", import.meta.url), "utf8"));
    expect([...m.permissions].sort()).toEqual(["alarms", "bookmarks", "scripting", "sessions", "tabs"]);
    expect(m.host_permissions).toEqual(["<all_urls>"]);
    expect(m.manifest_version).toBe(3);
  });
});

describe("sanitize: lo que llega de la extensión es un dato no confiable", () => {
  it("las pestañas se recortan, se limpian y se validan", () => {
    const out = sanitizeTabs([
      { ...tab, title: "Hola\u0000\n\tmundo  ", host: "WWW.Instagram.COM" },
      { ...tab, id: "no es número" },
      { ...tab, id: 2, title: "x".repeat(500), url: "https://secreto.com/token" },
      null,
      "texto",
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: "Hola mundo", host: "instagram.com" });
    expect(out[1]!.title).toHaveLength(120);
    expect(JSON.stringify(out)).not.toContain("secreto");
    expect(sanitizeTabs("no es una lista")).toEqual([]);
    expect(sanitizeTabs(Array.from({ length: 200 }, (_, i) => ({ ...tab, id: i })))).toHaveLength(60);
  });

  it("los elementos: sin título o con direcciones peligrosas se descartan", () => {
    const out = sanitizeItems([
      { kind: "video", id: VID, title: " Un tema ", subtitle: "Canal", meta: "3:42", current: true, index: 2, listId: "PLabc123" },
      { kind: "video", id: VID, title: "" },
      { kind: "bookmark", id: "9", title: "Malo", url: "javascript:alert(1)" },
      { kind: "bookmark", id: "10", title: "Sin dirección" },
      { kind: "bookmark", id: "11", title: "Bueno", subtitle: "Barra", url: "https://a.com/x" },
      { kind: "raro", id: "1", title: "Tipo desconocido" },
      { kind: "video", id: VID, title: "Lista inválida", listId: "a b;c" },
      { kind: "video", id: VID, title: "Posición absurda", index: -5 },
      42,
    ]);
    expect(out.map((i) => i.title)).toEqual(["Un tema", "Bueno"]);
    expect(out[0]).toEqual({ kind: "video", id: VID, title: "Un tema", subtitle: "Canal", meta: "3:42", current: true, index: 2, listId: "PLabc123" });
    expect(sanitizeItems({ no: "lista" })).toEqual([]);
    expect(sanitizeItems(Array.from({ length: 500 }, () => ({ kind: "video", id: VID, title: "T" })))).toHaveLength(80);
  });
});

describe("loadOrCreateToken y prepareExtension", () => {
  it("el secreto se crea una vez y se conserva", async () => {
    const fs = new MemFs();
    const random = new FakeRandom();
    const a = await loadOrCreateToken(fs, "/data", random);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await loadOrCreateToken(fs, "/data", random)).toBe(a);
  });
  it("un archivo roto o corto se reemplaza", async () => {
    const fs = new MemFs();
    await fs.writeFileAtomic("/data/extension-token.txt", "corto");
    expect(await loadOrCreateToken(fs, "/data", new FakeRandom())).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  const dirs: string[] = [];
  afterEach(() => void dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "pe-ext-"));
    dirs.push(d);
    return d;
  };

  it("copia la extensión real y escribe config.json; volver a correrlo la actualiza sin tocar otros archivos", () => {
    const target = tmp();
    const source = new URL("../../extension/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    writeFileSync(join(target, "nota-de-jay.txt"), "mía");
    expect(prepareExtension({ sourceDirs: ["/no/existe", source], targetDir: target, port: 47802, token: TOKEN })).toBe(true);
    expect(readdirSync(target).sort()).toEqual(["background.js", "config.json", "lib", "manifest.json", "nota-de-jay.txt"]);
    expect(JSON.parse(readFileSync(join(target, "config.json"), "utf8"))).toEqual({ port: 47802, token: TOKEN });
    expect(existsSync(join(target, "lib", "ops.js"))).toBe(true);
    writeFileSync(join(target, "lib", "viejo.js"), "x");
    prepareExtension({ sourceDirs: [source], targetDir: target, port: 47802, token: TOKEN });
    expect(existsSync(join(target, "lib", "viejo.js"))).toBe(false);
    expect(readFileSync(join(target, "nota-de-jay.txt"), "utf8")).toBe("mía");
  });

  it("si no encuentra los archivos de origen, lo dice y no crea nada", () => {
    const target = join(tmp(), "ext");
    expect(prepareExtension({ sourceDirs: ["/no/existe"], targetDir: target, port: 1, token: TOKEN })).toBe(false);
    expect(existsSync(target)).toBe(false);
    mkdirSync(target);
  });
});

// ── El servicio con un WebSocket real en 127.0.0.1 ──
describe("browserService con una extensión de mentira conectada de verdad", () => {
  const open: { svc: BrowserService; clients: WebSocket[] }[] = [];
  afterEach(async () => {
    for (const { svc, clients } of open.splice(0)) {
      clients.forEach((c) => c.terminate());
      await svc.stop();
    }
  });

  async function setup(timeoutMs = 10_000) {
    const clock = new FakeClock();
    const svc = createBrowserService({ clock, log: new MemLogger(), port: 0, token: TOKEN, origin: EXTENSION_ORIGIN, timeoutMs });
    const port = await svc.start();
    const clients: WebSocket[] = [];
    open.push({ svc, clients });
    const connect = (o: { origin?: string; key?: string } = {}) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?k=${o.key ?? TOKEN}`, { origin: o.origin ?? EXTENSION_ORIGIN });
        clients.push(ws);
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
        ws.once("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
      });
    return { svc, clock, connect };
  }
  const next = (ws: WebSocket) => new Promise<Record<string, unknown>>((r) => ws.once("message", (d) => r(JSON.parse(d.toString()))));
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(cond()).toBe(true);
  };

  it("solo deja entrar a la extensión: origen y secreto correctos", async () => {
    const { connect } = await setup();
    await expect(connect({ origin: "https://sitio-malo.com" })).rejects.toThrow("403");
    await expect(connect({ origin: "chrome-extension://otraextensionotraextensionotra" })).rejects.toThrow("403");
    await expect(connect({ key: "x".repeat(32) })).rejects.toThrow("401");
    await expect(connect({ key: "" })).rejects.toThrow("401");
    await expect(connect()).resolves.toBeDefined();
  });

  it("sin extensión: el estado dice desconectado y los pedidos fallan claro", async () => {
    const { svc } = await setup();
    expect(svc.state()).toEqual({ connected: false, browser: null, tabs: [] });
    expect(await svc.act({ op: "tab.reload", tabId: 1 })).toEqual({ ok: false, reason: "unsupported" });
    expect(await svc.query({ kind: "bookmarks" })).toEqual({ ok: false, reason: "no_extension" });
  });

  it("al conectarse publica el navegador y las pestañas (saneadas) y avisa a quien escucha", async () => {
    const { svc, connect } = await setup();
    const seen: unknown[] = [];
    svc.subscribe((s) => seen.push(s));
    const ws = await connect();
    ws.send(JSON.stringify({ t: "hello", browser: "Chrome!!", version: "0.1.0" }));
    ws.send(JSON.stringify({ t: "tabs", tabs: [tab, { ...tab, id: "malo" }] }));
    await until(() => svc.state().tabs.length === 1);
    expect(svc.state()).toEqual({ connected: true, browser: "chrome", tabs: [tab] });
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it("un pedido viaja a la extensión con su id y vuelve la respuesta", async () => {
    const { svc, connect } = await setup();
    const ws = await connect();
    ws.send(JSON.stringify({ t: "hello", browser: "chrome" }));
    await until(() => svc.state().connected);
    const asked = next(ws);
    const answer = svc.query({ kind: "yt.search", text: "lofi" });
    const req = await asked;
    expect(req).toMatchObject({ t: "req", cmd: "query", body: { kind: "yt.search", text: "lofi" } });
    ws.send(JSON.stringify({ t: "res", id: req.id, ok: true, data: [{ kind: "video", id: VID, title: "Tema" }, { kind: "video", id: "mal", title: "Roto" }] }));
    expect(await answer).toEqual({ ok: true, items: [{ kind: "video", id: VID, title: "Tema" }] });
  });

  it("una acción: ok se pasa tal cual; si la extensión falla, falla", async () => {
    const { svc, connect } = await setup();
    const ws = await connect();
    ws.send(JSON.stringify({ t: "hello", browser: "chrome" }));
    await until(() => svc.state().connected);
    for (const [reply, expected] of [[{ ok: true }, { ok: true }], [{ ok: false, error: "unreadable" }, { ok: false, reason: "failed" }]] as const) {
      const asked = next(ws);
      const result = svc.act({ op: "tab.close", tabId: 3 });
      const req = await asked;
      ws.send(JSON.stringify({ t: "res", id: req.id, ...reply }));
      expect(await result).toEqual(expected);
    }
  });

  it("si la extensión no contesta a tiempo, el pedido termina con timeout (no queda colgado)", async () => {
    const { svc, connect, clock } = await setup(5_000);
    const ws = await connect();
    ws.send(JSON.stringify({ t: "hello", browser: "chrome" }));
    await until(() => svc.state().connected);
    const asked = next(ws);
    const answer = svc.query({ kind: "yt.lists" });
    await asked;
    clock.advance(5_001);
    expect(await answer).toEqual({ ok: false, reason: "timeout" });
  });

  it("al cerrarse la extensión, el estado vuelve a desconectado y lo que esperaba falla", async () => {
    const { svc, connect } = await setup();
    const ws = await connect();
    ws.send(JSON.stringify({ t: "tabs", tabs: [tab] }));
    await until(() => svc.state().tabs.length === 1);
    const asked = next(ws);
    const answer = svc.query({ kind: "bookmarks" });
    await asked;
    ws.close();
    expect(await answer).toEqual({ ok: false, reason: "no_extension" });
    await until(() => !svc.state().connected);
    expect(svc.state().tabs).toEqual([]);
  });

  it("una conexión nueva reemplaza a la vieja (por ejemplo al recargar la extensión)", async () => {
    const { svc, connect } = await setup();
    const first = await connect();
    first.send(JSON.stringify({ t: "hello", browser: "chrome" }));
    await until(() => svc.state().connected);
    const closed = new Promise<number>((r) => first.once("close", (code) => r(code)));
    const second = await connect();
    expect(await closed).toBe(4000);
    second.send(JSON.stringify({ t: "tabs", tabs: [tab] }));
    await until(() => svc.state().tabs.length === 1);
    expect(svc.state().connected).toBe(true);
  });

  it("responde al latido, ignora basura y respuestas de pedidos que no existen", async () => {
    const { svc, connect } = await setup();
    const ws = await connect();
    const pong = next(ws);
    ws.send(JSON.stringify({ t: "ping" }));
    expect(await pong).toEqual({ t: "pong" });
    ws.send("no es json");
    ws.send(JSON.stringify({ t: "res", id: 999, ok: true }));
    ws.send(JSON.stringify(["no", "objeto"]));
    ws.send(JSON.stringify({ t: "tabs", tabs: [tab] }));
    await until(() => svc.state().tabs.length === 1);
  });
});
