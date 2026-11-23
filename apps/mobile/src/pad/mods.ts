import type { PadMod } from "@proyecto-e/protocol";

/** Modificadores "enganchados" (boceto 03): `once` = para la próxima tecla; `locked` = fijo hasta tocarlo otra vez. Viven en el celu. */
export type ModLevel = "off" | "once" | "locked";
export type ModState = Record<PadMod, ModLevel>;
export const MODS: readonly PadMod[] = ["ctrl", "alt", "shift", "win"];
export const noMods = (): ModState => ({ ctrl: "off", alt: "off", shift: "off", win: "off" });
const DOUBLE_TAP_MS = 400;

const lastTap: Partial<Record<PadMod, number>> = {};

/** Un toque: engancha; otro toque enseguida (< 400 ms): lo fija; otro toque más tarde: lo suelta. */
export function toggleMod(state: ModState, mod: PadMod, now: number): ModState {
  const level = state[mod];
  const prev = lastTap[mod];
  lastTap[mod] = now;
  if (level === "off") return { ...state, [mod]: "once" };
  if (level === "once" && prev !== undefined && now - prev < DOUBLE_TAP_MS) return { ...state, [mod]: "locked" };
  return { ...state, [mod]: "off" };
}

export const activeMods = (state: ModState): PadMod[] => MODS.filter((m) => state[m] !== "off");

/** Después de una tecla se sueltan los de una vez y se quedan los fijos. */
export function consumeMods(state: ModState): ModState {
  const next = { ...state };
  for (const m of MODS) if (next[m] === "once") next[m] = "off";
  return next;
}
