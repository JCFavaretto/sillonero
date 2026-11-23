import type { BrowserDataPayload, BrowserState, ServerMessage } from "@proyecto-e/protocol";
import { create } from "zustand";

/**
 * El navegador visto desde el celu (docs/PLAN.md 8.7): pestañas y si hay extensión conectada. Lo escribe el cliente con los
 * mensajes de la PC. Las respuestas a una pregunta (`browser.data`) no se guardan: se entregan a quien esperaba ese pedido.
 */
export interface BrowserData {
  /** `null` hasta que llega el primer estado (o si la PC es de una versión sin esta función). */
  browser: BrowserState | null;
  /** Cuándo llegó ese estado (reloj del celu, ms): desde ahí avanza sola la barra de un video (D99). */
  browserAt: number;
  /** Solo en la demo de desarrollo. */
  demo: boolean;
}

export const initialBrowser: BrowserData = { browser: null, browserAt: 0, demo: false };
export const useBrowser = create<BrowserData>(() => initialBrowser);

type Waiter = (r: BrowserDataPayload) => void;
const waiters = new Map<string, Waiter>();

/** Espera la respuesta de ese pedido. Devuelve cómo dejar de esperar (por si se vence el plazo). */
export function waitForBrowserData(requestId: string, cb: Waiter): () => void {
  waiters.set(requestId, cb);
  return () => void waiters.delete(requestId);
}

export function applyBrowser(msg: ServerMessage | null): void {
  if (msg === null) {
    for (const [id, cb] of waiters) {
      waiters.delete(id);
      cb({ replyTo: id, kind: "bookmarks", ok: false, reason: "no_extension" }); // se cortó la conexión: nadie queda esperando
    }
    return useBrowser.setState({ browser: null, browserAt: 0 });
  }
  if (msg.type === "browser.state") return useBrowser.setState({ browser: msg.payload, browserAt: Date.now(), demo: false });
  if (msg.type === "browser.data") {
    const cb = waiters.get(msg.payload.replyTo);
    if (!cb) return; // llegó tarde: ya se dejó de esperar
    waiters.delete(msg.payload.replyTo);
    cb(msg.payload);
  }
}
