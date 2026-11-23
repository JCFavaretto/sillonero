import { z } from "zod";

// Ids y tipos chicos del audio (docs/PLAN.md 8.4.3). Sin dependencias: los usan `library.ts` y `audio.ts`.
// El celu nunca ve un id de Windows ni un PID: solo estos ids opacos, que arma el agente con un hash.

/** "o_" + 12 caracteres base64url del hash del id del dispositivo de Windows. Estable entre reinicios (D28). */
export const OutputId = z.string().regex(/^o_[A-Za-z0-9_-]{12}$/);
/** "a_" + 12 del hash de la ruta del .exe en minúsculas. */
export const AudioAppId = z.string().regex(/^a_[A-Za-z0-9_-]{12}$/);
/** "m_" + 12 del hash del AUMID de la sesión de media ("chrome.exe", "Spotify.exe"). */
export const MediaId = z.string().regex(/^m_[A-Za-z0-9_-]{12}$/);
/** "r_" + 12 del hash de app + título + artista: identifica una carátula. */
export const ArtKey = z.string().regex(/^r_[A-Za-z0-9_-]{12}$/);

/** Volumen entero de 0 a 100. */
export const Volume = z.number().int().min(0).max(100);
export type Volume = z.infer<typeof Volume>;

export const MediaKey = z.enum(["prev", "playPause", "next"]);
export type MediaKey = z.infer<typeof MediaKey>;
