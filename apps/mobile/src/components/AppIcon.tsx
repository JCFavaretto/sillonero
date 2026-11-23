import { Image, StyleSheet, View } from "react-native";
import { useIcon } from "@/apps/icons";
import { AppText } from "@/components/ui";
import { colors, radius } from "@/theme";

/** El ícono que sacó la PC (PNG en base64). Mientras no llega, o si no hay, se muestra la inicial en un cuadrito. */
export function AppIcon({ iconKey, name, size = 36 }: { iconKey: string | null; name: string; size?: number }) {
  const png = useIcon(iconKey);
  const box = { width: size, height: size, borderRadius: Math.max(radius.sm, size / 5) };
  if (png) return <Image testID="app-icon" accessibilityIgnoresInvertColors source={{ uri: `data:image/png;base64,${png}` }} style={box} />;
  return (
    <View testID="app-icon-fallback" style={[styles.fallback, box]}>
      <AppText kind="key" style={{ fontSize: size * 0.42 }}>
        {(name.trim()[0] ?? "?").toUpperCase()}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
});
