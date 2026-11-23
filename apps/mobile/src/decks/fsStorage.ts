import { Directory, File, Paths } from "expo-file-system";
import { DECK_FILE } from "./model";
import type { DecksStorage } from "./storage";

// El almacenamiento real de los decks (D103): `decks/decks.json` y `decks/img/<nombre>` dentro de la carpeta de documentos de la
// app. API de `expo-file-system` leída de sus tipos instalados (SDK 58): `File`, `Directory`, `Paths.document`.

const dir = () => new Directory(Paths.document, "decks");
const imgDir = () => new Directory(dir(), "img");

function ensure() {
  dir().create({ intermediates: true, idempotent: true });
  imgDir().create({ intermediates: true, idempotent: true });
}

/** Un nombre de imagen que no sea exactamente un nombre de archivo de imagen no llega nunca al disco. */
function safeName(name: string): string {
  if (!DECK_FILE.test(name)) throw new Error("nombre de archivo no válido");
  return name;
}

export function createFsStorage(): DecksStorage {
  return {
    async readIndex() {
      // Si la app murió entre los dos renombres de `writeIndex`, falta decks.json pero queda la copia anterior (.bak, completa) y
      // la nueva (.tmp, que puede estar a medias): se prefiere la .bak.
      for (const name of ["decks.json", "decks.json.bak", "decks.json.tmp"]) {
        const f = new File(dir(), name);
        if (f.exists) return await f.text();
      }
      return null;
    },
    async writeIndex(json) {
      ensure();
      // Se escribe completo a un archivo temporal; el anterior pasa a .bak ANTES de que el nuevo tome su lugar y se borra al final.
      // En ningún momento falta una copia válida (ver `readIndex`).
      const tmp = new File(dir(), "decks.json.tmp");
      if (tmp.exists) tmp.delete();
      tmp.create();
      await tmp.write(json);
      const real = new File(dir(), "decks.json");
      const bak = new File(dir(), "decks.json.bak");
      if (bak.exists) bak.delete();
      if (real.exists) real.rename("decks.json.bak");
      tmp.rename("decks.json");
      const done = new File(dir(), "decks.json.bak");
      if (done.exists) done.delete();
    },
    async backupCorrupt(json) {
      ensure();
      const f = new File(dir(), `decks.corrupt-${Date.now()}.json`);
      f.create();
      await f.write(json);
    },
    async writeImage(name, base64) {
      ensure();
      const f = new File(imgDir(), safeName(name));
      if (f.exists) f.delete();
      f.create();
      await f.write(base64, { encoding: "base64" });
    },
    async readImage(name) {
      const f = new File(imgDir(), safeName(name));
      return f.exists ? await f.base64() : null;
    },
    imageUri: (name) => new File(imgDir(), safeName(name)).uri,
    async removeImage(name) {
      const f = new File(imgDir(), safeName(name));
      if (f.exists) f.delete();
    },
    async listImages() {
      const d = imgDir();
      if (!d.exists) return [];
      return d
        .list()
        .filter((x): x is File => x instanceof File)
        .map((x) => x.name)
        .filter((n) => DECK_FILE.test(n));
    },
  };
}
