import { Children, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useLayout } from "@/layout/useLayout";
import { columnsFor } from "@/layout/rules";
import { spacing } from "@/theme";

/** Grilla de teclas: 3 columnas en vertical, 5 en apaisado (docs/PLAN.md D25), o las que pida quien la usa en media pantalla. La última fila se completa con huecos. */
export function KeyGrid({ children, columns }: { children: ReactNode; columns?: number }) {
  const { width } = useLayout();
  const cols = columns ?? columnsFor(width, "deck");
  const items = Children.toArray(children);
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View testID="key-grid" style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row}
          {Array.from({ length: cols - row.length }, (_, i) => (
            <View key={`gap${i}`} style={styles.gap} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  gap: { flex: 1 },
});
