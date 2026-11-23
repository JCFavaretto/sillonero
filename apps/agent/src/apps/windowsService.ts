import type { CommandError, WindowAction, WindowsState } from "@proyecto-e/protocol";
import type { AppLauncher, Logger, RawDisplay, RawRect, RawWindowFull, Windows } from "../ports";
import { monitorId } from "../screens/model";
import { planMove } from "../screens/moveWindow";
import type { ScreensService } from "../screens/service";
import { WindowIds, buildWindows } from "./windowsModel";

// Servicio de ventanas abiertas (docs/PLAN.md 8.3.4): lee la lista, la arma para el celu y ejecuta acciones sobre ellas.

export type Outcome = { ok: true } | { ok: false; reason: CommandError };

export interface WindowsService {
  /** Lee Windows. Nunca rechaza: si falla, conserva lo último. */
  refresh(): Promise<{ changed: boolean; state: WindowsState | null }>;
  current(): WindowsState | null;
  /** La lista cruda y fresca (para que las escenas reconozcan ventanas nuevas). */
  rawList(): Promise<RawWindowFull[]>;
  move(windowId: string, monitorId: string): Promise<Outcome>;
  act(windowId: string, action: WindowAction): Promise<Outcome>;
  /** Junta en la principal todo lo que está en otra pantalla. */
  bringAll(): Promise<Outcome>;
  subscribe(cb: (state: WindowsState) => void): () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isElevated = (m: string) => /elevated|access (is )?denied|acceso denegado/i.test(m);

const areaOf = (d: RawDisplay): RawRect | null => (d.active ? (d.workArea ?? d.bounds) : null);

export function createWindowsService(deps: {
  windows: Windows;
  screens: ScreensService;
  log: Logger;
  /** Para abrir una ventana privada del navegador de una ventana (D93). Sin lanzador, esa acción no está. */
  launcher?: Pick<AppLauncher, "openBrowserWindow">;
  /** Cada vez que aparece una ventana con ruta de .exe: de ahí sale su ícono. */
  onIcon?(key: string, parsing: string): void;
}): WindowsService {
  const { windows, screens, log } = deps;
  const ids = new WindowIds();
  let raw: RawWindowFull[] = [];
  let state: WindowsState | null = null;
  let lastJson = "";
  const listeners = new Set<(s: WindowsState) => void>();

  function rebuild(list: RawWindowFull[]): boolean {
    raw = list;
    const monitors = screens.current()?.monitors ?? [];
    const built = buildWindows(list, screens.raw(), monitors, ids);
    for (const w of built) {
      const src = list.find((r) => ids.idFor(r.handle) === w.id);
      if (w.iconKey && src?.exePath) deps.onIcon?.(w.iconKey, src.exePath);
    }
    const next: WindowsState = { windows: built };
    const json = JSON.stringify(next);
    const changed = json !== lastJson;
    lastJson = json;
    state = next;
    return changed;
  }

  async function refresh() {
    try {
      const changed = rebuild(await windows.list());
      // Cualquier lectura que vea un cambio avisa (no solo el muestreo): si no, un refresco de otro se "comería" la novedad.
      if (changed && state) for (const cb of listeners) cb(state);
      return { changed, state };
    } catch (err) {
      log.warn("windows: cannot list", { error: message(err) });
      return { changed: false, state };
    }
  }

  async function fresh(): Promise<void> {
    // Después de una acción se vuelve a leer; `refresh` ya avisa si algo cambió.
    await refresh();
  }

  function find(windowId: string): RawWindowFull | undefined {
    const handle = ids.handleFor(windowId);
    return handle ? raw.find((w) => w.handle === handle) : undefined;
  }

  const displayOf = (w: RawWindowFull): RawDisplay | undefined => {
    const info = state?.windows.find((s) => ids.handleFor(s.id) === w.handle);
    return info?.monitorId ? screens.raw().find((d) => monitorId(d.devicePath) === info.monitorId) : undefined;
  };

  async function guarded(run: () => Promise<void>): Promise<Outcome> {
    try {
      await run();
      return { ok: true };
    } catch (err) {
      const m = message(err);
      log.warn("windows: action failed", { error: m });
      if (/focus_denied/i.test(m)) return { ok: false, reason: "focus_denied" };
      if (/not_supported/i.test(m)) return { ok: false, reason: "not_supported" };
      return { ok: false, reason: isElevated(m) ? "elevated" : "failed" };
    }
  }

  return {
    refresh,
    current: () => state,
    async rawList() {
      await refresh();
      return raw;
    },

    async move(windowId, targetId) {
      const w = find(windowId);
      const target = screens.raw().find((d) => monitorId(d.devicePath) === targetId);
      const toArea = target ? areaOf(target) : null;
      if (!w || !toArea || !target) return { ok: false, reason: "not_found" };
      const from = displayOf(w);
      const plan = planMove(w, from ? areaOf(from) : null, toArea, from !== undefined && monitorId(from.devicePath) === targetId);
      if (!plan) return { ok: true };
      const out = await guarded(() => windows.place(w.handle, plan.rect, plan.maximize));
      await fresh();
      return out;
    },

    async act(windowId, action) {
      const w = find(windowId);
      if (!w) return { ok: false, reason: "not_found" };
      const out = await guarded(async () => {
        if (action === "focus") return windows.focus(w.handle);
        if (action === "close") return windows.close(w.handle);
        if (action === "newPrivate" || action === "newWindow") {
          if (!deps.launcher) throw new Error("not_supported");
          return deps.launcher.openBrowserWindow(w.exePath, action === "newPrivate" ? "private" : "window");
        }
        if (action === "fullscreen") {
          const d = displayOf(w) ?? screens.raw().find((r) => r.primary) ?? screens.raw()[0];
          if (!d?.bounds) throw new Error("no hay pantalla donde ponerla");
          return windows.toggleFullscreen(w.handle, d.bounds);
        }
        return windows.show(w.handle, action);
      });
      await fresh();
      return out;
    },

    async bringAll() {
      await refresh();
      const primary = screens.raw().find((d) => d.active && d.primary);
      const toArea = primary ? areaOf(primary) : null;
      if (!primary || !toArea) return { ok: false, reason: "failed" };
      const primaryId = monitorId(primary.devicePath);
      let failed = false;
      for (const info of state?.windows ?? []) {
        if (info.state === "minimized" || info.monitorId === primaryId) continue;
        const w = raw.find((r) => ids.handleFor(info.id) === r.handle);
        if (!w) continue;
        const from = displayOf(w);
        const plan = planMove(w, from ? areaOf(from) : null, toArea, false);
        if (!plan) continue;
        const out = await guarded(() => windows.place(w.handle, plan.rect, plan.maximize));
        if (!out.ok) failed = true;
      }
      await fresh();
      return failed ? { ok: false, reason: "failed" } : { ok: true };
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
