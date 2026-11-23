import type { PadState, ServerMessage } from "@proyecto-e/protocol";
import { create } from "zustand";
import { savePadSettings } from "@/storage/prefs";
import { DEFAULT_SETTINGS, type PadSettings } from "./controller";
import { createLatency } from "./latency";
import { noMods, type ModState } from "./mods";

/**
 * Estado del Pad (docs/PLAN.md 8.5). Lo escribe el cliente con `pad.state` de la PC. Lo enganchado (modificadores,
 * candado, Alt+Tab) vive solo en el celu y se corta al perder la conexión.
 */
export interface PadData {
  /** `null` hasta que llega el primer estado. */
  state: PadState | null;
  rtt: number | null;
  slow: boolean;
  mods: ModState;
  /** El botón izquierdo quedó apretado con el candado de la barra de clic. */
  lock: boolean;
  /** Se está eligiendo ventana con Alt+Tab (Alt apretado en la PC). */
  altTab: boolean;
  settings: PadSettings;
  settingsLoaded: boolean;
  setMods(m: ModState): void;
  setLock(on: boolean): void;
  setAltTab(on: boolean): void;
  addLatency(ms: number): void;
  resetLatency(): void;
  /** Se cortó la conexión o se salió del Pad: nada queda enganchado. */
  clearTransient(): void;
  setSettings(patch: Partial<PadSettings>): void;
  loadSettings(s: PadSettings): void;
}

const latency = createLatency();

export const initialPad = { state: null, rtt: null, slow: false, mods: noMods(), lock: false, altTab: false, settings: DEFAULT_SETTINGS, settingsLoaded: false };

export const usePad = create<PadData>()((set, get) => ({
  ...initialPad,
  setMods: (mods) => set({ mods }),
  setLock: (lock) => set({ lock }),
  setAltTab: (altTab) => set({ altTab }),
  addLatency: (ms) => {
    latency.add(ms);
    set({ rtt: latency.median(), slow: latency.slow() });
  },
  resetLatency: () => {
    latency.reset();
    set({ rtt: null, slow: false });
  },
  clearTransient: () => set({ mods: noMods(), lock: false, altTab: false }),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings, settingsLoaded: true });
    void savePadSettings(settings);
  },
  loadSettings: (settings) => set({ settings, settingsLoaded: true }),
}));

/** Lo que manda la PC; `null` borra todo (olvidó la PC o la revocaron). */
export function applyPad(msg: ServerMessage | null): void {
  if (msg === null) {
    latency.reset();
    return usePad.setState({ state: null, rtt: null, slow: false, mods: noMods(), lock: false, altTab: false });
  }
  if (msg.type === "pad.state") usePad.setState({ state: msg.payload });
}
