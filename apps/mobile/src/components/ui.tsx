import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, hairline, radius, spacing, touch, type } from "@/theme";

/** Pantalla con fondo, zonas seguras (muescas, barra de gestos) y scroll. */
export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView style={styles.screen}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.content, style]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type TextKind = keyof typeof type;

export function AppText({
  kind = "body",
  muted,
  decorative,
  style,
  children,
  ...rest
}: {
  kind?: TextKind;
  muted?: boolean;
  /** Emoji o adorno que TalkBack no tiene que leer. */
  decorative?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text
      {...rest}
      accessibilityRole={kind === "title" || kind === "heading" ? "header" : undefined}
      importantForAccessibility={decorative ? "no-hide-descendants" : undefined}
      accessibilityElementsHidden={decorative}
      style={[type[kind], { color: muted ? colors.muted : colors.text }, style]}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = "primary",
  style,
  disabled = false,
  selected,
  testID,
}: {
  testID?: string;
  /** Para pestañas y opciones: el lector de pantalla dice cuál está elegida. */
  selected?: boolean;
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary";
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const primary = kind === "primary";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? colors.accent : colors.surfaceAlt, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <Text style={[type.heading, { color: primary ? colors.accentText : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Notice({ children, tone = "danger", live }: { children: ReactNode; tone?: "danger" | "info"; /** TalkBack lo anuncia al aparecer (por defecto solo los de error). */ live?: boolean }) {
  const danger = tone === "danger";
  return (
    <View
      accessibilityLiveRegion={live ?? danger ? "polite" : "none"}
      style={[styles.notice, { backgroundColor: danger ? colors.dangerBg : colors.surface }]}
    >
      <Text style={[type.small, { color: danger ? colors.danger : colors.muted }]}>{children}</Text>
    </View>
  );
}

export function StatusDot({ color }: { color: string }) {
  return (
    <View style={[styles.halo, { backgroundColor: `${color}33` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  fill: { flex: 1 },
  button: {
    minHeight: touch,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  notice: { borderRadius: radius.md, padding: spacing.md },
  /** Punto de estado con halo, como una luz piloto. */
  dot: { width: 8, height: 8, borderRadius: 4 },
  halo: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
