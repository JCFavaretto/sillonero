import { MAX_SOUND_BYTES, SOUND_EXTS, type SoundChunk, type SoundExt } from "@proyecto-e/protocol";
import type { Clock, FileSystem } from "../ports";

// Los sonidos que manda el celu (docs/PLAN.md 8.8, F4a, D108). El celu es el dueño del archivo: la PC lo guarda la primera vez para
// poder tocarlo y puede perderlo sin problema (el celu lo vuelve a mandar). Lo que llega es un dato no confiable: se valida el
// tamaño y que el contenido sea de verdad un sonido, y el nombre del archivo sale del id (nunca una ruta).

export const MAX_SOUNDS = 40;
const MAX_UPLOADS = 4;
/** Una subida a medias que no avanza en este tiempo se descarta. */
const UPLOAD_TTL_MS = 60_000;
const INDEX = "index.json";

export type PutResult = { ok: true; complete: boolean } | { ok: false; reason: "invalid" | "too_big" | "busy" | "failed" };

/** Qué clase de sonido es por sus primeros bytes; `null` si no es ninguno de los admitidos. */
export function sniffExt(b: Uint8Array): SoundExt | null {
  const ascii = (at: number, s: string) => b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
  // Wav: la cabecera y el bloque "fmt " que tiene que venir primero. Ogg: la marca de página. M4a: una marca (brand) de audio
  // conocida, no cualquier contenedor. Mp3: una etiqueta ID3 o un encabezado de cuadro con capa y tasa válidas (no el 0xFF 0xE0 suelto).
  if (ascii(0, "RIFF") && ascii(8, "WAVE") && ascii(12, "fmt ")) return "wav";
  if (ascii(0, "OggS")) return "ogg";
  if (ascii(4, "ftyp") && (ascii(8, "M4A ") || ascii(8, "M4B ") || ascii(8, "mp42") || ascii(8, "isom") || ascii(8, "iso2"))) return "m4a";
  if (ascii(0, "ID3")) return "mp3";
  if (b.length >= 4 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x18) !== 0x08 && (b[1]! & 0x06) !== 0 && (b[2]! & 0xf0) !== 0xf0) return "mp3";
  return null;
}

interface Upload {
  ext: SoundExt;
  total: number;
  parts: (string | null)[];
  at: number;
}

export interface SoundStore {
  /** Lee qué sonidos había en el disco. */
  load(): Promise<void>;
  put(chunk: SoundChunk): Promise<PutResult>;
  /** La ruta del sonido si está guardado; `null` si no. */
  path(id: string, ext: SoundExt): string | null;
  count(): number;
  /** Subidas a medias (para los tests). */
  pending(): number;
}

export function createSoundStore(deps: { fs: FileSystem; dir: string; clock: Clock }): SoundStore {
  const { fs, dir, clock } = deps;
  /** `id.ext` → cuándo se guardó (para borrar el más viejo). */
  const known = new Map<string, number>();
  const uploads = new Map<string, Upload>();
  /** La cola de escrituras a disco. */
  let writing: Promise<void> = Promise.resolve();
  const file = (name: string) => `${dir}/${name}`;
  const isExt = (e: string): e is SoundExt => (SOUND_EXTS as readonly string[]).includes(e);

  const saveIndex = () => fs.writeFileAtomic(file(INDEX), JSON.stringify([...known]));

  function prune() {
    const now = clock.now();
    for (const [id, u] of uploads) if (now - u.at > UPLOAD_TTL_MS) uploads.delete(id);
  }

  async function finish(id: string, up: Upload): Promise<PutResult> {
    const b64 = up.parts.join("");
    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    if (bytes.length > MAX_SOUND_BYTES) return { ok: false, reason: "too_big" };
    if (sniffExt(bytes) !== up.ext) return { ok: false, reason: "invalid" };
    // Windows no distingue mayúsculas: s_ABC.mp3 y s_abc.mp3 son el mismo archivo.
    const key = `${id}.${up.ext}`.toLowerCase();
    // De a uno: dos subidas terminando a la vez no escriben el mismo archivo temporal ni el mismo índice.
    const run = writing.then(async (): Promise<PutResult> => {
      try {
        await fs.writeBytesAtomic(file(key), bytes);
        known.set(key, clock.now());
        // Más de 40: se borra el más viejo. Primero el archivo; si Windows no lo suelta (está sonando), se lo deja en la lista.
        while (known.size > MAX_SOUNDS) {
          const oldest = [...known].filter(([k]) => k !== key).sort((a, b) => a[1] - b[1])[0]?.[0];
          if (!oldest) break;
          const removed = await fs.remove(file(oldest)).then(() => true, () => false);
          if (!removed) break;
          known.delete(oldest);
        }
        await saveIndex();
      } catch {
        return { ok: false, reason: "failed" };
      }
      return { ok: true, complete: true };
    });
    writing = run.then(() => undefined);
    return run;
  }

  return {
    async load() {
      const raw = await fs.readFile(file(INDEX));
      if (!raw) return;
      try {
        const list = JSON.parse(raw) as unknown;
        if (!Array.isArray(list)) return;
        for (const e of list) {
          if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number" && /^s_[A-Za-z0-9_-]{6,40}\.(mp3|wav|ogg|m4a)$/i.test(e[0])) known.set(e[0].toLowerCase(), e[1]);
        }
      } catch {
        // un índice roto: el celu vuelve a mandar lo que haga falta
      }
    },

    async put(c) {
      prune();
      if (!isExt(c.ext)) return { ok: false, reason: "invalid" };
      let up = uploads.get(c.id);
      if (up && (up.total !== c.total || up.ext !== c.ext)) {
        // El celu cambió de idea a mitad de camino: esa subida se cancela.
        uploads.delete(c.id);
        return { ok: false, reason: "invalid" };
      }
      if (!up) {
        if (uploads.size >= MAX_UPLOADS) return { ok: false, reason: "busy" };
        up = { ext: c.ext, total: c.total, parts: Array.from({ length: c.total }, () => null), at: clock.now() };
        uploads.set(c.id, up);
      }
      if (c.seq >= up.total) {
        uploads.delete(c.id);
        return { ok: false, reason: "invalid" };
      }
      up.parts[c.seq] = c.data;
      up.at = clock.now();
      // Tope de peso antes de juntar todo: si lo recibido ya pasa el máximo, se corta.
      const got = up.parts.reduce((n, p) => n + (p ? p.length : 0), 0);
      if ((got * 3) / 4 > MAX_SOUND_BYTES + 3) {
        uploads.delete(c.id);
        return { ok: false, reason: "too_big" };
      }
      if (up.parts.some((p) => p === null)) return { ok: true, complete: false };
      uploads.delete(c.id);
      return finish(c.id, up);
    },

    path: (id, ext) => {
      const key = `${id}.${ext}`.toLowerCase();
      return known.has(key) ? file(key) : null;
    },
    count: () => known.size,
    pending: () => uploads.size,
  };
}
