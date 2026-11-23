import { appendFile, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileSystem } from "../ports";

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

export function createFileSystem(): FileSystem {
  return {
    async readFile(path) {
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    // Escribe en `<path>.tmp` y renombra: si algo falla a mitad, el original queda intacto.
    async writeFileAtomic(path, data) {
      const tmp = `${path}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(tmp, data, "utf8");
        await rename(tmp, path); // en Windows reemplaza el destino si existe
      } catch (err) {
        await unlink(tmp).catch(() => undefined);
        throw err;
      }
    },

    async writeBytesAtomic(path, data) {
      const tmp = `${path}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(tmp, data);
        await rename(tmp, path);
      } catch (err) {
        await unlink(tmp).catch(() => undefined);
        throw err;
      }
    },

    async remove(path) {
      try {
        await unlink(path);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },

    copyFile: (from, to) => copyFile(from, to),

    async mkdirp(path) {
      await mkdir(path, { recursive: true });
    },

    appendFile: (path, data) => appendFile(path, data, "utf8"),

    async size(path) {
      try {
        return (await stat(path)).size;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    rename: (from, to) => rename(from, to),
  };
}
