import type { BrowserFailure, BrowserItem, BrowserOp, BrowserQuery } from "@proyecto-e/protocol";
import { queryApps, sendAppCommand } from "@/apps/commands";
import { useApps } from "@/apps/store";
import { DEMO_BROWSER_ITEMS } from "./demo";
import { useBrowser, waitForBrowserData } from "./store";

/** Lo que se le pide al navegador desde el celu. Con la PC de verdad, la extensión contesta y el estado nuevo llega solo. */
export type ActionResult = { ok: true } | { ok: false; error: string };
export type AskResult = { ok: true; items: BrowserItem[] } | { ok: false; reason: BrowserFailure | "offline" };

/** Cuánto se espera una respuesta de la extensión (ella misma espera hasta 10 s a YouTube). */
export const ASK_TIMEOUT_MS = 12_000;

const demo = () => useBrowser.getState().demo || useApps.getState().demo;

export const browserActions = {
  async act(op: BrowserOp): Promise<ActionResult> {
    if (demo()) return { ok: true };
    const r = await sendAppCommand("browser.act", op);
    return r.ok ? { ok: true } : { ok: false, error: `browser.error.${r.reason}` };
  },

  /** Hace una pregunta y espera la respuesta. Nunca rechaza. */
  ask(q: BrowserQuery): Promise<AskResult> {
    if (demo()) return Promise.resolve({ ok: true, items: DEMO_BROWSER_ITEMS[q.kind] ?? [] });
    return new Promise((resolve) => {
      const id = queryApps("browser.query", q);
      if (id === null) return resolve({ ok: false, reason: "offline" });
      let done = false;
      const stop = waitForBrowserData(id, (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r.ok ? { ok: true, items: r.items } : { ok: false, reason: r.reason });
      });
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        stop();
        resolve({ ok: false, reason: "timeout" });
      }, ASK_TIMEOUT_MS);
    });
  },
};
