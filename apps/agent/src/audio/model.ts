import { createHash } from "node:crypto";
import { MAX_MEDIA_DURATION_MS } from "@proyecto-e/protocol";
import type { AppAudio, AudioState, MediaSession, MediaTimeline, OutputInfo, OutputKind } from "@proyecto-e/protocol";
import type { AudioConfig } from "../config/schema";
import type { RawAudio, RawMedia, RawOutput, RawSession } from "../ports";
import { iconKeyFor } from "../apps/windowsModel";

// Modelo puro del audio (docs/PLAN.md 8.4.4): lo que dice Windows → lo que ve el celu.
// El celu nunca ve un id de Windows, una ruta ni un PID: solo ids opacos, y este módulo guarda el camino de vuelta.

const MAX_OUTPUTS = 16;
const MAX_APPS = 20;
const MAX_MEDIA = 8;
/** Un pico mayor a esto es "hace ruido"; por debajo es ruido de fondo del driver. */
const LOUD = 0.001;
/** Cuánto dura la marca "sonando" después del último pico, para que no titile entre canciones o pausas cortas (D33). */
const SOUNDING_MS = 3000;

const hash12 = (source: string): string => createHash("sha256").update(source).digest("base64url").slice(0, 12);

/** "o_" + 12 del hash del id de Windows: estable entre reinicios, así sirve para guardarlo en una escena o en el Inicio (D28). */
export const outputIdFor = (winId: string): string => "o_" + hash12(winId.toLowerCase());
/** "a_" + 12 del hash de la ruta del .exe (sin distinguir mayúsculas). */
export const appIdFor = (exePath: string): string => "a_" + hash12(exePath.toLowerCase());
/** "m_" + 12 del hash del AUMID de la sesión de media. */
export const mediaIdFor = (aumid: string, index = 0): string => "m_" + hash12(aumid.toLowerCase() + (index > 0 ? `#${index}` : ""));
/** "r_" + 12 del hash de app + título + artista: cambia cuando cambia el tema, así el celu sabe que tiene que pedir otra carátula. */
export const artKeyFor = (aumid: string, title: string, artist: string, index = 0): string => "r_" + hash12(`${aumid.toLowerCase()}${index > 0 ? `#${index}` : ""}\n${title}\n${artist}`);

/** Una sesión de media de Windows: el AUMID no alcanza (dos sesiones de Chrome lo comparten). */
export interface MediaRef {
  aumid: string;
  index: number;
}

/** El camino de vuelta de los ids opacos a lo real. Solo vive en el agente. */
export interface AudioLookup {
  /** id de salida → id de Windows (solo las activas: una "unavailable" no está acá). */
  outputs: Map<string, string>;
  /** id de app → PID de todas sus sesiones. */
  apps: Map<string, number[]>;
  /** id de media → la sesión (AUMID y número de orden entre las del mismo AUMID). */
  media: Map<string, MediaRef>;
  /** clave de carátula → la sesión. */
  art: Map<string, MediaRef>;
}

/** Cuándo hizo ruido cada app por última vez. Se actualiza en cada `buildAudio`. */
export class SoundingHistory {
  private readonly lastLoud = new Map<string, number>();

  observe(appId: string, peak: number, now: number): void {
    if (peak > LOUD) this.lastLoud.set(appId, now);
  }

  isSounding(appId: string, now: number): boolean {
    const last = this.lastLoud.get(appId);
    return last !== undefined && now - last <= SOUNDING_MS;
  }

  /** Olvida las apps que ya no tienen sesión. */
  prune(live: ReadonlySet<string>): void {
    for (const id of this.lastLoud.keys()) if (!live.has(id)) this.lastLoud.delete(id);
  }

  size(): number {
    return this.lastLoud.size;
  }
}

const pct = (scalar: number): number => Math.min(100, Math.max(0, Math.round(scalar * 100)));

/** `EndpointFormFactor` de Windows → el tipo que dibuja el celu (verificar los valores en el spike S1). */
function kindOf(formFactor: number): OutputKind {
  if (formFactor === 3 || formFactor === 5) return "headphones";
  if (formFactor === 1) return "speakers";
  if (formFactor === 9) return "tv"; // pantalla HDMI / DisplayPort
  if (formFactor === 7 || formFactor === 8) return "digital";
  return "other";
}

const label = (o: OutputInfo): string => o.nick ?? o.name;
const byLabel = (a: string, b: string): number => a.localeCompare(b, "es");

function buildOutputs(raw: RawOutput[], defaultWinId: string | null, config: AudioConfig, lookup: AudioLookup): OutputInfo[] {
  const out: OutputInfo[] = [];
  const active = new Set<string>();
  for (const o of raw) {
    const id = outputIdFor(o.winId);
    if (active.has(id)) continue;
    active.add(id);
    lookup.outputs.set(id, o.winId);
    const cfg = config.outputs[id];
    out.push({
      id,
      name: o.name.slice(0, 80),
      nick: cfg?.nick ?? null,
      kind: kindOf(o.formFactor),
      state: "active",
      isDefault: defaultWinId !== null && o.winId === defaultWinId,
      volume: pct(o.volume),
      muted: o.muted,
      hidden: cfg?.hidden ?? false,
    });
  }
  // D32: las que Jay renombró o usa en una escena siguen en la lista, en gris, cuando se desconectan (la tele apagada).
  for (const [id, known] of Object.entries(config.known)) {
    if (active.has(id)) continue;
    const cfg = config.outputs[id];
    out.push({ id, name: known.name.slice(0, 80), nick: cfg?.nick ?? null, kind: known.kind, state: "unavailable", isDefault: false, volume: null, muted: false, hidden: cfg?.hidden ?? false });
  }
  out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.state !== b.state) return a.state === "active" ? -1 : 1;
    return byLabel(label(a), label(b));
  });
  return out.slice(0, MAX_OUTPUTS);
}

const exeName = (path: string): string => (path.split(/[\\/]/).pop() ?? path).replace(/\.exe$/i, "").slice(0, 64);

function buildApps(sessions: RawSession[], outputs: RawOutput[], history: SoundingHistory, now: number, lookup: AudioLookup): AppAudio[] {
  const present = new Map(outputs.map((o) => [o.winId, outputIdFor(o.winId)]));
  const groups = new Map<string, RawSession[]>();
  for (const s of sessions) {
    if (s.pid === 0 || s.exePath === "") continue; // sonidos del sistema y procesos que no se pudieron leer
    if (!present.has(s.winOutputId)) continue;
    const key = s.exePath.toLowerCase();
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }

  const apps: AppAudio[] = [];
  const live = new Set<string>();
  for (const group of groups.values()) {
    const first = group[0]!;
    const id = appIdFor(first.exePath);
    live.add(id);
    history.observe(id, Math.max(...group.map((s) => s.peak)), now);
    const outputIds = [...new Set(group.map((s) => present.get(s.winOutputId)!))].slice(0, 4);
    const routedWin = group.map((s) => s.routedWinId).find((w): w is string => w !== null && present.has(w));
    lookup.apps.set(
      id,
      group.map((s) => s.pid),
    );
    apps.push({
      id,
      name: exeName(first.exePath),
      iconKey: iconKeyFor(first.exePath),
      outputIds,
      volume: pct(first.volume),
      muted: first.muted,
      sounding: history.isSounding(id, now),
      routed: routedWin ? present.get(routedWin)! : null,
    });
  }
  history.prune(live);
  apps.sort((a, b) => (a.sounding !== b.sounding ? (a.sounding ? -1 : 1) : byLabel(a.name, b.name)));
  return apps.slice(0, MAX_APPS);
}

/** "chrome.exe" → "chrome"; "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" → "Spotify". */
function mediaName(aumid: string): string {
  const bang = aumid.lastIndexOf("!");
  // Si el AUMID fuera una ruta, solo se muestra el nombre del archivo.
  const raw = bang >= 0 ? aumid.slice(bang + 1) : (aumid.split(/[\\/]/).pop() ?? aumid).replace(/\.exe$/i, "");
  return raw.slice(0, 64);
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * La línea de tiempo que viaja al celu (D97): por dónde va AHORA y cuánto dura. Windows da la posición del momento en que
 * la app la informó; si está reproduciendo se le suma lo que pasó desde entonces. Sin duración (un vivo) o con datos que no
 * cierran, no hay línea de tiempo: el celu no dibuja barra.
 */
export function timelineOf(m: RawMedia): MediaTimeline | undefined {
  const t = m.timeline;
  if (!t || !finite(t.startMs) || !finite(t.endMs) || !finite(t.positionMs)) return undefined;
  const durationMs = Math.round(t.endMs - t.startMs);
  if (durationMs < 1 || durationMs > MAX_MEDIA_DURATION_MS) return undefined;
  const rate = finite(t.rate) && t.rate >= 0.1 && t.rate <= 16 ? t.rate : 1;
  let position = t.positionMs - t.startMs;
  if (m.status === "playing") {
    // Sin saber cuándo se informó la posición no se puede saber por dónde va ahora.
    if (!finite(t.ageMs) || t.ageMs < 0) return undefined;
    position += t.ageMs * rate;
  }
  return { positionMs: Math.min(durationMs, Math.max(0, Math.round(position))), durationMs, rate };
}

/** Cuánto puede diferir la posición de lo esperado sin que cuente como un salto (D97). */
export const TIMELINE_TOLERANCE_MS = 2_000;

/**
 * El estado tal como se compara para decidir si hay que avisar al celu. La posición cambia en cada lectura aunque nada haya
 * pasado, así que no se compara tal cual: reproduciendo se compara el "momento en que empezó" (ahora − posición ÷ velocidad),
 * que no se mueve mientras avanza a su ritmo; en pausa, la posición. Si difiere menos que la tolerancia del último valor
 * avisado, se da por igual. `keys` (id de media → ese valor) es lo que hay que pasar en la próxima comparación.
 */
export function comparableAudio(state: AudioState, now: number, prev: ReadonlyMap<string, number>): { json: string; keys: Map<string, number> } {
  const keys = new Map<string, number>();
  const sessions = state.media.sessions.map((s) => {
    if (!s.timeline) return s;
    const { positionMs, ...rest } = s.timeline;
    // Al final del tema la posición queda recortada en la duración: ahí se compara la posición, como en pausa (si no, el
    // "momento en que empezó" cambiaría con el reloj y se avisaría en cada lectura).
    const moving = s.status === "playing" && positionMs < rest.durationMs;
    const fresh = moving ? Math.round(now - positionMs / rest.rate) : positionMs;
    const last = prev.get(s.id);
    const key = last !== undefined && Math.abs(fresh - last) <= TIMELINE_TOLERANCE_MS ? last : fresh;
    keys.set(s.id, key);
    return { ...s, timeline: { ...rest, key } };
  });
  return { json: JSON.stringify({ ...state, media: { ...state.media, sessions } }), keys };
}

function buildMedia(raw: RawMedia[], chosen: string | null, apps: AppAudio[], lookup: AudioLookup): AudioState["media"] {
  const ordered = [...raw].sort((a, b) => Number(b.status === "playing") - Number(a.status === "playing")).slice(0, MAX_MEDIA);
  const sessions: MediaSession[] = ordered.map((m) => {
    const id = mediaIdFor(m.aumid, m.index);
    lookup.media.set(id, { aumid: m.aumid, index: m.index });
    const name = mediaName(m.aumid);
    const artKey = m.hasArt ? artKeyFor(m.aumid, m.title, m.artist, m.index) : null;
    if (artKey) lookup.art.set(artKey, { aumid: m.aumid, index: m.index });
    const timeline = timelineOf(m);
    return {
      id,
      app: name,
      iconKey: apps.find((a) => a.name.toLowerCase() === name.toLowerCase())?.iconKey ?? null,
      title: m.title.slice(0, 120),
      artist: m.artist.slice(0, 80),
      status: m.status,
      controls: { ...m.controls },
      artKey,
      // Sin datos el campo no viaja (no se manda `null`).
      ...(timeline ? { timeline } : {}),
    };
  });
  const picked = chosen !== null ? sessions.find((s) => s.id === chosen) : undefined;
  if (picked) return { sessions, targetId: picked.id, chosen: true };
  // La "actual" de Windows; si dos sesiones de la misma app figuran como actual, la que está reproduciendo.
  const currents = ordered.filter((m) => m.isCurrent);
  const cur = currents.find((m) => m.status === "playing") ?? currents[0];
  const current = cur ? mediaIdFor(cur.aumid, cur.index) : (sessions[0]?.id ?? null);
  return { sessions, targetId: sessions.length === 0 ? null : current, chosen: false };
}

export interface BuildAudioInput {
  raw: RawAudio;
  config: AudioConfig;
  history: SoundingHistory;
  now: number;
  /** El `MediaId` que eligió Jay para ⏮ ⏯ ⏭ (D35), o null. */
  chosenMedia: string | null;
  /** Lo que dijo el hijo de audio al arrancar. */
  available: { audio: boolean; defaultOutput: boolean; appRouting: boolean };
}

export function buildAudio(input: BuildAudioInput): { state: AudioState; lookup: AudioLookup } {
  const { raw, config, history, now } = input;
  const lookup: AudioLookup = { outputs: new Map(), apps: new Map(), media: new Map(), art: new Map() };
  const outputs = buildOutputs(raw.outputs, raw.defaultWinId, config, lookup);
  const apps = buildApps(raw.sessions, raw.outputs, history, now, lookup);
  const media = buildMedia(raw.media, input.chosenMedia, apps, lookup);
  return {
    state: {
      available: {
        audio: input.available.audio,
        defaultOutput: input.available.defaultOutput && !config.disable.defaultOutput,
        appRouting: input.available.appRouting && !config.disable.appRouting,
      },
      outputs,
      apps,
      media,
    },
    lookup,
  };
}
