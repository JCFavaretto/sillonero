import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileSystem, Random } from "../ports";

// Dejar lista la carpeta de la extensión (docs/PLAN.md D91): se copia a la carpeta de datos del agente (una ruta que no
// cambia aunque se mueva o se rehaga la carpeta portable) junto con `config.json` (puerto y secreto). El usuario la carga
// una sola vez en el navegador ("Cargar descomprimida"). El agente la vuelve a copiar en cada arranque: así se actualiza sola.

/** El id fijo de la extensión (sale de la clave pública de su manifest: hay un test que lo comprueba). */
export const EXTENSION_ID = "gpmbmfadpejgpmhgmecgdalampkgogpb";
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

const TOKEN_FILE = "extension-token.txt";

/** El secreto de la extensión: se crea una vez y se conserva (si cambiara, la extensión ya cargada dejaría de conectar). */
export async function loadOrCreateToken(fs: FileSystem, dataDir: string, random: Random): Promise<string> {
  const path = join(dataDir, TOKEN_FILE);
  const existing = (await fs.readFile(path))?.trim();
  if (existing && /^[A-Za-z0-9_-]{32,}$/.test(existing)) return existing;
  const token = Buffer.from(random.bytes(24)).toString("base64url");
  await fs.writeFileAtomic(path, token + "\n");
  return token;
}

/** Los archivos que se copian (nada más: ni tests ni notas). */
const FILES = ["manifest.json", "background.js", "lib"];

/** Copia la extensión a `targetDir` y escribe `config.json`. Devuelve `false` si no encuentra los archivos de origen. */
export function prepareExtension(opts: { sourceDirs: string[]; targetDir: string; port: number; token: string }): boolean {
  const source = opts.sourceDirs.find((d) => existsSync(join(d, "manifest.json")));
  if (!source) return false;
  mkdirSync(opts.targetDir, { recursive: true });
  // Se limpian solo los archivos de la extensión que conocemos: si Jay dejó algo más en esa carpeta, no se toca.
  for (const f of FILES) rmSync(join(opts.targetDir, f), { recursive: true, force: true });
  for (const f of FILES) cpSync(join(source, f), join(opts.targetDir, f), { recursive: true });
  writeFileSync(join(opts.targetDir, "config.json"), JSON.stringify({ port: opts.port, token: opts.token }) + "\n");
  return true;
}

/** ¿La carpeta ya tiene la extensión lista? (para decirlo en el panel) */
export const extensionReady = (targetDir: string): boolean => existsSync(join(targetDir, "manifest.json")) && readdirSync(targetDir).includes("config.json");
