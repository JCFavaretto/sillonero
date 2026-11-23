import type { AppAudio, OutputInfo } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { audioActions, type ActionResult } from "@/audio/actions";
import { outputIcon, outputLabel } from "@/audio/view";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { useMounted } from "@/useMounted";
import { colors, hairline, spacing, touch } from "@/theme";

/**
 * Mandar una app a una salida (boceto audio 03). Solo salidas activas; la actual con ✓; "Seguir a la predeterminada" lo deshace.
 * Windows lo guarda por app: la nota lo dice.
 */
export function RouteSheet({ app, outputs, onClose }: { app: AppAudio; outputs: OutputInfo[]; onClose: () => void }) {
  const { t } = useTranslation();
  const mounted = useMounted();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const def = outputs.find((o) => o.isDefault);

  async function pick(id: string, outputId: string | null) {
    if (busy) return;
    setBusy(id);
    setError(null);
    const r: ActionResult = await audioActions.route(app.id, outputId);
    if (!mounted.current) return;
    setBusy(null);
    if (r.ok) onClose();
    else setError(r.error);
  }

  const option = (id: string, label: string, icon: keyof typeof Ionicons.glyphMap, on: boolean, outputId: string | null) => (
    <Pressable
      key={id}
      testID={`route-opt-${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled: busy !== null }}
      disabled={busy !== null}
      onPress={() => void pick(id, outputId)}
      style={styles.row}
    >
      <Ionicons name={icon} size={22} color={colors.muted} />
      <View style={styles.grow}>
        <AppText>{label}</AppText>
      </View>
      {busy === id ? <AppText kind="small" muted>{t("audio.changing")}</AppText> : on ? <AppText style={{ color: colors.accent }}>✓</AppText> : null}
    </Pressable>
  );

  return (
    <Sheet onClose={onClose} testID="route-sheet">
      <AppText kind="heading">{t("audio.route.title", { name: app.name })}</AppText>
      {error && <Notice>{t(error)}</Notice>}
      {option("default", t("audio.route.follow", { name: def ? outputLabel(def) : "" }), "refresh", app.routed === null, null)}
      {outputs
        .filter((o) => o.state === "active")
        .map((o) => option(o.id, outputLabel(o), outputIcon(o.kind), app.routed === o.id, o.id))}
      <Notice tone="info">{t("audio.route.note")}</Notice>
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch, borderBottomWidth: hairline, borderColor: colors.border },
  grow: { flex: 1 },
  actions: { flexDirection: "row", justifyContent: "flex-end", marginTop: spacing.sm },
});
