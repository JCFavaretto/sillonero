import { z } from "zod";
import { OutputId, Volume } from "./audioIds";

// Disparar un sonido por una salida de audio (docs/PLAN.md 8.8, F4a, D108). El sonido vive en el celu; la PC lo guarda la primera
// vez que lo recibe (en pedazos: un mensaje no pasa de 16 KB) y lo reproduce por la salida elegida sin cambiar la predeterminada.

export const SOUND_EXTS = ["mp3", "wav", "ogg", "m4a"] as const;
export const SoundExt = z.enum(SOUND_EXTS);
export type SoundExt = z.infer<typeof SoundExt>;
/** El id de un sonido: lo elige el celu y es el nombre del archivo (`s_abc123.mp3`). */
export const SoundId = z.string().regex(/^s_[A-Za-z0-9_-]{6,40}$/);
/** Tope de un sonido ya decodificado: alcanza para efectos cortos (unos 30 s de mp3 a baja calidad). */
export const MAX_SOUND_BYTES = 400 * 1024;
/** Caracteres base64 por pedazo (unos 7,5 KB): cabe de sobra en los 16 KB de un mensaje. */
export const SOUND_CHUNK_CHARS = 10_000;
export const MAX_SOUND_CHUNKS = Math.ceil((MAX_SOUND_BYTES * 4) / 3 / SOUND_CHUNK_CHARS) + 1;

export const SoundChunk = z.strictObject({
  id: SoundId,
  ext: SoundExt,
  /** Número de este pedazo (desde 0) y cuántos son en total. */
  seq: z.number().int().min(0).max(MAX_SOUND_CHUNKS - 1),
  total: z.number().int().min(1).max(MAX_SOUND_CHUNKS),
  data: z.string().min(1).max(SOUND_CHUNK_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type SoundChunk = z.infer<typeof SoundChunk>;

export const SoundPlay = z.strictObject({ id: SoundId, ext: SoundExt, outputId: OutputId, volume: Volume });
export type SoundPlay = z.infer<typeof SoundPlay>;
