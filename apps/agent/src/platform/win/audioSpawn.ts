import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { AudioChild } from "./audioClient";

// Lanza el hijo de audio real: un PowerShell de vida larga (`audioHost.ps1`) que compila el C# de `audioNative.cs`
// una vez y atiende un pedido JSON por línea de stdin (docs/PLAN.md 8.4.4, D27). Nada de lo que se le pide va por
// la línea de comandos: los argumentos de arranque son fijos y solo llevan la ruta del script.

/** Los argumentos de `powershell.exe`: fijos. La única parte variable es la ruta del script, que arma el agente. */
export function audioHostArgs(scriptPath: string): string[] {
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
}

/** Largo máximo de una línea del hijo: una respuesta de audio pesa pocos KB, y las carátulas ~15 KB en base64. */
const MAX_LINE = 256 * 1024;

/**
 * Junta lo que llega de stdout (en pedazos, a veces con un carácter partido entre dos pedazos) y entrega líneas
 * completas. Una línea que pasa `max` se tira entera: un hijo roto no puede llenar la memoria del agente.
 */
export function createLineSplitter(onLine: (line: string) => void, max = MAX_LINE): (chunk: Buffer | string) => void {
  const decoder = new StringDecoder("utf8");
  let buf = "";
  let dropping = false;
  return (chunk) => {
    buf += typeof chunk === "string" ? chunk : decoder.write(chunk);
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (dropping) dropping = false;
      else if (line.length <= max) onLine(line);
    }
    if (buf.length > max) {
      buf = "";
      dropping = true;
    }
  };
}

/** Lanza el PowerShell real. `powershell` y `scriptPath` los arma el agente (ver `main.ts`); nada viene del celu. */
export function spawnAudioHost(powershell: string, scriptPath: string): AudioChild {
  const cp = spawn(powershell, audioHostArgs(scriptPath), { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, shell: false });
  let onLine: (l: string) => void = () => undefined;
  const feed = createLineSplitter((l) => onLine(l));
  cp.stdout.on("data", feed);
  return {
    write: (line) => void cp.stdin.write(line + "\n", "utf8"),
    kill: () => void cp.kill(),
    onLine: (cb) => void (onLine = cb),
    onExit: (cb) => {
      cp.on("exit", (code, signal) => cb(`code ${code ?? "?"} signal ${signal ?? "-"}`));
      cp.on("error", (err) => cb(String(err)));
      cp.stdin.on("error", () => undefined); // el hijo se fue: ya lo avisa "exit"
    },
  };
}

/** Ruta del script junto a este archivo. */
export const AUDIO_HOST_SCRIPT = fileURLToPath(new URL("./audioHost.ps1", import.meta.url));
