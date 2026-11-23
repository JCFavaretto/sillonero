import * as Haptics from "expo-haptics";

/** Una vibración corta al tocar una tecla. Si el celu no la tiene (o falla), no pasa nada. */
export function tap(): void {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  } catch {
    // sin vibración
  }
}

/** Un "clic" suave al cruzar una marca (cada 10 de volumen en el anillo). */
export function tick(): void {
  try {
    void Haptics.selectionAsync().catch(() => undefined);
  } catch {
    // sin vibración
  }
}

/** Una vibración más marcada: empieza un arrastre (el botón quedó apretado). */
export function bump(): void {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  } catch {
    // sin vibración
  }
}
