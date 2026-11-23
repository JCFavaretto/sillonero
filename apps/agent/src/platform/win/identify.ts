import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Clock, Identifier, IdentifyItem, Logger } from "../../ports";

// "Identificar": un número grande en cada pantalla prendida durante unos segundos. Lo dibuja un script de
// PowerShell de vida corta (`identify.ps1`, WinForms), porque el agente no tiene ventanas propias.
// Al script solo le llegan enteros que arma el agente a partir de lo que leyó Windows: nada del celu.

export interface SpawnedProcess {
  /** Se cumple cuando el proceso arrancó; rechaza si no se pudo lanzar. */
  started: Promise<void>;
  /** Se cumple cuando terminó (por la razón que sea). Nunca rechaza. */
  exited: Promise<void>;
  kill(): void;
}

const SECONDS = 2;
/** Margen para que arranque PowerShell antes de matarlo si se colgó. */
const KILL_MARGIN_S = 6;
const MAX_INDEX = 16;
const MAX_COORD = 100_000;

const int = (n: number) => Number.isInteger(n) && Math.abs(n) <= MAX_COORD;

function encode(items: IdentifyItem[]): string {
  if (items.length === 0 || items.length > MAX_INDEX) throw new Error("no hay pantallas para identificar");
  return items
    .map(({ index, bounds: b }) => {
      const ok = Number.isInteger(index) && index >= 1 && index <= MAX_INDEX && int(b.x) && int(b.y) && int(b.w) && int(b.h) && b.w > 0 && b.h > 0;
      if (!ok) throw new Error("datos de pantalla inválidos para identificar");
      return [index, b.x, b.y, b.w, b.h].join(",");
    })
    .join(";");
}

export function createIdentifier(deps: {
  spawn(cmd: string, args: string[]): SpawnedProcess;
  scriptPath: string;
  powershell: string;
  clock: Clock;
  log: Logger;
}): Identifier {
  return {
    async show(items) {
      const encoded = encode(items); // si algo no cierra, se rechaza antes de lanzar nada
      const proc = deps.spawn(deps.powershell, [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        deps.scriptPath,
        "-Items",
        encoded,
        "-Seconds",
        String(SECONDS),
      ]);
      await proc.started;

      // Si el script se cuelga, los cuadros quedarían en pantalla: se lo mata pasado el tiempo.
      const killer = deps.clock.setTimeout(() => {
        deps.log.warn("identify: el script no terminó, se lo mata");
        proc.kill();
      }, (SECONDS + KILL_MARGIN_S) * 1000);
      const done = proc.exited.finally(() => deps.clock.clear(killer));
      return { done };
    },
  };
}

/** PowerShell de Windows (ruta absoluta, como `ComSpec` en `Browser.open`). */
export function windowsPowerShell(): string {
  return `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/** Lanza el proceso de verdad: sin ventana de consola y sin entrada ni salida. */
export function spawnProcess(cmd: string, args: string[]): SpawnedProcess {
  const cp = spawn(cmd, args, { windowsHide: true, stdio: "ignore" });
  return {
    started: new Promise<void>((resolve, reject) => {
      cp.once("spawn", () => resolve());
      cp.once("error", reject);
    }),
    exited: new Promise<void>((resolve) => {
      cp.once("exit", () => resolve());
      cp.once("error", () => resolve());
    }),
    kill: () => void cp.kill(),
  };
}

/** El identificador real (Windows): usa `identify.ps1`, que está al lado de este archivo. */
export function createWindowsIdentifier(deps: { clock: Clock; log: Logger }): Identifier {
  return createIdentifier({
    spawn: spawnProcess,
    scriptPath: fileURLToPath(new URL("./identify.ps1", import.meta.url)),
    powershell: windowsPowerShell(),
    clock: deps.clock,
    log: deps.log,
  });
}
