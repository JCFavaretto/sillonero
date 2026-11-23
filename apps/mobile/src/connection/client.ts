import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeHs2Payload,
  decodeQr,
  encodeFrame,
  encodeHs1Payload,
  initiatorHandshake,
  keyPairFromPrivate,
  openFrame,
  parseFrame,
  parseServerMessage,
  sealToFrame,
  type ClientMessage,
  type CommandError,
  type ScreensState,
  type ServerMessage,
  type Transport,
} from "@proyecto-e/protocol";
import { nextDelay } from "./backoff";
import {
  initialState,
  reduce,
  type ConnState,
  type Effect,
  type MachineContext,
  type MachineEvent,
  type TimerName,
} from "./machine";
import type { PairedPc } from "./types";

/** Lo mínimo que usamos de un WebSocket (el real y el falso de los tests lo cumplen). */
export interface SocketLike {
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface ClientDeps {
  createSocket(url: string): SocketLike;
  storage: {
    /** `upgraded`: había un emparejamiento de B1 (sin cifrado) y se borró. */
    load(): Promise<{ pc: PairedPc | null; upgraded: boolean }>;
    save(pc: PairedPc): Promise<void>;
    remove(): Promise<void>;
  };
  clock: {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  random(): number;
  /** Bytes aleatorios seguros (claves del celu y efímeras del handshake). */
  randomBytes(n: number): Uint8Array;
  newId(): string;
  appVersion: string;
  platform: "android" | "ios";
  /** Se llama con el estado completo cada vez que cambia (el store de zustand escribe acá). */
  onState(state: ConnState): void;
  /** Pantallas y ventana activa de la PC; `null` cuando hay que borrarlas (olvidó la PC o la revocaron). */
  onScreens?(state: ScreensState | null): void;
  /** B3 y B4: ventanas, biblioteca, resultados de búsqueda, íconos, progreso de escenas, audio y carátulas; `null` = borrar todo (olvidó la PC). */
  onExtra?(msg: ServerMessage | null): void;
  /** B5: ida y vuelta (ms) de un `measure()`. */
  onLatency?(ms: number): void;
}

/** Cuánto se espera el pong de una medición de latencia. */
const MEASURE_TIMEOUT_MS = 5_000;

/** Cuánto se espera la respuesta de la PC a un comando. */
export const COMMAND_TIMEOUT_MS = 8_000;

/** Cómo termina un comando: la PC lo cumplió, no pudo (con el motivo), o ni siquiera llegó la respuesta. */
export type StepResult = "ok" | "partial" | "failed" | "skipped";
export type CommandOutcome = { ok: true; steps?: StepResult[] } | { ok: false; reason: CommandError | "timeout" | "offline"; steps?: StepResult[] };

/** Los comandos que el celu le puede pedir a la PC (los que llevan respuesta `command.result`). */
export type CommandType =
  | "monitor.rename" | "monitor.setEnabled" | "monitor.setOrder" | "window.moveActive" | "monitor.identify"
  | "window.move" | "window.act" | "windows.bringAll"
  | "launcher.add" | "launcher.rename" | "launcher.remove" | "launcher.run" | "target.run" | "sound.put" | "sound.play"
  | "scene.save" | "scene.remove" | "scene.run" | "deck.set"
  | "audio.setVolume" | "audio.setMute" | "audio.nudge" | "audio.toggleMute" | "audio.setDefault" | "audio.route" | "audio.rename" | "audio.hide"
  | "media.key" | "media.select" | "browser.act"
  | "pad.button" | "pad.key" | "pad.shortcut" | "pad.type" | "pad.altTab" | "pad.release";
export type CommandRequest = Extract<ClientMessage, { type: CommandType }>;

/** `sendCommand` con el tipo de cada comando atado a su contenido. `timeoutMs` pisa los 8 s (una escena puede tardar). */
export type SendCommand = <T extends CommandType>(
  type: T,
  payload: Extract<CommandRequest, { type: T }>["payload"],
  opts?: { timeoutMs?: number },
) => Promise<CommandOutcome>;

/** Los del Pad que se mandan sin esperar respuesta (D42): 60 por segundo, no tendría sentido contestarlos. */
export type FireType = "pad.move" | "pad.scroll";
export type FireRequest = Extract<ClientMessage, { type: FireType }>;

/** Mensajes que preguntan algo y cuya respuesta no es un `command.result` (llega como mensaje propio). */
export type QueryType = "apps.search" | "icon.get" | "media.art" | "browser.query";

const TIMER_EVENTS: Record<TimerName, MachineEvent> = {
  retry: { type: "RETRY_TIMER" },
  ping: { type: "PING_TIMER" },
  pongTimeout: { type: "PONG_TIMEOUT" },
};

/**
 * Lo único impuro de la conexión: sockets, timers y almacenamiento.
 * Las decisiones las toma `machine.ts`; acá solo se ejecutan sus efectos.
 */
export function createClient(deps: ClientDeps) {
  const ctx: MachineContext = {
    backoff: (n) => nextDelay(n, deps.random),
    appVersion: deps.appVersion,
    platform: deps.platform,
  };
  let state: ConnState = initialState;
  let socket: SocketLike | null = null;
  /** Handshake de Noise de la conexión actual; `transport` existe desde que llega hs2. */
  let hs: { init: ReturnType<typeof initiatorHandshake>; transport: Transport | null; intent: "pair" | "connect" } | null = null;
  /** Cada socket nuevo (o cerrado a propósito) sube la generación: los eventos de uno viejo se ignoran. */
  let gen = 0;
  const timers = new Map<TimerName, unknown>();
  /** Comandos esperando respuesta, por el id del mensaje que los pidió. */
  const commands = new Map<string, { resolve(o: CommandOutcome): void; timer: unknown }>();
  /** Cuándo salió el ping de `measure()` (null = no hay uno esperando). */
  let measuring: number | null = null;

  function settleCommand(id: string, outcome: CommandOutcome) {
    const c = commands.get(id);
    if (!c) return;
    commands.delete(id);
    deps.clock.clearTimeout(c.timer);
    c.resolve(outcome);
  }

  function failAllCommands(reason: "offline") {
    for (const id of [...commands.keys()]) settleCommand(id, { ok: false, reason });
  }

  function dispatch(event: MachineEvent) {
    const result = reduce(state, event, ctx);
    const before = state.status;
    state = result.state;
    deps.onState(state);
    // Sin conexión no hay respuesta que esperar: los comandos en vuelo terminan en "offline".
    if (before === "online" && state.status !== "online") failAllCommands("offline");
    if (state.status === "unpaired" && before !== "unpaired") {
      deps.onScreens?.(null);
      deps.onExtra?.(null);
    }
    for (const effect of result.effects) run(effect);
  }

  function closeCurrent(code = 1000) {
    gen++;
    measuring = null;
    hs = null;
    const s = socket;
    socket = null;
    if (s) {
      try {
        s.close(code);
      } catch {
        // ya estaba cerrado
      }
    }
  }

  function run(effect: Effect) {
    switch (effect.kind) {
      case "openSocket": {
        closeCurrent();
        const g = ++gen;
        const s = deps.createSocket(effect.url);
        socket = s;
        s.onopen = () => {
          if (g === gen) dispatch({ type: "SOCKET_OPEN" });
        };
        s.onmessage = (e) => {
          if (g === gen) handleFrame(e.data);
        };
        s.onclose = (e) => {
          if (g === gen) dispatch({ type: "CLOSED", code: e?.code ?? 1006 });
        };
        s.onerror = () => {
          // después de un error el socket se cierra solo y llega onclose
        };
        return;
      }
      case "closeSocket":
        closeCurrent(effect.code);
        return;
      case "handshake": {
        const s = socket;
        const priv = base64UrlToBytes(effect.devicePrivateKey);
        const rs = base64UrlToBytes(effect.pcPublicKey);
        if (!s || !priv || !rs || priv.length !== 32 || rs.length !== 32) return connectionBroken();
        const init = initiatorHandshake({ s: keyPairFromPrivate(priv), rs, random: deps.randomBytes });
        hs = { init, transport: null, intent: effect.payload.intent };
        s.send(encodeFrame("hs1", init.writeHs1(encodeHs1Payload(effect.payload))));
        return;
      }
      case "send":
        // Todo mensaje de aplicación va cifrado: sin handshake terminado no se manda nada.
        if (socket && hs?.transport) {
          socket.send(
            sealToFrame(hs.transport, JSON.stringify({ v: 1, id: deps.newId(), type: effect.type, payload: effect.payload })),
          );
        }
        return;
      case "savePendingPc":
        deps.storage.save(effect.pc).then(
          () => dispatch({ type: "PENDING_SAVED" }),
          () => dispatch({ type: "PENDING_SAVE_FAILED" }),
        );
        return;
      case "startTimer": {
        const previous = timers.get(effect.name);
        if (previous !== undefined) deps.clock.clearTimeout(previous);
        timers.set(
          effect.name,
          deps.clock.setTimeout(() => {
            timers.delete(effect.name);
            dispatch(TIMER_EVENTS[effect.name]);
          }, effect.ms),
        );
        return;
      }
      case "cancelTimer": {
        const handle = timers.get(effect.name);
        if (handle !== undefined) deps.clock.clearTimeout(handle);
        timers.delete(effect.name);
        return;
      }
      case "savePc":
        void deps.storage.save(effect.pc).catch(() => undefined);
        return;
      case "deletePc":
        void deps.storage.remove().catch(() => undefined);
        return;
    }
  }

  /** Algo salió mal con el canal cifrado (no descifra, claves inválidas): se corta y se reconecta como ante un error de red. */
  function connectionBroken() {
    closeCurrent(1000);
    dispatch({ type: "CLOSED", code: 1006 });
  }

  function handleFrame(raw: string) {
    const frame = parseFrame(raw);
    if (!frame.ok) return; // lo que no es del protocolo se ignora
    if (frame.kind === "hs2") return handleHs2(frame.data);
    if (frame.kind === "data") return handleData(frame.data);
  }

  function handleHs2(data: Uint8Array) {
    const current = hs;
    if (!current || current.transport) return;
    let result;
    try {
      result = current.init.readHs2(data);
    } catch {
      return connectionBroken(); // la PC que contestó no es la del QR, o alguien tocó el mensaje
    }
    current.transport = result.transport;
    const reply = decodeHs2Payload(result.payload);
    if (!reply.ok) return connectionBroken();
    // Para conectar, el celu demuestra que tiene su clave con un primer mensaje cifrado: sin eso la PC no lo da por
    // conectado (así un hs1 copiado de la red no sirve). La PC contesta con auth.ok.
    if (reply.payload.ok && current.intent === "connect" && socket) {
      try {
        socket.send(sealToFrame(result.transport, JSON.stringify({ v: 1, id: deps.newId(), type: "ping", payload: {} })));
      } catch {
        return connectionBroken();
      }
    }
    // Un rechazo del handshake se resuelve con el código de cierre que manda la PC (4002, 4003, 4008…),
    // salvo los dos motivos que explican por qué falló el emparejamiento.
    if (!reply.payload.ok && current.intent === "pair" && (reply.payload.reason === "invalid_code" || reply.payload.reason === "busy")) {
      dispatch({ type: "PAIR_FAIL", reason: reply.payload.reason });
    }
  }

  function handleData(data: Uint8Array) {
    const current = hs;
    if (!current?.transport) return;
    let text: string;
    try {
      text = openFrame(current.transport, data);
    } catch {
      return connectionBroken();
    }
    handleMessage(text);
  }

  function handleMessage(raw: string) {
    // El acuse del Pad (`pad.ack`) llega decenas de veces por segundo y no lleva nada: ni se valida (el hilo de JS es el de los gestos).
    if (raw.includes('"type":"pad.ack"')) return;
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) return; // mensajes raros se ignoran
    const msg = parsed.msg;
    switch (msg.type) {
      case "pair.pending":
        return dispatch({ type: "PAIR_PENDING" });
      case "pair.result":
        if (msg.payload.ok) {
          return dispatch({
            type: "PAIR_OK",
            deviceId: msg.payload.deviceId,
            pcName: msg.payload.pcName,
            pairedAt: new Date(deps.clock.now()).toISOString(),
          });
        }
        return dispatch({ type: "PAIR_FAIL", reason: msg.payload.reason });
      case "auth.ok":
        return dispatch({ type: "AUTH_OK" });
      case "state.snapshot":
      case "state.update":
        return dispatch({ type: "STATE", snapshot: msg.payload });
      case "screens.snapshot":
      case "screens.update":
        return deps.onScreens?.(msg.payload);
      case "command.result":
        return settleCommand(
          msg.payload.replyTo,
          msg.payload.ok ? { ok: true, ...(msg.payload.steps ? { steps: msg.payload.steps } : {}) } : { ok: false, reason: msg.payload.reason },
        );
      case "windows.snapshot":
      case "windows.update":
      case "library.snapshot":
      case "library.update":
      case "apps.results":
      case "icon.data":
      case "scene.progress":
      case "audio.snapshot":
      case "audio.update":
      case "media.artData":
      case "browser.state":
      case "browser.data":
      case "pad.state":
        return deps.onExtra?.(msg);
      case "pong":
        if (measuring !== null) {
          const ms = deps.clock.now() - measuring;
          measuring = null;
          deps.onLatency?.(ms);
        }
        return dispatch({ type: "PONG" });
      default:
        // auth.error y error: el agente cierra enseguida con un código que ya manejamos
        return;
    }
  }

  return {
    getState: () => state,

    async boot() {
      // Si el almacenamiento seguro falla (p. ej. keystore inválido tras restaurar un backup),
      // se arranca como "sin emparejar" en vez de dejar la app en blanco.
      let loaded: { pc: PairedPc | null; upgraded: boolean } = { pc: null, upgraded: false };
      try {
        loaded = await deps.storage.load();
      } catch {
        loaded = { pc: null, upgraded: false };
      }
      dispatch({ type: "BOOT", pc: loaded.pc, upgraded: loaded.upgraded });
    },

    /** `text` es lo que leyó la cámara. */
    pair(text: string, deviceName: string) {
      const r = decodeQr(text, deps.clock.now());
      if (!r.ok) return dispatch({ type: "QR_INVALID", reason: r.reason });
      const { host, port, name, code, pk } = r.payload;
      // La clave de este celu se genera acá, una vez por emparejamiento, y no sale nunca del celu.
      const devicePrivateKey = bytesToBase64Url(deps.randomBytes(32));
      dispatch({ type: "QR_SCANNED", qr: { host, port, name, code, pcPublicKey: pk }, deviceName, devicePrivateKey });
    },

    /**
     * Le pide un comando a la PC y espera su `command.result`. Nunca rechaza: sin conexión da `offline`,
     * y si la PC no contesta en 8 s, `timeout`.
     */
    sendCommand: ((type: CommandRequest["type"], payload: CommandRequest["payload"], opts?: { timeoutMs?: number }): Promise<CommandOutcome> => {
      if (state.status !== "online" || !socket || !hs?.transport) return Promise.resolve({ ok: false, reason: "offline" });
      const id = deps.newId();
      return new Promise<CommandOutcome>((resolve) => {
        const timer = deps.clock.setTimeout(() => settleCommand(id, { ok: false, reason: "timeout" }), opts?.timeoutMs ?? COMMAND_TIMEOUT_MS);
        commands.set(id, { resolve, timer });
        try {
          socket!.send(sealToFrame(hs!.transport!, JSON.stringify({ v: 1, id, type, payload })));
        } catch {
          settleCommand(id, { ok: false, reason: "offline" });
        }
      });
    }) as SendCommand,

    /**
     * Una pregunta que no lleva `command.result` (`apps.search`, `icon.get`): se manda y la respuesta llega por `onExtra`.
     * Devuelve el id del pedido (el que trae `replyTo` en la respuesta), o `null` si no hay conexión.
     */
    query(type: QueryType, payload: Record<string, unknown>): string | null {
      if (state.status !== "online" || !socket || !hs?.transport) return null;
      const id = deps.newId();
      try {
        socket.send(sealToFrame(hs.transport, JSON.stringify({ v: 1, id, type, payload })));
      } catch {
        return null;
      }
      return id;
    },

    /** Un mensaje del Pad que no lleva respuesta (mover y scroll). `false` si no hay conexión: se pierde, el siguiente lo corrige. */
    fire<T extends FireType>(type: T, payload: Extract<FireRequest, { type: T }>["payload"]): boolean {
      if (state.status !== "online" || !socket || !hs?.transport) return false;
      try {
        socket.send(sealToFrame(hs.transport, JSON.stringify({ v: 1, id: deps.newId(), type, payload })));
        return true;
      } catch {
        return false;
      }
    },

    /** Manda un `ping` y, cuando llegue el `pong`, avisa la ida y vuelta por `onLatency` (D57). */
    measure(): void {
      if (state.status !== "online" || !socket || !hs?.transport || measuring !== null) return;
      const started = deps.clock.now();
      measuring = started;
      // Si el pong se pierde sin que se corte el socket, se deja de esperar a los 5 s (si no, la latencia quedaría congelada).
      deps.clock.setTimeout(() => {
        if (measuring === started) measuring = null;
      }, MEASURE_TIMEOUT_MS);
      try {
        socket.send(sealToFrame(hs.transport, JSON.stringify({ v: 1, id: deps.newId(), type: "ping", payload: {} })));
      } catch {
        measuring = null;
      }
    },

    cancelPair: () => dispatch({ type: "PAIR_CANCEL" }),
    retry: () => dispatch({ type: "RETRY_PRESSED" }),
    forget: () => dispatch({ type: "FORGET" }),
    appForeground: () => dispatch({ type: "APP_FOREGROUND" }),
    appBackground: () => dispatch({ type: "APP_BACKGROUND" }),

    dispose() {
      failAllCommands("offline");
      for (const handle of timers.values()) deps.clock.clearTimeout(handle);
      timers.clear();
      closeCurrent();
    },
  };
}

export type Client = ReturnType<typeof createClient>;
