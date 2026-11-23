import type { CommandError, Library, ScreensState, Step } from "@proyecto-e/protocol";
import type { Catalog } from "../apps/catalog";
import type { LaunchService } from "../apps/launch";
import type { Clock, Logger, Random } from "../ports";

// Ejecutor de escenas (docs/PLAN.md D22): una escena es una rutina, no una transacción. Los pasos corren en orden,
// cada uno informa su resultado, y si uno falla los siguientes siguen. Nada se deshace.

export type StepStatus = "ok" | "partial" | "failed" | "skipped";
export type RunOutcome = { ok: true; steps: StepStatus[] } | { ok: false; reason: CommandError; steps?: StepStatus[] };

export interface Progress {
  runId: string;
  sceneId: string;
  index: number;
  status: "running" | StepStatus;
  reason: CommandError | null;
}

/** Lo mínimo del servicio de pantallas que usan las escenas. */
export interface ScreensControl {
  current(): ScreensState | null;
  setEnabled(id: string, on: boolean): Promise<{ ok: true } | { ok: false; reason: CommandError }>;
}

/** Lo que usan los pasos de audio (B4). */
export interface AudioControl {
  waitForOutput(outputId: string, ms: number): Promise<boolean>;
  setDefault(outputId: string): Promise<{ ok: true } | { ok: false; reason: CommandError }>;
  setVolume(target: { kind: "output"; id: string }, volume: number): Promise<{ ok: true } | { ok: false; reason: CommandError }>;
}

export interface SceneRunner {
  run(sceneId: string): Promise<RunOutcome>;
  /** El id de la escena que está corriendo, o `null`. */
  running(): string | null;
}

const TOTAL_TIMEOUT_MS = 60_000;
/** D37: lo que se espera a que una salida aparezca (la tele recién prendida). */
const OUTPUT_WAIT_MS = 8_000;

export function createSceneRunner(deps: {
  library: { state(): Library };
  screens: ScreensControl;
  windows: { bringAll(): Promise<{ ok: true } | { ok: false; reason: CommandError }> };
  launch: LaunchService;
  catalog: Pick<Catalog, "has">;
  /** B4. Sin esto, un paso de audio falla con `audio_unavailable`. */
  audio?: AudioControl;
  clock: Clock;
  random: Random;
  log: Logger;
  emit(p: Progress): void;
}): SceneRunner {
  const { screens, windows, launch, catalog, clock, log } = deps;
  let current: string | null = null;

  type Result = { status: StepStatus; reason: CommandError | null };
  const done = (status: StepStatus, reason: CommandError | null = null): Result => ({ status, reason });

  async function runScreens(step: Extract<Step, { kind: "screens" }>): Promise<Result> {
    const state = screens.current();
    // Primero se prende y después se apaga, para no quedar nunca sin pantalla en el medio.
    const ordered = [...step.monitors].sort((a, b) => Number(b.enabled) - Number(a.enabled));
    let okCount = 0;
    let firstError: CommandError | null = null;
    for (const m of ordered) {
      const mon = state?.monitors.find((x) => x.id === m.monitorId);
      if (!mon) {
        firstError ??= "not_found";
        continue;
      }
      if (mon.enabled === m.enabled) {
        okCount++;
        continue;
      }
      const r = await screens.setEnabled(m.monitorId, m.enabled);
      if (r.ok) okCount++;
      else firstError ??= r.reason;
    }
    if (!firstError) return done("ok");
    return done(okCount > 0 ? "partial" : "failed", firstError);
  }

  async function runAudio(step: Extract<Step, { kind: "audio" }>): Promise<Result> {
    const audio = deps.audio;
    if (!audio) return done("failed", "audio_unavailable");
    if (!(await audio.waitForOutput(step.outputId, OUTPUT_WAIT_MS))) return done("failed", "output_unavailable");
    let changed = false;
    if (step.makeDefault) {
      const r = await audio.setDefault(step.outputId);
      if (!r.ok) return done("failed", r.reason);
      changed = true;
    }
    if (step.volume !== null) {
      const r = await audio.setVolume({ kind: "output", id: step.outputId }, step.volume);
      if (!r.ok) return changed ? done("partial", r.reason) : done("failed", r.reason);
    }
    return done("ok");
  }

  async function runStep(step: Step): Promise<Result> {
    if (step.kind === "screens") return runScreens(step);
    if (step.kind === "bringAll") {
      const r = await windows.bringAll();
      return r.ok ? done("ok") : done("failed", r.reason);
    }
    if (step.kind === "audio") return runAudio(step);
    // El AppID se vuelve a mirar al ejecutar: si la app se desinstaló, no se abre nada.
    if (step.target.kind === "app" && !(await catalog.has(step.target.appId))) return done("failed", "not_allowed");
    const r = await launch.runTarget(step.target, step.place);
    if (r.status === "ok") return done("ok");
    return done(r.status, r.reason);
  }

  return {
    running: () => current,

    async run(sceneId) {
      if (current) return { ok: false, reason: "busy" };
      const scene = deps.library.state().scenes.find((s) => s.id === sceneId);
      if (!scene) return { ok: false, reason: "not_found" };

      current = sceneId;
      const runId = Array.from(deps.random.bytes(6), (b) => b.toString(16).padStart(2, "0")).join("");
      const started = clock.now();
      const steps: StepStatus[] = [];
      try {
        for (let index = 0; index < scene.steps.length; index++) {
          if (clock.now() - started > TOTAL_TIMEOUT_MS) {
            steps.push("skipped");
            deps.emit({ runId, sceneId, index, status: "skipped", reason: null });
            continue;
          }
          deps.emit({ runId, sceneId, index, status: "running", reason: null });
          let result: Result;
          try {
            result = await runStep(scene.steps[index]!);
          } catch (err) {
            log.warn("scene: step crashed", { sceneId, index, error: String(err) });
            result = done("failed", "failed");
          }
          steps.push(result.status);
          deps.emit({ runId, sceneId, index, status: result.status, reason: result.reason });
        }
      } finally {
        current = null;
      }
      return steps.includes("failed") || steps.includes("skipped") ? { ok: false, reason: "failed", steps } : { ok: true, steps };
    },
  };
}
