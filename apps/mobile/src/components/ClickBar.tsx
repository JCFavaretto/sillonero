import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText } from "@/components/ui";
import { colors, hairline, radius, spacing, touch } from "@/theme";

/**
 * La barra de clic partida, pegada al borde de abajo del touchpad como la de una notebook (boceto pad 01): clic izquierdo,
 * el candado que lo deja apretado para arrastres largos, y clic derecho. En la zona del pulgar.
 */
export function ClickBar({
  locked,
  disabled = false,
  onLeft,
  onMiddle,
  onRight,
  onToggleLock,
}: {
  locked: boolean;
  disabled?: boolean;
  onLeft: () => void;
  onMiddle: () => void;
  onRight: () => void;
  onToggleLock: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.bar, disabled && styles.off]}>
      <Pressable
        testID="click-left"
        accessibilityRole="button"
        accessibilityLabel={t("pad.click.left")}
        disabled={disabled}
        onPress={onLeft}
        style={({ pressed }) => [styles.btn, styles.left, locked && styles.on, pressed && styles.pressed]}
      >
        <AppText kind="small" style={locked && { color: colors.accent }}>
          {t(locked ? "pad.click.leftHeld" : "pad.click.left")}
        </AppText>
      </Pressable>
      <Pressable
        testID="click-lock"
        accessibilityRole="switch"
        accessibilityLabel={t(locked ? "pad.click.unlock" : "pad.click.lock")}
        accessibilityState={{ checked: locked, disabled }}
        disabled={disabled}
        onPress={onToggleLock}
        style={({ pressed }) => [styles.btn, styles.mid, pressed && styles.pressed]}
      >
        <Ionicons name={locked ? "lock-closed" : "lock-open-outline"} size={18} color={locked ? colors.accent : colors.muted} />
      </Pressable>
      <Pressable
        testID="click-middle"
        accessibilityRole="button"
        accessibilityLabel={t("pad.click.middleLabel")}
        disabled={disabled}
        onPress={onMiddle}
        style={({ pressed }) => [styles.btn, styles.mid, pressed && styles.pressed]}
      >
        <Ionicons name="ellipse-outline" size={18} color={colors.muted} />
        <AppText kind="small" muted style={styles.midText}>
          {t("pad.click.middle")}
        </AppText>
      </Pressable>
      <Pressable
        testID="click-right"
        accessibilityRole="button"
        accessibilityLabel={t("pad.click.right")}
        disabled={disabled}
        onPress={onRight}
        style={({ pressed }) => [styles.btn, styles.right, pressed && styles.pressed]}
      >
        <AppText kind="small">{t("pad.click.right")}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", gap: 2, marginTop: -4 },
  off: { opacity: 0.4 },
  btn: { minHeight: touch + 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
  left: { flex: 1, borderTopLeftRadius: radius.sm, borderBottomLeftRadius: radius.lg },
  right: { flex: 1, borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.lg },
  mid: { width: touch + 8, paddingHorizontal: spacing.xs },
  midText: { fontSize: 10 },
  on: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  pressed: { backgroundColor: colors.surfaceAlt },
});
