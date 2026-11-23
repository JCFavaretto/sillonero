import type { AudioState, ClientMessage, CommandError, Library, ServerMessage, Target, WindowsState } from "@proyecto-e/protocol";
import type { SoundStore } from "../sounds/store";
import type { AudioService } from "../audio/service";
import type { Clock, Logger, Random } from "../ports";
import type { ScreensService } from "../screens/service";
import { createSceneRunner, type StepStatus } from "../scenes/runner";
import type { BrowserService } from "../browser/service";
import type { Catalog } from "./catalog";
import type { Icons } from "./icons";
import type { LaunchService } from "./launch";
import type { LibraryService } from "./library";
import type { WindowsService } from "./windowsService";

// Todo lo de B3 detrás de una sola puerta (docs/PLAN.md 8.3.4): la sesión le pasa los mensajes que no son suyos
// y el broadcaster le pide las novedades. Así `session.ts` no conoce ventanas, lanzadores ni escenas.

export type ExtraOutcome = { ok: true; steps?: StepStatus[] } | { ok: false; reason: CommandError; steps?: StepStatus[] } | "replied";
export type ExtraMessage = { type: ServerMessage["type"]; payload: unknown };

export interface Extras {
  /** ¿Es un mensaje de B3? */
  handles(type: string): boolean;
  /**
   * Lo ejecuta. `send` manda mensajes solo a la sesión que preguntó (resultados de búsqueda, íconos).
   * Devuelve el resultado para `command.result`, o `"replied"` si ya contestó por su cuenta.
   */
  handle(msg: ClientMessage, send: (type: ServerMessage["type"], payload: unknown) => void): Promise<ExtraOutcome>;
  /** Lo que se le manda a un celu recién autenticado. */
  snapshots(): Promise<ExtraMessage[]>;
  /** Novedades del muestreo (cada 2 s, solo con celus conectados). */
  tick(): Promise<ExtraMessage[]>;
  /** La config recién se leyó del disco. */
  reload(): void;
  /** Corre una escena guardada desde la PC (atajo o disparador). `busy` si ya hay otra corriendo. */
  runScene(sceneId: string): Promise<{ ok: true } | { ok: false; reason: CommandError }>;
  /** El id de la escena que está corriendo, o `null`. */
  runningScene(): string | null;
  /** La biblioteca ahora. */
  library(): Library;
  /** Se llama con la biblioteca nueva cada vez que cambia. */
  onLibrary(cb: (lib: Library) => void): () => void;
  /** Avisos para todos los celus (biblioteca cambió, progreso de una escena, ventanas tras una acción). */
  subscribe(cb: (type: ServerMessage["type"], payload: unknown) => void): () => void;
}

const TYPES: ReadonlySet<string> = new Set([
  "window.move", "window.act", "windows.bringAll", "apps.search", "icon.get", "launcher.add", "launcher.rename",
  "launcher.remove", "launcher.run", "target.run", "scene.save", "scene.remove", "scene.run", "deck.set",
  "audio.setVolume", "audio.setMute", "audio.nudge", "audio.toggleMute", "audio.setDefault", "audio.route", "audio.rename",
  "audio.hide", "media.key", "media.select", "media.art", "browser.act", "browser.query", "sound.put", "sound.play",
]);

const AUDIO_OFF = { ok: false, reason: "audio_unavailable" } as const;

export function createExtras(deps: {
  /** Fase C: la extensión del navegador (pestañas, marcadores, YouTube). Sin esto los mensajes del navegador contestan que no hay extensión. */
  browser?: BrowserService;
  /** B4. Sin esto los mensajes de audio contestan `audio_unavailable`. */
  audio?: AudioService;
  /** F4a: los sonidos que manda el celu. Sin esto, los mensajes de sonido contestan `unsupported`. */
  sounds?: SoundStore;
  windows: WindowsService;
  screens: ScreensService;
  library: LibraryService;
  launch: LaunchService;
  catalog: Catalog;
  icons: Icons;
  clock: Clock;
  random: Random;
  log: Logger;
}): Extras {
  const { windows, library, launch, catalog, icons, log } = deps;
  const listeners = new Set<(type: ServerMessage["type"], payload: unknown) => void>();
  /** Un lanzamiento por segundo como máximo: un celu pegado no puede abrir cientos de ventanas. */
  const LAUNCH_COOLDOWN_MS = 1_000;
  let lastLaunchAt = -Infinity;
  const broadcast = (type: ServerMessage["type"], payload: unknown) => {
    for (const cb of listeners) cb(type, payload);
  };

  const { audio } = deps;
  windows.subscribe((state: WindowsState) => broadcast("windows.update", state));
  audio?.subscribe((state: AudioState) => broadcast("audio.update", state));
  deps.browser?.subscribe((state) => broadcast("browser.state", state));
  library.subscribe((lib: Library) => broadcast("library.update", lib));
  const runner = createSceneRunner({
    library,
    screens: deps.screens,
    windows,
    launch,
    catalog,
    audio,
    clock: deps.clock,
    random: deps.random,
    log,
    emit: (p) => broadcast("scene.progress", p),
  });

  /** Abre un destino (de un lanzador o de la tecla de un deck): solo apps de la lista de la PC y links http(s); con enfriamiento. */
  async function openTarget(target: Target): Promise<ExtraOutcome> {
    if (target.kind === "app" && !(await catalog.has(target.appId))) return { ok: false, reason: "not_allowed" };
    if (runner.running() || deps.clock.now() - lastLaunchAt < LAUNCH_COOLDOWN_MS) return { ok: false, reason: "busy" };
    lastLaunchAt = deps.clock.now();
    const r = await launch.runTarget(target, null);
    return r.status === "failed" ? { ok: false, reason: r.reason } : { ok: true };
  }

  async function handle(msg: ClientMessage, send: (type: ServerMessage["type"], payload: unknown) => void): Promise<ExtraOutcome> {
    switch (msg.type) {
      case "window.move":
        return windows.move(msg.payload.windowId, msg.payload.monitorId);
      case "window.act":
        return windows.act(msg.payload.windowId, msg.payload.action);
      case "windows.bringAll":
        return windows.bringAll();

      case "apps.search": {
        const r = await catalog.search(msg.payload.query);
        for (const a of r.items) icons.register(a.iconKey, "shell:AppsFolder\\" + a.appId);
        send("apps.results", { replyTo: msg.id, items: r.items, total: r.total });
        return "replied";
      }
      case "icon.get": {
        for (const i of await icons.get(msg.payload.keys)) send("icon.data", { key: i.key, png: i.png });
        return "replied";
      }

      case "launcher.add":
        return library.addLauncher(msg.payload.target, msg.payload.name);
      case "launcher.rename":
        return library.renameLauncher(msg.payload.id, msg.payload.name);
      case "launcher.remove":
        return library.removeLauncher(msg.payload.id);
      case "launcher.run": {
        const l = library.state().launchers.find((x) => x.id === msg.payload.id);
        if (!l) return { ok: false, reason: "not_found" };
        return openTarget(l.target);
      }
      // F3 (D104): la tecla de un deck vive en el celu y trae su destino; la PC solo lo abre (nunca lo guarda).
      case "target.run":
        return openTarget(msg.payload.target);

      case "scene.save":
        return library.saveScene(msg.payload.scene);
      case "scene.remove":
        return library.removeScene(msg.payload.id);
      case "scene.run":
        return runner.run(msg.payload.id);
      case "deck.set":
        return library.setDeck(msg.payload.items);

      // B4: audio y media. Sin servicio de audio (otro sistema), todo contesta audio_unavailable.
      case "sound.put": {
        if (!deps.sounds) return { ok: false, reason: "unsupported" };
        const r = await deps.sounds.put(msg.payload);
        if (r.ok) return { ok: true };
        // invalid = lo que llegó no es un sonido (not_allowed); too_big = pasó el tope (limit)
        return { ok: false, reason: r.reason === "invalid" ? "not_allowed" : r.reason === "too_big" ? "limit" : r.reason === "busy" ? "busy" : "failed" };
      }
      case "sound.play": {
        if (!audio || !deps.sounds) return AUDIO_OFF;
        const file = deps.sounds.path(msg.payload.id, msg.payload.ext);
        // La PC no lo tiene (o lo perdió): el celu lo vuelve a mandar y repite.
        if (!file) return { ok: false, reason: "not_found" };
        return audio.playSound(file, msg.payload.outputId, msg.payload.volume);
      }
      case "audio.setVolume":
        return audio ? audio.setVolume(msg.payload.target, msg.payload.volume) : AUDIO_OFF;
      case "audio.setMute":
        return audio ? audio.setMute(msg.payload.target, msg.payload.muted) : AUDIO_OFF;
      case "audio.nudge":
        return audio ? audio.nudge(msg.payload.delta) : AUDIO_OFF;
      case "audio.toggleMute":
        return audio ? audio.toggleMute() : AUDIO_OFF;
      case "audio.setDefault":
        return audio ? audio.setDefault(msg.payload.outputId) : AUDIO_OFF;
      case "audio.route":
        return audio ? audio.route(msg.payload.appId, msg.payload.outputId) : AUDIO_OFF;
      case "audio.rename":
        return audio ? audio.rename(msg.payload.outputId, msg.payload.nick) : AUDIO_OFF;
      case "audio.hide":
        return audio ? audio.hide(msg.payload.outputId, msg.payload.hidden) : AUDIO_OFF;
      case "media.key":
        return audio ? audio.pressKey(msg.payload.key) : AUDIO_OFF;
      case "media.select":
        return audio ? audio.selectMedia(msg.payload.id) : AUDIO_OFF;
      case "browser.act":
        return deps.browser ? deps.browser.act(msg.payload) : { ok: false, reason: "unsupported" };
      case "browser.query": {
        const r = deps.browser ? await deps.browser.query(msg.payload) : ({ ok: false, reason: "no_extension" } as const);
        send("browser.data", r.ok ? { replyTo: msg.id, kind: msg.payload.kind, ok: true, items: r.items } : { replyTo: msg.id, kind: msg.payload.kind, ok: false, reason: r.reason });
        return "replied";
      }
      case "media.art": {
        if (!audio) return AUDIO_OFF;
        for (const a of await audio.art(msg.payload.keys)) send("media.artData", { key: a.key, jpeg: a.jpeg });
        return "replied";
      }
      default:
        return { ok: false, reason: "unsupported" };
    }
  }

  return {
    handles: (type) => TYPES.has(type),
    reload: () => library.reload(),
    async runScene(id) {
      // Sin celu conectado nadie viene refrescando las pantallas: se leen ahora para que los pasos vean cómo están de verdad.
      if (!runner.running()) await deps.screens.refresh();
      return runner.run(id);
    },
    runningScene: () => runner.running(),
    library: () => library.state(),
    onLibrary: (cb) => library.subscribe(cb),
    handle,
    async snapshots() {
      await Promise.all([windows.refresh(), audio?.refresh()]);
      const audioState = audio?.current();
      return [
        { type: "windows.snapshot", payload: windows.current() ?? { windows: [] } },
        { type: "library.snapshot", payload: library.state() },
        ...(audioState ? [{ type: "audio.snapshot" as const, payload: audioState }] : []),
        ...(deps.browser ? [{ type: "browser.state" as const, payload: deps.browser.state() }] : []),
      ];
    },
    async tick() {
      await Promise.all([windows.refresh(), audio?.refresh()]); // si cambió algo, `refresh` ya avisa a todos por `subscribe`
      return [];
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
