/** Versión del mensaje de aplicación que va ADENTRO del canal cifrado. */
export const PROTOCOL_VERSION = 1;

export const DEFAULT_WS_PORT = 47800;
export const DEFAULT_ADMIN_PORT = 47801;
/** Donde escucha el agente a la extensión del navegador (solo en 127.0.0.1, D89). */
export const DEFAULT_EXTENSION_PORT = 47802;

/** El código del QR vence a los 2 minutos. */
export const PAIR_CODE_TTL_MS = 120_000;
/** Tiempo que Jay tiene para tocar Permitir en la PC. */
export const PAIR_DECISION_TIMEOUT_MS = 60_000;
/** Tiempo máximo para que llegue pair.request o auth.hello tras conectar. */
export const AUTH_TIMEOUT_MS = 5_000;
/** Cada cuánto el agente manda state.update. */
export const STATE_INTERVAL_MS = 2_000;
export const PING_INTERVAL_MS = 10_000;
export const PONG_TIMEOUT_MS = 5_000;

/** 5 intentos por minuto por IP; al pasarse, bloqueo de 5 minutos. */
export const RATE_LIMIT = {
  attempts: 5,
  windowMs: 60_000,
  blockMs: 300_000,
} as const;

/** Tamaño máximo de un mensaje de aplicación del celu al agente (ya descifrado), en bytes UTF-8. */
export const MAX_MESSAGE_BYTES = 16_384;
/** Lo que manda el agente al celu puede ser más grande (lista de ventanas, biblioteca): hasta 60 KB (D26). */
export const MAX_SERVER_MESSAGE_BYTES = 61_440;

/** Versión del marco exterior (v2 = cifrado con Noise). La v1 (B1) iba en claro y ya no se acepta. */
export const FRAME_VERSION = 2;
/** Tope del marco que viaja por el WebSocket (el `maxPayload` de `ws`): un mensaje de 60 KB cifrado, en base64url, más el sobre. */
export const MAX_FRAME_BYTES = 83_968;
/** Tope de un marco que viene DEL celu (el agente lo exige antes de descifrar). */
export const MAX_CLIENT_FRAME_BYTES = 24_576;
