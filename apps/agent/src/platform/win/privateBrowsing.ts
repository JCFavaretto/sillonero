import { execFile } from "node:child_process";

// Navegación privada (docs/PLAN.md D93): qué opción entiende cada navegador y cuál es el navegador predeterminado.
// Regla: si no se sabe abrir en privado, NO se abre en una ventana común (se devuelve un error).

/** La opción de ventana privada de cada navegador, por el nombre de su .exe. Los que no figuran no se soportan. */
const PRIVATE_FLAG: Record<string, string> = {
  "chrome.exe": "--incognito",
  "chromium.exe": "--incognito",
  "brave.exe": "--incognito",
  "vivaldi.exe": "--incognito",
  "msedge.exe": "--inprivate",
  "opera.exe": "--private",
  "firefox.exe": "-private-window",
};

const exeName = (p: string) => p.slice(p.lastIndexOf("\\") + 1).toLowerCase();
const isExePath = (p: string) => /^[A-Za-z]:\\[^"<>|?*\r\n]+\.exe$/i.test(p);

/** La opción de ventana nueva (no privada) de cada navegador. */
const NEW_WINDOW_FLAG: Record<string, string> = {
  "chrome.exe": "--new-window",
  "chromium.exe": "--new-window",
  "brave.exe": "--new-window",
  "vivaldi.exe": "--new-window",
  "msedge.exe": "--new-window",
  "opera.exe": "--new-window",
  "firefox.exe": "-new-window",
};

/** Los argumentos para abrir una ventana común y nueva (con la dirección, si viene). `null` si no es un navegador conocido. */
export function newWindowArgs(exePath: string, url: string | null): string[] | null {
  if (!isExePath(exePath)) return null;
  const flag = NEW_WINDOW_FLAG[exeName(exePath)];
  if (!flag) return null;
  return url === null ? [flag] : [flag, url];
}

/**
 * Los argumentos para abrir una ventana privada de ese navegador (con la dirección, si viene). `null` si el .exe no es
 * un navegador conocido o la ruta no es una ruta de .exe.
 */
export function privateArgs(exePath: string, url: string | null): string[] | null {
  if (!isExePath(exePath)) return null;
  const flag = PRIVATE_FLAG[exeName(exePath)];
  if (!flag) return null;
  return url === null ? [flag] : [flag, url];
}

/** Saca la ruta del .exe de un comando del registro: `"C:\…\chrome.exe" --single-argument %1` o `C:\…\app.exe %1`. */
export function parseOpenCommand(command: string): string | null {
  const text = command.trim();
  const quoted = /^"([^"]+)"/.exec(text);
  const path = quoted ? quoted[1]! : (/^(.+?\.exe)(?:\s|$)/i.exec(text)?.[1] ?? "");
  return isExePath(path) ? path : null;
}

/** El valor de una línea de `reg query`: `    ProgId    REG_SZ    ChromeHTML`. */
export function parseRegValue(output: string): string | null {
  const m = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(output);
  return m ? m[1]! : null;
}

function reg(args: string[]): Promise<string> {
  const exe = (process.env.SystemRoot ?? "C:\\Windows") + "\\System32\\reg.exe";
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: 5_000, encoding: "utf8" }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** La ruta del .exe del navegador predeterminado para https, leída del registro (solo lectura). `null` si no se pudo saber. */
export async function defaultBrowserExe(query: (args: string[]) => Promise<string> = reg): Promise<string | null> {
  try {
    const choice = await query(["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", "/v", "ProgId"]);
    const progId = parseRegValue(choice);
    if (!progId || !/^[\w.-]{1,80}$/.test(progId)) return null;
    const command = await query(["query", `HKCR\\${progId}\\shell\\open\\command`, "/ve"]);
    const value = parseRegValue(command);
    return value ? parseOpenCommand(value) : null;
  } catch {
    return null;
  }
}
