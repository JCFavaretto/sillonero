import type { Monitor } from "@proyecto-e/protocol";
import { appsActions } from "@/apps/actions";
import type { DeckKey } from "@/apps/deck";
import { audioActions } from "@/audio/actions";
import { useAudio } from "@/audio/store";
import { outputLabel } from "@/audio/view";
import { screensActions } from "@/screens/actions";
import { useScreens } from "@/screens/store";
import type { DeckSlot } from "./model";
import { playSoundKey } from "./sound";
import { getDecksStorage } from "./store";

// Lo que pasa al tocar una tecla de un deck (D104). Devuelve claves de i18n: la pantalla las escribe y marca la tecla en rojo.

export type PressResult =
  | { ok: true; toast?: { n: number; name: string } }
  /** `flag`: la acción falló de verdad (la tecla queda en rojo); si no, es un aviso de por qué no se puede. */
  | { ok: false; error: string; vars?: Record<string, string>; flag: boolean };

const WHY = { disconnected: "home.deck.disconnected", audioOff: "home.deck.audioOff", unsupported: "home.deck.unsupported" } as const;
const bad = (error: string, flag = true, vars?: Record<string, string>): PressResult => ({ ok: false, error, vars, flag });
const from = (r: { ok: true } | { ok: false; error: string }): PressResult => (r.ok ? { ok: true } : bad(r.error));

export async function pressSlot(slot: DeckSlot, view: DeckKey, monitors: Monitor[]): Promise<PressResult> {
  if (!view.available) {
    const why = view.reason && view.reason !== "missing" ? (view.kind === "output" && view.reason === "disconnected" ? "home.deck.outputGone" : WHY[view.reason]) : "home.deck.missing";
    return bad(why, false);
  }
  const a = slot.action;
  switch (a.kind) {
    case "scene": {
      const r = await appsActions.runScene(a.id);
      return r.ok ? { ok: true } : r.error === "apps.error.sceneFailed" ? bad("home.deck.sceneFailed", true, { name: view.label ?? "" }) : bad(r.error);
    }
    case "link":
      return from(await appsActions.runTarget({ kind: "url", url: a.url, ...(a.open && a.open !== "tab" ? { open: a.open } : {}) }));
    case "app":
      return from(await appsActions.runTarget({ kind: "app", appId: a.appId }));
    case "sound": {
      const r = await playSoundKey(a, getDecksStorage());
      return r.ok ? { ok: true } : bad(r.error);
    }
    case "bringAll":
      return from(await appsActions.bringAll());
    case "monitorToggle": {
      const m = monitors.find((x) => x.id === a.monitorId);
      if (!m) return { ok: true };
      await screensActions.setEnabled(m.id, !m.enabled);
      const e = useScreens.getState().error;
      return e ? bad(e) : { ok: true };
    }
    case "identify":
      await screensActions.identify();
      return { ok: true };
    default: {
      const r = a.kind === "media" ? await audioActions.pressKey(a.key) : a.kind === "volume" ? await audioActions.nudge(a.delta) : a.kind === "mute" ? await audioActions.toggleMute() : await audioActions.setDefault(a.outputId);
      if (!r.ok) return bad(r.error);
      if (a.kind === "volume") {
        const d = useAudio.getState().audio?.outputs.find((o) => o.isDefault);
        if (d?.volume != null) return { ok: true, toast: { n: d.volume, name: outputLabel(d) } };
      }
      return { ok: true };
    }
  }
}
