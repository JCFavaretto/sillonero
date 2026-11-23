import { createHash } from "node:crypto";
import type { Monitor, WindowInfo } from "@proyecto-e/protocol";
import type { RawDisplay, RawWindowFull } from "../ports";
import { monitorId } from "../screens/model";

// Modelo puro de las ventanas abiertas (docs/PLAN.md 8.3.4): lo que dice Windows → lo que ve el celu.

const MAX_WINDOWS = 40;
const SHELL_CLASSES: ReadonlySet<string> = new Set(["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"]);

/** "i_" + 16 caracteres base64url del SHA-256 del AppID o de la ruta del .exe (sin distinguir mayúsculas). */
export function iconKeyFor(source: string): string {
  return "i_" + createHash("sha256").update(source.toLowerCase()).digest("base64url").slice(0, 16);
}

/**
 * Ids opacos para el celu (`w_<n>`): el HWND nunca sale del agente y el celu solo puede tocar ventanas que se le listaron.
 * El contador solo sube: un id viejo nunca apunta a otra ventana.
 */
export class WindowIds {
  private readonly byHandle = new Map<string, string>();
  private readonly byId = new Map<string, string>();
  private n = 0;

  idFor(handle: string): string {
    let id = this.byHandle.get(handle);
    if (!id) {
      id = `w_${++this.n}`;
      this.byHandle.set(handle, id);
      this.byId.set(id, handle);
    }
    return id;
  }

  handleFor(id: string): string | undefined {
    return this.byId.get(id);
  }

  /** Olvida las ventanas que ya no existen. */
  prune(live: ReadonlySet<string>): void {
    for (const [handle, id] of this.byHandle) {
      if (!live.has(handle)) {
        this.byHandle.delete(handle);
        this.byId.delete(id);
      }
    }
  }
}

/** Las ventanas de usuario de arriba hacia abajo (orden Z), con la pantalla donde cae el centro de cada una. */
export function buildWindows(raw: RawWindowFull[], displays: RawDisplay[], monitors: Monitor[], ids: WindowIds): WindowInfo[] {
  const enabled = new Set(monitors.filter((m) => m.enabled).map((m) => m.id));
  const user = raw.filter((w) => !SHELL_CLASSES.has(w.className) && w.title.trim() !== "");
  ids.prune(new Set(raw.map((w) => w.handle)));

  // Si hay más de 40, la que tiene el foco siempre entra.
  let picked = user.slice(0, MAX_WINDOWS);
  const focused = user.find((w) => w.focused);
  if (focused && !picked.includes(focused)) picked = [...picked.slice(0, MAX_WINDOWS - 1), focused];

  return picked.map((w) => {
    const cx = w.rect.x + w.rect.w / 2;
    const cy = w.rect.y + w.rect.h / 2;
    const hit =
      w.state === "minimized"
        ? undefined // minimizada: Windows la manda a coordenadas lejanas, no está "en" una pantalla
        : displays.find((d) => {
            const b = d.active ? d.bounds : null;
            return b !== null && enabled.has(monitorId(d.devicePath)) && cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h;
          });
    return {
      id: ids.idFor(w.handle),
      title: w.title.trim().slice(0, 120),
      app: w.exe.replace(/\.exe$/i, "").slice(0, 64),
      iconKey: w.exePath ? iconKeyFor(w.exePath) : null,
      monitorId: hit ? monitorId(hit.devicePath) : null,
      state: w.fullscreen ? "fullscreen" : w.state,
      focused: w.focused,
    };
  });
}
