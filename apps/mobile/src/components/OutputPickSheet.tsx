import type { AudioState } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { audioActions } from "@/audio/actions";
import { outputIcon, outputLabel } from "@/audio/view";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { useMounted } from "@/useMounted";
import { colors, hairline, spacing, touch } from "@/theme";

/** Elegir la salida predeterminada desde el Inicio (boceto audio 08): las salidas activas, la actual con ✓. */
export function OutputPickSheet({ audio, onClose }: { audio: AudioState; onClose: () => void }) {
  const { t } = useTranslation();
  const mounted = useMounted();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const can = audio.available.defaultOutput;

  async function pick(id: string) {
    if (busy || !can) return;
    setBusy(id);
    setError(null);
    const r = await audioActions.setDefault(id);
    if (!mounted.current) return;
    setBusy(null);
    if (r.ok) onClose();
    else setError(r.error);
  }

  return (
    <Sheet onClose={onClose} testID="output-pick-sheet">
      <AppText kind="heading">{t("home.audio.pickTitle")}</AppText>
      {!can && <Notice tone="info">{t("audio.noDefaultNote")}</Notice>}
      {error && <Notice>{t(error)}</Notice>}
      {audio.outputs
        .filter((o) => o.state === "active")
        .map((o) => (
          <Pressable
            key={o.id}
            testID={`pick-output-${o.id}`}
            accessibilityRole="button"
            accessibilityLabel={outputLabel(o)}
            accessibilityState={{ selected: o.isDefault, disabled: !can || busy !== null }}
            disabled={!can || busy !== null}
            onPress={() => void pick(o.id)}
            style={[styles.row, !can && styles.off]}
          >
            <Ionicons name={outputIcon(o.kind)} size={22} color={colors.muted} />
            <View style={styles.grow}>
              <AppText>{outputLabel(o)}</AppText>
            </View>
            {busy === o.id ? <AppText kind="small" muted>{t("audio.changing")}</AppText> : o.isDefault ? <AppText style={{ color: colors.accent }}>✓</AppText> : null}
          </Pressable>
        ))}
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch, borderBottomWidth: hairline, borderColor: colors.border },
  off: { opacity: 0.5 },
  grow: { flex: 1 },
  actions: { flexDirection: "row", justifyContent: "flex-end", marginTop: spacing.sm },
});
