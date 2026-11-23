import {
  AUTH_TIMEOUT_MS,
  CloseCode,
  PROTOCOL_VERSION,
  bytesToBase64Url,
  decodeHs1Payload,
  encodeFrame,
  encodeHs2Payload,
  normalizeIp,
  openFrame,
  parseClientMessage,
  MAX_CLIENT_FRAME_BYTES,
  parseFrame,
  responderHandshake,
  sealToFrame,
  type ClientMessage,
  type ErrorCode,
  type Hs2Payload,
  type KeyPair,
  type ScreensState,
  type ServerMessage,
  type SystemState,
  type Transport,
} from "@proyecto-e/protocol";
import type { Device } from "../config/schema";
import { isAllowedClient } from "../net/allowedClient";
import type { Pairing, PairRequestHandle } from "../pairing/pairing";
import type { Clock, Logger, TimerHandle } from "../ports";
import type { RateLimiter } from "../security/rateLimit";
import type { Extras } from "../apps/extras";
import type { PadService } from "../input/service";
import type { CommandOutcome } from "../screens/service";
import type { Sampler } from "../state/system";

// Una conexión del celu (docs/PLAN.md 8.2.4). No conoce sockets: `server.ts` adapta el de `ws` a `Conn`.
//
// Protocolo v2: lo primero que manda el celu es `hs1` (handshake Noise IK). De ahí salen la clave pública
// del celu (su identidad) y lo que quiere (emparejar o conectar). Antes de que el canal esté cifrado el
// agente NO responde nada en claro: ante cualquier problema solo corta con un código de cierre.

export interface Conn {
  send(text: string): void;
  close(code: number, reason: string): void;
  remoteIp: string;
}

export type DeviceLookup =
  | { status: "ok"; device: Device }
  | { status: "revoked" }
  | { status: "unknown" };

export interface SessionDeps {
  conn: Conn;
  clock: Clock;
  log: Logger;
  sampler: Sampler;
  pairing: Pairing;
  limiter: RateLimiter;
  /** Par de claves de la PC (la pública va en el QR). */
  identity: KeyPair;
  random: (n: number) => Uint8Array;
  /** Solo para tests de integración en 127.0.0.1. */
  allowLoopback: boolean;
  /** Busca un dispositivo por su clave pública (base64url). */
  lookupDevice(publicKey: string): DeviceLookup;
  /** "Olvidar" desde el celu: borra el dispositivo. La sesión cierra después. */
  unpair(deviceId: string): Promise<void>;
  /** Ejecuta un comando del celu (apodos, y más adelante prender/apagar y mover). Sin esto: `unsupported`. */
  runCommand?(
    msg: Extract<ClientMessage, { type: "monitor.rename" | "monitor.setEnabled" | "monitor.setOrder" | "window.moveActive" | "monitor.identify" }>,
  ): Promise<CommandOutcome>;
  /** B3: ventanas, lanzadores, escenas e Inicio. Sin esto esos mensajes responden `unsupported`. */
  extras?: Extras;
  /** B5: mouse y teclado del Pad. Sin esto los `pad.*` contestan `input_unavailable`. Tiene su propio límite de ritmo (D43). */
  pad?: PadService;
  /** Después de un rato en silencio por el Pad, hay que volver a mandarle el estado completo a este celu. */
  onResync?(): void;
  /** El handshake fue válido: el servidor suma la sesión al broadcaster y anota `lastSeenAt`. */
  onAuthenticated(device: Device): void;
}

export interface Session {
  /** Llamar al aceptar la conexión: filtra la IP y arranca el timer de auth. */
  start(): void;
  /** Un marco de texto del celu. */
  receive(raw: string): void;
  /** El socket ya se cerró (por el celu o por la red). Idempotente. */
  handleClose(): void;
  /** Revocación con la sesión abierta: cierra con 4003. */
  revoke(): void;
  /** Apagado del agente o remoto off: cierra con 1001. */
  shutdown(reason?: string): void;
  /** `state.update` del broadcaster; no hace nada si la sesión no está autenticada. */
  pushState(state: SystemState): void;
  /** Pantallas y ventana activa: `snapshot` al conectar, `update` cuando algo cambió. */
  pushScreens(state: ScreensState, kind: "snapshot" | "update"): void;
  /** Un mensaje de B3 (ventanas, biblioteca, progreso de una escena); no hace nada si la sesión no está autenticada. */
  pushExtra(type: ServerMessage["type"], payload: unknown): void;
  isAuthenticated(): boolean;
  readonly deviceId: string | null;
}

// "confirming": el handshake salió bien pero falta que el celu demuestre que tiene su clave mandando un primer
// mensaje cifrado. Sin esto, quien reenvíe un hs1 capturado (los hs1 viajan por la red) quedaría como "en línea".
type Phase = "new" | "unauth" | "pairing" | "confirming" | "authed" | "closed";

/** Mensajes de B3 por segundo y por sesión: un celu pegado no puede reescribir el disco ni lanzar procesos sin freno. */
const EXTRA_MAX_PER_SECOND = 30;
const MAX_INVALID_MESSAGES = 3; // el 4.º inválido corta
/**
 * Mientras se usa el Pad no se le mandan al celu las actualizaciones pesadas (ventanas, audio, biblioteca, pantallas, CPU): todo viaja
 * por una sola conexión y el celu las valida en el mismo hilo que los gestos, así que cada una congelaba el touchpad unos instantes.
 * A los 1,5 s sin mensajes del Pad se le vuelve a mandar todo.
 */
const PAD_QUIET_MS = 1_500;
/** Cada cuánto como mucho se acusa recibo de movimientos (ver `pad.ack`). */
const ACK_MIN_GAP_MS = 12;
/** Lo único que sigue pasando mientras se usa el Pad. */
const QUIET_KEEP: ReadonlySet<string> = new Set(["pad.state", "scene.progress", "media.artData", "apps.results", "icon.data", "browser.data"]);

export function createSession(deps: SessionDeps): Session {
  const { conn, clock, log, sampler, pairing, limiter } = deps;
  const ip = normalizeIp(conn.remoteIp);
  let phase: Phase = "new";
  let seq = 0;
  let invalid = 0;
  let extraWindowStart = 0;
  let extraCount = 0;
  let authTimer: TimerHandle | null = null;
  let pairHandle: Extract<PairRequestHandle, { status: "pending" }> | null = null;
  let deviceId: string | null = null;
  let transport: Transport | null = null;
  /** El dispositivo que pidió conectar, mientras espera confirmar su clave. */
  let candidate: Device | null = null;
  let quietUntil = 0;
  let quietTimer: TimerHandle | null = null;
  let missed = false;
  let lastAck = 0;

  const isQuiet = () => clock.now() < quietUntil;
  function checkQuiet(): void {
    quietTimer = null;
    if (phase !== "authed") return;
    const left = quietUntil - clock.now();
    if (left > 0) {
      quietTimer = clock.setTimeout(checkQuiet, left);
      return;
    }
    if (missed) {
      missed = false;
      deps.onResync?.();
    }
  }
  function quietForPad(): void {
    quietUntil = clock.now() + PAD_QUIET_MS;
    if (quietTimer === null) quietTimer = clock.setTimeout(checkQuiet, PAD_QUIET_MS);
  }

  function clearAuthTimer(): void {
    if (authTimer !== null) clock.clear(authTimer);
    authTimer = null;
  }

  /** Mensaje de aplicación, cifrado. Solo existe después del handshake. */
  function send<T extends ServerMessage["type"]>(
    type: T,
    payload: Extract<ServerMessage, { type: T }>["payload"],
  ): void {
    if (phase === "closed" || transport === null) return;
    try {
      conn.send(sealToFrame(transport, JSON.stringify({ v: PROTOCOL_VERSION, id: String(++seq), type, payload })));
    } catch (err) {
      log.warn("send failed", { ip, error: String(err) });
      closeWith(CloseCode.GOING_AWAY, "send_failed");
    }
  }

  function sendError(code: ErrorCode, message: string, replyTo?: string): void {
    send("error", { code, message: message.slice(0, 200), ...(replyTo ? { replyTo } : {}) });
  }

  function closeWith(code: number, reason: string): void {
    if (phase === "closed") return;
    phase = "closed";
    clearAuthTimer();
    pairHandle?.cancel();
    conn.close(code, reason);
  }

  function handleClose(): void {
    if (phase === "closed") return;
    phase = "closed";
    clearAuthTimer();
    pairHandle?.cancel(); // el celu se fue con un pedido esperando: se descarta
    if (quietTimer !== null) clock.clear(quietTimer);
    quietTimer = null;
    if (deviceId !== null) deps.pad?.disconnect(deviceId); // suelta lo que ese celu tenía apretado (D53)
  }

  /** Cuenta un intento fallido; si ya se pasó del límite, la IP queda bloqueada. */
  function overLimit(): boolean {
    if (limiter.attempt(ip).allowed) return false;
    log.warn("ip blocked by rate limit", { ip });
    return true;
  }

  /** El handshake no se pudo ni leer: no se responde nada, se cuenta el intento y se corta. */
  function failHandshake(detail: string): void {
    log.warn("handshake failed", { ip, detail });
    closeWith(overLimit() ? CloseCode.RATE_LIMITED : CloseCode.PROTOCOL_ERROR, "protocol_error");
  }

  function onInvalid(failure: { code: ErrorCode; detail: string }): void {
    sendError(failure.code, failure.detail);
    if (failure.code === "incompatible") return closeWith(CloseCode.INCOMPATIBLE, "incompatible");
    invalid++;
    if (invalid > MAX_INVALID_MESSAGES) closeWith(CloseCode.PROTOCOL_ERROR, "protocol_error");
  }

  function handleHs1(data: Uint8Array): void {
    clearAuthTimer();
    const responder = responderHandshake({ s: deps.identity, random: deps.random });
    let read;
    try {
      read = responder.readHs1(data);
    } catch (err) {
      return failHandshake(`hs1 no descifra: ${String(err)}`);
    }
    const hello = decodeHs1Payload(read.payload);
    if (!hello.ok) return failHandshake(`hs1 con contenido inválido: ${hello.detail}`);
    const publicKey = bytesToBase64Url(read.remoteStatic);

    /** Contesta con hs2 (cifrado con las claves del handshake) y deja el canal listo. */
    function replyHs2(payload: Hs2Payload): void {
      const w2 = responder.writeHs2(encodeHs2Payload(payload));
      transport = w2.transport;
      conn.send(encodeFrame("hs2", w2.msg));
    }
    const hostname = () => sampler.snapshot().hostname;
    const agentVersion = () => sampler.snapshot().agentVersion;

    if (hello.payload.intent === "connect") {
      const found = deps.lookupDevice(publicKey);
      if (found.status === "unknown") {
        if (overLimit()) {
          replyHs2({ ok: false, reason: "rate_limited" });
          return closeWith(CloseCode.RATE_LIMITED, "rate_limited");
        }
        log.warn("auth failed", { ip, reason: "unknown_device" });
        replyHs2({ ok: false, reason: "unknown_device" });
        return closeWith(CloseCode.AUTH_FAILED, "auth_failed");
      }
      if (found.status === "revoked") {
        // Un celu revocado reintenta una vez y se olvida de la PC: no cuenta para el rate limit.
        log.warn("auth failed", { ip, reason: "revoked" });
        replyHs2({ ok: false, reason: "revoked" });
        return closeWith(CloseCode.REVOKED, "revoked");
      }
      replyHs2({ ok: true, pcName: hostname(), agentVersion: agentVersion() });
      // Todavía no es "autenticado": falta el primer mensaje cifrado (ver `confirmKey`). Hasta entonces no se le
      // manda nada, no se anota `lastSeenAt` ni se lo suma al muestreo; y si no llega en 5 s se lo corta.
      phase = "confirming";
      candidate = found.device;
      authTimer = clock.setTimeout(() => {
        authTimer = null;
        log.warn("key confirmation timeout", { ip });
        closeWith(CloseCode.AUTH_TIMEOUT, "auth_timeout");
      }, AUTH_TIMEOUT_MS);
      return;
    }

    // intent === "pair"
    const { code, deviceName, platform } = hello.payload;
    const handle = pairing.request({ code, deviceName, platform, publicKey, ip });
    if (handle.status === "failed") {
      if (handle.reason === "invalid_code" && overLimit()) {
        replyHs2({ ok: false, reason: "rate_limited" });
        return closeWith(CloseCode.RATE_LIMITED, "rate_limited");
      }
      log.warn("pairing request failed", { ip, reason: handle.reason });
      replyHs2({ ok: false, reason: handle.reason });
      return closeWith(CloseCode.PAIR_CLOSED, "pair_closed");
    }

    phase = "pairing";
    pairHandle = handle;
    replyHs2({ ok: true, pcName: hostname(), agentVersion: agentVersion() });
    send("pair.pending", {});
    void handle.outcome.then((outcome) => {
      if (phase === "closed") return;
      if (outcome.ok) {
        send("pair.result", { ok: true, deviceId: outcome.deviceId, pcName: hostname() });
        return closeWith(CloseCode.PAIR_CLOSED, "pair_closed");
      }
      if (outcome.reason === "cancelled") return closeWith(CloseCode.GOING_AWAY, "pairing_cancelled");
      send("pair.result", { ok: false, reason: outcome.reason });
      closeWith(CloseCode.PAIR_CLOSED, "pair_closed");
    });
  }

  /** El celu mandó su primer mensaje cifrado: tiene la clave. Recién ahora entra. */
  function confirmKey(): void {
    const device = candidate;
    candidate = null;
    if (!device) return closeWith(CloseCode.PROTOCOL_ERROR, "protocol_error");
    clearAuthTimer();
    phase = "authed";
    deviceId = device.id;
    deps.pad?.connect(device.id);
    const snapshot = sampler.snapshot();
    send("auth.ok", { pcName: snapshot.hostname, agentVersion: snapshot.agentVersion });
    send("state.snapshot", snapshot);
    log.info("auth ok", { ip, deviceId });
    deps.onAuthenticated(device);
  }

  function handleData(data: Uint8Array): void {
    if (transport === null) return closeWith(CloseCode.PROTOCOL_ERROR, "protocol_error");
    let text: string;
    try {
      text = openFrame(transport, data);
    } catch (err) {
      // Si no descifra, los contadores quedaron desfasados o alguien toca el canal: se corta sin responder.
      log.warn("data frame did not decrypt: closing", { ip, deviceId, error: String(err) });
      return closeWith(CloseCode.PROTOCOL_ERROR, "protocol_error");
    }
    const parsed = parseClientMessage(text);
    if (phase === "confirming") {
      // Lo único que se acepta acá es el ping de confirmación.
      if (!parsed.ok || parsed.msg.type !== "ping") return closeWith(CloseCode.PROTOCOL_ERROR, "protocol_error");
      return confirmKey();
    }
    if (!parsed.ok) return onInvalid(parsed);
    routeMessage(parsed.msg);
  }

  function routeMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case "ping":
        return send("pong", {});
      case "monitor.rename":
      case "monitor.setEnabled":
      case "monitor.setOrder":
      case "window.moveActive":
      case "monitor.identify": {
        const replyTo = msg.id;
        const run: Promise<CommandOutcome> = deps.runCommand ? deps.runCommand(msg) : Promise.resolve({ ok: false, reason: "unsupported" });
        void run
          .catch((err: unknown): CommandOutcome => {
            log.error("command failed", { type: msg.type, error: String(err) });
            return { ok: false, reason: "failed" };
          })
          .then((outcome) => send("command.result", outcome.ok ? { replyTo, ok: true } : { replyTo, ok: false, reason: outcome.reason }));
        return;
      }
      case "window.move":
      case "window.act":
      case "windows.bringAll":
      case "apps.search":
      case "icon.get":
      case "launcher.add":
      case "launcher.rename":
      case "launcher.remove":
      case "launcher.run":
      case "scene.save":
      case "scene.remove":
      case "scene.run":
      case "deck.set":
      case "audio.setVolume":
      case "audio.setMute":
      case "audio.nudge":
      case "audio.toggleMute":
      case "audio.setDefault":
      case "audio.route":
      case "audio.rename":
      case "audio.hide":
      case "media.key":
      case "media.select":
      case "browser.act":
      case "browser.query":
      case "media.art": {
        const replyTo = msg.id;
        const now = clock.now();
        if (now - extraWindowStart >= 1_000) {
          extraWindowStart = now;
          extraCount = 0;
        }
        if (++extraCount > EXTRA_MAX_PER_SECOND) {
          log.warn("too many messages from a phone", { ip, deviceId });
          return send("command.result", { replyTo, ok: false, reason: "busy" });
        }
        const extras = deps.extras;
        const run = extras ? extras.handle(msg, (t, p) => send(t as "pong", p as never)) : Promise.resolve<Awaited<ReturnType<Extras["handle"]>>>({ ok: false, reason: "unsupported" });
        void run
          .catch((err: unknown) => {
            log.error("command failed", { type: msg.type, error: String(err) });
            return { ok: false, reason: "failed" } as const;
          })
          .then((out) => {
            if (out === "replied") return; // ya contestó por su cuenta (apps.results, icon.data)
            const steps = "steps" in out && out.steps ? { steps: out.steps } : {};
            send("command.result", out.ok ? { replyTo, ok: true, ...steps } : { replyTo, ok: false, reason: out.reason });
          });
        return;
      }
      case "pad.move":
      case "pad.scroll":
      case "pad.button":
      case "pad.key":
      case "pad.shortcut":
      case "pad.type":
      case "pad.altTab":
      case "pad.release": {
        // El Pad no pasa por el límite de 30/s de B3: tiene el suyo adentro del servicio (D43).
        const replyTo = msg.id;
        const id = deviceId;
        const pad = deps.pad;
        if (id === null) return;
        if (!pad) {
          if (msg.type === "pad.move" || msg.type === "pad.scroll") return;
          return send("command.result", { replyTo, ok: false, reason: "input_unavailable" });
        }
        quietForPad();
        const run = pad.handle(id, msg);
        if (run === "silent") {
          // pad.move y pad.scroll no reciben respuesta (D42), pero sí un acuse chiquito de vez en cuando para destrabar el TCP del celu.
          const now = clock.now();
          if (now - lastAck >= ACK_MIN_GAP_MS) {
            lastAck = now;
            send("pad.ack", {});
          }
          return;
        }
        void run
          .catch((err: unknown) => {
            log.error("command failed", { type: msg.type, error: String(err) });
            return { ok: false, reason: "failed" } as const;
          })
          .then((out) => send("command.result", out.ok ? { replyTo, ok: true } : { replyTo, ok: false, reason: out.reason }));
        return;
      }
      case "device.unpair": {
        const id = deviceId;
        if (id === null) return;
        log.info("device unpaired by the phone", { deviceId: id });
        void deps
          .unpair(id)
          .catch((err: unknown) => log.error("could not unpair device", { deviceId: id, error: String(err) }))
          .finally(() => closeWith(CloseCode.NORMAL, "unpaired"));
        return;
      }
    }
  }

  return {
    start() {
      if (!isAllowedClient(ip, { allowLoopback: deps.allowLoopback })) {
        // Sin mensaje previo: a una IP que no es de la red local no se le responde nada.
        log.warn("connection rejected", { ip, reason: "not_private" });
        return closeWith(CloseCode.NOT_PRIVATE, "not_private");
      }
      if (limiter.isBlocked(ip)) {
        log.warn("connection rejected", { ip, reason: "rate_limited" });
        return closeWith(CloseCode.RATE_LIMITED, "rate_limited");
      }
      phase = "unauth";
      authTimer = clock.setTimeout(() => {
        authTimer = null;
        log.warn("auth timeout", { ip });
        closeWith(CloseCode.AUTH_TIMEOUT, "auth_timeout");
      }, AUTH_TIMEOUT_MS);
    },

    receive(raw) {
      if (phase === "closed" || phase === "new") return;
      const frame = parseFrame(raw, MAX_CLIENT_FRAME_BYTES);
      if (!frame.ok) {
        log.warn("invalid frame", { ip, code: frame.code });
        return closeWith(frame.code === "incompatible" ? CloseCode.INCOMPATIBLE : CloseCode.PROTOCOL_ERROR, frame.code);
      }

      switch (phase) {
        case "unauth":
          if (frame.kind === "hs1") return handleHs1(frame.data);
          return closeWith(CloseCode.PROTOCOL_ERROR, "protocol_error");
        case "pairing":
          return; // esperando la decisión de Jay: no hay nada que responder
        case "confirming":
        case "authed":
          if (frame.kind === "data") return handleData(frame.data);
          return closeWith(CloseCode.PROTOCOL_ERROR, "protocol_error");
      }
    },

    handleClose,

    revoke() {
      if (phase !== "authed") return;
      log.info("device revoked while connected", { deviceId });
      closeWith(CloseCode.REVOKED, "revoked");
    },

    shutdown(reason = "agent_stopping") {
      closeWith(CloseCode.GOING_AWAY, reason);
    },

    pushState(state) {
      if (phase !== "authed") return;
      if (isQuiet()) {
        missed = true;
        return;
      }
      send("state.update", state);
    },

    pushScreens(state, kind) {
      if (phase !== "authed") return;
      if (isQuiet()) {
        missed = true;
        return;
      }
      send(kind === "snapshot" ? "screens.snapshot" : "screens.update", state);
    },

    pushExtra(type, payload) {
      if (phase !== "authed") return;
      if (isQuiet() && !QUIET_KEEP.has(type)) {
        missed = true;
        return;
      }
      send(type as "pong", payload as never);
    },

    isAuthenticated: () => phase === "authed",

    get deviceId() {
      return deviceId;
    },
  };
}
