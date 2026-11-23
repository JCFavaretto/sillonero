import type { AltTabStep, PadKey, PadMod, Shortcut } from "@proyecto-e/protocol";
import { sendAppCommand } from "@/apps/commands";
import type { CommandOutcome } from "@/connection/client";

/** Lo que se le pide a la PC desde el Pad. Cada pedido es un comando con respuesta; el estado de la PC llega aparte (`pad.state`). */
export type ActionResult = { ok: true } | { ok: false; error: string };

const done = (r: CommandOutcome): ActionResult => (r.ok ? { ok: true } : { ok: false, error: `pad.error.${r.reason}` });

export const padActions = {
  async key(key: PadKey, mods: readonly PadMod[]): Promise<ActionResult> {
    return done(await sendAppCommand("pad.key", { key, mods: [...mods] }));
  },
  async shortcut(name: Shortcut): Promise<ActionResult> {
    return done(await sendAppCommand("pad.shortcut", { name }));
  },
  async type(backspaces: number, text: string): Promise<ActionResult> {
    return done(await sendAppCommand("pad.type", { backspaces, text }));
  },
  async altTab(step: AltTabStep): Promise<ActionResult> {
    return done(await sendAppCommand("pad.altTab", { step }));
  },
  async release(): Promise<ActionResult> {
    return done(await sendAppCommand("pad.release", {}));
  },
  async button(button: "left" | "middle" | "right", action: "click" | "down" | "up"): Promise<ActionResult> {
    return done(await sendAppCommand("pad.button", { button, action }));
  },
};
