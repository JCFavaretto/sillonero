import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Clock, Logger, Random } from "../ports";
import { safeEqual } from "../pairing/tokens";
import { matchApi, type AdminController } from "./routes";

export interface AdminAssets {
  html: string;
  js: string;
  /** La CSP no permite estilos inline: van en `GET /app.css`. */
  css: string;
}

export interface AdminServerDeps {
  clock: Clock;
  random: Random;
  controller: AdminController;
  assets: AdminAssets;
  log: Logger;
}

export interface AdminServer {
  /** Escucha en 127.0.0.1. Rechaza con el error de `listen` (EADDRINUSE = ya hay otra instancia). */
  start(port: number): Promise<{ port: number }>;
  /** Idempotente. */
  stop(): Promise<void>;
  /**
   * URL para abrir el panel en el navegador. El `?k=` es de un solo uso y vence a los 60 s: se
   * canjea por una cookie de sesión distinta, así lo que quede en la línea de comandos o en el
   * historial del navegador no sirve de nada. Cada llamada emite uno nuevo.
   */
  launchUrl(): string;
}

const COOKIE_NAME = "pe_admin";
const MAX_BODY_BYTES = 4_096;
const LAUNCH_TTL_MS = 60_000;
const UNAUTHORIZED = "Abrí el panel desde la bandeja de Sillonero.";

const FIXED_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; script-src 'self'",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
} as const;

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Lee el cuerpo con tope; si se pasa sigue consumiendo (sin guardar) para poder responder 413. */
function readBody(req: IncomingMessage): Promise<{ text: string; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), tooLarge }));
    req.on("error", reject);
  });
}

/**
 * Panel local (docs/PLAN.md 5.5). Middleware, en orden: Host exacto → 421;
 * cookie con el secreto → 401; en POST, Origin exacto → 403 y JSON → 415.
 */
export function createAdminServer(deps: AdminServerDeps): AdminServer {
  const { controller, assets, log, clock, random } = deps;
  // Cookie de sesión: se genera al crear el servidor y solo sale por Set-Cookie al canjear un `?k=`.
  const sessionSecret = Buffer.from(random.bytes(32)).toString("base64url");
  const launchTokens = new Map<string, number>(); // valor de ?k → vencimiento (epoch ms)
  let server: Server | null = null;
  let expectedHost = "";
  let expectedOrigin = "";

  function reply(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, { ...FIXED_HEADERS, "Content-Type": type, ...extra });
    res.end(body);
  }
  const text = (res: ServerResponse, status: number, body: string) =>
    reply(res, status, "text/plain; charset=utf-8", body);
  const json = (res: ServerResponse, status: number, body: unknown) =>
    reply(res, status, "application/json; charset=utf-8", JSON.stringify(body));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.host !== expectedHost) return text(res, 421, "Host no permitido");

    const url = new URL(req.url ?? "/", `http://${expectedHost}`);
    const method = req.method ?? "GET";

    // Entrada desde la bandeja: el secreto pasa a cookie y sale de la barra de direcciones.
    if (method === "GET" && url.pathname === "/" && url.searchParams.has("k")) {
      const given = url.searchParams.get("k") ?? "";
      const expiresAt = launchTokens.get(given);
      launchTokens.delete(given); // de un solo uso, sirva o no
      if (expiresAt === undefined || clock.now() >= expiresAt) return text(res, 401, UNAUTHORIZED);
      return reply(res, 303, "text/plain; charset=utf-8", "", {
        Location: "/",
        "Set-Cookie": `${COOKIE_NAME}=${sessionSecret}; HttpOnly; SameSite=Strict; Path=/`,
      });
    }

    const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
    if (cookie === null || !safeEqual(cookie, sessionSecret)) return text(res, 401, UNAUTHORIZED);

    const isStatic = url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/app.css";
    const api = isStatic ? null : matchApi(method, url.pathname);
    if (!isStatic && api?.kind === "none") return text(res, 404, "No encontrado");
    if ((isStatic && method !== "GET") || api?.kind === "wrong_method") return text(res, 405, "Método no permitido");

    if (method === "GET" && isStatic) {
      if (url.pathname === "/") return reply(res, 200, "text/html; charset=utf-8", assets.html);
      if (url.pathname === "/app.css") return reply(res, 200, "text/css; charset=utf-8", assets.css);
      return reply(res, 200, "text/javascript; charset=utf-8", assets.js);
    }
    if (api?.kind !== "match") return text(res, 405, "Método no permitido");

    let body: unknown;
    if (method === "POST") {
      if (req.headers.origin !== expectedOrigin) return text(res, 403, "Origin no permitido");
      if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return text(res, 415, "Se espera application/json");
      }
      const raw = await readBody(req);
      if (raw.tooLarge) return text(res, 413, "Cuerpo demasiado grande");
      try {
        body = raw.text.trim() === "" ? {} : JSON.parse(raw.text);
      } catch {
        return json(res, 400, { ok: false, error: "JSON inválido" });
      }
    }

    const result = await api.run(controller, body);
    json(res, result.status, result.json);
    if (result.after) res.once("finish", result.after);
  }

  return {
    start(port) {
      if (server) return Promise.reject(new Error("admin server already running"));
      return new Promise((resolve, reject) => {
        const s = createServer((req, res) => {
          handle(req, res).catch((err: unknown) => {
            log.error("admin request failed", { error: String(err) });
            if (!res.headersSent) text(res, 500, "Error interno");
            else res.end();
          });
        });
        s.once("error", reject);
        s.listen(port, "127.0.0.1", () => {
          s.off("error", reject);
          s.on("error", (err) => log.error("admin server error", { error: String(err) }));
          const address = s.address();
          const actual = typeof address === "object" && address ? address.port : port;
          expectedHost = `127.0.0.1:${actual}`;
          expectedOrigin = `http://${expectedHost}`;
          server = s;
          log.info("admin server listening", { port: actual });
          resolve({ port: actual });
        });
      });
    },

    launchUrl() {
      if (!server) throw new Error("admin server is not running");
      const now = clock.now();
      for (const [token, expiresAt] of launchTokens) if (now >= expiresAt) launchTokens.delete(token);
      const token = Buffer.from(random.bytes(32)).toString("base64url");
      launchTokens.set(token, now + LAUNCH_TTL_MS);
      return `http://${expectedHost}/?k=${token}`;
    },

    async stop() {
      const s = server;
      if (!s) return;
      server = null;
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections();
      });
    },
  };
}
