import type { Foreground, Monitor } from "@proyecto-e/protocol";
import { create } from "zustand";

/**
 * Estado de la pestaña Pantallas. Solo escriben `actions.ts`, `demo.ts` y (desde R2) el cliente;
 * las pantallas leen con selectores. Los datos van separados de las acciones para poder
 * reiniciarlos en los tests con `setState(initialScreens, true)`.
 */
export interface ScreensData {
  monitors: Monitor[];
  foreground: Foreground | null;
  /** Clave de i18n del último error de un comando, o null. */
  error: string | null;
  /** R1: datos de mentira; los comandos se aplican localmente. Desde R4 los reemplazan los de la PC. */
  demo: boolean;
}

export const initialScreens: ScreensData = { monitors: [], foreground: null, error: null, demo: false };

export const useScreens = create<ScreensData>()(() => initialScreens);

/** Lo que manda la PC (`screens.snapshot` / `screens.update`); `null` borra todo (olvidó la PC o la revocaron). */
export function applyScreensState(state: Pick<ScreensData, "monitors" | "foreground"> | null): void {
  if (state === null) {
    useScreens.setState({ ...initialScreens }, true);
    return;
  }
  useScreens.setState({ monitors: state.monitors, foreground: state.foreground, error: null, demo: false });
}
