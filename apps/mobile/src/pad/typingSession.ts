import type { PadKey, PadMod } from "@proyecto-e/protocol";
import { activeMods, consumeMods, type ModState } from "./mods";
import { applyTyping, charToPadKey, chunkTyping, diffTyping, sanitizeTyped } from "./typing";

// Escribir en vivo (docs/PLAN.md 8.5, cambio 4): lo que se escribe en el campo del celu se escribe en la PC y las correcciones
// también. "Enviar" es la tecla Enter. Un solo mensaje en vuelo por vez, así lo escrito llega en orden.

type R = { ok: true } | { ok: false; error: string };

export interface TypingDeps {
  type(backspaces: number, text: string): Promise<R>;
  key(key: PadKey, mods: readonly PadMod[]): Promise<R>;
  mods(): ModState;
  setMods(m: ModState): void;
  /** Cambia lo que muestra el campo (para volverlo atrás o vaciarlo). */
  setText(text: string): void;
  /** Un error de la PC (clave de texto) o `null` cuando se resolvió. */
  onError(error: string | null): void;
}

const SEND_DELAY_MS = 50;

export function createTypingSession(deps: TypingDeps) {
  /** Lo que muestra el campo ahora. */
  let value = "";
  /** Lo que la PC ya tiene escrito. */
  let sent = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy: Promise<void> | null = null;
  let again = false;
  let disposed = false;

  async function drain(): Promise<void> {
    do {
      again = false;
      const target = value;
      const diff = diffTyping(sent, target);
      if (diff.backspaces === 0 && diff.text === "") break;
      let failed: string | null = null;
      for (const piece of chunkTyping(diff)) {
        if (disposed) return; // se salió del Pad: no se sigue escribiendo
        const r = await deps.type(piece.backspaces, piece.text);
        if (!r.ok) {
          failed = r.error;
          break;
        }
        sent = applyTyping(sent, piece); // lo que ya salió queda anotado: un reintento no lo repite
      }
      if (failed === null) {
        deps.onError(null);
      } else {
        deps.onError(failed); // lo próximo que se escriba reintenta solo lo que faltó
        break;
      }
    } while (again || value !== sent);
  }

  function run(): Promise<void> {
    if (busy) {
      again = true;
      return busy;
    }
    busy = drain().finally(() => {
      busy = null;
    });
    return busy;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, SEND_DELAY_MS);
  }

  async function flushNow() {
    if (timer) clearTimeout(timer);
    timer = null;
    while (busy) await busy;
    await run();
  }

  async function pressKey(key: PadKey): Promise<R> {
    const mods = deps.mods();
    const r = await deps.key(key, activeMods(mods));
    deps.setMods(consumeMods(mods));
    return r;
  }

  return {
    /** El campo cambió. */
    change(raw: string) {
      if (disposed) return;
      const next = sanitizeTyped(raw);
      const mods = activeMods(deps.mods());
      if (mods.length > 0) {
        const d = diffTyping(value, next);
        if (d.backspaces === 0 && d.text.length > 0) {
          // Con un modificador enganchado la letra va como combinación (Ctrl+L) y no entra al campo.
          const k = Array.from(d.text).length === 1 ? charToPadKey(d.text) : null;
          deps.setText(value);
          if (k) void pressKey(k).then((r) => deps.onError(r.ok ? null : r.error));
          return;
        }
      }
      value = next;
      schedule();
    },

    /** "Enviar" = Enter: manda lo que falte, aprieta Enter (con lo enganchado) y vacía el campo. */
    async enter(): Promise<R> {
      await flushNow();
      if (value !== sent) return { ok: false, error: "pad.error.failed" }; // lo anterior no salió: no se sigue
      const r = await pressKey("enter");
      if (r.ok) {
        value = "";
        sent = "";
        deps.setText("");
        deps.onError(null);
      } else {
        deps.onError(r.error);
      }
      return r;
    },

    /** Una tecla del Pad (Esc, flechas, F5…) con lo que haya enganchado. */
    pressKey,

    /** "Vaciar": limpia el campo sin tocar la PC (para cuando Jay hizo clic en otro lado). */
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      value = "";
      sent = "";
      deps.setText("");
      deps.onError(null);
    },

    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type TypingSession = ReturnType<typeof createTypingSession>;
