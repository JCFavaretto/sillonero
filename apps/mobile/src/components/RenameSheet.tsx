import { MONITOR_NICKNAME_MAX, type Monitor } from "@proyecto-e/protocol";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText, Button, Notice } from "@/components/ui";
import type { ActionResult } from "@/screens/actions";
import { useLayout } from "@/layout/useLayout";
import { useSheetInsets } from "./useSheetInsets";
import { resolutionText } from "@/screens/display";
import { colors, radius, spacing, touch, type } from "@/theme";

/**
 * Hoja para ponerle apodo a una pantalla. En vertical sube desde abajo; en apaisado es un cuadro
 * centrado (el teclado ocupa media pantalla). Montarla solo cuando hay una pantalla elegida.
 */
export function RenameSheet({
  monitor,
  onSave,
  onClear,
  onClose,
}: {
  monitor: Monitor;
  /** Contesta cuando la PC confirmó (o no). La hoja se cierra sola si salió bien. */
  onSave: (nickname: string) => Promise<ActionResult>;
  onClear: () => Promise<ActionResult>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  const inset = useSheetInsets();
  const [text, setText] = useState(monitor.nickname ?? "");
  const [saving, setSaving] = useState(false);
  /** Clave de i18n del último error; la hoja se queda abierta para reintentar sin perder lo escrito. */
  const [error, setError] = useState<string | null>(null);
  const value = text.trim();
  const canSave = value.length > 0 && value !== (monitor.nickname ?? "");
  const res = resolutionText(monitor);

  async function run(action: () => Promise<ActionResult>) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await action();
    if (result.ok) return onClose();
    setSaving(false);
    setError(result.error);
  }

  return (
    // Mientras guarda no se cierra: si la PC falla, el error tiene que verse.
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
      {/* "padding" en las dos plataformas: dentro de un Modal de Android el teclado no achica la ventana. */}
      <KeyboardAvoidingView behavior="padding" style={[styles.backdrop, isLandscape ? styles.center : styles.bottom, { paddingLeft: inset.left, paddingRight: inset.right }]}>
        <Pressable accessibilityLabel={t("common.cancel")} style={StyleSheet.absoluteFill} onPress={saving ? undefined : onClose} />
        <View testID="rename-sheet" style={[styles.sheet, isLandscape ? styles.sheetCenter : styles.sheetBottom, !isLandscape && { paddingBottom: inset.bottom }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <AppText kind="heading">{t("screens.rename.title")}</AppText>
          <AppText kind="small" muted>
            {t("screens.rename.detail", { res: res ?? "?", connector: t(`screens.connector.${monitor.connector}`) })}
          </AppText>
          <View style={styles.fieldRow}>
            <TextInput
              autoFocus
              value={text}
              onChangeText={setText}
              maxLength={MONITOR_NICKNAME_MAX}
              placeholder={monitor.name}
              placeholderTextColor={colors.muted}
              selectionColor={colors.accent}
              style={styles.field}
              returnKeyType="done"
              accessibilityLabel={t("screens.rename.title")}
              disableFullscreenUI
              onSubmitEditing={() => canSave && void run(() => onSave(value))}
              editable={!saving}
            />
            <AppText kind="small" muted>
              {t("screens.rename.count", { n: text.length })}
            </AppText>
          </View>
          {error !== null && <Notice>{t(error)}</Notice>}
          <View style={styles.actions}>
            {monitor.nickname !== null && (
              <Button
                kind="secondary"
                label={t("screens.rename.clear")}
                onPress={() => void run(onClear)}
                disabled={saving}
                style={styles.clear}
              />
            )}
            <Button kind="secondary" label={t("common.cancel")} onPress={onClose} disabled={saving} />
            <Button
              label={t(error !== null ? "screens.rename.retry" : "screens.rename.save")}
              onPress={() => void run(() => onSave(value))}
              disabled={!canSave || saving}
            />
          </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.sm },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  bottom: { justifyContent: "flex-end" },
  center: { justifyContent: "center", alignItems: "center" },
  sheet: { backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm },
  sheetBottom: { borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4 },
  sheetCenter: { width: "62%", maxHeight: "92%", borderRadius: radius.lg },
  fieldRow: { gap: spacing.xs, marginTop: spacing.sm, alignItems: "flex-end" },
  field: {
    ...type.body,
    alignSelf: "stretch",
    minHeight: touch,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", flexWrap: "wrap", marginTop: spacing.md },
  clear: { marginRight: "auto" },
});
