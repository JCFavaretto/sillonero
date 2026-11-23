import type { AppAudio, AudioState, WindowInfo } from "@proyecto-e/protocol";

/**
 * Una tarjeta de la pantalla Apps (boceto comodidad 05, corregido por Jay el 12/11/2026): **una por ventana**, no por app. Si
 * Chrome tiene 20 ventanas aparecen 20 tarjetas, cada una con el título de su pestaña activa.
 */
export interface WindowCard {
  /** El id de la ventana: es la clave de la tarjeta. */
  key: string;
  /** Nombre del programa (el `.exe` sin extensión). */
  app: string;
  iconKey: string | null;
  /** La ventana sobre la que actúan todos los botones de la tarjeta. */
  main: WindowInfo;
  front: boolean;
  minimized: boolean;
  /** Su app suena ahora según el audio de la PC. */
  sounding: boolean;
  /** El id de su app en el mezclador de audio de la PC, si figura. */
  audioId: string | null;
  /** Su app en el mezclador de la PC (para la barra de volumen de la tarjeta, D96); null si no figura. */
  audio: AppAudio | null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Una tarjeta por ventana, en el orden en que las manda la PC (puro). */
export function windowCards(windows: readonly WindowInfo[], audio: AudioState | null): WindowCard[] {
  return windows.map((w) => {
    const sound = audio?.apps.find((a) => same(a.name, w.app)) ?? null;
    return {
      key: w.id,
      app: w.app,
      iconKey: w.iconKey,
      main: w,
      front: w.focused,
      minimized: w.state === "minimized",
      sounding: sound?.sounding ?? false,
      audioId: sound?.id ?? null,
      audio: sound,
    };
  });
}
