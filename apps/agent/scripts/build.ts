import { build } from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `pnpm build:agent` (docs/PLAN.md 8.6, D74): arma la carpeta portable `dist/proyecto-e/`, que corre sin pnpm ni el repo.
//
//   proyecto-e/
//     proyecto-e.exe            node.exe copiado y renombrado (el nombre que se ve en el Administrador de tareas)
//     Iniciar Sillonero.vbs    lanzador sin consola (doble clic, y lo usa "Iniciar con Windows")
//     LEEME.txt
//     package.json              solo la versión
//     assets/tray.png
//     app/                      agent.mjs + los tres procesos hijo (.mjs) + los .ps1/.cs de los hijos de PowerShell
//     node_modules/             koffi y tray-hook con sus binarios (lo único que no se puede juntar en un archivo)
//
// Los hijos se lanzan "por extensión, junto al agente" (spawn.ts), y los scripts se buscan con import.meta.url: por eso
// todo vive plano en app/ y `../package.json` y `../assets/tray.png` caen en la raíz, igual que en el repo.

export const AGENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = resolve(AGENT_DIR, "..", "..");
export const DEFAULT_OUT = join(REPO_DIR, "dist", "proyecto-e");
/** Marca que deja el build: sin ella no se borra ninguna carpeta (no vaya a ser que apunten a otra cosa). */
export const MARKER = ".proyecto-e-build";

export const ENTRIES = [
  { in: "src/main.ts", out: "agent.mjs" },
  { in: "src/platform/win/host.ts", out: "host.mjs" },
  { in: "src/platform/win/inputHost.ts", out: "inputHost.mjs" },
  { in: "src/platform/win/hotkeyHost.ts", out: "hotkeyHost.mjs" },
] as const;

const WIN_SRC = "src/platform/win";
export const STATIC_FILES = [
  { from: `${WIN_SRC}/audioHost.ps1`, to: "app/audioHost.ps1" },
  { from: `${WIN_SRC}/audioNative.cs`, to: "app/audioNative.cs" },
  { from: `${WIN_SRC}/catalog.ps1`, to: "app/catalog.ps1" },
  { from: `${WIN_SRC}/icons.ps1`, to: "app/icons.ps1" },
  { from: `${WIN_SRC}/identify.ps1`, to: "app/identify.ps1" },
  { from: "assets/tray.png", to: "assets/tray.png" },
] as const;

/** Lo que se copia de `apps/extension` a `extension-src/` (lo mismo que `src/browser/install.ts`). */
export const EXTENSION_FILES = ["manifest.json", "background.js", "lib"] as const;

/** Paquetes que se copian enteros a node_modules/ (nombre → dónde buscarlos). `koffi` y `tray-hook` traen su binario en un paquete hermano. */
const NATIVE_PACKAGES = [
  { name: "koffi", via: null },
  { name: "@koromix/koffi-win32-x64", via: "koffi" },
  { name: "tray-hook", via: null },
  { name: "@phtdacosta/tray-hook-win32-x64", via: "tray-hook" },
] as const;

/** El lanzador sin consola. Solo reenvía `--background`: nada más del exterior llega a la línea de comandos. */
export function launcherScript(): string {
  return [
    "' Inicia Sillonero sin ventana de consola. Doble clic, o lo usa la entrada de \"Iniciar con Windows\".",
    "Option Explicit",
    "Dim sh, fso, dir, extra, i",
    'Set sh = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    "dir = fso.GetParentFolderName(WScript.ScriptFullName)",
    'extra = ""',
    "For i = 0 To WScript.Arguments.Count - 1",
    '  If WScript.Arguments(i) = "--background" Then extra = " --background"',
    "Next",
    "sh.CurrentDirectory = dir",
    'sh.Run """" & dir & "\\proyecto-e.exe"" """ & dir & "\\app\\agent.mjs""" & extra, 0, False',
    "",
  ].join("\r\n");
}

const README = [
  "Sillonero — carpeta portable",
  "=============================",
  "",
  "Esta carpeta es todo el agente de la PC: no hace falta instalar nada (ni Node, ni pnpm, ni el código).",
  "",
  "Cómo se usa",
  "  1. Doble clic en \"Iniciar Sillonero.vbs\". No abre ninguna ventana de consola: aparece el ícono en la bandeja de Windows",
  "     (si no lo ves, está detrás de la flecha ^ al lado del reloj; arrastralo a la barra para dejarlo fijo) y se abre el panel.",
  "  2. En el panel, prendé el acceso remoto y emparejá el celu con el QR.",
  "  3. Para que arranque solo al prender la PC: tarjeta \"Iniciar con Windows\" del panel, o el ítem del mismo nombre en la bandeja.",
  "     Eso solo apunta a esta carpeta: si la movés, apagalo y volvelo a prender desde la nueva ubicación.",
  "  4. Para cerrarlo: ícono de la bandeja > Salir.",
  "",
  "Dónde guarda las cosas: %APPDATA%\\proyecto-e (configuración, registro de actividad). La clave privada de la PC va cifrada",
  "con tu cuenta de Windows: copiar ese archivo a otra cuenta o PC no sirve.",
  "",
  "Para probarlo desde una consola (muestra errores): proyecto-e.exe app\\agent.mjs",
  "Para borrarlo: cerrá el agente, apagá \"Iniciar con Windows\" y borrá esta carpeta.",
  "",
].join("\r\n");

function resolvePackageDir(name: string, via: string | null): string {
  const base = join(AGENT_DIR, "node_modules", via ?? name);
  if (!existsSync(base)) throw new Error(`falta ${via ?? name} en node_modules: corré pnpm install`);
  const real = realpathSync(base);
  if (via === null) return real;
  // El paquete hermano (el binario) vive junto al que lo pide, en el node_modules de pnpm.
  const req = createRequire(join(real, "package.json"));
  let dir = dirname(real);
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    dir = dirname(dir);
  }
  return dirname(req.resolve(`${name}/package.json`));
}

export interface BuildOptions {
  outDir?: string;
  /** Copiar node.exe como proyecto-e.exe (80 MB). Los tests lo apagan. */
  copyNode?: boolean;
}

export async function buildAgent(opts: BuildOptions = {}): Promise<string> {
  const out = resolve(opts.outDir ?? DEFAULT_OUT);
  if (existsSync(out)) {
    const hasMarker = existsSync(join(out, MARKER));
    if (!hasMarker && readdirSync(out).length > 0) throw new Error(`${out} no tiene la marca de un build anterior (${MARKER}): no la borro`);
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(join(out, "app"), { recursive: true });

  await build({
    entryPoints: Object.fromEntries(ENTRIES.map((e) => [e.out.replace(/\.mjs$/, ""), join(AGENT_DIR, e.in)])),
    outdir: join(out, "app"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    external: ["koffi", "tray-hook"],
    // Los paquetes CommonJS que se juntan (ws, qrcode) piden `require` de módulos de Node: en ESM no existe sin esto.
    banner: { js: 'import { createRequire as __pe_createRequire } from "node:module"; const require = __pe_createRequire(import.meta.url);' },
  });

  for (const f of STATIC_FILES) {
    mkdirSync(dirname(join(out, f.to)), { recursive: true });
    copyFileSync(join(AGENT_DIR, f.from), join(out, f.to));
  }

  // La extensión del navegador viaja dentro de la carpeta; el agente la copia a %APPDATA% al arrancar (src/browser/install.ts).
  for (const f of EXTENSION_FILES) cpSync(join(REPO_DIR, "apps", "extension", f), join(out, "extension-src", f), { recursive: true });

  for (const p of NATIVE_PACKAGES) {
    const dest = join(out, "node_modules", ...p.name.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(resolvePackageDir(p.name, p.via), dest, { recursive: true, dereference: true });
  }

  const pkg = JSON.parse(readFileSync(join(AGENT_DIR, "package.json"), "utf8")) as { version: string };
  writeFileSync(join(out, "package.json"), JSON.stringify({ name: "proyecto-e", version: pkg.version, private: true, type: "module" }, null, 2) + "\n");
  writeFileSync(join(out, "Iniciar Sillonero.vbs"), launcherScript());
  writeFileSync(join(out, "LEEME.txt"), README);
  writeFileSync(join(out, MARKER), `${new Date().toISOString()}\n`);
  if (opts.copyNode ?? true) copyFileSync(process.execPath, join(out, "proyecto-e.exe"));
  return out;
}

// `pnpm build:agent`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAgent()
    .then((out) => console.log(`Listo: ${out}\nProbalo con: pnpm smoke:agent`))
    .catch((err: unknown) => {
      console.error("No se pudo armar la carpeta:", err);
      process.exit(1);
    });
}
