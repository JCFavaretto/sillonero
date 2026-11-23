import type { Hotkeys, Logger } from "../ports";
import type { SceneHotkey } from "@proyecto-e/protocol";
import { HOTKEYS, activeHotkeys, hotkeyById, sceneHotkeys, type HotkeyAction, type HotkeyDef } from "./model";

// Servicio de atajos (docs/PLAN.md 8.6, D67 y D68): une la tabla de atajos con el hijo que los registra. El hijo solo avisa
// "se apretó el id N"; lo que hace cada uno lo corre `run` con los servicios del agente.

/** active = registrado; busy = otro programa ya tiene la combinación; failed = no se pudo registrar; off = llave global apagada. */
export type HotkeyStatus = "active" | "busy" | "failed" | "off";

export interface HotkeyState {
  /** El hijo está vivo (o todavía no se necesitó). */
  available: boolean;
  /** La llave global "Atajos de teclado" del panel. Cortar el Pad sigue activo aunque esté apagada. */
  enabled: boolean;
  keys: { id: number; label: string; status: HotkeyStatus; scene?: { id: string; name: string } }[];
}

export interface HotkeyService {
  state(): HotkeyState;
  /** Registra los atajos. Nunca rechaza: lo que falle queda marcado en el estado. */
  start(): Promise<void>;
  /** Las escenas con tecla (B6.3): se registran junto con las fijas. Se puede llamar antes o después de `start`. */
  setScenes(scenes: readonly { id: string; name: string; hotkey?: SceneHotkey }[]): Promise<void>;
  /** Guarda la llave global y registra o suelta en consecuencia. Rechaza si no se pudo guardar. */
  setEnabled(on: boolean): Promise<void>;
  subscribe(cb: (state: HotkeyState) => void): () => void;
  /** Suelta todos los atajos y deja de atender avisos. */
  stop(): Promise<void>;
}

export interface HotkeyDeps {
  hotkeys: Hotkeys;
  log: Logger;
  /** Corre la acción de un atajo (`commands.ts`). */
  run(action: HotkeyAction): Promise<unknown>;
  config: { enabled(): boolean; setEnabled(on: boolean): Promise<void> };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createHotkeyService(deps: HotkeyDeps): HotkeyService {
  const { hotkeys, log, config } = deps;
  const status = new Map<number, HotkeyStatus>();
  const listeners = new Set<(s: HotkeyState) => void>();
  const running = new Set<number>();
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  let sceneDefs: HotkeyDef[] = [];
  let started = false;

  const allDefs = () => [...HOTKEYS, ...sceneDefs];

  function state(): HotkeyState {
    return {
      available: !stopped && hotkeys.available(),
      enabled: config.enabled(),
      keys: allDefs().map((h) => ({
        id: h.id,
        label: h.label,
        status: status.get(h.id) ?? "off",
        ...(h.sceneName !== undefined && h.action.kind === "scene" ? { scene: { id: h.action.sceneId, name: h.sceneName } } : {}),
      })),
    };
  }

  function emit(): void {
    const s = state();
    for (const cb of listeners) cb(s);
  }

  /** Deja registrado exactamente lo que corresponde a la llave global. De a una vez: dos cambios seguidos no se pisan. */
  function apply(): Promise<void> {
    const run = queue.then(async () => {
      if (stopped) return;
      const on = config.enabled();
      const wanted = [...activeHotkeys(on), ...(on ? sceneDefs : [])];
      const wantedIds = new Set(wanted.map((h) => h.id));
      status.clear();
      for (const h of allDefs()) if (!wantedIds.has(h.id)) status.set(h.id, "off");
      try {
        const results = await hotkeys.set(wanted.map((h) => ({ id: h.id, vk: h.vk })));
        for (const h of wanted) {
          const r = results.find((x) => x.id === h.id);
          if (r?.ok) status.set(h.id, "active");
          else if (r && r.busy) {
            status.set(h.id, "busy");
            log.warn("hotkey busy: another program already has it", { key: `Ctrl+Alt+${h.label}` });
          } else {
            status.set(h.id, "failed");
            log.warn("hotkey could not be registered", { key: `Ctrl+Alt+${h.label}`, error: r && !r.ok ? r.error : "sin respuesta" });
          }
        }
      } catch (err) {
        for (const h of wanted) status.set(h.id, "failed");
        log.warn("hotkeys: could not register", { error: message(err) });
      }
      emit();
    });
    queue = run.catch(() => undefined);
    return run;
  }

  // Si el hijo se cayó y se relanzó, los atajos pudieron quedar bien, ocupados por otro programa o sin registrar: se vuelve a leer.
  hotkeys.onRestored(() => {
    if (!stopped && started) void apply();
  });

  hotkeys.onPressed((id) => {
    if (stopped) return;
    const def = hotkeyById(id) ?? sceneDefs.find((d) => d.id === id);
    if (!def) return;
    // Un aviso que ya venía en camino cuando se apagó la llave global no debe hacer nada.
    if (!def.always && !config.enabled()) return;
    if (running.has(id)) return;
    running.add(id);
    deps
      .run(def.action)
      .catch((err: unknown) => log.warn("hotkey action failed", { key: `Ctrl+Alt+${def.label}`, error: message(err) }))
      .finally(() => running.delete(id));
  });

  return {
    state,
    start() {
      started = true;
      return apply();
    },
    async setScenes(scenes) {
      sceneDefs = sceneHotkeys(scenes);
      if (started && !stopped) await apply();
    },
    async setEnabled(on) {
      await config.setEnabled(on);
      await apply();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      listeners.clear();
      hotkeys.stop();
    },
  };
}
