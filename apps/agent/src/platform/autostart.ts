import { execFile } from "node:child_process";
import type { Autostart } from "../ports";

// Arranque con Windows por usuario (docs/PLAN.md 8.6, D72): una entrada en HKCU\...\Run. Sin administrador, sin servicio.
// Se usa `reg.exe` con argumentos separados (nunca por un shell), así nada de lo que haya en una ruta se interpreta.

export const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const RUN_NAME = "ProyectoE";

export type RegRunner = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Lo que Windows ejecuta al iniciar sesión: cada parte entre comillas y `--background`. Rechaza lo que rompería las comillas. */
export function buildRunCommand(execPath: string, args: readonly string[]): string {
  const parts = [execPath, ...args];
  for (const p of parts) {
    if (/["%\r\n\0]/.test(p)) throw new Error(`no se puede armar el comando de inicio: la ruta o el argumento tiene un carácter no permitido (${JSON.stringify(p)})`);
  }
  return `${parts.map((p) => `"${p}"`).join(" ")} --background`;
}

/** Portable: Windows abre el lanzador (`.vbs`) con wscript, que arranca el agente sin ventana de consola. */
export function buildLauncherCommand(wscriptExe: string, launcherPath: string): string {
  for (const p of [wscriptExe, launcherPath]) {
    if (/["%\r\n\0]/.test(p)) throw new Error(`no se puede armar el comando de inicio: la ruta tiene un carácter no permitido (${JSON.stringify(p)})`);
  }
  return `"${wscriptExe}" "${launcherPath}" --background`;
}

const regExe = () => `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\reg.exe`;

/** Ejecuta `reg.exe` real (sin shell, sin ventana). */
export const execReg: RegRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 10_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((err as unknown as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (err ? err.message : "")) });
    });
  });

export function createAutostart(opts: { run?: RegRunner; command: string; name?: string }): Autostart {
  const run = opts.run ?? execReg;
  const name = opts.name ?? RUN_NAME;
  const failure = (what: string, r: { stderr: string; stdout: string }) => new Error(`${what}: ${(r.stderr || r.stdout).trim().slice(0, 200) || "reg.exe falló"}`);

  return {
    async read() {
      const r = await run(regExe(), ["query", RUN_KEY, "/v", name]);
      // reg.exe devuelve 1 si la entrada no existe: eso es "apagado", no un error.
      return { enabled: r.code === 0 && r.stdout.includes(name) };
    },

    async set(on) {
      if (on) {
        const r = await run(regExe(), ["add", RUN_KEY, "/v", name, "/t", "REG_SZ", "/d", opts.command, "/f"]);
        if (r.code !== 0) throw failure("No se pudo escribir la entrada de inicio", r);
        return;
      }
      const r = await run(regExe(), ["delete", RUN_KEY, "/v", name, "/f"]);
      if (r.code === 0) return;
      // Borrar algo que no estaba no es un problema: se vuelve a leer para saber la verdad.
      const now = await run(regExe(), ["query", RUN_KEY, "/v", name]);
      if (now.code !== 0) return;
      throw failure("No se pudo borrar la entrada de inicio", r);
    },
  };
}
