import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText } from "@/components/ui";
import { colors, radius, spacing, touch } from "@/theme";

/**
 * Alt+Tab (boceto pad 04 C): la PC deja Alt apretado y muestra el selector de ventanas; acá se mueve con ◀ ▶ y se elige.
 * Se elige sola a los 2 s sin tocar nada (la PC se encarga, para que Alt no quede apretado).
 */
export function AltTabPanel({ disabled = false, onPrev, onNext, onCommit, onCancel }: { disabled?: boolean; onPrev: () => void; onNext: () => void; onCommit: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <View testID="alttab" style={styles.box}>
      <AppText kind="small" muted style={styles.title}>
        {t("pad.altTab.title")}
      </AppText>
      <View style={styles.row}>
        <Pressable testID="alttab-prev" accessibilityRole="button" accessibilityLabel={t("pad.altTab.prev")} disabled={disabled} onPress={onPrev} style={[styles.arrow, disabled && styles.off]}>
          <AppText kind="title">◀</AppText>
        </Pressable>
        <Pressable testID="alttab-next" accessibilityRole="button" accessibilityLabel={t("pad.altTab.next")} disabled={disabled} onPress={onNext} style={[styles.arrow, disabled && styles.off]}>
          <AppText kind="title">▶</AppText>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable testID="alttab-cancel" accessibilityRole="button" accessibilityLabel={t("pad.altTab.cancel")} disabled={disabled} onPress={onCancel} style={[styles.big, disabled && styles.off]}>
          <AppText kind="heading">{t("pad.altTab.cancel")}</AppText>
        </Pressable>
        <Pressable testID="alttab-commit" accessibilityRole="button" accessibilityLabel={t("pad.altTab.commit")} disabled={disabled} onPress={onCommit} style={[styles.big, styles.commit, disabled && styles.off]}>
          <AppText kind="heading" style={{ color: colors.accentText }}>
            {t("pad.altTab.commit")}
          </AppText>
        </Pressable>
      </View>
      <AppText kind="small" muted style={styles.title}>
        {t("pad.altTab.auto")}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.md },
  title: { textAlign: "center" },
  row: { flexDirection: "row", gap: spacing.sm },
  arrow: { flex: 1, minHeight: touch + 16, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  big: { flex: 1, minHeight: touch + 8, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  commit: { backgroundColor: colors.accent },
  off: { opacity: 0.4 },
});
