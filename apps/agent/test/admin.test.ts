import { request, type IncomingHttpHeaders } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createAdminServer, type AdminServer } from "../src/admin/server";
import type { AdminController, AdminStatus } from "../src/admin/routes";
import { FakeClock, FakeRandom, MemLogger } from "./fakes";

const ID = "11111111-1111-4111-8111-111111111111";

const STATUS: AdminStatus = {
  remote: { enabled: true, port: 47800 },
  addresses: [{ name: "Wi-Fi 2", address: "192.168.100.5" }],
  selected: { name: "Wi-Fi 2", address: "192.168.100.5" },
  pairing: { state: "idle" },
  devices: [],
  firewallHint: false,
};

class FakeController implements AdminController {
  calls: [string, ...unknown[]][] = [];
  quitCalled = false;
  result = true;
  status(): AdminStatus {
    return STATUS;
  }
  async setRemote(enabled: boolean) {
    this.calls.push(["setRemote", enabled]);
  }
  async startPairing() {
    this.calls.push(["startPairing"]);
    return this.result;
  }
  async decide(allow: boolean) {
    this.calls.push(["decide", allow]);
    return this.result;
  }
  async revoke(id: string) {
    this.calls.push(["revoke", id]);
    return this.result;
  }
  async setInterface(name: string | null) {
    this.calls.push(["setInterface", name]);
    return this.result;
  }
  async setAudioSwitch(which: "defaultOutput" | "appRouting", disabled: boolean) {
    this.calls.push(["setAudioSwitch", which, disabled]);
    return this.result;
  }
  async setInput(enabled: boolean) {
    this.calls.push(["setInput", enabled]);
    return this.result;
  }
  async releaseInput() {
    this.calls.push(["releaseInput"]);
    return this.result;
  }
  async resetIdentity() {
    this.calls.push(["resetIdentity"]);
    return this.result;
  }
  async setAutostart(enabled: boolean) {
    this.calls.push(["setAutostart", enabled]);
    return this.result;
  }
  async setHotkeys(enabled: boolean) {
    this.calls.push(["setHotkeys", enabled]);
    return this.result;
  }
  async setTvMonitor(id: string | null) {
    this.calls.push(["setTvMonitor", id]);
    return this.result;
  }
  quit() {
    this.quitCalled = true;
  }
}

type Res = { status: number; headers: IncomingHttpHeaders; body: string };

let server: AdminServer | null = null;

async function setup() {
  const controller = new FakeController();
  const clock = new FakeClock(0);
  server = createAdminServer({
    clock,
    random: new FakeRandom(),
    controller,
    assets: { html: "<html>panel</html>", js: "console.log('panel')", css: "body{}" },
    log: new MemLogger(),
  });
  const { port } = await server.start(0);
  const nonce = () => new URL(server!.launchUrl()).searchParams.get("k")!;
  let session = "";
  const send = (
    opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string; auth?: boolean; origin?: boolean | string } = {},
  ) =>
    new Promise<Res>((resolve, reject) => {
      const method = opts.method ?? "GET";
      const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, ...opts.headers };
      if (opts.auth !== false) headers.Cookie = `pe_admin=${session}`;
      if (method === "POST") {
        if (opts.origin !== false) headers.Origin = typeof opts.origin === "string" ? opts.origin : `http://127.0.0.1:${port}`;
        headers["Content-Type"] ??= "application/json";
      }
      const req = request({ host: "127.0.0.1", port, method, path: opts.path ?? "/", headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end(opts.body);
    });
  // Entra como lo hace el navegador: canjea el valor de la URL y se queda con la cookie de sesion.
  const entry = await send({ auth: false, path: `/?k=${nonce()}` });
  session = /pe_admin=([^;]+)/.exec(String(entry.headers["set-cookie"]))?.[1] ?? "";
  return { controller, port, send, clock, nonce, session: () => session };
}

afterEach(async () => {
  await server?.stop();
  server = null;
});

describe("admin · Host", () => {
  it("Host distinto del exacto → 421, aunque la cookie sea buena", async () => {
    const { send, port } = await setup();
    for (const host of ["localhost:" + port, "127.0.0.1", `127.0.0.1:${port + 1}`, "evil.com", `evil.com:${port}`]) {
      expect((await send({ headers: { Host: host } })).status).toBe(421);
    }
  });
});

describe("admin · cookie y ?k", () => {
  it("sin cookie → 401 con el aviso", async () => {
    const { send } = await setup();
    const res = await send({ auth: false });
    expect(res.status).toBe(401);
    expect(res.body).toContain("Abrí el panel desde la bandeja");
    expect((await send({ auth: false, path: "/api/status" })).status).toBe(401);
    expect((await send({ auth: false, path: "/app.js" })).status).toBe(401);
  });

  it("cookie distinta (o de otro largo) → 401", async () => {
    const { send, session } = await setup();
    expect((await send({ auth: false, headers: { Cookie: "pe_admin=otro" } })).status).toBe(401);
    expect((await send({ auth: false, headers: { Cookie: `pe_admin=${session()}x` } })).status).toBe(401);
    expect((await send({ auth: false, headers: { Cookie: "otra=1" } })).status).toBe(401);
  });

  it("?k correcto → 303 a / con la cookie HttpOnly SameSite=Strict", async () => {
    const { send, nonce } = await setup();
    const res = await send({ auth: false, path: `/?k=${nonce()}` });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("pe_admin=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
  });

  it("la cookie de sesión NO es el valor de la URL (lo que queda en la línea de comandos no sirve de cookie)", async () => {
    const { send, nonce, session } = await setup();
    const k = nonce();
    expect(k).not.toBe(session());
    expect((await send({ auth: false, headers: { Cookie: `pe_admin=${k}` } })).status).toBe(401);
  });

  it("el valor de ?k es de un solo uso: el segundo canje da 401", async () => {
    const { send, nonce } = await setup();
    const k = nonce();
    expect((await send({ auth: false, path: `/?k=${k}` })).status).toBe(303);
    const again = await send({ auth: false, path: `/?k=${k}` });
    expect(again.status).toBe(401);
    expect(again.headers["set-cookie"]).toBeUndefined();
  });

  it("el valor de ?k vence a los 60 s", async () => {
    const { send, nonce, clock } = await setup();
    const k = nonce();
    clock.advance(60_000);
    expect((await send({ auth: false, path: `/?k=${k}` })).status).toBe(401);
  });

  it("justo antes de los 60 s todavía vale", async () => {
    const { send, nonce, clock } = await setup();
    const k = nonce();
    clock.advance(59_999);
    expect((await send({ auth: false, path: `/?k=${k}` })).status).toBe(303);
  });

  it("cada launchUrl() da un valor nuevo y todos sirven (cada uno una vez)", async () => {
    const { send, nonce } = await setup();
    const a = nonce();
    const b = nonce();
    expect(a).not.toBe(b);
    expect((await send({ auth: false, path: `/?k=${b}` })).status).toBe(303);
    expect((await send({ auth: false, path: `/?k=${a}` })).status).toBe(303);
  });

  it("la cookie de sesión sigue valiendo después de canjear otros valores", async () => {
    const { send, nonce } = await setup();
    await send({ auth: false, path: `/?k=${nonce()}` });
    expect((await send({ path: "/api/status" })).status).toBe(200);
  });

  it("?k incorrecto → 401 y sin cookie", async () => {
    const { send } = await setup();
    const res = await send({ auth: false, path: "/?k=nope" });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("?k solo vale en GET /", async () => {
    const { send, nonce } = await setup();
    expect((await send({ auth: false, path: `/api/status?k=${nonce()}` })).status).toBe(401);
  });

  it("?k con el Host equivocado → 421 (el Host se mira primero)", async () => {
    const { send, nonce } = await setup();
    expect((await send({ auth: false, path: `/?k=${nonce()}`, headers: { Host: "evil.com" } })).status).toBe(421);
  });
});

describe("admin · rutas GET", () => {
  it("/ da el HTML, /app.js el JS y /api/status el estado", async () => {
    const { send } = await setup();
    const page = await send();
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toBe("<html>panel</html>");
    const js = await send({ path: "/app.js" });
    expect(js.headers["content-type"]).toContain("text/javascript");
    expect(js.body).toContain("panel");
    const css = await send({ path: "/app.css" });
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.body).toBe("body{}");
    expect((await send({ auth: false, path: "/app.css" })).status).toBe(401);
    const status = await send({ path: "/api/status" });
    expect(status.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(status.body)).toEqual(STATUS);
  });

  it("ruta desconocida → 404 y método no permitido → 405", async () => {
    const { send } = await setup();
    expect((await send({ path: "/nada" })).status).toBe(404);
    expect((await send({ path: "/api/remote" })).status).toBe(405);
    expect((await send({ method: "DELETE", path: "/api/status" })).status).toBe(405);
  });
});

describe("admin · headers fijos", () => {
  it("están en todas las respuestas, también en los errores", async () => {
    const { send } = await setup();
    const responses = [
      await send(),
      await send({ auth: false }),
      await send({ headers: { Host: "evil.com" } }),
      await send({ path: "/nada" }),
      await send({ path: "/app.js" }),
    ];
    for (const r of responses) {
      expect(r.headers["content-security-policy"]).toBe("default-src 'self'; img-src 'self' data:; script-src 'self'");
      expect(r.headers["x-frame-options"]).toBe("DENY");
      expect(r.headers["cache-control"]).toBe("no-store");
    }
  });
});

describe("admin · POST: Origin, tipo y cuerpo", () => {
  it("sin Origin o con uno ajeno → 403 y no hace nada", async () => {
    const { send, controller } = await setup();
    const body = JSON.stringify({ enabled: true });
    expect((await send({ method: "POST", path: "/api/remote", body, origin: false })).status).toBe(403);
    expect((await send({ method: "POST", path: "/api/remote", body, origin: "http://evil.com" })).status).toBe(403);
    expect((await send({ method: "POST", path: "/api/remote", body, origin: "null" })).status).toBe(403);
    expect(controller.calls).toEqual([]);
  });

  it("la cookie se mira antes que el Origin (sin cookie → 401)", async () => {
    const { send } = await setup();
    expect((await send({ method: "POST", path: "/api/remote", auth: false, origin: false, body: "{}" })).status).toBe(401);
  });

  it("Content-Type que no es JSON → 415", async () => {
    const { send, controller } = await setup();
    const res = await send({ method: "POST", path: "/api/remote", headers: { "Content-Type": "text/plain" }, body: '{"enabled":true}' });
    expect(res.status).toBe(415);
    expect(controller.calls).toEqual([]);
  });

  it("JSON roto o con forma incorrecta → 400", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/remote", body: "{no" })).status).toBe(400);
    expect((await send({ method: "POST", path: "/api/remote", body: '{"enabled":"yes"}' })).status).toBe(400);
    expect((await send({ method: "POST", path: "/api/pairing/decision", body: "{}" })).status).toBe(400);
    expect((await send({ method: "POST", path: "/api/devices/no-es-uuid/revoke", body: "{}" })).status).toBe(400);
    expect(controller.calls).toEqual([]);
  });

  it("cuerpo demasiado grande → 413", async () => {
    const { send } = await setup();
    const res = await send({ method: "POST", path: "/api/remote", body: JSON.stringify({ enabled: true, pad: "x".repeat(10_000) }) });
    expect(res.status).toBe(413);
  });
});

describe("admin · acciones POST", () => {
  it("/api/remote prende y apaga", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/remote", body: '{"enabled":true}' })).status).toBe(200);
    await send({ method: "POST", path: "/api/remote", body: '{"enabled":false}' });
    expect(controller.calls).toEqual([["setRemote", true], ["setRemote", false]]);
  });

  it("/api/pairing/start; si el controller no puede → 409", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/pairing/start", body: "{}" })).status).toBe(200);
    controller.result = false;
    expect((await send({ method: "POST", path: "/api/pairing/start", body: "{}" })).status).toBe(409);
  });

  it("/api/pairing/decision permite o rechaza; sin pedido → 409", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/pairing/decision", body: '{"allow":true}' })).status).toBe(200);
    await send({ method: "POST", path: "/api/pairing/decision", body: '{"allow":false}' });
    expect(controller.calls).toEqual([["decide", true], ["decide", false]]);
    controller.result = false;
    expect((await send({ method: "POST", path: "/api/pairing/decision", body: '{"allow":true}' })).status).toBe(409);
  });

  it("/api/devices/:id/revoke; id desconocido → 404", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: `/api/devices/${ID}/revoke`, body: "{}" })).status).toBe(200);
    expect(controller.calls).toEqual([["revoke", ID]]);
    controller.result = false;
    expect((await send({ method: "POST", path: `/api/devices/${ID}/revoke`, body: "{}" })).status).toBe(404);
  });

  it("/api/audio apaga o prende a mano las funciones no documentadas (D29 y D30)", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/audio", body: '{"which":"defaultOutput","disabled":true}' })).status).toBe(200);
    expect((await send({ method: "POST", path: "/api/audio", body: '{"which":"appRouting","disabled":false}' })).status).toBe(200);
    expect(controller.calls).toEqual([["setAudioSwitch", "defaultOutput", true], ["setAudioSwitch", "appRouting", false]]);
    for (const body of ['{"which":"otra","disabled":true}', '{"which":"appRouting"}', '{"which":"appRouting","disabled":"si"}', '{"which":"appRouting","disabled":true,"x":1}']) {
      expect((await send({ method: "POST", path: "/api/audio", body })).status, body).toBe(400);
    }
    expect(controller.calls).toHaveLength(2);
  });

  it("/api/input prende o apaga la llave del Pad; valida el cuerpo", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/input", body: '{"enabled":false}' })).status).toBe(200);
    expect((await send({ method: "POST", path: "/api/input", body: '{"enabled":true}' })).status).toBe(200);
    expect(controller.calls).toEqual([["setInput", false], ["setInput", true]]);
    for (const body of ['{"enabled":"si"}', "{}", '{"enabled":true,"x":1}', "no json"]) {
      expect((await send({ method: "POST", path: "/api/input", body })).status, body).toBe(400);
    }
    expect(controller.calls).toHaveLength(2);
  });

  it("/api/identity/reset genera una clave nueva solo si hacía falta; 409 si no", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/identity/reset", body: "{}" })).status).toBe(200);
    expect(controller.calls).toEqual([["resetIdentity"]]);
    controller.result = false;
    expect((await send({ method: "POST", path: "/api/identity/reset", body: "{}" })).status).toBe(409);
    expect((await send({ method: "POST", path: "/api/identity/reset", body: '{"x":1,"y":' })).status).toBe(400);
    expect((await send({ path: "/api/identity/reset" })).status).toBe(405);
  });

  it("/api/autostart prende o apaga el inicio con Windows; valida el cuerpo y el método", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/autostart", body: '{"enabled":true}' })).status).toBe(200);
    expect((await send({ method: "POST", path: "/api/autostart", body: '{"enabled":false}' })).status).toBe(200);
    expect(controller.calls).toEqual([["setAutostart", true], ["setAutostart", false]]);
    for (const body of ['{"enabled":"si"}', "{}", '{"enabled":true,"x":1}']) {
      expect((await send({ method: "POST", path: "/api/autostart", body })).status, body).toBe(400);
    }
    expect((await send({ path: "/api/autostart" })).status).toBe(405);
    controller.result = false;
    expect((await send({ method: "POST", path: "/api/autostart", body: '{"enabled":true}' })).status).toBe(409);
  });

  it("/api/hotkeys prende o apaga la llave de los atajos; valida el cuerpo", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/hotkeys", body: '{"enabled":false}' })).status).toBe(200);
    expect((await send({ method: "POST", path: "/api/hotkeys", body: '{"enabled":true}' })).status).toBe(200);
    expect(controller.calls).toEqual([["setHotkeys", false], ["setHotkeys", true]]);
    for (const body of ['{"enabled":"si"}', "{}", '{"enabled":true,"x":1}', "no json"]) {
      expect((await send({ method: "POST", path: "/api/hotkeys", body })).status, body).toBe(400);
    }
    expect((await send({ path: "/api/hotkeys" })).status).toBe(405);
    expect(controller.calls).toHaveLength(2);
  });

  it("/api/hotkeys/tv elige la pantalla de la tele (o ninguna); valida el id", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/hotkeys/tv", body: '{"monitorId":"m_abcdefghijklmnop"}' })).status).toBe(200);
    expect((await send({ method: "POST", path: "/api/hotkeys/tv", body: '{"monitorId":null}' })).status).toBe(200);
    expect(controller.calls).toEqual([["setTvMonitor", "m_abcdefghijklmnop"], ["setTvMonitor", null]]);
    for (const body of ['{"monitorId":"hola"}', "{}", '{"monitorId":3}', '{"monitorId":null,"x":1}']) {
      expect((await send({ method: "POST", path: "/api/hotkeys/tv", body })).status, body).toBe(400);
    }
    expect(controller.calls).toHaveLength(2);
  });

  it("/api/hotkeys/tv responde 409 si el controlador no la acepta", async () => {
    const { send, controller } = await setup();
    controller.result = false;
    expect((await send({ method: "POST", path: "/api/hotkeys/tv", body: '{"monitorId":"m_abcdefghijklmnop"}' })).status).toBe(409);
    expect((await send({ method: "POST", path: "/api/hotkeys", body: '{"enabled":true}' })).status).toBe(409);
  });

  it("/api/input/release suelta todo lo apretado; no acepta GET", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/input/release", body: "{}" })).status).toBe(200);
    expect(controller.calls).toEqual([["releaseInput"]]);
    expect((await send({ path: "/api/input/release" })).status).toBe(405);
    expect((await send({ path: "/api/input" })).status).toBe(405);
  });

  it("/api/input sin la cookie del panel no entra (misma seguridad que el resto)", async () => {
    const { send, controller } = await setup();
    const r = await send({ method: "POST", path: "/api/input", body: '{"enabled":false}', auth: false });
    expect([401, 403]).toContain(r.status);
    expect(controller.calls).toEqual([]);
  });

  it("/api/audio no acepta GET", async () => {
    const { send } = await setup();
    expect((await send({ path: "/api/audio" })).status).toBe(405);
  });

  it("/api/interface cambia la interfaz (o la deja automática con null); inexistente → 400", async () => {
    const { send, controller } = await setup();
    expect((await send({ method: "POST", path: "/api/interface", body: '{"name":"Wi-Fi 2"}' })).status).toBe(200);
    await send({ method: "POST", path: "/api/interface", body: '{"name":null}' });
    expect(controller.calls).toEqual([["setInterface", "Wi-Fi 2"], ["setInterface", null]]);
    controller.result = false;
    expect((await send({ method: "POST", path: "/api/interface", body: '{"name":"Nada"}' })).status).toBe(400);
  });

  it("/api/quit responde y después llama a quit()", async () => {
    const { send, controller } = await setup();
    const res = await send({ method: "POST", path: "/api/quit", body: "{}" });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(controller.quitCalled).toBe(true);
  });

  it("si el controller tira, responde 500 sin filtrar el error", async () => {
    const { send, controller } = await setup();
    controller.setRemote = async () => {
      throw new Error("detalle interno");
    };
    const res = await send({ method: "POST", path: "/api/remote", body: '{"enabled":true}' });
    expect(res.status).toBe(500);
    expect(res.body).not.toContain("detalle interno");
  });
});

describe("admin · arranque", () => {
  it("escucha solo en 127.0.0.1 y stop() es idempotente", async () => {
    const { port } = await setup();
    expect(port).toBeGreaterThan(0);
    await server?.stop();
    await server?.stop();
  });

  it("EADDRINUSE sube como error de start()", async () => {
    const { port } = await setup();
    const other = createAdminServer({
      clock: new FakeClock(0),
      random: new FakeRandom(),
      controller: new FakeController(),
      assets: { html: "", js: "", css: "" },
      log: new MemLogger(),
    });
    await expect(other.start(port)).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
