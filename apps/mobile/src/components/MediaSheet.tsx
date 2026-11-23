import type { MediaState } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { audioActions } from "@/audio/actions";
import { AppIcon } from "@/components/AppIcon";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { useMounted } from "@/useMounted";
import { colors, hairline, spacing, touch } from "@/theme";

/**
 * A qué app van ⏮ ⏯ ⏭ (boceto audio 07): las apps de media activas, o "La que elija Windows". La elegida vive en la PC,
 * así que la tarjeta de Audio y las teclas del Inicio van a la misma.
 */
export function MediaSheet({ media, onClose }: { media: MediaState; onClose: () => void }) {
  const { t } = useTranslation();
  const mounted = useMounted();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(id: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await audioActions.selectMedia(id);
    if (!mounted.current) return;
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.error);
  }

  const current = media.sessions.find((s) => s.id === media.targetId);
  return (
    <Sheet onClose={onClose} testID="media-sheet">
      <AppText kind="heading">{t("audio.media.title")}</AppText>
      {error && <Notice>{t(error)}</Notice>}
      <Pressable testID="media-opt-auto" accessibilityRole="button" accessibilityState={{ selected: !media.chosen }} accessibilityLabel={t("audio.media.auto")} disabled={busy} onPress={() => void pick(null)} style={styles.row}>
        <Ionicons name="refresh" size={22} color={colors.muted} />
        <View style={styles.grow}>
          <AppText>{t("audio.media.auto")}</AppText>
          <AppText kind="small" muted>
            {t("audio.media.autoNow", { name: !media.chosen && current ? current.app : "…" })}
          </AppText>
        </View>
        {!media.chosen && <AppText style={{ color: colors.accent }}>✓</AppText>}
      </Pressable>
      {media.sessions.map((s, i) => (
        <Pressable
          key={`${s.id}-${i}`}
          testID={`media-opt-${s.id}`}
          accessibilityRole="button"
          accessibilityLabel={s.app}
          accessibilityState={{ selected: media.chosen && media.targetId === s.id }}
          disabled={busy}
          onPress={() => void pick(s.id)}
          style={styles.row}
        >
          <AppIcon iconKey={s.iconKey} name={s.app} size={36} />
          <View style={styles.grow}>
            <AppText>{s.app}</AppText>
            <AppText kind="small" muted numberOfLines={1}>
              {`${s.status === "playing" ? "▶" : "⏸"} ${[s.title, s.artist].filter(Boolean).join(" · ")}`}
            </AppText>
          </View>
          {media.chosen && media.targetId === s.id && <AppText style={{ color: colors.accent }}>✓</AppText>}
        </Pressable>
      ))}
      <AppText kind="small" muted>
        {t("audio.media.hint")}
      </AppText>
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch, paddingVertical: spacing.xs, borderBottomWidth: hairline, borderColor: colors.border },
  grow: { flex: 1 },
  actions: { flexDirection: "row", justifyContent: "flex-end", marginTop: spacing.sm },
});
