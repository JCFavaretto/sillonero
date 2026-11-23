import { createHash } from "node:crypto";
import type { Foreground, Monitor, MonitorConnector } from "@proyecto-e/protocol";
import type { RawDisplay, RawRect, RawWindow } from "../ports";

// Modelo puro de las pantallas (docs/PLAN.md 8.2.4): convierte lo que dice Windows en lo que ve el celu.
// No toca Windows ni el reloj, así se prueba entero con datos armados a mano.

const MAX_MONITORS = 16;
/** Clases de ventana que no son "una ventana del usuario": escritorio y barra de tareas. */
const SHELL_CLASSES: ReadonlySet<string> = new Set(["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"]);

/** "m_" + 16 caracteres base64url del SHA-256 de la ruta del dispositivo. Estable entre arranques. */
export function monitorId(devicePath: string): string {
  return "m_" + createHash("sha256").update(devicePath).digest("base64url").slice(0, 16);
}

/** DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY → conector (valores de learn.microsoft.com, 07/11/2026). */
export function connectorFor(outputTechnology: number): MonitorConnector {
  switch (outputTechnology >>> 0) {
    case 0:
      return "vga"; // HD15
    case 4:
      return "dvi";
    case 5:
      return "hdmi";
    case 10:
      return "displayport"; // externo
    case 6: // LVDS
    case 11: // DisplayPort embebido
    case 13: // UDI embebido
    case 0x80000000: // INTERNAL (visto como sin signo)
      return "internal";
    default:
      return "other";
  }
}

export interface BuildOptions {
  /** Dónde estaba cada pantalla la última vez que estuvo prendida (para las apagadas). */
  lastBounds?: ReadonlyMap<string, RawRect>;
  /** Apodos puestos por el usuario, por id. */
  nicknames?: ReadonlyMap<string, string>;
  /** Pantallas con un cambio en curso. */
  busy?: ReadonlySet<string>;
}

export function buildMonitors(raw: RawDisplay[], opts: BuildOptions = {}): Monitor[] {
  // Windows puede repetir una misma pantalla (varios caminos al mismo monitor): queda una, la prendida.
  const byId = new Map<string, RawDisplay>();
  for (const r of raw) {
    const id = monitorId(r.devicePath);
    const prev = byId.get(id);
    if (!prev || (!prev.active && r.active)) byId.set(id, r);
  }

  const entries = [...byId].map(([id, r]) => ({ id, r }));
  const on = entries
    .filter((e) => e.r.active && e.r.bounds)
    .sort((a, b) => a.r.bounds!.x - b.r.bounds!.x || a.r.bounds!.y - b.r.bounds!.y);
  const indexOf = new Map(on.map((e, i) => [e.id, i + 1]));

  const monitors = entries.map(({ id, r }): Monitor => {
    const enabled = indexOf.has(id);
    const primary = enabled && r.primary;
    const blockedBy = !enabled ? null : primary ? "primary" : on.length === 1 ? "last_active" : null;
    const bounds = enabled ? r.bounds : null;
    return {
      id,
      index: indexOf.get(id) ?? null,
      nickname: opts.nicknames?.get(id) ?? null,
      name: r.friendlyName.trim().slice(0, 64) || "Pantalla",
      connector: connectorFor(r.outputTechnology),
      enabled,
      primary,
      bounds,
      lastBounds: bounds ?? opts.lastBounds?.get(id) ?? null,
      resolution: bounds ? { w: bounds.w, h: bounds.h } : null,
      canDisable: enabled && blockedBy === null,
      blockedBy,
      busy: opts.busy?.has(id) ?? false,
    };
  });

  // Prendidas primero (por número), después las apagadas por nombre.
  monitors.sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return monitors.slice(0, MAX_MONITORS);
}

/** La ventana activa, con la pantalla donde cae su centro. `null` si no hay ventana de usuario. */
export function buildForeground(win: RawWindow | null, monitors: Monitor[], raw: RawDisplay[]): Foreground | null {
  if (!win || SHELL_CLASSES.has(win.className)) return null;

  const cx = win.rect.x + win.rect.w / 2;
  const cy = win.rect.y + win.rect.h / 2;
  const known = new Set(monitors.filter((m) => m.enabled).map((m) => m.id));
  const hit =
    win.state === "minimized"
      ? undefined // minimizada: Windows la manda a coordenadas lejanas, no está "en" una pantalla
      : raw.find((r) => {
          const b = r.active ? r.bounds : null;
          return b !== null && known.has(monitorId(r.devicePath)) && cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h;
        });

  return {
    title: (win.title.trim() || win.exe).slice(0, 120),
    app: win.exe.slice(0, 64),
    monitorId: hit ? monitorId(hit.devicePath) : null,
  };
}
