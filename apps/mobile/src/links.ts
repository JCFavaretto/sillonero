import { SafeUrl } from "@proyecto-e/protocol";

// Direcciones que escribe o pega una persona (puro): sin tener que poner "https://" y sin que se rompa si lo pone.

/** Lo que se muestra en el campo: sin el "https://" del principio (se agrega solo al guardar). */
export const stripScheme = (v: string): string => v.replace(/^\s*https:\/\//i, "");

/**
 * La dirección completa lista para guardar, o `null` si no sirve. Acepta "youtube.com", "www.twitch.tv/directory" o
 * "https://…"; un "http://" escrito a propósito se respeta. Tiene que parecer un sitio (con un punto, o localhost, o una IP).
 */
export function normalizeUrl(input: string): string | null {
  const t = input.trim();
  if (!t || /\s/.test(t)) return null;
  const full = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  if (!SafeUrl.safeParse(full).success) return null;
  const host = (/^https?:\/\/([^/?#]+)/i.exec(full)?.[1] ?? "").replace(/:\d+$/, "");
  // Un sitio termina en algo con letras ("com", "tv", "xn--p1ai"): así "3.14159" no cuenta.
  const siteLike = /^(localhost|(\d{1,3}\.){3}\d{1,3})$/i.test(host) || /^[^.]+(\.[^.]+)*\.[^.]*[a-z][^.]*$/i.test(host);
  return siteLike ? full : null;
}

/** El sitio sin "www.": "https://www.youtube.com/x" → "youtube.com". */
export const siteOf = (url: string): string => (/^(?:https?:\/\/)?([^/?#]+)/i.exec(url.trim())?.[1] ?? "").replace(/^www\./i, "").replace(/:\d+$/, "").slice(0, 32);

/** ¿Lo que hay en el portapapeles es un link que vale la pena ofrecer? (una sola línea, sin espacios, que parezca un sitio). */
export function linkFromClipboard(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 2048 || /\s/.test(t)) return null;
  return normalizeUrl(t);
}
