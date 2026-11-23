import { z } from "zod";
import { ArtKey, AudioAppId, MediaId, OutputId, Volume } from "./audioIds";
import { Name } from "./library";
import { IconKey } from "./windows";

// Audio de la PC (docs/PLAN.md 8.4.3): salidas, apps con sonido y qué suena. Todo con ids opacos.

export const OutputKind = z.enum(["headphones", "speakers", "tv", "digital", "other"]);
export type OutputKind = z.infer<typeof OutputKind>;

export const MAX_OUTPUTS = 16;
export const MAX_AUDIO_APPS = 20;
export const MAX_MEDIA_SESSIONS = 8;

export const OutputInfo = z.strictObject({
  id: OutputId,
  /** El nombre de Windows ("Altavoces (3- HyperX Cloud Flight Wireless)"). */
  name: z.string().max(80),
  /** El apodo que le puso Jay; vive en la PC. */
  nick: Name.nullable(),
  kind: OutputKind,
  state: z.enum(["active", "unavailable"]),
  isDefault: z.boolean(),
  /** null si la salida no está activa. */
  volume: Volume.nullable(),
  muted: z.boolean(),
  hidden: z.boolean(),
});
export type OutputInfo = z.infer<typeof OutputInfo>;

export const AppAudio = z.strictObject({
  id: AudioAppId,
  /** Nombre del .exe sin ".exe". */
  name: z.string().max(64),
  iconKey: IconKey.nullable(),
  /** Dónde tiene sesiones ahora. */
  outputIds: z.array(OutputId).max(4),
  /** El de la primera sesión. */
  volume: Volume,
  muted: z.boolean(),
  /** Hizo ruido en los últimos 3 s (D33). */
  sounding: z.boolean(),
  /** A qué salida la mandó Jay (D30); null = sigue a la predeterminada. */
  routed: OutputId.nullable(),
});
export type AppAudio = z.infer<typeof AppAudio>;

/** Tope de duración de una reproducción: 7 días (un valor mayor es un dato roto). */
export const MAX_MEDIA_DURATION_MS = 7 * 24 * 3600 * 1000;

/**
 * Por dónde va una reproducción (D97, docs/PLAN.md 8.8). `positionMs` es la posición **en el momento en que se armó el
 * mensaje**: el celu la avanza solo (por `rate`) mientras el estado sea `playing`, y la PC vuelve a avisar solo si la
 * posición salta. Sin duración conocida (un vivo, o una app que no la informa) el campo no viaja.
 */
export const MediaTimeline = z
  .strictObject({
    positionMs: z.number().int().min(0).max(MAX_MEDIA_DURATION_MS),
    durationMs: z.number().int().min(1).max(MAX_MEDIA_DURATION_MS),
    /** Velocidad de reproducción (1 = normal). */
    rate: z.number().min(0.1).max(16),
  })
  .refine((t) => t.positionMs <= t.durationMs, "la posición no puede pasar la duración");
export type MediaTimeline = z.infer<typeof MediaTimeline>;

export const MediaSession = z.strictObject({
  id: MediaId,
  app: z.string().max(64),
  iconKey: IconKey.nullable(),
  title: z.string().max(120),
  artist: z.string().max(80),
  status: z.enum(["playing", "paused", "other"]),
  /** Qué botones acepta la app (Chrome no acepta ⏮ ⏭). */
  controls: z.strictObject({ prev: z.boolean(), playPause: z.boolean(), next: z.boolean() }),
  artKey: ArtKey.nullable(),
  /** Falta = no se sabe por dónde va (no se dibuja barra). Se omite en vez de mandar `null`. */
  timeline: MediaTimeline.optional(),
});
export type MediaSession = z.infer<typeof MediaSession>;

export const MediaState = z.strictObject({
  sessions: z.array(MediaSession).max(MAX_MEDIA_SESSIONS),
  /** A cuál van ⏮ ⏯ ⏭ ahora; null = no hay ninguna sesión. */
  targetId: MediaId.nullable(),
  /** true = la eligió Jay; false = la actual de Windows (D35). */
  chosen: z.boolean(),
});
export type MediaState = z.infer<typeof MediaState>;

export const AudioState = z.strictObject({
  available: z.strictObject({ audio: z.boolean(), defaultOutput: z.boolean(), appRouting: z.boolean() }),
  outputs: z.array(OutputInfo).max(MAX_OUTPUTS),
  apps: z.array(AppAudio).max(MAX_AUDIO_APPS),
  media: MediaState,
});
export type AudioState = z.infer<typeof AudioState>;

/** Sobre qué se cambia el volumen o el silencio: una salida o una app. */
export const AudioTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("output"), id: OutputId }),
  z.strictObject({ kind: z.literal("app"), id: AudioAppId }),
]);
export type AudioTarget = z.infer<typeof AudioTarget>;
