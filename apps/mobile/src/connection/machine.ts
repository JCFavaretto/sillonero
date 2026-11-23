import { PING_INTERVAL_MS, PONG_TIMEOUT_MS, type Hs1Payload, type QrFailure, type SystemState } from "@proyecto-e/protocol";
import type { PairedPc } from "./types";

/** Reintentos con espera creciente antes de pasar a "Sin conexión". */
export const MAX_ATTEMPTS = 6;
/** En "Sin conexión" (app al frente) se sigue probando cada 30 s. */
export const OFFLINE_POLL_MS = 30_000;
/** Si la PC nos bloqueó por rate limit, esperamos 5 minutos. */
export const RATE_LIMIT_RETRY_MS = 300_000;

export type Status = "unpaired" | "pairing" | "connecting" | "online" | "reconnecting" | "offline";

/** Claves de i18n (ver src/i18n/es.json). El estado guarda la clave, no el texto. */
export type PairFailure = "rejected" | "timeout" | "invalid_code" | "busy";
export type ErrorKey =
  | `errors.qr.${QrFailure}`
  | `errors.pair.${PairFailure}`
  | "errors.revoked"
  | "errors.authFailed"
  | "errors.incompatible"
  | "errors.rateLimited"
  | "errors.notPrivate"
  | "errors.unreachable"
  | "errors.protocol"
  | "errors.securityUpgrade"
  | "errors.storage";

export interface QrTarget {
  host: string;
  port: number;
  name: string;
  code: string;
  /** Clave pública de la PC (del QR). */
  pcPublicKey: string;
}

export interface ConnState {
  status: Status;
  pc: PairedPc | null;
  /** Reintentos fallidos desde que se perdió la conexión. */
  attempt: number;
  snapshot: SystemState | null;
  lastError: ErrorKey | null;
  pairing: { phase: "sent" | "waitingPc" } | null;
  /** Datos del QR mientras se empareja, con la clave que generó este celu. */
  pendingPair: (QrTarget & { deviceName: string; devicePrivateKey: string }) | null;
  /** En "offline": ¿sigue probando solo cada 30 s? */
  autoRetry: boolean;
  foreground: boolean;
}

export const initialState: ConnState = {
  status: "unpaired",
  pc: null,
  attempt: 0,
  snapshot: null,
  lastError: null,
  pairing: null,
  pendingPair: null,
  autoRetry: false,
  foreground: true,
};

export type MachineEvent =
  | { type: "BOOT"; pc: PairedPc | null; /** Había un emparejamiento de B1: hay que escanear de nuevo. */ upgraded?: boolean }
  | { type: "QR_INVALID"; reason: QrFailure }
  /** `devicePrivateKey`: la clave de este celu, generada por el cliente (la máquina no tiene azar). */
  | { type: "QR_SCANNED"; qr: QrTarget; deviceName: string; devicePrivateKey: string }
  | { type: "PENDING_SAVED" }
  | { type: "PENDING_SAVE_FAILED" }
  | { type: "PAIR_CANCEL" }
  | { type: "SOCKET_OPEN" }
  | { type: "PAIR_PENDING" }
  | { type: "PAIR_OK"; deviceId: string; pcName: string; pairedAt: string }
  | { type: "PAIR_FAIL"; reason: PairFailure }
  | { type: "AUTH_OK" }
  | { type: "STATE"; snapshot: SystemState }
  | { type: "PONG" }
  | { type: "PING_TIMER" }
  | { type: "PONG_TIMEOUT" }
  | { type: "CLOSED"; code: number }
  | { type: "RETRY_TIMER" }
  | { type: "RETRY_PRESSED" }
  | { type: "FORGET" }
  | { type: "APP_FOREGROUND" }
  | { type: "APP_BACKGROUND" };

export type TimerName = "retry" | "ping" | "pongTimeout";

/** Lo que `client.ts` tiene que hacer. La máquina solo los describe. */
export type Effect =
  | { kind: "openSocket"; url: string }
  | { kind: "closeSocket"; code: number }
  /** Arranca el handshake de Noise: el cliente arma hs1 con estas claves y este contenido. */
  | { kind: "handshake"; payload: Hs1Payload; pcPublicKey: string; devicePrivateKey: string }
  | { kind: "send"; type: "ping" | "device.unpair"; payload: Record<string, never> }
  | { kind: "startTimer"; name: TimerName; ms: number }
  | { kind: "cancelTimer"; name: TimerName }
  | { kind: "savePc"; pc: PairedPc }
  /** Se guarda la clave del celu ANTES de pedir emparejar: si falla, no se empareja nada. */
  | { kind: "savePendingPc"; pc: PairedPc }
  | { kind: "deletePc" };

export interface MachineContext {
  backoff: (attempt: number) => number;
  appVersion: string;
  platform: "android" | "ios";
}

export interface Result {
  state: ConnState;
  effects: Effect[];
}

const wsUrl = (host: string, port: number) => `ws://${host}:${port}`;
const cancel = (...names: TimerName[]): Effect[] => names.map((name) => ({ kind: "cancelTimer", name }));
const ALL_TIMERS: TimerName[] = ["ping", "pongTimeout", "retry"];
const stay = (state: ConnState): Result => ({ state, effects: [] });

/** Se perdió la conexión: reintenta con espera creciente. */
function connectionLost(s: ConnState, ctx: MachineContext): Result {
  return {
    state: { ...s, status: "reconnecting", attempt: 0, autoRetry: false },
    effects: [...cancel("ping", "pongTimeout"), { kind: "startTimer", name: "retry", ms: ctx.backoff(0) }],
  };
}

/** Un reintento falló. */
function retryFailed(s: ConnState, ctx: MachineContext): Result {
  const attempt = s.attempt + 1;
  if (attempt >= MAX_ATTEMPTS) {
    return {
      state: { ...s, status: "offline", attempt, autoRetry: true },
      effects: [{ kind: "startTimer", name: "retry", ms: OFFLINE_POLL_MS }],
    };
  }
  return {
    state: { ...s, status: "reconnecting", attempt },
    effects: [{ kind: "startTimer", name: "retry", ms: ctx.backoff(attempt) }],
  };
}

/** Sin reintento automático: hay que tocar "Reintentar" o volver a abrir la app. */
function giveUp(s: ConnState, error: ErrorKey): Result {
  return {
    state: { ...s, status: "offline", lastError: error, autoRetry: false },
    effects: [...cancel("ping", "pongTimeout", "retry")],
  };
}

/** La PC nos quitó el acceso: se olvida todo y se vuelve a Conectar. */
function forgetWithError(s: ConnState, error: ErrorKey): Result {
  return {
    state: { ...initialState, foreground: s.foreground, lastError: error },
    effects: [...cancel(...ALL_TIMERS), { kind: "deletePc" }],
  };
}

function onClosedWhilePairing(s: ConnState, code: number): Result {
  const key: ErrorKey =
    code === 4008
      ? "errors.rateLimited"
      : code === 4009
        ? "errors.notPrivate"
        : code === 4004
          ? "errors.incompatible"
          : "errors.unreachable";
  return stay({ ...s, status: "unpaired", pairing: null, pendingPair: null, lastError: key });
}

function onClosed(s: ConnState, code: number, ctx: MachineContext): Result {
  if (s.status === "pairing") return onClosedWhilePairing(s, code);
  // El socket de emparejamiento se cierra con 4005 al terminar: no afecta a la conexión nueva.
  if (code === 4005) return stay(s);
  if (!s.pc) return stay(s);

  switch (code) {
    case 4003:
      return forgetWithError(s, "errors.revoked");
    case 4002:
      return forgetWithError(s, "errors.authFailed");
    case 4004:
      return s.status === "offline" && !s.autoRetry && s.lastError === "errors.incompatible"
        ? stay(s)
        : giveUp(s, "errors.incompatible");
    case 4009:
      return giveUp(s, "errors.notPrivate");
    case 4000:
      return giveUp(s, "errors.protocol");
    case 4008:
      return {
        state: { ...s, status: "reconnecting", attempt: 0, autoRetry: false, lastError: "errors.rateLimited" },
        effects: [...cancel("ping", "pongTimeout"), { kind: "startTimer", name: "retry", ms: RATE_LIMIT_RETRY_MS }],
      };
  }

  switch (s.status) {
    case "online":
    case "connecting":
      return connectionLost(s, ctx);
    case "reconnecting":
      return retryFailed(s, ctx);
    case "offline":
      return s.autoRetry && s.foreground ? { state: s, effects: [{ kind: "startTimer", name: "retry", ms: OFFLINE_POLL_MS }] } : stay(s);
    default:
      return stay(s);
  }
}

export function reduce(s: ConnState, e: MachineEvent, ctx: MachineContext): Result {
  switch (e.type) {
    case "BOOT":
      if (e.pc && e.pc.deviceId === null) {
        // Un emparejamiento que no llegó a terminar (la app se cerró en el medio): no sirve.
        return { state: { ...s, status: "unpaired", pc: null }, effects: [{ kind: "deletePc" }] };
      }
      if (!e.pc) {
        return stay({ ...s, status: "unpaired", pc: null, lastError: e.upgraded ? "errors.securityUpgrade" : s.lastError });
      }
      return {
        state: { ...s, status: "connecting", pc: e.pc, attempt: 0, lastError: null },
        effects: [{ kind: "openSocket", url: wsUrl(e.pc.host, e.pc.port) }],
      };

    case "QR_INVALID":
      return s.status === "unpaired" ? stay({ ...s, lastError: `errors.qr.${e.reason}` }) : stay(s);

    case "QR_SCANNED": {
      if (s.status !== "unpaired") return stay(s);
      const pending: PairedPc = {
        v: 2,
        host: e.qr.host,
        port: e.qr.port,
        pcName: e.qr.name,
        pcPublicKey: e.qr.pcPublicKey,
        devicePrivateKey: e.devicePrivateKey,
        deviceId: null,
        pairedAt: null,
      };
      return {
        state: {
          ...s,
          status: "pairing",
          lastError: null,
          pairing: { phase: "sent" },
          pendingPair: { ...e.qr, deviceName: e.deviceName, devicePrivateKey: e.devicePrivateKey },
        },
        // El socket se abre recién cuando la clave quedó guardada (PENDING_SAVED).
        effects: [{ kind: "savePendingPc", pc: pending }],
      };
    }

    case "PENDING_SAVED":
      if (s.status !== "pairing" || !s.pendingPair) return stay(s);
      return { state: s, effects: [{ kind: "openSocket", url: wsUrl(s.pendingPair.host, s.pendingPair.port) }] };

    case "PENDING_SAVE_FAILED":
      if (s.status !== "pairing") return stay(s);
      return stay({ ...s, status: "unpaired", pairing: null, pendingPair: null, lastError: "errors.storage" });

    case "PAIR_CANCEL":
      if (s.status !== "pairing") return stay(s);
      return {
        state: { ...s, status: "unpaired", pairing: null, pendingPair: null },
        effects: [{ kind: "closeSocket", code: 1000 }],
      };

    case "SOCKET_OPEN":
      if (s.status === "pairing" && s.pendingPair) {
        return {
          state: s,
          effects: [
            {
              kind: "handshake",
              payload: {
                intent: "pair",
                code: s.pendingPair.code,
                deviceName: s.pendingPair.deviceName,
                platform: ctx.platform,
                appVersion: ctx.appVersion,
              },
              pcPublicKey: s.pendingPair.pcPublicKey,
              devicePrivateKey: s.pendingPair.devicePrivateKey,
            },
          ],
        };
      }
      if (s.pc && (s.status === "connecting" || s.status === "reconnecting" || s.status === "offline")) {
        return {
          state: s,
          effects: [
            {
              kind: "handshake",
              payload: { intent: "connect", appVersion: ctx.appVersion },
              pcPublicKey: s.pc.pcPublicKey,
              devicePrivateKey: s.pc.devicePrivateKey,
            },
          ],
        };
      }
      return stay(s);

    case "PAIR_PENDING":
      return s.status === "pairing" ? stay({ ...s, pairing: { phase: "waitingPc" } }) : stay(s);

    case "PAIR_OK": {
      if (s.status !== "pairing" || !s.pendingPair) return stay(s);
      const pc: PairedPc = {
        v: 2,
        host: s.pendingPair.host,
        port: s.pendingPair.port,
        pcName: e.pcName,
        pcPublicKey: s.pendingPair.pcPublicKey,
        devicePrivateKey: s.pendingPair.devicePrivateKey,
        deviceId: e.deviceId,
        pairedAt: e.pairedAt,
      };
      return {
        state: { ...s, status: "connecting", pc, attempt: 0, pairing: null, pendingPair: null, lastError: null },
        effects: [
          { kind: "savePc", pc },
          { kind: "openSocket", url: wsUrl(pc.host, pc.port) },
        ],
      };
    }

    case "PAIR_FAIL":
      if (s.status !== "pairing") return stay(s);
      return {
        state: { ...s, status: "unpaired", pairing: null, pendingPair: null, lastError: `errors.pair.${e.reason}` },
        effects: [{ kind: "closeSocket", code: 1000 }],
      };

    case "AUTH_OK":
      if (!s.pc || !(s.status === "connecting" || s.status === "reconnecting" || s.status === "offline")) return stay(s);
      return {
        state: { ...s, status: "online", attempt: 0, lastError: null, autoRetry: false },
        effects: [...cancel("retry"), { kind: "startTimer", name: "ping", ms: PING_INTERVAL_MS }],
      };

    case "STATE":
      return s.status === "online" ? stay({ ...s, snapshot: e.snapshot }) : stay(s);

    case "PING_TIMER":
      if (s.status !== "online") return stay(s);
      return {
        state: s,
        effects: [
          { kind: "send", type: "ping", payload: {} },
          { kind: "startTimer", name: "pongTimeout", ms: PONG_TIMEOUT_MS },
          { kind: "startTimer", name: "ping", ms: PING_INTERVAL_MS },
        ],
      };

    case "PONG":
      return s.status === "online" ? { state: s, effects: cancel("pongTimeout") } : stay(s);

    case "PONG_TIMEOUT": {
      if (s.status !== "online") return stay(s);
      const lost = connectionLost(s, ctx);
      return { state: lost.state, effects: [{ kind: "closeSocket", code: 1000 }, ...lost.effects] };
    }

    case "CLOSED":
      return onClosed(s, e.code, ctx);

    case "RETRY_TIMER":
      if (!s.pc) return stay(s);
      if (s.status === "reconnecting" || (s.status === "offline" && s.autoRetry && s.foreground)) {
        return { state: s, effects: [{ kind: "openSocket", url: wsUrl(s.pc.host, s.pc.port) }] };
      }
      return stay(s);

    case "RETRY_PRESSED":
      if (!s.pc || s.status !== "offline") return stay(s);
      return {
        state: { ...s, status: "connecting", attempt: 0, lastError: null, autoRetry: false },
        effects: [...cancel("retry"), { kind: "openSocket", url: wsUrl(s.pc.host, s.pc.port) }],
      };

    case "FORGET":
      return {
        state: { ...initialState, foreground: s.foreground },
        effects: [
          ...cancel(...ALL_TIMERS),
          // En línea, la PC se entera y borra el dispositivo; sin conexión queda para revocar a mano en el panel.
          ...(s.status === "online" ? [{ kind: "send", type: "device.unpair", payload: {} } as const] : []),
          { kind: "closeSocket", code: 1000 },
          { kind: "deletePc" },
        ],
      };

    case "APP_BACKGROUND": {
      const base = { ...s, foreground: false };
      if (!s.pc || s.status === "unpaired" || s.status === "pairing") return stay(base);
      return {
        state: { ...base, status: "offline", autoRetry: false, attempt: 0 },
        effects: [...cancel(...ALL_TIMERS), { kind: "closeSocket", code: 1000 }],
      };
    }

    case "APP_FOREGROUND": {
      const base = { ...s, foreground: true };
      if (!s.pc || s.status !== "offline") return stay(base);
      return {
        state: { ...base, status: "connecting", attempt: 0, lastError: null, autoRetry: false },
        effects: [...cancel("retry"), { kind: "openSocket", url: wsUrl(s.pc.host, s.pc.port) }],
      };
    }
  }
}
