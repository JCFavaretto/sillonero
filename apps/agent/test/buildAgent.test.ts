import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_DIR, ENTRIES, MARKER, STATIC_FILES, buildAgent, launcherScript } from "../scripts/build";
import { buildLauncherCommand } from "../src/platform/autostart";
import { parseArgs } from "../src/cli";

// B6.5 (docs/PLAN.md D74): carpeta portable. Se arma de verdad (esbuild + copias) en una carpeta temporal, sin copiar node.exe
// (80 MB) salvo en la prueba de humo manual `pnpm smoke:agent`.

let out = "";
let files: string[] = [];
const walk = (dir: string, base = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "proyecto-e-build-"));
  rmSync(out, { recursive: true, force: true });
  await buildAgent({ outDir: out, copyNode: false });
  files = walk(out);
}, 120_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("pnpm build:agent · lo que arma", () => {
  it("el agente y cada proceso hijo quedan como .mjs en app/ (los hijos se lanzan por extensión, junto al agente)", () => {
    for (const e of ENTRIES) expect(files, e.out).toContain(`app/${e.out}`);
    expect(ENTRIES.map((e) => e.out).sort()).toEqual(["agent.mjs", "host.mjs", "hotkeyHost.mjs", "inputHost.mjs"]);
  });

  it("copia cada .ps1 y .cs de los hijos de PowerShell (si se suma uno nuevo a src/platform/win y no está en la lista, este test avisa)", () => {
    const onDisk = readdirSync(join(AGENT_DIR, "src", "platform", "win")).filter((f) => /\.(ps1|cs)$/.test(f));
    const listed = STATIC_FILES.map((f) => f.to.replace(/^app\//, ""));
    for (const f of onDisk) expect(listed, f).toContain(f);
    for (const f of onDisk) expect(files, f).toContain(`app/${f}`);
  });

  it("trae el ícono, el package.json (la versión), el LEEME y el lanzador sin consola", () => {
    expect(files).toEqual(expect.arrayContaining(["assets/tray.png", "package.json", "LEEME.txt", "Iniciar Sillonero.vbs", MARKER]));
    expect(JSON.parse(readFileSync(join(out, "package.json"), "utf8")).version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("trae koffi y tray-hook con sus binarios nativos (lo único que no se puede juntar en un archivo)", () => {
    expect(files.some((f) => f.startsWith("node_modules/koffi/"))).toBe(true);
    expect(files.some((f) => /^node_modules\/@koromix\/koffi-win32-x64\/.*koffi\.node$/.test(f))).toBe(true);
    expect(files).toContain("node_modules/tray-hook/index.js");
    expect(files).toContain("node_modules/@phtdacosta/tray-hook-win32-x64/tray-hook.exe");
  });

  it("el agente juntado arranca solo, sin el repo ni pnpm: --smoke carga bandeja, ws, qrcode y zod y sale con 0", () => {
    const r = spawnSync(process.execPath, [join(out, "app", "agent.mjs"), "--smoke"], { encoding: "utf8", cwd: tmpdir(), timeout: 60_000 });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Sillonero \d+\.\d+\.\d+ \(carpeta portable\)/);
  });

  it("no depende del repo: nada del bundle apunta a rutas del código fuente", () => {
    const bundle = readFileSync(join(out, "app", "agent.mjs"), "utf8");
    expect(bundle).not.toContain(AGENT_DIR);
  });

  it("el LEEME explica el uso en español", () => {
    const txt = readFileSync(join(out, "LEEME.txt"), "utf8");
    expect(txt).toContain("Iniciar Sillonero.vbs");
    expect(txt).toContain("Iniciar con Windows");
  });
});

describe("buildAgent · seguridad de la carpeta de salida", () => {
  it("rehacer pisa lo anterior pero solo si la carpeta es de un build previo (tiene la marca)", async () => {
    writeFileSync(join(out, "viejo.txt"), "x");
    await buildAgent({ outDir: out, copyNode: false });
    expect(existsSync(join(out, "viejo.txt"))).toBe(false);
  });

  it("se niega a borrar una carpeta con cosas que no son de un build (sin la marca)", async () => {
    const other = mkdtempSync(join(tmpdir(), "no-es-un-build-"));
    writeFileSync(join(other, "tesoro.txt"), "no me borres");
    await expect(buildAgent({ outDir: other, copyNode: false })).rejects.toThrow(/marca/);
    expect(readFileSync(join(other, "tesoro.txt"), "utf8")).toBe("no me borres");
    rmSync(other, { recursive: true, force: true });
  });
});

describe("lanzador sin consola", () => {
  it("abre el exe con el agente escondido y solo reenvía --background", () => {
    const vbs = launcherScript();
    expect(vbs).toContain("proyecto-e.exe");
    expect(vbs).toContain("app\\agent.mjs");
    expect(vbs).toContain(", 0, False"); // ventana oculta, sin esperar
    expect(vbs).toContain('"--background"');
    expect(vbs).not.toMatch(/WScript\.Arguments\(0\)\s*&/); // nada de pasar cualquier argumento a la línea de comandos
  });

  it("usa el directorio donde está el .vbs (la carpeta se puede mover)", () => {
    expect(launcherScript()).toContain("GetParentFolderName(WScript.ScriptFullName)");
  });
});

describe("arranque con Windows en la carpeta portable", () => {
  it("la entrada de Run abre el lanzador con wscript y --background (sin consola)", () => {
    expect(buildLauncherCommand("C:\\Windows\\System32\\wscript.exe", "D:\\Apps\\Sillonero\\Iniciar Sillonero.vbs")).toBe(
      '"C:\\Windows\\System32\\wscript.exe" "D:\\Apps\\Sillonero\\Iniciar Sillonero.vbs" --background',
    );
  });

  it("rechaza comillas y % en las rutas", () => {
    expect(() => buildLauncherCommand('C:\\a"b\\wscript.exe', "x.vbs")).toThrow();
    expect(() => buildLauncherCommand("C:\\wscript.exe", "C:\\%TEMP%\\x.vbs")).toThrow();
  });

  it("--smoke se reconoce en la línea de comandos", () => {
    expect(parseArgs(["node", "agent.mjs", "--smoke"])).toEqual({ background: false, smoke: true });
    expect(parseArgs(["node", "agent.mjs", "--background"])).toEqual({ background: true, smoke: false });
  });
});
