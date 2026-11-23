import type { AudioState, AudioTarget, MediaKey } from "@proyecto-e/protocol";
import { sendAppCommand } from "@/apps/commands";
import type { CommandOutcome } from "@/connection/client";
import { isAudioDemo } from "./demoFlag";
import { useAudio } from "./store";

/**
 * Lo que se puede pedir desde Audio y el Inicio. Con la PC de verdad cada pedido es un comando y la PC contesta con el
 * estado nuevo (`audio.update`): acá no se toca el estado. En la demo se aplica local.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

const fail = (r: Extract<CommandOutcome, { ok: false }>): ActionResult => ({ ok: false, error: `audio.error.${r.reason}` });
const done = (r: CommandOutcome): ActionResult => (r.ok ? { ok: true } : fail(r));

const state = (): AudioState | null => useAudio.getState().audio;
const patch = (fn: (a: AudioState) => AudioState) => {
  const a = state();
  if (a) useAudio.setState({ audio: fn(a) });
};
const key = (t: AudioTarget) => `${t.kind}:${t.id}`;

export const audioActions = {
  async setVolume(target: AudioTarget, volume: number): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({
        ...a,
        outputs: target.kind === "output" ? a.outputs.map((o) => (o.id === target.id ? { ...o, volume } : o)) : a.outputs,
        apps: target.kind === "app" ? a.apps.map((p) => (p.id === target.id ? { ...p, volume } : p)) : a.apps,
      }));
      return { ok: true };
    }
    return done(await sendAppCommand("audio.setVolume", { target, volume }));
  },

  async setMute(target: AudioTarget, muted: boolean): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({
        ...a,
        outputs: target.kind === "output" ? a.outputs.map((o) => (o.id === target.id ? { ...o, muted } : o)) : a.outputs,
        apps: target.kind === "app" ? a.apps.map((p) => (p.id === target.id ? { ...p, muted } : p)) : a.apps,
      }));
      return { ok: true };
    }
    return done(await sendAppCommand("audio.setMute", { target, muted }));
  },

  async nudge(delta: -5 | 5): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({ ...a, outputs: a.outputs.map((o) => (o.isDefault && o.volume !== null ? { ...o, volume: Math.min(100, Math.max(0, o.volume + delta)) } : o)) }));
      return { ok: true };
    }
    return done(await sendAppCommand("audio.nudge", { delta }));
  },

  async toggleMute(): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({ ...a, outputs: a.outputs.map((o) => (o.isDefault ? { ...o, muted: !o.muted } : o)) }));
      return { ok: true };
    }
    return done(await sendAppCommand("audio.toggleMute", {}));
  },

  async setDefault(outputId: string): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({ ...a, outputs: a.outputs.map((o) => ({ ...o, isDefault: o.id === outputId })) }));
      return { ok: true };
    }
    return done(await sendAppCommand("audio.setDefault", { outputId }));
  },

  async route(appId: string, outputId: string | null): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({ ...a, apps: a.apps.map((p) => (p.id === appId ? { ...p, routed: outputId } : p)) }));
      return { ok: true };
    }
    return done(await sendAppCommand("audio.route", { appId, outputId }));
  },

  async rename(outputId: string, nick: string | null): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({ ...a, outputs: a.outputs.map((o) => (o.id === outputId ? { ...o, nick } : o)) }));
      return { ok: true };
    }
    return done(await sendAppCommand("audio.rename", { outputId, nick }));
  },

  async hide(outputId: string, hidden: boolean): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({ ...a, outputs: a.outputs.map((o) => (o.id === outputId ? { ...o, hidden } : o)) }));
      return { ok: true };
    }
    return done(await sendAppCommand("audio.hide", { outputId, hidden }));
  },

  async pressKey(k: MediaKey): Promise<ActionResult> {
    if (isAudioDemo()) return { ok: true };
    return done(await sendAppCommand("media.key", { key: k }));
  },

  async selectMedia(id: string | null): Promise<ActionResult> {
    if (isAudioDemo()) {
      patch((a) => ({ ...a, media: { ...a.media, targetId: id ?? a.media.sessions[0]?.id ?? null, chosen: id !== null } }));
      return { ok: true };
    }
    return done(await sendAppCommand("media.select", { id }));
  },
};

export { key as sliderKey };
