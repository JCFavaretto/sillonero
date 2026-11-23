import { z } from "zod";

// B5: Pad (docs/PLAN.md 8.5). El celu manda solo enteros acotados, nombres de listas cerradas, booleanos y texto
// sin caracteres de control. Nada de esto llega a una línea de comandos ni a una ruta: el agente lo traduce a eventos.

/** Píxeles lógicos (a 100 % de escala) que se mueve el cursor en un mensaje. */
export const PadDelta = z.number().int().min(-512).max(512);
/** Rueda: 120 = un "clic" de rueda. */
export const WheelDelta = z.number().int().min(-1200).max(1200);

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const DIGITS = "0123456789".split("");
const FKEYS = Array.from({ length: 12 }, (_, i) => `f${i + 1}`);

export const PAD_KEYS = [
  "esc", "tab", "backspace", "enter", "space",
  "left", "up", "right", "down",
  "home", "end", "delete", "insert", "pageUp", "pageDown",
  ...FKEYS,
  ...LETTERS,
  ...DIGITS,
] as const;
export const PadKey = z.enum(PAD_KEYS);
export type PadKey = z.infer<typeof PadKey>;

export const PadMod = z.enum(["ctrl", "alt", "shift", "win"]);
export type PadMod = z.infer<typeof PadMod>;
export const PadMods = z.array(PadMod).max(4).refine((m) => new Set(m).size === m.length, "modificadores repetidos");

/** Atajos fijos (boceto 04). El celu manda el nombre; la PC sabe qué teclas son. */
export const SHORTCUTS = [
  "desktop", "fullscreen", "back", "forward", "reload", "addressBar", "newTab", "closeTab",
  "ytPlayPause", "ytBack10", "ytForward10", "ytFullscreen", "ytCaptions", "escape",
  // D101: los que casi todos los reproductores de video comparten (sin la extensión): Espacio, flechas, M y F.
  "mediaPlayPause", "mediaBack", "mediaForward", "mediaMute", "mediaFullscreen",
  "copy", "paste", "undo",
] as const;
export const Shortcut = z.enum(SHORTCUTS);
export type Shortcut = z.infer<typeof Shortcut>;

/** Tope de caracteres por mensaje de texto y de retrocesos. */
export const PAD_TEXT_MAX = 500;
/** Sin caracteres de control (Enter y Tab van como teclas). Pasa ñ, tildes y emojis. */
export const PadText = z
  .string()
  .max(PAD_TEXT_MAX)
  .refine((t) => !/[\u0000-\u001F\u007F]/.test(t), "caracteres de control");

/** Escribir en vivo: borrar `backspaces` caracteres y escribir `text` (al menos una de las dos cosas). */
export const PadTypePayload = z
  .strictObject({ backspaces: z.number().int().min(0).max(PAD_TEXT_MAX), text: PadText })
  .refine((p) => p.backspaces > 0 || p.text.length > 0, "nada que hacer");

export const AltTabStep = z.enum(["start", "next", "prev", "commit", "cancel"]);
export type AltTabStep = z.infer<typeof AltTabStep>;

/** Estado del Pad en la PC, para todos los celus. `holding` = lo que tiene apretado ahora (D53). */
export const PadState = z.strictObject({
  /** false = el hijo de entrada no está (se cayó o no es Windows). */
  available: z.boolean(),
  /** La llave global del panel de la PC (prendida por defecto). */
  enabled: z.boolean(),
  /** La ventana del frente es de administrador: Windows no deja escribirle (UIPI). */
  elevated: z.boolean(),
  holding: z.strictObject({ left: z.boolean(), alt: z.boolean() }),
});
export type PadState = z.infer<typeof PadState>;
