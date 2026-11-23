import { z } from "zod";
import { Id, parseEnvelope, type ParseFailure } from "./envelope";
import { MAX_MESSAGE_BYTES, MAX_SERVER_MESSAGE_BYTES } from "./constants";
import { ErrorCode } from "./errors";
import { CatalogApp, DeckItem, LauncherId, Library, Name, SceneDraft, SceneId, Target, SEARCH_MAX } from "./library";
import { AudioState, AudioTarget } from "./audio";
import { SoundChunk, SoundPlay } from "./sound";
import { ArtKey, AudioAppId, MediaId, MediaKey, OutputId, Volume } from "./audioIds";
import { AltTabStep, PadDelta, PadKey, PadMods, PadState, PadTypePayload, Shortcut, WheelDelta } from "./pad";
import { IconKey, WindowAction, WindowId, WindowsState } from "./windows";
import { BrowserDataPayload, BrowserOp, BrowserQuery, BrowserState } from "./browser";
import { MONITOR_NICKNAME_MAX, MonitorId, ScreensState } from "./screens";

/** Mensaje completo: sobre v1 + `type` fijo + payload validado. */
const msg = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.strictObject({ v: z.literal(1), id: Id, type: z.literal(type), payload });

// ── Celu → Agente ────────────────────────────────────────────────────────────

export const Ping = msg("ping", z.strictObject({}));

/** Ponerle apodo a una pantalla (`null` = sacárselo). El apodo vive en la PC. */
export const MonitorRename = msg(
  "monitor.rename",
  z.strictObject({ monitorId: MonitorId, nickname: z.string().trim().min(1).max(MONITOR_NICKNAME_MAX).nullable() }),
);

/** Prender o apagar una pantalla. La PC nunca apaga la principal ni la última prendida. */
export const MonitorSetEnabled = msg("monitor.setEnabled", z.strictObject({ monitorId: MonitorId, enabled: z.boolean() }));

/** El orden de las pantallas prendidas, de izquierda a derecha. La PC calcula las posiciones; la principal queda en (0,0). */
export const MonitorSetOrder = msg(
  "monitor.setOrder",
  z.strictObject({ order: z.array(MonitorId).min(1).max(16).refine((ids) => new Set(ids).size === ids.length, "ids repetidos") }),
);

/** Manda la ventana activa de la PC a una pantalla. El celu no elige la ventana: es la que tiene el foco. */
export const WindowMoveActive = msg("window.moveActive", z.strictObject({ monitorId: MonitorId }));

/** Muestra un número en cada pantalla prendida de la PC durante unos segundos. No lleva datos: la PC decide qué mostrar. */
export const MonitorIdentify = msg("monitor.identify", z.strictObject({}));

/** "Olvidar" en el celu: la PC borra el dispositivo y cierra. */
export const DeviceUnpair = msg("device.unpair", z.strictObject({}));

// B3: ventanas, apps, lanzadores, escenas e Inicio (docs/PLAN.md 8.3.3)
export const WindowMove = msg("window.move", z.strictObject({ windowId: WindowId, monitorId: MonitorId }));
export const WindowAct = msg("window.act", z.strictObject({ windowId: WindowId, action: WindowAction }));
export const WindowsBringAll = msg("windows.bringAll", z.strictObject({}));
export const AppsSearch = msg("apps.search", z.strictObject({ query: z.string().max(SEARCH_MAX) }));
export const IconGet = msg("icon.get", z.strictObject({ keys: z.array(IconKey).min(1).max(10) }));
export const LauncherAdd = msg("launcher.add", z.strictObject({ target: Target, name: Name.nullable() }));
export const LauncherRename = msg("launcher.rename", z.strictObject({ id: LauncherId, name: Name }));
export const LauncherRemove = msg("launcher.remove", z.strictObject({ id: LauncherId }));
export const LauncherRun = msg("launcher.run", z.strictObject({ id: LauncherId }));
/** F3 (D104): abrir una app o un link que viven en el celu (en un deck), sin guardarlos en la PC. Mismas validaciones que `launcher.add`. */
export const TargetRun = msg("target.run", z.strictObject({ target: Target }));
export const SceneSave = msg("scene.save", z.strictObject({ scene: SceneDraft }));
export const SceneRemove = msg("scene.remove", z.strictObject({ id: SceneId }));
export const SceneRun = msg("scene.run", z.strictObject({ id: SceneId }));
export const DeckSet = msg("deck.set", z.strictObject({ items: z.array(DeckItem).max(30) }));

// Fase C: el navegador por la extensión (docs/PLAN.md 8.7). `browser.act` contesta con `command.result`; `browser.query` con `browser.data`.
export const BrowserAct = msg("browser.act", BrowserOp);
export const BrowserQueryMsg = msg("browser.query", BrowserQuery);

// B4: audio y media (docs/PLAN.md 8.4.3). Solo ids opacos, enteros y booleanos: nada llega a una línea de comandos.
export const AudioSetVolume = msg("audio.setVolume", z.strictObject({ target: AudioTarget, volume: Volume }));
export const AudioSetMute = msg("audio.setMute", z.strictObject({ target: AudioTarget, muted: z.boolean() }));
export const AudioNudge = msg("audio.nudge", z.strictObject({ delta: z.union([z.literal(-5), z.literal(5)]) }));
export const AudioToggleMute = msg("audio.toggleMute", z.strictObject({}));
export const AudioSetDefault = msg("audio.setDefault", z.strictObject({ outputId: OutputId }));
export const AudioRoute = msg("audio.route", z.strictObject({ appId: AudioAppId, outputId: OutputId.nullable() }));
export const AudioRename = msg("audio.rename", z.strictObject({ outputId: OutputId, nick: Name.nullable() }));
export const AudioHide = msg("audio.hide", z.strictObject({ outputId: OutputId, hidden: z.boolean() }));
// F4a (D108): un sonido que vive en el celu, para tocarlo por una salida de la PC.
export const SoundPut = msg("sound.put", SoundChunk);
export const SoundPlayMsg = msg("sound.play", SoundPlay);
export const MediaKeyPress = msg("media.key", z.strictObject({ key: MediaKey }));
export const MediaSelect = msg("media.select", z.strictObject({ id: MediaId.nullable() }));
export const MediaArtGet = msg("media.art", z.strictObject({ keys: z.array(ArtKey).min(1).max(3) }));

// B5: Pad (docs/PLAN.md 8.5). `pad.move` y `pad.scroll` NO reciben respuesta (D42): serían 60 por segundo de vuelta.
export const PadMove = msg("pad.move", z.strictObject({ dx: PadDelta, dy: PadDelta }));
export const PadScroll = msg("pad.scroll", z.strictObject({ dx: WheelDelta, dy: WheelDelta }));
export const PadButton = msg("pad.button", z.strictObject({ button: z.enum(["left", "middle", "right"]), action: z.enum(["click", "down", "up"]) }));
export const PadKeyPress = msg("pad.key", z.strictObject({ key: PadKey, mods: PadMods }));
export const PadShortcut = msg("pad.shortcut", z.strictObject({ name: Shortcut }));
export const PadType = msg("pad.type", PadTypePayload);
export const PadAltTab = msg("pad.altTab", z.strictObject({ step: AltTabStep }));
/** "Soltar todo": suelta el botón izquierdo y Alt si quedaron apretados. */
export const PadRelease = msg("pad.release", z.strictObject({}));

// ── Agente → Celu ────────────────────────────────────────────────────────────

/** "Mirá la PC": el pedido llegó y espera que Jay toque Permitir. */
export const PairPending = msg("pair.pending", z.strictObject({}));

/** Resultado del pedido de emparejamiento. Sin token: desde v2 la identidad del celu es su clave (Noise). */
export const PairResult = msg(
  "pair.result",
  z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), deviceId: z.uuid(), pcName: z.string().max(64) }),
    z.strictObject({ ok: z.literal(false), reason: z.enum(["rejected", "timeout"]) }),
  ]),
);

export const AuthOk = msg("auth.ok", z.strictObject({ pcName: z.string().max(64), agentVersion: z.string().max(20) }));

export const SystemState = z.strictObject({
  hostname: z.string().max(64),
  agentVersion: z.string().max(20),
  uptimeSec: z.number().int().nonnegative(), // uptime de la PC, no del agente
  cpuPercent: z.number().min(0).max(100),
  memUsedBytes: z.number().int().nonnegative(),
  memTotalBytes: z.number().int().positive(),
  sampledAt: z.number().int(), // epoch ms según el agente
});
export type SystemState = z.infer<typeof SystemState>;

export const StateSnapshot = msg("state.snapshot", SystemState);
export const StateUpdate = msg("state.update", SystemState);
export const ScreensSnapshot = msg("screens.snapshot", ScreensState);
export const ScreensUpdate = msg("screens.update", ScreensState);
/** Por qué un comando no se pudo cumplir. */
export const CommandError = z.enum([
  "not_found",
  "primary",
  "last_active",
  "no_window",
  "elevated",
  "busy",
  "failed",
  "unsupported",
  "not_allowed",
  "focus_denied",
  "launch_failed",
  "not_placed",
  "limit",
  "audio_unavailable",
  "output_unavailable",
  "not_supported",
  "input_disabled",
  "input_blocked",
  "input_unavailable",
  "hotkey_taken",
]);
export type CommandError = z.infer<typeof CommandError>;

/** Respuesta a un comando del celu (`replyTo` es el `id` del mensaje que lo pidió). */
export const CommandResult = msg(
  "command.result",
  z.discriminatedUnion("ok", [
    z.strictObject({ replyTo: Id, ok: z.literal(true), steps: z.array(z.enum(["ok", "partial", "failed", "skipped"])).max(12).optional() }),
    z.strictObject({ replyTo: Id, ok: z.literal(false), reason: CommandError }),
  ]),
);

export const WindowsSnapshot = msg("windows.snapshot", WindowsState);
export const WindowsUpdate = msg("windows.update", WindowsState);
export const LibrarySnapshot = msg("library.snapshot", Library);
export const LibraryUpdate = msg("library.update", Library);
export const AppsResults = msg("apps.results", z.strictObject({ replyTo: Id, items: z.array(CatalogApp).max(SEARCH_MAX), total: z.number().int().nonnegative() }));
/** Un ícono PNG en base64 estándar (hasta ~16 KB de binario); `null` = no hay ícono. */
export const IconData = msg("icon.data", z.strictObject({ key: IconKey, png: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(22_000).nullable() }));
export const SceneProgress = msg(
  "scene.progress",
  z.strictObject({ runId: Id, sceneId: SceneId, index: z.number().int().min(0).max(11), status: z.enum(["running", "ok", "partial", "failed", "skipped"]), reason: CommandError.nullable() }),
);

export const BrowserStateMsg = msg("browser.state", BrowserState);
export const BrowserDataMsg = msg("browser.data", BrowserDataPayload);

export const AudioSnapshot = msg("audio.snapshot", AudioState);
export const AudioUpdate = msg("audio.update", AudioState);
/** Una carátula en JPEG, base64 estándar (hasta ~16 KB de binario); null = no hay o ya no está. */
export const MediaArtData = msg("media.artData", z.strictObject({ key: ArtKey, jpeg: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(22_000).nullable() }));

export const PadStateMsg = msg("pad.state", PadState);
/** Un acuse chiquito mientras se usa el touchpad: la PC le contesta algo al celu seguido para que el TCP del celu no se quede esperando el ACK (Nagle + ACK demorado de Windows = trabas de ~200 ms). No lleva datos. */
export const PadAck = msg("pad.ack", z.strictObject({}));

export const Pong = msg("pong", z.strictObject({}));

export const ErrorMsg = msg(
  "error",
  z.strictObject({ code: ErrorCode, message: z.string().max(200), replyTo: Id.optional() }),
);

// ── Uniones y parseo ─────────────────────────────────────────────────────────

export const ClientMessage = z.discriminatedUnion("type", [
  Ping,
  DeviceUnpair,
  MonitorRename,
  MonitorSetEnabled,
  MonitorSetOrder,
  WindowMoveActive,
  MonitorIdentify,
  WindowMove,
  WindowAct,
  WindowsBringAll,
  AppsSearch,
  IconGet,
  LauncherAdd,
  LauncherRename,
  LauncherRemove,
  LauncherRun,
  TargetRun,
  SceneSave,
  SceneRemove,
  SceneRun,
  DeckSet,
  BrowserAct,
  BrowserQueryMsg,
  AudioSetVolume,
  AudioSetMute,
  AudioNudge,
  AudioToggleMute,
  AudioSetDefault,
  AudioRoute,
  AudioRename,
  AudioHide,
  MediaKeyPress,
  SoundPut,
  SoundPlayMsg,
  MediaSelect,
  MediaArtGet,
  PadMove,
  PadScroll,
  PadButton,
  PadKeyPress,
  PadShortcut,
  PadType,
  PadAltTab,
  PadRelease,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  PairPending,
  PairResult,
  AuthOk,
  StateSnapshot,
  StateUpdate,
  ScreensSnapshot,
  ScreensUpdate,
  WindowsSnapshot,
  WindowsUpdate,
  LibrarySnapshot,
  LibraryUpdate,
  AppsResults,
  IconData,
  SceneProgress,
  AudioSnapshot,
  AudioUpdate,
  MediaArtData,
  BrowserStateMsg,
  BrowserDataMsg,
  PadStateMsg,
  PadAck,
  CommandResult,
  Pong,
  ErrorMsg,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

const CLIENT_TYPES: ReadonlySet<string> = new Set(["ping", "device.unpair", "monitor.rename", "monitor.setEnabled", "monitor.setOrder", "window.moveActive", "monitor.identify", "window.move", "window.act", "windows.bringAll", "apps.search", "icon.get", "launcher.add", "launcher.rename", "launcher.remove", "launcher.run", "target.run", "scene.save", "scene.remove", "scene.run", "deck.set", "browser.act", "browser.query", "audio.setVolume", "audio.setMute", "audio.nudge", "audio.toggleMute", "audio.setDefault", "audio.route", "audio.rename", "audio.hide", "media.key", "sound.put", "sound.play", "media.select", "media.art", "pad.move", "pad.scroll", "pad.button", "pad.key", "pad.shortcut", "pad.type", "pad.altTab", "pad.release"]);
const SERVER_TYPES: ReadonlySet<string> = new Set([
  "pair.pending",
  "pair.result",
  "auth.ok",
  "state.snapshot",
  "state.update",
  "screens.snapshot",
  "screens.update",
  "windows.snapshot",
  "windows.update",
  "library.snapshot",
  "library.update",
  "apps.results",
  "icon.data",
  "scene.progress",
  "audio.snapshot",
  "audio.update",
  "media.artData",
  "browser.state",
  "browser.data",
  "pad.state",
  "pad.ack",
  "command.result",
  "pong",
  "error",
]);

function parseWith<S extends z.ZodType>(
  raw: string,
  schema: S,
  knownTypes: ReadonlySet<string>,
  maxBytes: number,
): { ok: true; msg: z.infer<S> } | ParseFailure {
  const e = parseEnvelope(raw, maxBytes);
  if (!e.ok) return e;
  if (!knownTypes.has(e.envelope.type)) {
    return { ok: false, code: "unknown_type", detail: `type desconocido: ${e.envelope.type}` };
  }
  const r = schema.safeParse(e.envelope);
  if (!r.success) return { ok: false, code: "bad_message", detail: z.prettifyError(r.error) };
  return { ok: true, msg: r.data };
}

/** Lo que recibe el agente. Un mensaje del agente que llegue acá es `unknown_type`. */
export function parseClientMessage(raw: string) {
  return parseWith(raw, ClientMessage, CLIENT_TYPES, MAX_MESSAGE_BYTES);
}

/** Lo que recibe el celu. */
export function parseServerMessage(raw: string) {
  return parseWith(raw, ServerMessage, SERVER_TYPES, MAX_SERVER_MESSAGE_BYTES);
}
