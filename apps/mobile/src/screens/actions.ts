import type { Monitor } from "@proyecto-e/protocol";
import { sendScreenCommand } from "./commands";
import { useScreens } from "./store";

/**
 * Lo que el usuario puede pedir desde la pestaña Pantallas.
 * R1: solo en demo se aplica, de forma local. Fuera de la demo no hace nada, porque los
 * comandos reales (cifrados) llegan en R4 (apodos), R5 (prender/apagar) y R6 (mover).
 */

/** Recalcula número, bounds y frenos como lo hará el agente (docs/PLAN.md 8.2.4, `model.ts`). */
export function normalize(monitors: Monitor[]): Monitor[] {
  const on = monitors.filter((m) => m.enabled);
  const order = [...on].sort((a, b) => (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0) || (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0));
  return monitors.map((m) => {
    const index = m.enabled ? order.indexOf(m) + 1 : null;
    const blockedBy = !m.enabled ? null : m.primary ? "primary" : on.length === 1 ? "last_active" : null;
    return { ...m, index, blockedBy, canDisable: m.enabled && blockedBy === null };
  });
}

function patch(id: string, fn: (m: Monitor) => Monitor): void {
  const { monitors } = useScreens.getState();
  useScreens.setState({ monitors: normalize(monitors.map((m) => (m.id === id ? fn(m) : m))), error: null });
}

/** Lo que vuelve de una acción: listo, o la clave de i18n del error para mostrar. */
export type ActionResult = { ok: true } | { ok: false; error: string };

export const screensActions = {
  /**
   * Con la PC de verdad se le pide el cambio y la PC contesta con el estado nuevo (primero "cambiando…" y
   * después el final): el interruptor no se mueve por su cuenta. Si no se pudo, queda el motivo para mostrar.
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (useScreens.getState().demo) {
      patch(id, (m) =>
        enabled
          ? { ...m, enabled: true, bounds: m.lastBounds }
          : { ...m, enabled: false, lastBounds: m.bounds ?? m.lastBounds, bounds: null },
      );
      return;
    }
    const r = await sendScreenCommand("monitor.setEnabled", { monitorId: id, enabled });
    useScreens.setState({ error: r.ok ? null : `screens.error.${r.reason}` });
  },

  /**
   * Con la PC de verdad el apodo lo guarda la PC y el cambio vuelve en un `screens.update`: acá no se toca el estado.
   * En la demo se aplica local.
   */
  async rename(id: string, nickname: string | null): Promise<ActionResult> {
    if (useScreens.getState().demo) {
      patch(id, (m) => ({ ...m, nickname }));
      return { ok: true };
    }
    const r = await sendScreenCommand("monitor.rename", { monitorId: id, nickname });
    return r.ok ? { ok: true } : { ok: false, error: `screens.error.${r.reason}` };
  },

  /**
   * Pone las pantallas prendidas en este orden, de izquierda a derecha. Con la PC de verdad el cambio vuelve en un
   * `screens.update`; en la demo se reubican acá.
   */
  async setOrder(order: string[]): Promise<ActionResult> {
    const { demo, monitors } = useScreens.getState();
    if (demo) {
      let x = 0;
      const place = new Map<string, number>();
      for (const id of order) {
        const m = monitors.find((k) => k.id === id);
        if (!m?.bounds) return { ok: false, error: "screens.error.not_found" };
        place.set(id, x);
        x += m.bounds.w;
      }
      const primaryX = place.get(monitors.find((m) => m.primary && m.enabled)?.id ?? "") ?? 0;
      useScreens.setState({
        monitors: normalize(
          monitors.map((m) => {
            const nx = place.get(m.id);
            return nx === undefined || !m.bounds ? m : { ...m, bounds: { ...m.bounds, x: nx - primaryX }, lastBounds: { ...m.bounds, x: nx - primaryX } };
          }),
        ),
        error: null,
      });
      return { ok: true };
    }
    const r = await sendScreenCommand("monitor.setOrder", { order });
    return r.ok ? { ok: true } : { ok: false, error: `screens.error.${r.reason}` };
  },

  /** La PC muestra un número en cada pantalla durante unos segundos. En la demo no hay PC: no hace nada. */
  async identify(): Promise<void> {
    if (useScreens.getState().demo) return;
    const r = await sendScreenCommand("monitor.identify", {});
    useScreens.setState({ error: r.ok ? null : `screens.error.${r.reason}` });
  },

  /**
   * Con la PC de verdad se le pide mandar SU ventana activa (la que tiene el foco ahora) a esa pantalla; el estado
   * nuevo vuelve en un `screens.update`. En la demo se mueve la ventana de mentira.
   */
  async moveActive(monitorId: string): Promise<void> {
    const { demo, foreground } = useScreens.getState();
    if (demo) {
      if (foreground) useScreens.setState({ foreground: { ...foreground, monitorId }, error: null });
      return;
    }
    const r = await sendScreenCommand("window.moveActive", { monitorId });
    useScreens.setState({ error: r.ok ? null : `screens.error.${r.reason}` });
  },
};

/**
 * Qué comandos están conectados de verdad. En la demo (datos de mentira) todo se aplica localmente;
 * con datos reales cada flag pasa a `true` cuando llega su rebanada: apodos (R4, hecho), prender/apagar (R5, hecho), mover (R6, hecho).
 */
export const LIVE_COMMANDS = { rename: true, toggle: true, move: true, order: true } as const;

export function screensCapabilities(demo: boolean): { rename: boolean; toggle: boolean; move: boolean; order: boolean } {
  return demo ? { rename: true, toggle: true, move: true, order: true } : { ...LIVE_COMMANDS };
}
