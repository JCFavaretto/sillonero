import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { BrowserFailure, BrowserItem, BrowserOp, BrowserQuery, BrowserState, CommandError } from "@proyecto-e/protocol";
import type { Clock, Logger, TimerHandle } from "../ports";
import { comparableTabs, sanitizeItems, sanitizeTabs } from "./sanitize";

// El puente con la extensión del navegador (docs/PLAN.md D88 a D91). Escucha SOLO en 127.0.0.1 y solo deja pasar a la extensión
// de Sillonero: el origen tiene que ser el de ella y el secreto el que el agente escribió en la carpeta de la extensión.

export type BrowserOutcome = { ok: true } | { ok: false; reason: CommandError };
export type BrowserQueryOutcome = { ok: true; items: BrowserItem[] } | { ok: false; reason: BrowserFailure };

export interface BrowserService {
  state(): BrowserState;
  subscribe(cb: (state: BrowserState) => void): () => void;
  act(op: BrowserOp): Promise<BrowserOutcome>;
  query(q: BrowserQuery): Promise<BrowserQueryOutcome>;
  /** Empieza a escuchar. Devuelve el puerto real (útil con el puerto 0 de los tests). */
  start(): Promise<number>;
  stop(): Promise<void>;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PAYLOAD = 512 * 1024;
/** Código con el que se cierra una conexión vieja cuando llega una nueva. */
const CLOSE_REPLACED = 4000;

const emptyState = (): BrowserState => ({ connected: false, browser: null, tabs: [] });

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createBrowserService(deps: { clock: Clock; log: Logger; port: number; token: string; origin: string; timeoutMs?: number }): BrowserService {
  const { clock, log, token, origin } = deps;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let current: BrowserState = emptyState();
  let socket: WebSocket | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve: (r: { ok: boolean; data?: unknown; error?: string }) => void; timer: TimerHandle }>();
  const listeners = new Set<(s: BrowserState) => void>();
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;

  /** Con qué se comparó la posición del reproductor de cada pestaña la última vez (ver `comparableTabs`). */
  let mediaKeys = new Map<number, number>();
  const comparable = (s: BrowserState) => {
    const tabs = comparableTabs(s.tabs, clock.now(), mediaKeys);
    return { json: JSON.stringify([s.connected, s.browser]) + tabs.json, keys: tabs.keys };
  };
  let lastJson = comparable(current).json;

  /** Guarda el estado (siempre: así la posición queda fresca) y avisa solo si cambió algo más que el avance normal (D99). */
  const publish = (next: BrowserState) => {
    const cmp = comparable(next);
    mediaKeys = cmp.keys;
    current = next;
    if (cmp.json === lastJson) return;
    lastJson = cmp.json;
    for (const cb of listeners) cb(current);
  };

  function failPending() {
    for (const [, p] of pending) {
      clock.clear(p.timer);
      p.resolve({ ok: false, error: "no_extension" });
    }
    pending.clear();
  }

  /** Manda un pedido a la extensión y espera su respuesta (o el plazo). */
  function request(cmd: "act" | "query", body: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const ws = socket;
    if (!ws || ws.readyState !== ws.OPEN) return Promise.resolve({ ok: false, error: "no_extension" });
    const id = ++seq;
    return new Promise((resolve) => {
      const timer = clock.setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: "timeout" });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      ws.send(JSON.stringify({ t: "req", id, cmd, body }));
    });
  }

  function onMessage(ws: WebSocket, raw: string) {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as Record<string, unknown>;
    switch (m.t) {
      case "hello": {
        const name = typeof m.browser === "string" ? m.browser.replace(/[^a-z]/gi, "").toLowerCase().slice(0, 20) : "";
        log.info("browser extension connected", { browser: name });
        publish({ connected: true, browser: name || "chrome", tabs: current.tabs });
        return;
      }
      case "tabs":
        publish({ ...current, connected: true, tabs: sanitizeTabs(m.tabs) });
        return;
      case "ping":
        ws.send(JSON.stringify({ t: "pong" }));
        return;
      case "res": {
        if (typeof m.id !== "number") return;
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clock.clear(p.timer);
        p.resolve({ ok: m.ok === true, data: m.data, error: typeof m.error === "string" ? m.error : undefined });
        return;
      }
      default:
        return;
    }
  }

  return {
    state: () => current,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },

    async act(op) {
      const r = await request("act", op);
      if (r.ok) return { ok: true };
      return { ok: false, reason: r.error === "no_extension" ? "unsupported" : "failed" };
    },

    async query(q) {
      const r = await request("query", q);
      if (!r.ok) {
        const reason: BrowserFailure = r.error === "no_extension" ? "no_extension" : r.error === "timeout" ? "timeout" : r.error === "unreadable" ? "unreadable" : "failed";
        return { ok: false, reason };
      }
      return { ok: true, items: sanitizeItems(r.data) };
    },

    start() {
      return new Promise<number>((resolve, reject) => {
        const http = createServer((_req, res) => {
          res.writeHead(404).end(); // esto no es una página: solo acepta la conexión de la extensión
        });
        const ws = new WebSocketServer({
          server: http,
          maxPayload: MAX_PAYLOAD,
          verifyClient: (info, done) => {
            const url = new URL(info.req.url ?? "/", "http://127.0.0.1");
            const key = url.searchParams.get("k") ?? "";
            if (info.origin !== origin) return done(false, 403, "origen no permitido");
            if (!sameToken(key, token)) return done(false, 401, "secreto incorrecto");
            done(true);
          },
        });
        ws.on("connection", (client) => {
          // Una sola extensión a la vez: la conexión nueva reemplaza a la vieja (por ejemplo al recargar la extensión).
          if (socket && socket !== client) {
            const old = socket;
            socket = null;
            failPending();
            old.close(CLOSE_REPLACED, "reemplazada");
          }
          socket = client;
          client.on("message", (data) => onMessage(client, data.toString()));
          client.on("close", () => {
            if (socket !== client) return;
            socket = null;
            failPending();
            publish(emptyState());
          });
          client.on("error", (err) => log.warn("browser extension socket error", { error: String(err) }));
        });
        http.once("error", reject);
        http.listen(deps.port, "127.0.0.1", () => {
          server = http;
          wss = ws;
          const addr = http.address();
          resolve(typeof addr === "object" && addr ? addr.port : deps.port);
        });
      });
    },

    async stop() {
      failPending();
      socket?.close();
      socket = null;
      await new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve()));
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      server = null;
      wss = null;
      publish(emptyState());
    },
  };
}
