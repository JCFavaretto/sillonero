import { useEffect, useRef, useState } from "react";
import { firePad } from "@/apps/commands";
import { bump, tap } from "@/haptics";
import { padActions } from "./actions";
import { createPadController } from "./controller";
import { padFx } from "./fx";
import { usePad } from "./store";
import { createTypingSession } from "./typingSession";

const nowMs = () => Date.now();

/**
 * El controlador del touchpad (gestos → curva → mensajes) y la sesión de escritura en vivo. Viven mientras la pantalla está
 * montada; los callbacks leen lo más nuevo por refs (nunca al dibujar), igual que el deslizador de volumen.
 */
export function usePadEngine({ flash, setText }: { flash: (key: string | null) => void; setText: (text: string) => void }) {
  const live = useRef({ flash, setText });
  useEffect(() => {
    live.current = { flash, setText };
  });

  /* eslint-disable react-hooks/refs */
  const [controller] = useState(() =>
    createPadController({
      fire: firePad,
      button: (b, a) => void padActions.button(b, a).then((r) => !r.ok && live.current.flash(r.error)),
      haptic: (k) => (k === "drag" ? bump() : tap()),
      fx: padFx.emit,
      settings: () => usePad.getState().settings,
      now: nowMs,
    }),
  );
  const [typing] = useState(() =>
    createTypingSession({
      type: (b, tx) => padActions.type(b, tx),
      key: (k, m) => padActions.key(k, m),
      mods: () => usePad.getState().mods,
      setMods: (m) => usePad.getState().setMods(m),
      setText: (tx) => live.current.setText(tx),
      onError: (e) => live.current.flash(e),
    }),
  );
  /* eslint-enable react-hooks/refs */

  return { controller, typing };
}
