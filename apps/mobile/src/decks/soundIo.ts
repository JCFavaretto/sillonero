import { File } from "expo-file-system";
import { MAX_SOUND_BYTES, SOUND_EXTS, type SoundExt } from "@proyecto-e/protocol";

// Elegir el archivo de un sonido (F4a): el selector de archivos del sistema. API de expo-file-system leída de sus tipos (SDK 58).

export type PickedSound = { ok: true; name: string; ext: SoundExt; base64: string } | { ok: false; reason: "canceled" | "tooBig" | "type" | "failed" };

export const soundExt = (fileName: string): SoundExt | null => {
  const e = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return (SOUND_EXTS as readonly string[]).includes(e) ? (e as SoundExt) : null;
};

export async function pickSoundFile(): Promise<PickedSound> {
  try {
    const r = await File.pickFileAsync({ mimeTypes: ["audio/*"] });
    if (!r.result) return { ok: false, reason: "canceled" };
    const f = r.result;
    const ext = soundExt(f.name);
    if (!ext) return { ok: false, reason: "type" };
    if (f.size > MAX_SOUND_BYTES) return { ok: false, reason: "tooBig" };
    return { ok: true, name: f.name.slice(0, f.name.lastIndexOf(".")), ext, base64: await f.base64() };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
