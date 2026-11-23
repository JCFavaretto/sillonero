import { z } from "zod";

/** Códigos de error que viajan en un mensaje `error` (y en los resultados de parseo). */
export const ErrorCode = z.enum([
  "bad_json",
  "bad_message",
  "unknown_type",
  "incompatible",
  "too_large",
  "not_authenticated",
  "already_authenticated",
  "rate_limited",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Códigos de cierre del WebSocket. 1xxx son estándar; 4xxx son nuestros. */
export const CloseCode = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  TOO_BIG: 1009,
  PROTOCOL_ERROR: 4000,
  AUTH_TIMEOUT: 4001,
  AUTH_FAILED: 4002,
  REVOKED: 4003,
  INCOMPATIBLE: 4004,
  PAIR_CLOSED: 4005,
  RATE_LIMITED: 4008,
  NOT_PRIVATE: 4009,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];
