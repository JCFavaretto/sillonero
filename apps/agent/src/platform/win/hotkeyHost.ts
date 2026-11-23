import type { HotkeyRegistration } from "../../ports";
import type { HotkeyMessage, HotkeyRequest } from "./hotkeyClient";
import { createHotkeyNative } from "./hotkeyNative";

// Proceso hijo de ATAJOS (docs/PLAN.md D67). Lo lanza el agente con fork() y le habla por IPC. Registra con RegisterHotKey y
// consulta la cola de mensajes cada 25 ms desde el mismo hilo. Si el padre se va, el canal se corta y este proceso termina
// solo; al terminar el proceso Windows suelta todos los atajos.

const POLL_MS = 25;
const MAX_KEYS = 64;

const native = createHotkeyNative();

function send(msg: HotkeyMessage): void {
  process.send?.(msg);
}

const isKey = (k: unknown): k is HotkeyRegistration =>
  typeof k === "object" && k !== null && Number.isInteger((k as HotkeyRegistration).id) && Number.isInteger((k as HotkeyRegistration).vk);

process.on("message", (raw: unknown) => {
  const req = raw as Partial<HotkeyRequest> | null;
  const id = typeof req?.id === "number" && Number.isInteger(req.id) ? req.id : -1;
  try {
    if (req?.op !== "set") throw new Error(`operación desconocida: ${String(req?.op)}`);
    const keys = req.args?.keys;
    if (!Array.isArray(keys) || keys.length > MAX_KEYS || !keys.every(isKey)) throw new Error("set: keys inválidas");
    send({ id, ok: true, result: native.set(keys) });
  } catch (err) {
    send({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

setInterval(() => {
  try {
    for (const hotkey of native.poll()) send({ event: "pressed", hotkey });
  } catch {
    // un error de lectura no debe tirar el proceso: el próximo turno reintenta
  }
}, POLL_MS);

process.on("disconnect", () => {
  native.unregisterAll();
  process.exit(0);
});
