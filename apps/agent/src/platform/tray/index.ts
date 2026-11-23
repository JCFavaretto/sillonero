import { createTray, type MenuItemTemplate, type Tray as TrayHook } from "tray-hook";
import type { Logger, Tray, TrayMenuItem } from "../../ports";

/** Lo que usamos de `tray-hook` (lo que probó el spike del paso 0a); permite inyectar uno falso en los tests. */
export type TrayHookLike = Pick<
  TrayHook,
  "start" | "setIcon" | "setTooltip" | "setMenu" | "quit" | "destroy" | "on" | "off" | "once"
>;

export interface TrayHookOptions {
  /** PNG o ICO del ícono de la bandeja. */
  iconPath: string;
  log?: Logger;
  factory?: () => TrayHookLike;
}

const KNOWN_IDS: ReadonlySet<string> = new Set<TrayMenuItem["id"]>(["open", "remoteToggle", "autostartToggle", "cutInput", "quit"]);
const EXIT_WAIT_MS = 1_000;

function toTemplate(items: TrayMenuItem[]): MenuItemTemplate[] {
  const out: MenuItemTemplate[] = [];
  for (const item of items) {
    if (item.id === "quit") out.push({ type: "separator", id: "sep" }); // Salir va aparte
    out.push(
      item.checked === undefined
        ? { type: "item", id: item.id, title: item.label }
        : { type: "check", id: item.id, title: item.label, checked: item.checked },
    );
  }
  return out;
}

/**
 * Bandeja de Windows con `tray-hook` (binario Rust como proceso hijo, JSON por stdin/stdout).
 * Menú fino: Abrir panel · Remoto (con tilde) · Salir. Los items marcables emiten `check`, no `click`;
 * los dos llegan a `onClick`.
 */
export function createTrayHook(opts: TrayHookOptions): Tray {
  const make = opts.factory ?? (() => createTray({ autoRestart: true }) as TrayHookLike);
  let hook: TrayHookLike | null = null;
  let items: TrayMenuItem[] = [];
  let click: ((id: TrayMenuItem["id"]) => void) | null = null;

  const emitClick = (id: string) => {
    if (KNOWN_IDS.has(id)) click?.(id as TrayMenuItem["id"]);
  };

  return {
    async start({ tooltip, items: initial }) {
      items = initial;
      const h = make();
      // Sin listener de "error", tray-hook tira el proceso entero.
      h.on("error", (err) => opts.log?.warn("tray error", { error: String(err) }));
      h.on("click", emitClick);
      h.on("check", (id) => emitClick(id));
      try {
        await h.start();
        await h.setIcon(opts.iconPath);
        await h.setTooltip(tooltip);
        await h.setMenu(toTemplate(items));
      } catch (err) {
        h.destroy();
        throw err;
      }
      hook = h;
    },

    setItems(next) {
      items = next;
      hook?.setMenu(toTemplate(next)).catch((err: unknown) => opts.log?.warn("tray setMenu failed", { error: String(err) }));
    },

    onClick(cb) {
      click = cb;
    },

    async stop() {
      const h = hook;
      if (!h) return;
      hook = null;
      const exited = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, EXIT_WAIT_MS);
        h.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await h.quit().catch(() => undefined);
      await exited; // el daemon saca el ícono de la bandeja antes de salir
      h.destroy();
    },
  };
}
