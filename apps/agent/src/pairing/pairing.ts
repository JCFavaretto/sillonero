import { PAIR_CODE_TTL_MS, PAIR_DECISION_TIMEOUT_MS } from "@proyecto-e/protocol";
import type { Device } from "../config/schema";
import type { Clock, Logger, Random, TimerHandle } from "../ports";
import { generatePairCode, safeEqual } from "./tokens";

// Máquina de estados del emparejamiento (docs/PLAN.md 4.7). No conoce sockets:
// la sesión le pasa el pedido y espera el resultado.

/** Por qué un pedido de emparejamiento no prosperó antes de que Jay decida. */
export type PairRequestFailure = "invalid_code" | "busy";
/** Cómo terminó un pedido que sí llegó a esperar la decisión de Jay. */
export type PairFailure = "rejected" | "timeout";

export type PairOutcome =
  | { ok: true; deviceId: string }
  | { ok: false; reason: PairFailure | "cancelled" }; // "cancelled": el celu se fue o se apagó el remoto

export type PairRequestHandle =
  | { status: "failed"; reason: PairRequestFailure }
  | {
      status: "pending";
      /** Se resuelve cuando Jay decide, vence el tiempo o se cancela. Nunca rechaza. */
      outcome: Promise<PairOutcome>;
      /** El celu se desconectó: descarta el pedido. No hace nada si ya terminó. */
      cancel(): void;
    };

export type PairingStatus =
  | { state: "idle" }
  | { state: "showing"; code: string; expiresAt: number }
  | { state: "awaiting"; deviceName: string; platform: Device["platform"]; ip?: string; expiresAt: number };

export interface PairingDeps {
  clock: Clock;
  random: Random;
  log: Logger;
  remoteEnabled: boolean;
  /** Guarda el dispositivo nuevo (con la clave pública del celu). */
  saveDevice(device: Device): Promise<void>;
  /** Deshace `saveDevice` si el pedido se canceló mientras se guardaba (el celu ya no está para enterarse). */
  removeDevice?(deviceId: string): Promise<void>;
  codeTtlMs?: number;
  decisionTimeoutMs?: number;
}

export interface Pairing {
  status(): PairingStatus;
  /** Admin "Emparejar": muestra un código nuevo. `null` si el remoto está apagado o hay un pedido esperando. */
  start(): { code: string; expiresAt: number } | null;
  /** Pedido de emparejamiento del celu (hs1 `pair`). La sesión cuenta el intento para el rate limit. */
  request(req: {
    code: string;
    deviceName: string;
    platform: Device["platform"];
    /** Clave pública X25519 del celu, que Noise ya autenticó. */
    publicKey: string;
    ip?: string;
  }): PairRequestHandle;
  /** Admin "Permitir". `null` si no había pedido. Si no se puede guardar, rechaza y el pedido sigue vivo. */
  allow(): Promise<Device | null>;
  /** Admin "Rechazar". `false` si no había pedido. */
  reject(): boolean;
  setRemoteEnabled(enabled: boolean): void;
}

type Showing = { kind: "showing"; code: string; expiresAt: number; timer: TimerHandle };
type Awaiting = {
  kind: "awaiting";
  deviceName: string;
  platform: Device["platform"];
  publicKey: string;
  ip: string | undefined;
  expiresAt: number;
  timer: TimerHandle;
  deciding: boolean;
  resolve(outcome: PairOutcome): void;
};
type Internal = { kind: "idle" } | Showing | Awaiting;

export function createPairing(deps: PairingDeps): Pairing {
  const { clock, random, log } = deps;
  const codeTtlMs = deps.codeTtlMs ?? PAIR_CODE_TTL_MS;
  const decisionTimeoutMs = deps.decisionTimeoutMs ?? PAIR_DECISION_TIMEOUT_MS;
  let remoteEnabled = deps.remoteEnabled;
  let current: Internal = { kind: "idle" };

  function toIdle(): void {
    if (current.kind !== "idle") clock.clear(current.timer);
    current = { kind: "idle" };
  }

  function finish(awaiting: Awaiting, outcome: PairOutcome): void {
    if (current !== awaiting) return;
    toIdle();
    awaiting.resolve(outcome);
  }

  return {
    status() {
      switch (current.kind) {
        case "idle":
          return { state: "idle" };
        case "showing":
          return { state: "showing", code: current.code, expiresAt: current.expiresAt };
        case "awaiting":
          return {
            state: "awaiting",
            deviceName: current.deviceName,
            platform: current.platform,
            ...(current.ip !== undefined ? { ip: current.ip } : {}),
            expiresAt: current.expiresAt,
          };
      }
    },

    start() {
      if (!remoteEnabled) return null;
      // El plan no define "Emparejar" con un pedido esperando: no se toca el pedido.
      if (current.kind === "awaiting") return null;
      toIdle();
      const code = generatePairCode(random);
      const expiresAt = clock.now() + codeTtlMs;
      const showing: Showing = {
        kind: "showing",
        code,
        expiresAt,
        timer: clock.setTimeout(() => {
          if (current === showing) toIdle();
        }, codeTtlMs),
      };
      current = showing;
      log.info("pairing code shown", { expiresAt });
      return { code, expiresAt };
    },

    request(req) {
      if (current.kind === "awaiting") return { status: "failed", reason: "busy" };
      if (
        current.kind !== "showing" ||
        clock.now() >= current.expiresAt ||
        !safeEqual(req.code, current.code)
      ) {
        return { status: "failed", reason: "invalid_code" };
      }

      // Código correcto: se consume ya, antes de que Jay decida.
      toIdle();
      let resolve!: (o: PairOutcome) => void;
      const outcome = new Promise<PairOutcome>((r) => (resolve = r));
      const awaiting: Awaiting = {
        kind: "awaiting",
        deviceName: req.deviceName,
        platform: req.platform,
        publicKey: req.publicKey,
        ip: req.ip,
        expiresAt: clock.now() + decisionTimeoutMs,
        timer: clock.setTimeout(() => {
          if (current === awaiting && !awaiting.deciding) {
            log.info("pairing request timed out");
            finish(awaiting, { ok: false, reason: "timeout" });
          }
        }, decisionTimeoutMs),
        deciding: false,
        resolve,
      };
      current = awaiting;
      log.info("pairing request received", { deviceName: req.deviceName, platform: req.platform });
      return { status: "pending", outcome, cancel: () => finish(awaiting, { ok: false, reason: "cancelled" }) };
    },

    async allow() {
      const awaiting = current;
      if (awaiting.kind !== "awaiting" || awaiting.deciding) return null;
      awaiting.deciding = true;

      const device: Device = {
        id: random.uuid(),
        name: awaiting.deviceName,
        platform: awaiting.platform,
        publicKey: awaiting.publicKey,
        pairedAt: new Date(clock.now()).toISOString(),
        lastSeenAt: null,
      };
      try {
        await deps.saveDevice(device);
      } catch (err) {
        awaiting.deciding = false; // el pedido sigue vivo: se puede reintentar
        throw err;
      }
      if (current !== awaiting) {
        // El celu se fue (o se apagó el remoto) mientras se guardaba.
        log.warn("pairing cancelled while saving: device discarded", { deviceId: device.id });
        await deps.removeDevice?.(device.id).catch((err: unknown) =>
          log.error("could not discard device", { deviceId: device.id, error: String(err) }),
        );
        return null;
      }
      log.info("device paired", { deviceId: device.id, deviceName: device.name });
      finish(awaiting, { ok: true, deviceId: device.id });
      return device;
    },

    reject() {
      const awaiting = current;
      if (awaiting.kind !== "awaiting" || awaiting.deciding) return false;
      log.info("pairing request rejected");
      finish(awaiting, { ok: false, reason: "rejected" });
      return true;
    },

    setRemoteEnabled(enabled) {
      remoteEnabled = enabled;
      if (enabled) return;
      if (current.kind === "awaiting") finish(current, { ok: false, reason: "cancelled" });
      toIdle(); // invalida el código
    },
  };
}
