import type { Monitor } from "@proyecto-e/protocol";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText, Button, Notice } from "@/components/ui";
import { useLayout } from "@/layout/useLayout";
import { useSheetInsets } from "./useSheetInsets";
import type { ActionResult } from "@/screens/actions";
import { displayName } from "@/screens/display";
import { colors, radius, spacing, touch } from "@/theme";

/**
 * Hoja para elegir el orden de las pantallas prendidas, de izquierda a derecha, como en el escritorio.
 * Cada pantalla se mueve un lugar con las flechas; "Aplicar" se lo manda a la PC. Mismo estilo que RenameSheet.
 * Recibe solo las pantallas prendidas, ya en su orden actual.
 */
export function OrderSheet({
  monitors,
  onApply,
  onClose,
}: {
  monitors: Monitor[];
  onApply: (order: string[]) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  const inset = useSheetInsets();
  const original = monitors.map((m) => m.id);
  const [order, setOrder] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(monitors.map((m) => [m.id, m]));
  const changed = order.some((id, i) => id !== original[i]);

  const move = (from: number, delta: -1 | 1) =>
    setOrder((prev) => {
      const to = from + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });

  async function apply() {
    if (saving || !changed) return;
    setSaving(true);
    setError(null);
    const result = await onApply(order);
    if (result.ok) return onClose();
    setSaving(false);
    setError(result.error);
  }

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={() => {
        if (!saving) onClose();
      }}
      supportedOrientations={["portrait", "landscape"]}
    >
      <KeyboardAvoidingView behavior="padding" style={[styles.backdrop, isLandscape ? styles.center : styles.bottom, { paddingLeft: inset.left, paddingRight: inset.right }]}>
        <Pressable accessibilityLabel={t("common.cancel")} style={StyleSheet.absoluteFill} onPress={saving ? undefined : onClose} />
        <View testID="order-sheet" style={[styles.sheet, isLandscape ? styles.sheetCenter : styles.sheetBottom, !isLandscape && { paddingBottom: inset.bottom }]}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <AppText kind="heading">{t("screens.order.title")}</AppText>
            <AppText kind="small" muted>
              {t("screens.order.hint")}
            </AppText>
            <View style={styles.tiles}>
              {order.map((id, i) => {
                const m = byId.get(id)!;
                const moved = id !== original[i];
                return (
                  <View key={id} style={[styles.tile, moved && styles.tileMoved]}>
                    <AppText kind="title" style={{ color: colors.accent }}>
                      {`${i + 1}${m.primary ? " ★" : ""}`}
                    </AppText>
                    <AppText kind="small" muted numberOfLines={2} style={styles.tileName}>
                      {displayName(m)}
                    </AppText>
                    <View style={styles.arrows}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("screens.order.left", { name: displayName(m) })}
                        accessibilityState={{ disabled: i === 0 || saving }}
                        disabled={i === 0 || saving}
                        onPress={() => move(i, -1)}
                        style={[styles.arrow, (i === 0 || saving) && styles.arrowOff]}
                      >
                        <AppText decorative>◀</AppText>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("screens.order.right", { name: displayName(m) })}
                        accessibilityState={{ disabled: i === order.length - 1 || saving }}
                        disabled={i === order.length - 1 || saving}
                        onPress={() => move(i, 1)}
                        style={[styles.arrow, (i === order.length - 1 || saving) && styles.arrowOff]}
                      >
                        <AppText decorative>▶</AppText>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
            {error !== null && <Notice>{t(error)}</Notice>}
            <View style={styles.actions}>
              <Button kind="secondary" label={t("common.cancel")} onPress={onClose} disabled={saving} />
              <Button label={t(error !== null ? "screens.order.retry" : "screens.order.apply")} onPress={() => void apply()} disabled={!changed || saving} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  bottom: { justifyContent: "flex-end" },
  center: { justifyContent: "center", alignItems: "center" },
  sheet: { backgroundColor: colors.surface, padding: spacing.lg },
  sheetBottom: { borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4 },
  sheetCenter: { width: "70%", maxHeight: "92%", borderRadius: radius.lg },
  scroll: { gap: spacing.sm },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: 96,
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  tileMoved: { borderColor: colors.accent },
  tileName: { textAlign: "center", minHeight: 34 },
  arrows: { flexDirection: "row", gap: spacing.sm },
  arrow: {
    width: touch,
    height: touch,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowOff: { opacity: 0.35 },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", flexWrap: "wrap", marginTop: spacing.md },
});
