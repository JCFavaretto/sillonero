import * as SecureStore from "expo-secure-store";
import { DEFAULT_SETTINGS, SCROLL_RANGE, SENSITIVITY_RANGE, type PadSettings } from "@/pad/controller";

// Preferencias chicas de la interfaz que se recuerdan entre usos. Van al almacenamiento seguro porque ya está en la app
// (no se suma una dependencia nueva) y son un valor mínimo. Si falla, la app sigue con el valor por defecto.

const AUDIO_CARD_KEY = "ui.audioCardOpen.v1";

/** ¿La tarjeta de Audio del Inicio está desplegada? Por defecto sí; recuerda lo último que eligió Jay. */
export async function loadAudioCardOpen(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(AUDIO_CARD_KEY)) !== "0";
  } catch {
    return true;
  }
}

export async function saveAudioCardOpen(open: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(AUDIO_CARD_KEY, open ? "1" : "0");
  } catch {
    // no se pudo guardar: la elección vale en esta sesión y la próxima vez arranca desplegada
  }
}

const PAD_KEY = "ui.pad.v1";
const clampTo = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const boolOr = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** Los ajustes del Pad (boceto 05). Un valor roto o fuera de rango se recorta o vuelve al de fábrica; si el almacenamiento falla, de fábrica. */
export async function loadPadSettings(): Promise<PadSettings> {
  try {
    const raw = await SecureStore.getItemAsync(PAD_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      sensitivity: clampTo(o.sensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max, DEFAULT_SETTINGS.sensitivity),
      scrollSpeed: clampTo(o.scrollSpeed, SCROLL_RANGE.min, SCROLL_RANGE.max, DEFAULT_SETTINGS.scrollSpeed),
      naturalScroll: boolOr(o.naturalScroll, DEFAULT_SETTINGS.naturalScroll),
      vibrateClick: boolOr(o.vibrateClick, DEFAULT_SETTINGS.vibrateClick),
      keepAwake: boolOr(o.keepAwake, DEFAULT_SETTINGS.keepAwake),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function savePadSettings(s: PadSettings): Promise<void> {
  try {
    await SecureStore.setItemAsync(PAD_KEY, JSON.stringify(s));
  } catch {
    // no se pudo guardar: vale en esta sesión
  }
}

const DECKS_KEY = "ui.decks.v1";
export interface DecksPrefs {
  /** Las imágenes animadas de las teclas se mueven (D105). */
  animate: boolean;
  /** Cuándo se exportó por última vez (ISO), o `null` si nunca. */
  lastExport: string | null;
}

export async function loadDecksPrefs(): Promise<DecksPrefs> {
  try {
    const raw = await SecureStore.getItemAsync(DECKS_KEY);
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return { animate: boolOr(o.animate, true), lastExport: typeof o.lastExport === "string" ? o.lastExport.slice(0, 40) : null };
  } catch {
    return { animate: true, lastExport: null };
  }
}

export async function saveDecksPrefs(p: DecksPrefs): Promise<void> {
  try {
    await SecureStore.setItemAsync(DECKS_KEY, JSON.stringify(p));
  } catch {
    // no se pudo guardar: vale en esta sesión
  }
}
