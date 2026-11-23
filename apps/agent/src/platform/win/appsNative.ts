import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AppCatalog, AppLauncher, IconExtractor } from "../../ports";
import { windowsPowerShell } from "./identify";
import { defaultBrowserExe, newWindowArgs, privateArgs } from "./privateBrowsing";

// Catálogo de apps, íconos y lanzador reales (docs/PLAN.md 8.3.4). Todo con procesos de vida corta y SIN shell:
// lo que llega a un argumento ya fue validado (AppID del catálogo, link http(s), claves `i_…`).

const script = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));
const PS_FLAGS = ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File"];
const sysRoot = () => process.env.SystemRoot ?? "C:\\Windows";

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

export function createWindowsCatalog(): AppCatalog {
  return {
    async list() {
      const out = await run(windowsPowerShell(), [...PS_FLAGS, script("catalog.ps1")], 15_000);
      const parsed: unknown = JSON.parse(out.trim() || "[]");
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .filter((r): r is { appId: string; name: string } => typeof r?.appId === "string" && typeof r?.name === "string" && r.appId !== "")
        .map((r) => ({ appId: r.appId, name: r.name }));
    },
  };
}

export function createWindowsIconExtractor(): IconExtractor {
  return {
    async extract(items, outDir) {
      if (items.length === 0) return;
      const b64 = Buffer.from(JSON.stringify(items), "utf8").toString("base64");
      await run(windowsPowerShell(), [...PS_FLAGS, script("icons.ps1"), "-OutDir", outDir, "-ItemsB64", b64], 30_000);
    },
  };
}

function launch(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const cp = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: false, shell: false });
    cp.once("error", reject);
    cp.once("spawn", () => {
      cp.unref();
      resolve();
    });
  });
}

/** Los argumentos exactos de cada lanzamiento (el test verifica que son solo estos: nada pasa por un shell). */
export const launchArgs = {
  app: (appId: string) => ["shell:AppsFolder\\" + appId],
  url: (url: string) => ["url.dll,FileProtocolHandler", url],
};

/** Apps con `explorer.exe shell:AppsFolder\<AppID>`; links con `rundll32 url.dll,FileProtocolHandler <url>`. */
export function createWindowsLauncher(): AppLauncher {
  return {
    openApp: (appId) => launch(sysRoot() + "\\explorer.exe", launchArgs.app(appId)),
    openUrl: async (url, opts) => {
      // Se normaliza con URL (Node sí la tiene) y se vuelve a exigir http(s): lo que llega a rundll32 ya pasó dos filtros.
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("solo http(s)");
      const mode = opts?.mode ?? "tab";
      if (mode === "tab") return launch(sysRoot() + "\\System32\\rundll32.exe", launchArgs.url(u.href));
      // Ventana nueva o de incógnito: el .exe del navegador predeterminado con su opción. Si no se sabe cuál es, no se abre nada.
      const exe = await defaultBrowserExe();
      const args = exe ? (mode === "private" ? privateArgs(exe, u.href) : newWindowArgs(exe, u.href)) : null;
      if (!exe || !args) throw new Error("not_supported: no sé abrir esa ventana con el navegador predeterminado");
      return launch(exe, args);
    },
    openBrowserWindow: async (exePath, mode) => {
      const args = mode === "private" ? privateArgs(exePath, null) : newWindowArgs(exePath, null);
      if (!args) throw new Error("not_supported: ese programa no es un navegador conocido");
      return launch(exePath, args);
    },
  };
}
