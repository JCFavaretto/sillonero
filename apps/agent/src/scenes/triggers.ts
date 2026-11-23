import type { CommandError, Library, Scene, ScreensState } from "@proyecto-e/protocol";
import type { Clock, Logger, TimerHandle } from "../ports";

// Disparadores de escena (docs/PLAN.md 8.6, D71): el agente corre solo las escenas que tienen `trigger`.
//   · agentStart: una vez, 20 s después de arrancar (para que Windows termine de levantar pantallas y audio).
//   · displayOn: cuando esa pantalla pasa de apagada a prendida (por la app, por el atajo, o un cable que se enchufa).
// Reglas: nunca pisa a otra escena que esté corriendo y la misma escena no se repite antes de 60 s (un cable flojo no
// puede lanzar la escena veinte veces). Funciona sin celu conectado.

export const AGENT_START_DELAY_MS = 20_000;
export const DISPLAY_POLL_MS = 5_000;
export const REPEAT_GUARD_MS = 60_000;

export interface TriggerDeps {
  library: { state(): Library };
  runScene(sceneId: string): Promise<{ ok: true } | { ok: false; reason: CommandError }>;
  /** El id de la escena que está corriendo, o `null`. */
  running(): string | null;
  screens: { refresh(): Promise<unknown>; current(): ScreensState | null };
  clock: Clock;
  log: Logger;
}

export interface Triggers {
  start(): void;
  stop(): void;
}

export function createTriggers(deps: TriggerDeps): Triggers {
  const { clock, log } = deps;
  let startTimer: TimerHandle | null = null;
  let pollTimer: TimerHandle | null = null;
  let stopped = false;
  let polling = false;
  /** Cómo estaba cada pantalla en la lectura anterior (`null` = todavía no se leyó). */
  let previous: Map<string, boolean> | null = null;
  const lastRun = new Map<string, number>();

  const scenesWith = (type: "agentStart" | "displayOn"): Scene[] => deps.library.state().scenes.filter((s) => s.trigger?.type === type);

  /** Corre una escena disparada sola, si se puede. Devuelve si la corrió. */
  async function fire(scene: Scene, why: string): Promise<boolean> {
    if (stopped) return false;
    const now = clock.now();
    const last = lastRun.get(scene.id);
    if (last !== undefined && now - last < REPEAT_GUARD_MS) {
      log.info("trigger skipped: ran less than a minute ago", { sceneId: scene.id, why });
      return false;
    }
    const busy = deps.running();
    if (busy) {
      log.info("trigger skipped: another scene is running", { sceneId: scene.id, running: busy, why });
      return false;
    }
    lastRun.set(scene.id, now);
    log.info("trigger: running scene", { sceneId: scene.id, why });
    try {
      const r = await deps.runScene(scene.id);
      if (!r.ok) log.warn("trigger: scene did not finish cleanly", { sceneId: scene.id, reason: r.reason });
    } catch (err) {
      log.warn("trigger: scene crashed", { sceneId: scene.id, error: String(err) });
    }
    return true;
  }

  async function runAgentStart(): Promise<void> {
    // Una después de la otra; se lee la biblioteca recién ahora (en 20 s pudo cambiar).
    for (const scene of scenesWith("agentStart")) await fire(scene, "agentStart");
  }

  async function pollDisplays(): Promise<void> {
    if (polling || stopped) return;
    const wanted = scenesWith("displayOn");
    if (wanted.length === 0) {
      previous = null; // si más tarde aparece una, la primera lectura vuelve a ser solo "tomar nota"
      return;
    }
    polling = true;
    try {
      try {
        await deps.screens.refresh();
      } catch (err) {
        log.warn("trigger: cannot read the displays", { error: String(err) });
        return;
      }
      const monitors = deps.screens.current()?.monitors;
      if (!monitors) return;
      const now = new Map(monitors.map((m) => [m.id, m.enabled]));
      const before = previous;
      previous = now;
      if (before === null) return; // la primera lectura no dispara: ya estaba como estaba
      for (const scene of wanted) {
        if (scene.trigger?.type !== "displayOn") continue;
        const id = scene.trigger.displayId;
        if (before.get(id) === false && now.get(id) === true) await fire(scene, `displayOn ${id}`);
      }
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (stopped || startTimer !== null) return;
      startTimer = clock.setTimeout(() => {
        void runAgentStart().catch((err: unknown) => log.warn("trigger: agentStart failed", { error: String(err) }));
      }, AGENT_START_DELAY_MS);
      pollTimer = clock.setInterval(() => {
        void pollDisplays().catch((err: unknown) => log.warn("trigger: poll failed", { error: String(err) }));
      }, DISPLAY_POLL_MS);
    },
    stop() {
      stopped = true;
      if (startTimer !== null) clock.clear(startTimer);
      if (pollTimer !== null) clock.clear(pollTimer);
      startTimer = null;
      pollTimer = null;
    },
  };
}
