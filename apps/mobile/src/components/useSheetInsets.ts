import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "@/theme";

/**
 * Las hojas (Modal) se dibujan por debajo de la barra de Android (atrás, inicio, recientes). Este margen las sube:
 * `bottom` para el relleno de abajo de una hoja pegada al borde y `side` para el borde de lado en apaisado (la barra queda de costado).
 */
export function useSheetInsets() {
  const i = useSafeAreaInsets();
  return { bottom: spacing.lg + i.bottom, left: i.left, right: i.right };
}
