import type { AudioState, AudioTarget, CommandError, MediaKey } from "@proyecto-e/protocol";
import type { AudioConfig } from "../config/schema";
import type { AudioReady, AudioSystem, Clock, Logger, MediaKeys, RawAudio } from "../ports";
import { SoundingHistory, buildAudio, comparableAudio, type AudioLookup } from "./model";

// Servicio de audio (docs/PLAN.md 8.4.4): lee Windows, arma el estado para el celu y ejecuta lo que el celu pide.
// El celu solo manda ids opacos; el camino de vuelta a los ids de Windows y a los PID está en `lookup` y no sale de acá.

export type Outcome = { ok: true } | { ok: false; reason: CommandError };

export interface AudioService {
  /** Lee Windows. Nunca rechaza: si falla, el estado queda "audio no disponible" y se recupera solo. */
  refresh(): Promise<{ changed: boolean; state: AudioState | null }>;
  current(): AudioState | null;
  setVolume(target: AudioTarget, volume: number): Promise<Outcome>;
  setMute(target: AudioTarget, muted: boolean): Promise<Outcome>;
  /** F4a (D108): reproduce un archivo por esa salida, sin cambiar la predeterminada. `volume` de 0 a 100. */
  playSound(file: string, outputId: string, volume: number): Promise<Outcome>;
  /** Sube o baja la predeterminada de a 5 (D36). */
  nudge(delta: -5 | 5): Promise<Outcome>;
  toggleMute(): Promise<Outcome>;
  setDefault(outputId: string): Promise<Outcome>;
  /** Manda una app a una salida; `null` = que siga a la predeterminada. */
  route(appId: string, outputId: string | null): Promise<Outcome>;
  rename(outputId: string, nick: string | null): Promise<Outcome>;
  hide(outputId: string, hidden: boolean): Promise<Outcome>;
  /** Espera hasta `ms` a que una salida conocida esté activa (la tele recién prendida tarda). `false` si no aparece o nunca se vio. */
  waitForOutput(outputId: string, ms: number): Promise<boolean>;
  /** Anota una salida vista entre las conocidas (la usa una escena o el Inicio). `false` si nunca se vio. */
  remember(outputId: string): Promise<boolean>;
  pressKey(key: MediaKey): Promise<Outcome>;
  selectMedia(id: string | null): Promise<Outcome>;
  art(keys: string[]): Promise<{ key: string; jpeg: string | null }[]>;
  subscribe(cb: (state: AudioState) => void): () => void;
}

const ART_CACHE_MAX = 20;
const WAIT_POLL_MS = 400;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Traduce lo que dice el hijo de audio al motivo que ve el celu. */
function reasonOf(err: unknown): CommandError {
  const m = message(err);
  if (/busy/.test(m)) return "busy";
  if (/output_unavailable/.test(m)) return "output_unavailable";
  if (/not_supported/.test(m)) return "not_supported";
  if (/not_found/.test(m)) return "not_found";
  if (/no disponible|unavailable|stopped|detenido|unsupported|exited|timeout/i.test(m)) return "audio_unavailable";
  return "failed";
}

const fail = (reason: CommandError): Outcome => ({ ok: false, reason });
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function createAudioService(deps: {
  /** `undefined` cuando no es Windows: todo da "audio no disponible". */
  audio: AudioSystem | undefined;
  mediaKeys: MediaKeys;
  config: { get(): AudioConfig; save(next: AudioConfig): Promise<void> };
  clock: Clock;
  log: Logger;
}): AudioService {
  const { audio, mediaKeys, config, clock, log } = deps;
  const history = new SoundingHistory();
  const listeners = new Set<(s: AudioState) => void>();
  let flags: AudioReady | null = null;
  let lastRaw: RawAudio | null = null;
  let lookup: AudioLookup = { outputs: new Map(), apps: new Map(), media: new Map(), art: new Map() };
  let state: AudioState | null = null;
  let lastJson = "";
  /** Con qué se comparó la línea de tiempo de cada reproducción la última vez (ver `comparableAudio`). */
  let timelineKeys = new Map<string, number>();
  let chosenMedia: string | null = null;
  const artCache = new Map<string, string | null>();

  function rebuild(raw: RawAudio | null): boolean {
    const built = buildAudio({
      raw: raw ?? { outputs: [], sessions: [], defaultWinId: null, media: [] },
      config: config.get(),
      history,
      now: clock.now(),
      chosenMedia,
      available: raw && flags ? { audio: true, defaultOutput: flags.defaultOutput, appRouting: flags.appRouting } : { audio: false, defaultOutput: false, appRouting: false },
    });
    lookup = built.lookup;
    // La posición de lo que suena avanza sola: eso no es un cambio que haya que avisar (D97). `state` igual queda fresco.
    const comparable = comparableAudio(built.state, clock.now(), timelineKeys);
    timelineKeys = comparable.keys;
    const json = comparable.json;
    const changed = json !== lastJson;
    lastJson = json;
    state = built.state;
    if (changed) for (const cb of listeners) cb(built.state);
    return changed;
  }

  let reading: Promise<{ changed: boolean; state: AudioState | null }> | null = null;
  let readAgain: Promise<{ changed: boolean; state: AudioState | null }> | null = null;
  function refresh() {
    if (!reading) {
      reading = read().finally(() => (reading = null));
      return reading;
    }
    readAgain ??= reading.then(() => {
      readAgain = null;
      reading = read().finally(() => (reading = null));
      return reading;
    });
    return readAgain;
  }

  async function read() {
    if (!audio) {
      lastRaw = null;
      return { changed: rebuild(null), state };
    }
    try {
      flags ??= await audio.ready();
      lastRaw = await audio.snapshot();
    } catch (err) {
      log.warn("audio: cannot read", { error: message(err) });
      lastRaw = null;
      return { changed: rebuild(null), state };
    }
    return { changed: rebuild(lastRaw), state };
  }

  const available = () => audio !== undefined && state?.available.audio === true;

  /** Corre un cambio en Windows y vuelve a leer. */
  async function change(run: () => Promise<void>): Promise<Outcome> {
    try {
      await run();
    } catch (err) {
      log.warn("audio: change failed", { error: message(err) });
      return fail(reasonOf(err));
    }
    await refresh();
    return { ok: true };
  }

  function output(id: string): { winId: string } | Outcome {
    const winId = lookup.outputs.get(id);
    if (winId) return { winId };
    return fail(state?.outputs.some((o) => o.id === id) ? "output_unavailable" : "not_found");
  }
  const isOutcome = (x: { winId: string } | Outcome): x is Outcome => "ok" in x;

  // D38: un deslizador manda decenas de valores por segundo. Por cada id se atiende de a uno; mientras uno está en curso, los
  // que llegan se reemplazan por el último, y todos reciben el resultado final (los descartados cuentan como ok).
  const slots = new Map<string, { latest: number; dirty: boolean; waiters: ((o: Outcome) => void)[] }>();

  async function applyVolume(target: AudioTarget, volume: number): Promise<Outcome> {
    const scalar = clamp(volume, 0, 100) / 100;
    try {
      if (target.kind === "output") {
        const o = output(target.id);
        if (isOutcome(o)) return o;
        await audio!.setOutputVolume(o.winId, scalar);
      } else {
        const pids = lookup.apps.get(target.id);
        if (!pids) return fail("not_found");
        await audio!.setAppVolume(pids, scalar);
      }
      return { ok: true };
    } catch (err) {
      log.warn("audio: volume failed", { error: message(err) });
      return fail(reasonOf(err));
    }
  }

  async function setVolume(target: AudioTarget, volume: number): Promise<Outcome> {
    if (!audio || !available()) return fail("audio_unavailable");
    const key = `${target.kind}:${target.id}`;
    const slot = slots.get(key);
    if (slot) {
      slot.latest = volume;
      slot.dirty = true;
      return new Promise<Outcome>((resolve) => slot.waiters.push(resolve));
    }
    const mine = { latest: volume, dirty: false, waiters: [] as ((o: Outcome) => void)[] };
    slots.set(key, mine);
    let outcome = await applyVolume(target, volume);
    while (mine.dirty && outcome.ok) {
      mine.dirty = false;
      outcome = await applyVolume(target, mine.latest);
    }
    slots.delete(key);
    if (outcome.ok) await refresh();
    for (const w of mine.waiters) w(outcome);
    return outcome;
  }

  let ordered: Promise<unknown> = Promise.resolve();
  function inOrder(run: () => Promise<Outcome>): Promise<Outcome> {
    const p = ordered.then(run, run);
    ordered = p.catch(() => undefined);
    return p;
  }

  async function setMuteNow(target: AudioTarget, muted: boolean): Promise<Outcome> {
    if (!available()) return fail("audio_unavailable");
    return change(async () => {
      if (target.kind === "output") {
        const o = output(target.id);
        if (isOutcome(o)) throw new Error(o.ok ? "failed" : o.reason);
        await audio!.setOutputMute(o.winId, muted);
      } else {
        const pids = lookup.apps.get(target.id);
        if (!pids) throw new Error("not_found");
        await audio!.setAppMute(pids, muted);
      }
    });
  }

  const defaultOutput = () => state?.outputs.find((o) => o.isDefault && o.state === "active") ?? null;

  function mediaSession(): { aumid: string; index: number; controls: Record<MediaKey, boolean> } | null {
    const id = state?.media.targetId;
    const s = id ? state?.media.sessions.find((x) => x.id === id) : undefined;
    const ref = id ? lookup.media.get(id) : undefined;
    return s && ref ? { aumid: ref.aumid, index: ref.index, controls: s.controls } : null;
  }

  /** Guarda un cambio de apodo u "oculta" sobre una salida que se vio alguna vez (D32). */
  async function updateOutput(id: string, patch: { nick?: string | null; hidden?: boolean }): Promise<Outcome> {
    const info = state?.outputs.find((o) => o.id === id);
    if (!info) return fail("not_found");
    const cfg = config.get();
    const prev = cfg.outputs[id] ?? { nick: null, hidden: false };
    const next = { nick: patch.nick !== undefined ? patch.nick : prev.nick, hidden: patch.hidden ?? prev.hidden };
    const outputs = { ...cfg.outputs };
    if (next.nick === null && !next.hidden) delete outputs[id];
    else outputs[id] = next;
    try {
      await config.save({ ...cfg, outputs, known: { ...cfg.known, [id]: { name: info.name, kind: info.kind } } });
    } catch (err) {
      log.error("audio: cannot save config", { error: message(err) });
      return fail("failed");
    }
    rebuild(lastRaw);
    return { ok: true };
  }

  return {
    refresh,
    current: () => state,
    setVolume,

    setMute: (target, muted) => setMuteNow(target, muted),

    // Vol +, Vol − y Silenciar se hacen de a uno (cada uno parte del estado que dejó el anterior): tres toques rápidos suman +15, no +5.
    nudge: (delta) =>
      inOrder(async () => {
        const d = defaultOutput();
        if (!d || d.volume === null) return fail("not_found");
        return setVolume({ kind: "output", id: d.id }, clamp(d.volume + delta, 0, 100));
      }),

    toggleMute: () =>
      inOrder(async () => {
        const d = defaultOutput();
        if (!d) return fail("not_found");
        return setMuteNow({ kind: "output", id: d.id }, !d.muted);
      }),
    async setDefault(outputId) {
      if (!available() || !state?.available.defaultOutput) return fail("audio_unavailable");
      const o = output(outputId);
      if (isOutcome(o)) return o;
      if (state.outputs.find((x) => x.id === outputId)?.isDefault) return { ok: true };
      return change(() => audio!.setDefault(o.winId));
    },

    async playSound(file, outputId, volume) {
      if (!available()) return fail("audio_unavailable");
      const o = output(outputId);
      if (isOutcome(o)) return o;
      try {
        await audio!.playSound(file, o.winId, volume / 100);
      } catch (err) {
        log.warn("audio: cannot play sound", { error: message(err) });
        return fail(reasonOf(err));
      }
      return { ok: true };
    },

    async route(appId, outputId) {
      if (!available() || !state?.available.appRouting) return fail("audio_unavailable");
      const pids = lookup.apps.get(appId);
      if (!pids) return fail("not_found");
      let winId: string | null = null;
      if (outputId !== null) {
        const o = output(outputId);
        if (isOutcome(o)) return o;
        winId = o.winId;
      }
      return change(() => audio!.route(pids, winId));
    },

    async waitForOutput(outputId, ms) {
      await refresh();
      if (lookup.outputs.has(outputId)) return true;
      if (!state?.available.audio) return false; // con el audio caído no tiene sentido esperar 8 s
      if (!state?.outputs.some((o) => o.id === outputId)) return false;
      const deadline = clock.now() + ms;
      while (clock.now() < deadline) {
        await new Promise<void>((resolve) => clock.setTimeout(resolve, WAIT_POLL_MS));
        await refresh();
        if (lookup.outputs.has(outputId)) return true;
      }
      return false;
    },

    rename: (outputId, nick) => updateOutput(outputId, { nick }),
    hide: (outputId, hidden) => updateOutput(outputId, { hidden }),

    async remember(outputId) {
      const info = state?.outputs.find((o) => o.id === outputId);
      if (!info) return false;
      const cfg = config.get();
      if (cfg.known[outputId]) return true;
      try {
        await config.save({ ...cfg, known: { ...cfg.known, [outputId]: { name: info.name, kind: info.kind } } });
        return true;
      } catch (err) {
        log.error("audio: cannot save config", { error: message(err) });
        return false;
      }
    },

    async pressKey(key) {
      const target = mediaSession();
      if (!target) {
        // Sin ninguna sesión de media: la tecla del teclado hace lo mismo que el teclado (D35).
        try {
          await mediaKeys.press(key);
          return { ok: true };
        } catch (err) {
          log.warn("media: key failed", { error: message(err) });
          return fail("failed");
        }
      }
      if (!target.controls[key]) return fail("not_supported");
      try {
        await audio!.mediaControl(target.aumid, key, target.index);
      } catch (err) {
        log.warn("media: control failed", { error: message(err) });
        return fail(reasonOf(err));
      }
      await refresh();
      return { ok: true };
    },

    async selectMedia(id) {
      if (id !== null && !state?.media.sessions.some((s) => s.id === id)) return fail("not_found");
      chosenMedia = id;
      rebuild(lastRaw);
      return { ok: true };
    },

    async art(keys) {
      const out: { key: string; jpeg: string | null }[] = [];
      for (const key of keys) {
        const ref = lookup.art.get(key);
        if (!ref || !audio) {
          out.push({ key, jpeg: null });
          continue;
        }
        if (artCache.has(key)) {
          out.push({ key, jpeg: artCache.get(key) ?? null });
          continue;
        }
        try {
          const jpeg = await audio.art(ref.aumid, ref.index);
          // Un null puede ser "todavía no cargó": no se recuerda, así se vuelve a pedir.
          if (jpeg !== null) {
            artCache.set(key, jpeg);
            if (artCache.size > ART_CACHE_MAX) artCache.delete(artCache.keys().next().value as string);
          }
          out.push({ key, jpeg });
        } catch (err) {
          log.warn("media: art failed", { error: message(err) });
          out.push({ key, jpeg: null });
        }
      }
      return out;
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
