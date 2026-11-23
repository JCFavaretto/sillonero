import type { CommandOutcome, CommandType, FireRequest, FireType, QueryType, SendCommand } from "@/connection/client";

// Cómo las pantallas de Apps y Escenas le piden cosas a la PC. El envío real lo enchufa `connection/index.ts`;
// los tests ponen uno falso. Así `apps/` no depende del socket.

export interface AppsBridge {
  command: SendCommand;
  query(type: QueryType, payload: Record<string, unknown>): string | null;
  /** B5: mover y scroll del Pad, sin respuesta. */
  fire?<T extends FireType>(type: T, payload: Extract<FireRequest, { type: T }>["payload"]): boolean;
  /** B5: pide medir la latencia (ping); la respuesta llega por onLatency. */
  measure?(): void;
}

let bridge: AppsBridge | null = null;

export function setAppsBridge(next: AppsBridge | null): void {
  bridge = next;
}

/** Una escena puede tardar hasta 60 s en la PC. */
export const SCENE_TIMEOUT_MS = 65_000;

/** Sin conexión (o sin enlace configurado) el resultado es `offline`. Nunca rechaza. */
export async function sendAppCommand(type: CommandType, payload: unknown, opts?: { timeoutMs?: number }): Promise<CommandOutcome> {
  if (!bridge) return { ok: false, reason: "offline" };
  try {
    return await (bridge.command as (t: string, p: unknown, o?: { timeoutMs?: number }) => Promise<CommandOutcome>)(type, payload, opts);
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Una pregunta sin `command.result` (búsqueda, íconos). Devuelve el id del pedido o `null` si no hay conexión. */
export function queryApps(type: QueryType, payload: Record<string, unknown>): string | null {
  return bridge ? bridge.query(type, payload) : null;
}

/** Mover o scroll del Pad: no espera respuesta. `false` si no hay conexión. */
export function firePad<T extends FireType>(type: T, payload: Extract<FireRequest, { type: T }>["payload"]): boolean {
  return bridge?.fire ? bridge.fire(type, payload) : false;
}

export function measurePad(): void {
  bridge?.measure?.();
}
