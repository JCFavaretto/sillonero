/** Avisos chicos del controlador a la superficie (el anillo del clic, el borde del arrastre) sin acoplarlos. */
export type PadFx = "click" | "dragStart" | "dragEnd";

type Listener = (fx: PadFx) => void;
const listeners = new Set<Listener>();

export const padFx = {
  emit(fx: PadFx): void {
    for (const l of listeners) l(fx);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
