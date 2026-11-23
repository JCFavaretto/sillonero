import { SOUND_CHUNK_CHARS, type SoundExt } from "@proyecto-e/protocol";
import { sendAppCommand } from "@/apps/commands";
import type { KeyAction } from "./model";
import type { DecksStorage } from "./storage";

// Tocar una tecla de sonido (F4a, D108). El archivo vive en el celu. Primero se le pide a la PC que lo toque; si no lo tiene
// (la primera vez, o lo perdió) contesta `not_found`: el celu se lo manda en pedazos y repite el pedido.

type Send = (type: "sound.put" | "sound.play", payload: unknown) => Promise<{ ok: true } | { ok: false; reason: string }>;
export type SoundResult = { ok: true } | { ok: false; error: string };

const real: Send = (type, payload) => sendAppCommand(type, payload) as ReturnType<Send>;

type SoundAction = Extract<KeyAction, { kind: "sound" }>;

function whyNot(reason: string): string {
  if (reason === "limit") return "decks.sound.tooBig";
  if (reason === "not_allowed") return "decks.sound.invalid";
  if (reason === "offline") return "audio.error.offline";
  return `audio.error.${reason}`;
}

export async function playSoundKey(action: SoundAction, storage: DecksStorage | null, send: Send = real): Promise<SoundResult> {
  const dot = action.file.lastIndexOf(".");
  const id = action.file.slice(0, dot);
  const ext = action.file.slice(dot + 1) as SoundExt;
  const play = () => send("sound.play", { id, ext, outputId: action.outputId, volume: action.volume });

  const first = await play();
  if (first.ok) return { ok: true };
  if (first.reason !== "not_found") return { ok: false, error: whyNot(first.reason) };

  // La PC no lo tiene: se le manda desde el archivo del celu.
  const b64 = storage ? await storage.readImage(action.file) : null;
  if (b64 === null) return { ok: false, error: "decks.sound.missingFile" };
  const total = Math.max(1, Math.ceil(b64.length / SOUND_CHUNK_CHARS));
  for (let seq = 0; seq < total; seq++) {
    const r = await send("sound.put", { id, ext, seq, total, data: b64.slice(seq * SOUND_CHUNK_CHARS, (seq + 1) * SOUND_CHUNK_CHARS) });
    if (!r.ok) return { ok: false, error: whyNot(r.reason) };
  }
  const again = await play();
  return again.ok ? { ok: true } : { ok: false, error: whyNot(again.reason) };
}
