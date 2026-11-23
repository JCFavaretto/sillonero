import type { AudioState, ServerMessage } from "@proyecto-e/protocol";
import { create } from "zustand";
import { saveAudioCardOpen } from "@/storage/prefs";
import { setAudioDemo } from "./demoFlag";

/**
 * Estado de Audio (docs/PLAN.md 8.4.5). Lo escribe el cliente con los mensajes de la PC. Los deslizadores
 * muestran el valor local mientras se arrastran y durante 1,5 s después (D38), para que un `audio.update` no los pise.
 */
const ART_MAX = 10;
export const DRAG_HOLD_MS = 1_500;

export interface AudioData {
  /** `null` hasta que llega el primer estado. */
  audio: AudioState | null;
  /** Cuándo llegó ese estado (reloj del celu, ms): desde ahí avanza sola la barra de reproducción (D97). */
  audioAt: number;
  /** Carátulas como data URI; `null` = no hay (se muestra la inicial); ausente = todavía no se pidió. Las últimas 10. */
  art: Record<string, string | null>;
  showHidden: boolean;
  /** Valor local de los deslizadores que se están moviendo, por `output:<id>` o `app:<id>`. */
  dragging: Record<string, { value: number; until: number }>;
  drag(key: string, value: number, now: number): void;
  /** El valor que se dibuja: el local si se movió hace menos de 1,5 s, si no el de la PC. */
  valueFor(key: string, fromPc: number, now: number): number;
  setShowHidden(v: boolean): void;
  /** Tarjeta Audio del Inicio desplegada (por defecto sí) y si ya se leyó lo guardado. */
  cardOpen: boolean;
  cardLoaded: boolean;
  /** Pliega o despliega la tarjeta y lo recuerda para la próxima vez. */
  setCardOpen(open: boolean): void;
  /** Fija el valor leído del almacenamiento (sin volver a guardarlo). */
  loadCardOpen(open: boolean): void;
}

export const initialAudio = { audio: null, audioAt: 0, art: {}, showHidden: false, dragging: {}, cardOpen: true, cardLoaded: false };

export const useAudio = create<AudioData>()((set, get) => ({
  ...initialAudio,
  drag: (key, value, now) => set({ dragging: { ...get().dragging, [key]: { value, until: now + DRAG_HOLD_MS } } }),
  valueFor: (key, fromPc, now) => {
    const d = get().dragging[key];
    return d && now <= d.until ? d.value : fromPc;
  },
  setShowHidden: (showHidden) => set({ showHidden }),
  setCardOpen: (cardOpen) => {
    set({ cardOpen, cardLoaded: true });
    void saveAudioCardOpen(cardOpen);
  },
  loadCardOpen: (cardOpen) => set({ cardOpen, cardLoaded: true }),
}));

/** Lo que manda la PC; `null` borra todo (olvidó la PC o la revocaron). */
export function applyAudio(msg: ServerMessage | null): void {
  if (msg === null) return useAudio.setState({ audio: null, audioAt: 0, art: {}, showHidden: false, dragging: {} });
  switch (msg.type) {
    case "audio.snapshot":
    case "audio.update":
      setAudioDemo(false);
      return useAudio.setState({ audio: msg.payload, audioAt: Date.now() });
    case "media.artData": {
      const { key, jpeg } = msg.payload;
      const next = { ...useAudio.getState().art };
      delete next[key]; // se vuelve a insertar al final: así la más vieja es la primera
      next[key] = jpeg === null ? null : `data:image/jpeg;base64,${jpeg}`;
      const keys = Object.keys(next);
      for (const k of keys.slice(0, Math.max(0, keys.length - ART_MAX))) delete next[k];
      return useAudio.setState({ art: next });
    }
    default:
      return;
  }
}
