import { usePad } from "./store";

/** Datos de mentira para "Ver demo": el Pad se ve como con la PC lista (los mensajes no salen a ningún lado). */
export function loadPadDemo(): void {
  usePad.setState({ state: { available: true, enabled: true, elevated: false, holding: { left: false, alt: false } }, rtt: 18, slow: false });
}
