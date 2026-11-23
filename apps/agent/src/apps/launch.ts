import type { CommandError, Target, Zone } from "@proyecto-e/protocol";
import type { AppLauncher, Clock, Logger, RawWindowFull, Windows } from "../ports";
import { monitorId } from "../screens/model";
import type { ScreensService } from "../screens/service";
import { zoneRect } from "../scenes/zones";
import type { WindowsService } from "./windowsService";

// Abrir una app o un link y, si se pidió, ubicar su ventana (docs/PLAN.md D20, D23).

export type LaunchOutcome =
  | { status: "ok" }
  /** Se abrió, pero no se pudo ubicar (la ventana no apareció, o la pantalla pedida está apagada). */
  | { status: "partial"; reason: CommandError }
  | { status: "failed"; reason: CommandError };

export interface Place {
  monitorId: string;
  zone: Zone;
}

export interface LaunchService {
  runTarget(target: Target, place: Place | null): Promise<LaunchOutcome>;
}

const WAIT_MS = 8_000;
const POLL_MS = 400;
const BROWSERS = new Set(["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc", "chromium"]);

const exeName = (p: string) => p.slice(p.lastIndexOf("\\") + 1).toLowerCase();
const isExePath = (id: string) => /^[A-Za-z]:\\.+\.exe$/i.test(id);

export function createLaunchService(deps: {
  windows: WindowsService;
  /** El puerto de Windows para ubicar la ventana por su handle. */
  port: Windows;
  launcher: AppLauncher;
  screens: ScreensService;
  clock: Clock;
  log: Logger;
  waitMs?: number;
}): LaunchService {
  const { windows, port, launcher, screens, clock, log } = deps;
  const waitMs = deps.waitMs ?? WAIT_MS;
  const sleep = (ms: number) => new Promise<void>((r) => void clock.setTimeout(r, ms));

  /** Pone la ventana donde dice la zona. `false` si no se pudo (pantalla apagada, Windows no la dejó…). */
  async function placeWindow(w: RawWindowFull, place: Place): Promise<boolean> {
    if (place.zone === "keep") return true;
    const display = screens.raw().find((d) => d.active && monitorId(d.devicePath) === place.monitorId);
    if (!display?.bounds) return false;
    const plan = zoneRect(place.zone, display.workArea ?? display.bounds, display.bounds);
    if (!plan) return true;
    try {
      if (plan.fullscreen) {
        // Si ya estaba en pantalla completa, un segundo toggle la sacaría: solo se pide si no lo está.
        if (!w.fullscreen) await port.toggleFullscreen(w.handle, plan.rect);
      } else {
        // Una ventana que estaba en pantalla completa sin bordes vuelve a la normal antes de ubicarla (si no, queda sin bordes y marcada).
        if (w.fullscreen) await port.toggleFullscreen(w.handle, plan.rect);
        await port.place(w.handle, plan.rect, plan.maximize);
      }
      return true;
    } catch (err) {
      log.warn("launch: cannot place the window", { error: String(err) });
      return false;
    }
  }

  async function finish(w: RawWindowFull | null, place: Place | null): Promise<LaunchOutcome> {
    if (!place || place.zone === "keep") return { status: "ok" };
    if (!w) return { status: "partial", reason: "not_placed" };
    const ok = await placeWindow(w, place);
    await windows.refresh();
    return ok ? { status: "ok" } : { status: "partial", reason: "not_placed" };
  }

  const matchesApp = (target: Target & { kind: "app" }) => (w: RawWindowFull) => {
    if (isExePath(target.appId)) return w.exePath.toLowerCase() === target.appId.toLowerCase();
    return true; // AUMID: no se sabe qué .exe es (las de la tienda corren en ApplicationFrameHost), sirve cualquier ventana nueva
  };

  async function waitForNew(before: Set<string>, accept: (w: RawWindowFull) => boolean): Promise<RawWindowFull | null> {
    for (let waited = 0; waited <= waitMs; waited += POLL_MS) {
      const list = await windows.rawList();
      const found = list.find((w) => !before.has(w.handle) && accept(w));
      if (found) return found;
      await sleep(POLL_MS);
    }
    return null;
  }

  return {
    async runTarget(target, place) {
      const before = await windows.rawList();

      if (target.kind === "app" && isExePath(target.appId)) {
        // "Abrir o enfocar": si ya hay una ventana de ese .exe, se la trae en vez de abrir otra.
        const open = before.find((w) => w.exePath.toLowerCase() === target.appId.toLowerCase());
        if (open) {
          try {
            await port.focus(open.handle);
          } catch (err) {
            log.warn("launch: cannot focus", { error: String(err) });
            return { status: "failed", reason: /focus_denied/i.test(String(err)) ? "focus_denied" : "failed" };
          }
          return finish(open, place);
        }
      }

      try {
        if (target.kind === "app") await launcher.openApp(target.appId);
        else await launcher.openUrl(target.url, { mode: target.open ?? "tab" });
      } catch (err) {
        log.warn("launch: cannot open", { kind: target.kind, error: String(err) });
        return { status: "failed", reason: "launch_failed" };
      }

      if (!place || place.zone === "keep") return { status: "ok" };

      const known = new Set(before.map((w) => w.handle));
      if (target.kind === "app") return finish(await waitForNew(known, matchesApp(target)), place);

      // Link: ventana nueva del navegador o, si abrió como pestaña de una que ya estaba, la ventana activa si es un navegador.
      const fresh = await waitForNew(known, (w) => BROWSERS.has(exeName(w.exePath).replace(/\.exe$/, "")));
      if (fresh) return finish(fresh, place);
      const fg = (await windows.rawList()).find((w) => w.focused && BROWSERS.has(exeName(w.exePath).replace(/\.exe$/, "")));
      return finish(fg ?? null, place);
    },
  };
}
