import type { InputKeyEvent } from "../../ports";
import type { InputReply, InputRequest } from "./inputClient";
import { createInputNative } from "./inputNative";

// Proceso hijo de ENTRADA (docs/PLAN.md D56): aparte del de ventanas, así una lectura lenta (`windows.list`) no frena el mouse.
// Lo lanza el agente con fork() y le habla por IPC. Si el padre se va, el canal se corta y este proceso termina solo.

const native = createInputNative();

function reply(msg: InputReply): void {
  process.send?.(msg);
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

process.on("message", (raw: unknown) => {
  const req = raw as Partial<InputRequest> | null;
  const id = isInt(req?.id) ? req.id : -1;
  const a = (req?.args ?? {}) as Record<string, unknown>;
  try {
    switch (req?.op) {
      case "cursor":
        return reply({ id, ok: true, result: native.cursor() });
      case "monitors":
        return reply({ id, ok: true, result: native.monitors() });
      case "moveAbs":
        if (!isInt(a.nx) || !isInt(a.ny)) throw new Error("moveAbs: nx y ny enteros");
        native.moveAbs(a.nx, a.ny);
        return reply({ id, ok: true, result: null });
      case "wheel":
        if (!isInt(a.dx) || !isInt(a.dy)) throw new Error("wheel: dx y dy enteros");
        native.wheel(a.dx, a.dy);
        return reply({ id, ok: true, result: null });
      case "button":
        if ((a.button !== "left" && a.button !== "middle" && a.button !== "right") || (a.action !== "click" && a.action !== "down" && a.action !== "up")) throw new Error("button: argumentos inválidos");
        native.button(a.button, a.action);
        return reply({ id, ok: true, result: null });
      case "keys":
        if (!Array.isArray(a.events)) throw new Error("keys: events");
        native.keys(a.events as InputKeyEvent[]);
        return reply({ id, ok: true, result: null });
      case "text":
        if (!Array.isArray(a.units)) throw new Error("text: units");
        native.text(a.units as number[]);
        return reply({ id, ok: true, result: null });
      case "elevated":
        return reply({ id, ok: true, result: native.elevated() });
      default:
        return reply({ id, ok: false, error: `operación desconocida: ${String(req?.op)}` });
    }
  } catch (err) {
    reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

process.on("disconnect", () => process.exit(0));
