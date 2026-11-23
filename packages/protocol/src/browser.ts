import { z } from "zod";
import { MAX_MEDIA_DURATION_MS } from "./audio";
import { Volume } from "./audioIds";
import { SafeUrl } from "./library";

// El navegador visto desde el celu (docs/PLAN.md 8.7, D88 a D92): pestañas, marcadores y, en YouTube, cola, búsqueda y listas.
// Todo viene de la extensión del navegador (opcional). Lo que llega de ahí ya fue validado y recortado por el agente (D90).

export const MAX_BROWSER_TABS = 60;
export const MAX_BROWSER_ITEMS = 80;

/** Un id de video de YouTube: 11 caracteres. */
export const VideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
/** Un id de lista de YouTube (PL…, RD…, OLAK…, LL, WL): solo letras, números, guion y guion bajo. */
export const ListId = z.string().regex(/^[A-Za-z0-9_-]{2,64}$/);
const TabId = z.number().int().min(0).max(2_147_483_647);

/** Las velocidades de reproducción que se pueden pedir (D99). */
export const MEDIA_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const MediaRate = z.union([z.literal(0.5), z.literal(0.75), z.literal(1), z.literal(1.25), z.literal(1.5), z.literal(1.75), z.literal(2)]);
export type MediaRate = z.infer<typeof MediaRate>;

/**
 * El video o audio principal de una pestaña, tal como lo ve la extensión (D99, docs/PLAN.md 8.8): sirve para cualquier sitio,
 * sin perfiles. `positionMs` es la posición de cuando se leyó; el celu la avanza solo mientras no esté en pausa.
 */
export const TabMedia = z
  .strictObject({
    paused: z.boolean(),
    positionMs: z.number().int().min(0).max(MAX_MEDIA_DURATION_MS),
    /** `null` = un vivo, o la página no dice cuánto dura: no hay barra de reproducción. */
    durationMs: z.number().int().min(1).max(MAX_MEDIA_DURATION_MS).nullable(),
    rate: z.number().min(0.1).max(16),
    muted: z.boolean(),
    /** El volumen del reproductor de la página (no el de todo el navegador). */
    volume: Volume,
    /** false = no se puede saltar ni cambiar la velocidad (un vivo, o un sitio que se rompe si se lo toca, D102). */
    canSeek: z.boolean(),
  })
  .refine((m) => m.durationMs === null || m.positionMs <= m.durationMs, "la posición no puede pasar la duración");
export type TabMedia = z.infer<typeof TabMedia>;

export const BrowserTab = z.strictObject({
  id: TabId,
  windowId: TabId,
  title: z.string().max(120),
  /** El sitio sin "www." (la dirección completa no viaja al celu, D90). */
  host: z.string().max(100),
  /** La pestaña que se ve en su ventana. */
  active: z.boolean(),
  audible: z.boolean(),
  pinned: z.boolean(),
  /** Falta = la pestaña no tiene un video o audio que se pueda manejar. */
  media: TabMedia.optional(),
});
export type BrowserTab = z.infer<typeof BrowserTab>;

export const BrowserState = z.strictObject({
  /** ¿Hay una extensión conectada ahora? */
  connected: z.boolean(),
  /** "chrome", "edge", "brave"… (lo que dice la extensión; solo para mostrar). */
  browser: z.string().max(20).nullable(),
  tabs: z.array(BrowserTab).max(MAX_BROWSER_TABS),
});
export type BrowserState = z.infer<typeof BrowserState>;

/** Lo que se le manda hacer al navegador. */
export const BrowserOp = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("tab.activate"), tabId: TabId }),
  z.strictObject({ op: z.literal("tab.close"), tabId: TabId }),
  z.strictObject({ op: z.literal("tab.reload"), tabId: TabId }),
  z.strictObject({ op: z.literal("tab.reopen") }),
  z.strictObject({ op: z.literal("tab.open"), url: SafeUrl, mode: z.enum(["tab", "window"]) }),
  /** Reproducir un video en una pestaña de YouTube sin traerla al frente. Con `index` y `listId` es un tema de la lista que ya suena. */
  z.strictObject({ op: z.literal("yt.play"), tabId: TabId, videoId: VideoId, listId: ListId.optional(), index: z.number().int().min(0).max(5000).optional() }),
  /** Poner a sonar una lista entera desde el principio. Sin `tabId`, en una pestaña nueva. */
  z.strictObject({ op: z.literal("yt.playList"), listId: ListId, tabId: TabId.optional() }),
  // D99: el reproductor de la pestaña, en cualquier sitio. Nada de esto trae la ventana al frente.
  z.strictObject({ op: z.literal("media.playPause"), tabId: TabId }),
  /** Saltar para atrás (negativo) o para adelante, en segundos. */
  z.strictObject({ op: z.literal("media.seekBy"), tabId: TabId, seconds: z.number().int().min(-600).max(600).refine((n) => n !== 0, "no salta nada") }),
  z.strictObject({ op: z.literal("media.rate"), tabId: TabId, rate: MediaRate }),
  z.strictObject({ op: z.literal("media.mute"), tabId: TabId, muted: z.boolean() }),
  z.strictObject({ op: z.literal("media.volume"), tabId: TabId, volume: Volume }),
  /** YouTube Music: tocar un tema de la cola (por su posición). */
  z.strictObject({ op: z.literal("ytm.play"), tabId: TabId, index: z.number().int().min(0).max(5000) }),
]);
export type BrowserOp = z.infer<typeof BrowserOp>;

/** Lo que se le pregunta al navegador (la respuesta llega como `browser.data`). */
export const BrowserQuery = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bookmarks") }),
  z.strictObject({ kind: z.literal("yt.queue"), tabId: TabId }),
  z.strictObject({ kind: z.literal("ytm.queue"), tabId: TabId }),
  z.strictObject({ kind: z.literal("yt.search"), text: z.string().trim().min(1).max(100) }),
  z.strictObject({ kind: z.literal("yt.lists") }),
]);
export type BrowserQuery = z.infer<typeof BrowserQuery>;
export type BrowserQueryKind = BrowserQuery["kind"];

export const BrowserItem = z.strictObject({
  kind: z.enum(["video", "list", "track", "bookmark"]),
  /** El id de video o de lista, o un número de posición; para un marcador, su identificador. */
  id: z.string().max(80),
  title: z.string().max(120),
  /** Canal, artista o carpeta. */
  subtitle: z.string().max(80).optional(),
  /** Duración o cantidad ("3:42", "24 videos", "VIVO"). */
  meta: z.string().max(24).optional(),
  /** Solo marcadores: la dirección a abrir. */
  url: SafeUrl.optional(),
  /** Es el que suena ahora. */
  current: z.boolean().optional(),
  /** Posición en la cola (para tocar ese tema). */
  index: z.number().int().min(0).max(5000).optional(),
  /** Un video que pertenece a esta lista (para tocarlo dentro de ella). */
  listId: ListId.optional(),
});
export type BrowserItem = z.infer<typeof BrowserItem>;

/** Por qué no se pudo: la extensión no está, no contestó a tiempo, o la página no se pudo leer. */
export const BrowserFailure = z.enum(["no_extension", "timeout", "unreadable", "failed"]);
export type BrowserFailure = z.infer<typeof BrowserFailure>;

export const BrowserDataPayload = z.discriminatedUnion("ok", [
  z.strictObject({ replyTo: z.string(), kind: z.enum(["bookmarks", "yt.queue", "ytm.queue", "yt.search", "yt.lists"]), ok: z.literal(true), items: z.array(BrowserItem).max(MAX_BROWSER_ITEMS) }),
  z.strictObject({ replyTo: z.string(), kind: z.enum(["bookmarks", "yt.queue", "ytm.queue", "yt.search", "yt.lists"]), ok: z.literal(false), reason: BrowserFailure }),
]);
export type BrowserDataPayload = z.infer<typeof BrowserDataPayload>;

/** El sitio de una pestaña por su título y su sitio: los botones propios dependen de eso (D87). */
export function siteKind(host: string): "youtube" | "youtubeMusic" | null {
  if (host === "music.youtube.com") return "youtubeMusic";
  if (host === "youtube.com" || host === "m.youtube.com") return "youtube";
  return null;
}
