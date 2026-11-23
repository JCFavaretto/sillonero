import type { CommandError, MediaKey } from "@proyecto-e/protocol";
import type { HotkeyAction } from "./hotkeys/model";
import type { Logger, Windows } from "./ports";
import { buildForeground, monitorId } from "./screens/model";
import type { ScreensService } from "./screens/service";

// Capa de comandos compartida (docs/PLAN.md 8.6, D68): lo que hacen los atajos del teclado de la PC (y, desde B6.3, los
// disparadores de escena) con los servicios que ya existen. El celu sigue hablando por `session.ts` y `Extras`; esto no
// reemplaza a nadie, solo suma los puntos nuevos de entrada.

export type CommandOutcome = { ok: true } | { ok: false; reason: CommandError };

export interface Commands {
  run(action: HotkeyAction): Promise<CommandOutcome>;
}

export interface CommandsDeps {
  screens: ScreensService;
  windows: Windows;
  /** La llave global del Pad. Sin Pad en esta PC, "cortar el Pad" responde `unsupported`. */
  pad?: { setEnabled(on: boolean): Promise<void> };
  /** ⏮ ⏯ ⏭ sobre la app de Media elegida (o la tecla del teclado si no hay ninguna). */
  media(key: MediaKey): Promise<unknown>;
  openPanel(): Promise<void>;
  /** Corre una escena guardada (`busy` si ya hay otra corriendo). Sin escenas en esta PC, la acción responde `unsupported`. */
  runScene?(sceneId: string): Promise<CommandOutcome>;
  /** La pantalla que Jay eligió como "la tele" en el panel de la PC. */
  tvMonitorId(): string | null;
  log: Logger;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isElevated = (m: string) => /elevated|access (is )?denied|acceso denegado/i.test(m);
const OK: CommandOutcome = { ok: true };

export function createCommands(deps: CommandsDeps): Commands {
  const { screens, windows, log } = deps;

  async function tv(): Promise<CommandOutcome> {
    const id = deps.tvMonitorId();
    if (!id) return { ok: false, reason: "not_found" };
    await screens.refresh();
    const monitor = screens.current()?.monitors.find((m) => m.id === id);
    if (!monitor) return { ok: false, reason: "not_found" };
    return screens.setEnabled(id, !monitor.enabled);
  }

  async function moveActive(index: number): Promise<CommandOutcome> {
    await screens.refresh();
    // "Pantalla 1, 2, 3" = las prendidas de izquierda a derecha (igual que el .ahk): ese es el `index` del modelo.
    const target = screens.current()?.monitors.find((m) => m.enabled && m.index === index);
    if (!target) return { ok: false, reason: "not_found" };
    return screens.moveActive(target.id);
  }

  async function fullscreen(): Promise<CommandOutcome> {
    let win;
    try {
      win = await windows.foreground();
    } catch (err) {
      log.warn("commands: cannot read the active window", { error: message(err) });
      return { ok: false, reason: "failed" };
    }
    await screens.refresh();
    const monitors = screens.current()?.monitors ?? [];
    const raw = screens.raw();
    const info = buildForeground(win, monitors, raw);
    if (!win || !info) return { ok: false, reason: "no_window" };
    const display =
      raw.find((r) => r.active && info.monitorId !== null && monitorId(r.devicePath) === info.monitorId) ?? raw.find((r) => r.active && r.primary);
    if (!display?.bounds) return { ok: false, reason: "failed" };
    try {
      await windows.toggleFullscreen(win.handle, display.bounds);
      return OK;
    } catch (err) {
      const m = message(err);
      log.warn("commands: fullscreen failed", { error: m });
      return { ok: false, reason: isElevated(m) ? "elevated" : "failed" };
    }
  }

  return {
    async run(action) {
      try {
        switch (action.kind) {
          case "tv":
            return await tv();
          case "moveActive":
            return await moveActive(action.index);
          case "fullscreen":
            return await fullscreen();
          case "media":
            await deps.media(action.key);
            return OK;
          case "panel":
            await deps.openPanel();
            return OK;
          case "scene":
            return deps.runScene ? await deps.runScene(action.sceneId) : { ok: false, reason: "unsupported" };
          case "cutPad":
            if (!deps.pad) return { ok: false, reason: "unsupported" };
            await deps.pad.setEnabled(false);
            return OK;
        }
      } catch (err) {
        log.warn("commands: failed", { action: action.kind, error: message(err) });
        return { ok: false, reason: "failed" };
      }
    },
  };
}
