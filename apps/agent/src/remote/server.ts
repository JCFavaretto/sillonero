import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { MAX_CLIENT_FRAME_BYTES, PING_INTERVAL_MS, normalizeIp, type KeyPair, type ScreensState } from "@proyecto-e/protocol";
import type { Device } from "../config/schema";
import { originAllowed } from "../net/originAllowed";
import type { Pairing } from "../pairing/pairing";
import type { Clock, Logger, TimerHandle } from "../ports";
import type { RateLimiter } from "../security/rateLimit";
import type { Extras } from "../apps/extras";
import type { PadService } from "../input/service";
import type { ScreensService } from "../screens/service";
import type { Sampler } from "../state/system";
import { createThrottledLogger } from "../log";
import { createBroadcaster } from "./broadcaster";
import { createSession, type Conn, type DeviceLookup, type Session, type SessionDeps } from "./session";

export interface RemoteServerDeps {
  clock: Clock;
  log: Logger;
  sampler: Sampler;
  /** Pantallas y ventana activa para los celus conectados (R2). */
  screens?: ScreensService;
  /** B3: ventanas, lanzadores, escenas e Inicio. */
  extras?: Extras;
  /** B5: mouse y teclado del Pad. */
  pad?: PadService;
  pairing: Pairing;
  limiter: RateLimiter;
  /** Par de claves de la PC: con la privada se responde el handshake de Noise. */
  identity(): KeyPair;
  /** Azar para las claves efímeras del handshake. */
  random: (n: number) => Uint8Array;
  /** Busca un dispositivo por su clave pública (base64url). */
  lookupDevice(publicKey: string): DeviceLookup;
  /** "Olvidar" desde el celu: borra el dispositivo. */
  unpair(deviceId: string): Promise<void>;
  /** Comandos de pantallas (apodos…). Sin esto el celu recibe `unsupported`. */
  runCommand?: SessionDeps["runCommand"];
  /** IPv4 propias en las que puede llegar el celu (para validar el `Origin` del upgrade). */
  ownAddresses?(): string[];
  /** Un celu se autenticó (la app anota `lastSeenAt`). */
  onAuthenticated(device: Device): void;
  /** Entró una conexión (aunque después se rechace): alimenta el aviso del firewall. */
  onConnection?(ip: string): void;
  /** Interfaz donde escucha. Por defecto todas; los tests usan 127.0.0.1. */
  host?: string;
  /** Solo para tests: acepta conexiones desde 127.0.0.1. */
  allowLoopback?: boolean;
  /** Conexiones simultáneas por IP (por defecto 8) y en total (por defecto 64). */
  maxConnectionsPerIp?: number;
  maxConnections?: number;
}

export interface RemoteServer {
  /** Empieza a escuchar. Rechaza con el error de `listen` (p. ej. EADDRINUSE). Devuelve el puerto real. */
  start(port: number): Promise<{ port: number }>;
  /** Cierra todas las sesiones con 1001 y deja de escuchar. Idempotente. */
  stop(): Promise<void>;
  /** Corta con 4003 las sesiones abiertas de ese dispositivo. */
  revoke(deviceId: string): void;
  sessionCount(): number;
  /** Manda `screens.update` a todos los celus conectados (después de un comando que cambió algo). */
  broadcastScreens(state: ScreensState): void;
  /** ¿Hay una sesión autenticada de ese dispositivo? */
  isConnected(deviceId: string): boolean;
}

const CRLF = String.fromCharCode(13, 10);
const CLOSE_WAIT_MS = 1_000; // cuánto esperar a que los celus contesten el cierre antes de cortar

/** Servidor WebSocket real (`ws`): adapta cada socket a `Conn` y se lo da a una `Session`. */
export function createRemoteServer(deps: RemoteServerDeps): RemoteServer {
  const { clock } = deps;
  const log = createThrottledLogger(deps.log, clock);
  const maxPerIp = deps.maxConnectionsPerIp ?? 8;
  const maxTotal = deps.maxConnections ?? 64;
  const ipOf = new Map<WebSocket, string>();
  const broadcaster = createBroadcaster({ clock, sampler: deps.sampler, screens: deps.screens, extras: deps.extras });
  const sessions = new Map<WebSocket, Session>();
  // Avisos de B3 (biblioteca cambió, progreso de una escena, ventanas tras una acción) a todos los celus conectados.
  deps.extras?.subscribe((type, payload) => {
    for (const s of sessions.values()) s.pushExtra(type, payload);
  });
  // El estado del Pad (llave, administrador, lo apretado) llega a todos los celus conectados.
  deps.pad?.subscribe((state) => {
    for (const s of sessions.values()) s.pushExtra("pad.state", state);
  });
  let wss: WebSocketServer | null = null;
  let httpServer: Server | null = null;
  let listenPort = 0;
  let heartbeat: TimerHandle | null = null;
  let stopping: Promise<void> | null = null;

  function onConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = normalizeIp(req.socket.remoteAddress ?? "");
    let fromSameIp = 0;
    for (const other of ipOf.values()) if (other === ip) fromSameIp++;
    if (ipOf.size >= maxTotal || fromSameIp >= maxPerIp) {
      // Sin crear sesión ni responder: así abrir conexiones sin parar sale barato para el agente.
      log.warn("connection limit reached", { ip });
      ws.terminate();
      return;
    }
    ipOf.set(ws, ip);

    const conn: Conn = {
      remoteIp: req.socket.remoteAddress ?? "",
      send(text) {
        if (ws.readyState !== WebSocket.OPEN) throw new Error("socket not open");
        ws.send(text);
      },
      close(code, reason) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(code, reason);
      },
    };

    const session: Session = createSession({
      conn,
      clock,
      log,
      sampler: deps.sampler,
      pairing: deps.pairing,
      limiter: deps.limiter,
      allowLoopback: deps.allowLoopback ?? false,
      extras: deps.extras,
      pad: deps.pad,
      onResync: () => broadcaster.resync(session),
      identity: deps.identity(),
      random: deps.random,
      lookupDevice: deps.lookupDevice,
      unpair: deps.unpair,
      runCommand: deps.runCommand,
      onAuthenticated(device) {
        broadcaster.add(session);
        if (deps.pad) session.pushExtra("pad.state", deps.pad.state());
        deps.onAuthenticated(device);
      },
    });
    sessions.set(ws, session);
    deps.onConnection?.(conn.remoteIp);

    let alive = true;
    ws.on("pong", () => (alive = true));
    (ws as WebSocket & { checkAlive?: () => void }).checkAlive = () => {
      if (!alive) {
        log.warn("celu sin respuesta al ping: se corta la conexión", { ip: conn.remoteIp });
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    };

    ws.on("message", (data, isBinary) => {
      // Los marcos son texto; uno binario se trata como basura (la sesión corta con 4000).
      session.receive(isBinary ? "<binary>" : data.toString());
    });
    ws.on("close", () => {
      session.handleClose();
      broadcaster.remove(session);
      sessions.delete(ws);
      ipOf.delete(ws);
    });
    ws.on("error", (err) => log.warn("websocket error", { error: String(err) }));

    session.start();
  }

  function runHeartbeat(): void {
    for (const ws of sessions.keys()) (ws as WebSocket & { checkAlive?: () => void }).checkAlive?.();
  }

  async function doStop(): Promise<void> {
    const server = wss;
    if (!server) return;
    wss = null;
    if (heartbeat !== null) clock.clear(heartbeat);
    heartbeat = null;

    const open = [...sessions.entries()];
    const allClosed = Promise.all(
      open.map(([ws]) => (ws.readyState === WebSocket.CLOSED ? null : new Promise<void>((r) => ws.once("close", () => r())))),
    );
    for (const [, session] of open) session.shutdown("agent_stopping");

    let timer: TimerHandle | undefined;
    const timeout = new Promise<void>((r) => (timer = clock.setTimeout(r, CLOSE_WAIT_MS)));
    await Promise.race([allClosed, timeout]);
    if (timer !== undefined) clock.clear(timer);
    for (const [ws] of sessions) ws.terminate(); // los que no contestaron el cierre
    sessions.clear();
    ipOf.clear();
    broadcaster.stop();
    const http = httpServer;
    httpServer = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (http) {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    }
    log.info("remote server stopped");
  }

  return {
    start(port) {
      if (wss) return Promise.reject(new Error("remote server already running"));
      return new Promise((resolve, reject) => {
        const http = createServer((_req, res) => {
          res.writeHead(426, { "Content-Type": "text/plain" });
          res.end("Upgrade Required");
        });
        const server = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_FRAME_BYTES });

        // El upgrade se maneja a mano para mirar el Origin antes de abrir el WebSocket (ws desaconseja verifyClient).
        http.on("upgrade", (req, socket, head) => {
          const origin = req.headers.origin;
          if (!originAllowed(origin, deps.ownAddresses?.() ?? [], listenPort, { allowLoopback: deps.allowLoopback })) {
            log.warn("origin rejected", { ip: normalizeIp(req.socket.remoteAddress ?? ""), origin: String(origin).slice(0, 100) });
            socket.write("HTTP/1.1 403 Forbidden"+CRLF+"Connection: close"+CRLF+"Content-Length: 0"+CRLF+CRLF);
            socket.destroy();
            return;
          }
          server.handleUpgrade(req, socket, head, (ws) => server.emit("connection", ws, req));
        });

        http.once("error", reject); // EADDRINUSE y compañía, antes de escuchar
        http.listen(port, deps.host ?? "0.0.0.0", () => {
          http.off("error", reject);
          http.on("error", (err) => log.error("http server error", { error: String(err) }));
          server.on("error", (err) => log.error("websocket server error", { error: String(err) }));
          wss = server;
          httpServer = http;
          server.on("connection", onConnection);
          heartbeat = clock.setInterval(runHeartbeat, PING_INTERVAL_MS);
          const address = http.address();
          listenPort = typeof address === "object" && address ? address.port : port;
          log.info("remote server listening", { port: listenPort });
          resolve({ port: listenPort });
        });
      });
    },

    stop() {
      stopping ??= doStop().finally(() => {
        stopping = null;
      });
      return stopping;
    },

    revoke(deviceId) {
      for (const s of sessions.values()) if (s.deviceId === deviceId) s.revoke();
    },

    sessionCount: () => sessions.size,

    broadcastScreens(state) {
      for (const s of sessions.values()) s.pushScreens(state, "update");
    },

    isConnected(deviceId) {
      for (const s of sessions.values()) if (s.deviceId === deviceId && s.isAuthenticated()) return true;
      return false;
    },
  };
}
