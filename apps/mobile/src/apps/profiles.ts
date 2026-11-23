import type { Shortcut } from "@proyecto-e/protocol";

// Perfiles de app, nivel básico (docs/PLAN.md D87): qué botones propios tiene una app o un sitio SIN instalar nada.
// Son atajos de teclado, así que antes de mandarlos hay que traer la ventana al frente. Sumar una app = sumar un perfil.

const BROWSERS = new Set(["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "chromium"]);

/** ¿Ese programa (nombre del .exe sin extensión) es un navegador conocido? */
export const isBrowser = (app: string): boolean => BROWSERS.has(app.trim().toLowerCase());

export type Site = "youtube" | "youtubeMusic";

/** El sitio de la pestaña a la vista, sacado del título de la ventana ("Video - YouTube - Google Chrome"). */
export function siteOf(title: string): Site | null {
  if (/\bYouTube Music\b/i.test(title)) return "youtubeMusic";
  if (/\bYouTube\b/i.test(title)) return "youtube";
  return null;
}

export interface ProfileButton {
  shortcut: Shortcut;
  /** Nombre de un ícono de Ionicons. */
  icon: string;
  /** Clave de i18n del texto corto. */
  label: string;
}
export interface ProfileRow {
  id: "browser" | "youtube" | "player";
  /** Clave de i18n del título del grupo. */
  title: string;
  buttons: ProfileButton[];
}

const BROWSER_ROW: ProfileRow = {
  id: "browser",
  title: "apps.profile.browser",
  buttons: [
    { shortcut: "back", icon: "arrow-back", label: "pad.shortcuts.back" },
    { shortcut: "forward", icon: "arrow-forward", label: "pad.shortcuts.forward" },
    { shortcut: "reload", icon: "refresh", label: "pad.shortcuts.reload" },
    { shortcut: "newTab", icon: "add", label: "pad.shortcuts.newTab" },
  ],
};

const YOUTUBE_ROW: ProfileRow = {
  id: "youtube",
  title: "apps.profile.youtube",
  buttons: [
    { shortcut: "ytBack10", icon: "play-back", label: "pad.shortcuts.ytBack10" },
    { shortcut: "ytForward10", icon: "play-forward", label: "pad.shortcuts.ytForward10" },
    { shortcut: "ytFullscreen", icon: "expand", label: "apps.profile.fullscreen" },
    { shortcut: "ytCaptions", icon: "text", label: "pad.shortcuts.ytCaptions" },
  ],
};

/** D101: lo que casi todo reproductor web entiende (sin la extensión): retroceder y adelantar (unos 5 s), silencio y pantalla completa. */
const PLAYER_ROW: ProfileRow = {
  id: "player",
  title: "apps.profile.player",
  buttons: [
    { shortcut: "mediaBack", icon: "play-back", label: "apps.profile.playerBack" },
    { shortcut: "mediaForward", icon: "play-forward", label: "apps.profile.playerForward" },
    { shortcut: "mediaMute", icon: "volume-mute", label: "apps.profile.playerMute" },
    { shortcut: "mediaFullscreen", icon: "expand", label: "apps.profile.fullscreen" },
  ],
};

/** Las filas de atajos de una ventana: las del navegador y, si la pestaña a la vista es YouTube, las de YouTube primero. */
export function shortcutRows(app: string, title: string, playing = true): ProfileRow[] {
  if (!isBrowser(app)) return [];
  // Sin YouTube a la vista, la fila genérica de reproductor (D101): sirve en cualquier sitio con video, aunque la PC no sepa cuál es.
  // Espacio, flechas, M y F van a ciegas a la ventana al frente: si no suena nada ahí, la fila no se ofrece (en un campo de texto
  // escribirían una letra, y con foco en un botón, Espacio lo activaría).
  return siteOf(title) === "youtube" ? [YOUTUBE_ROW, BROWSER_ROW] : playing ? [PLAYER_ROW, BROWSER_ROW] : [BROWSER_ROW];
}
