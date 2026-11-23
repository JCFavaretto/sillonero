import type { CommandError } from "@proyecto-e/protocol";

// Cómo la pestaña Pantallas le pide cosas a la PC. El envío real lo enchufa `connection/index.ts`
// (con el cliente); los tests ponen uno falso. Así `screens/` no depende del socket.

export type CommandOutcome = { ok: true } | { ok: false; reason: CommandError | "timeout" | "offline" };

export type ScreenCommandSender = {
  (type: "monitor.rename", payload: { monitorId: string; nickname: string | null }): Promise<CommandOutcome>;
  (type: "monitor.setEnabled", payload: { monitorId: string; enabled: boolean }): Promise<CommandOutcome>;
  (type: "monitor.setOrder", payload: { order: string[] }): Promise<CommandOutcome>;
  (type: "window.moveActive", payload: { monitorId: string }): Promise<CommandOutcome>;
  (type: "monitor.identify", payload: Record<string, never>): Promise<CommandOutcome>;
};

let sender: ScreenCommandSender | null = null;

export function setCommandSender(next: ScreenCommandSender | null): void {
  sender = next;
}

/** Sin envío configurado (o sin conexión) el resultado es \`offline\`. Nunca rechaza. */
export async function sendScreenCommand(
  type: "monitor.rename" | "monitor.setEnabled" | "monitor.setOrder" | "window.moveActive" | "monitor.identify",
  payload: { monitorId?: string; nickname?: string | null; enabled?: boolean; order?: string[] },
): Promise<CommandOutcome> {
  if (!sender) return { ok: false, reason: "offline" };
  try {
    return await (sender as (t: string, p: unknown) => Promise<CommandOutcome>)(type, payload);
  } catch {
    return { ok: false, reason: "failed" };
  }
}
