import { describe, expect, it } from "vitest";
import { MAX_SOUND_BYTES, MAX_SOUND_CHUNKS, SOUND_CHUNK_CHARS, SoundChunk, SoundId, SoundPlay } from "../src/sound";
import { MAX_MESSAGE_BYTES } from "../src/constants";
import { parseClientMessage } from "../src/messages";

const env = (type: string, payload: unknown) => JSON.stringify({ v: 1, id: "abcdefgh", type, payload });
const OUT = "o_AAAAAAAAAAAA";
const chunk = { id: "s_abc123", ext: "mp3", seq: 0, total: 3, data: "AAAA" };

describe("sonido: ids y pedazos", () => {
  it("el id es el nombre del archivo: letras, números, guion y guion bajo", () => {
    for (const ok of ["s_abc123", "s_" + "x".repeat(40)]) expect(SoundId.safeParse(ok).success).toBe(true);
    for (const bad of ["abc123", "s_abc", "s_../x", "s_a b c d e f", "s_" + "x".repeat(41), "s_abc123.mp3", ""]) expect(SoundId.safeParse(bad).success, bad).toBe(false);
  });

  it("un pedazo válido, y los rechazos", () => {
    expect(SoundChunk.safeParse(chunk).success).toBe(true);
    for (const bad of [
      { ...chunk, ext: "exe" },
      { ...chunk, seq: -1 },
      { ...chunk, seq: MAX_SOUND_CHUNKS },
      { ...chunk, total: 0 },
      { ...chunk, total: MAX_SOUND_CHUNKS + 1 },
      { ...chunk, data: "" },
      { ...chunk, data: "no es base64!" },
      { ...chunk, data: "A".repeat(SOUND_CHUNK_CHARS + 1) },
      { ...chunk, extra: 1 },
    ]) expect(SoundChunk.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
  });

  it("los pedazos alcanzan para el tope y cada mensaje cabe en los 16 KB", () => {
    expect(MAX_SOUND_CHUNKS * SOUND_CHUNK_CHARS * 0.75).toBeGreaterThanOrEqual(MAX_SOUND_BYTES);
    const biggest = env("sound.put", { ...chunk, data: "A".repeat(SOUND_CHUNK_CHARS) });
    expect(biggest.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(biggest).ok).toBe(true);
  });

  it("reproducir: el sonido, la salida y el volumen", () => {
    expect(SoundPlay.safeParse({ id: "s_abc123", ext: "wav", outputId: OUT, volume: 40 }).success).toBe(true);
    for (const bad of [{ id: "s_abc123", ext: "wav", outputId: "x", volume: 40 }, { id: "s_abc123", ext: "wav", outputId: OUT, volume: 101 }, { id: "s_abc123", ext: "wav", outputId: OUT }]) expect(SoundPlay.safeParse(bad).success).toBe(false);
  });

  it("viajan como mensajes del celu", () => {
    expect(parseClientMessage(env("sound.put", chunk)).ok).toBe(true);
    expect(parseClientMessage(env("sound.play", { id: "s_abc123", ext: "mp3", outputId: OUT, volume: 50 })).ok).toBe(true);
    expect(parseClientMessage(env("sound.play", { id: "../x", ext: "mp3", outputId: OUT, volume: 50 })).ok).toBe(false);
  });
});
