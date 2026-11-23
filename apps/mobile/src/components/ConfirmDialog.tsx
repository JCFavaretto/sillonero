import { View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/Sheet";
import { AppText, Button } from "@/components/ui";
import { colors, spacing } from "@/theme";

/** Cuadro de confirmación para lo que no tiene vuelta atrás (cerrar una ventana, quitar un lanzador, borrar una escena). */
export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet center onClose={busy ? () => undefined : onCancel} testID="confirm-dialog">
      <AppText kind="heading">{title}</AppText>
      <AppText kind="small" muted>
        {detail}
      </AppText>
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.cancel")} onPress={onCancel} disabled={busy} />
        <Button label={confirmLabel} onPress={onConfirm} disabled={busy} style={styles.danger} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", marginTop: spacing.md },
  danger: { backgroundColor: colors.danger },
});
