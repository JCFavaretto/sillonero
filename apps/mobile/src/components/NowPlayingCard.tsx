import type { MediaKey, MediaState } from "@proyecto-e/protocol";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useArt } from "@/audio/art";
import { AppText } from "@/components/ui";
import { colors, hairline, radius, spacing, touch } from "@/theme";

const GLYPH: Record<MediaKey, string> = { prev: "⏮", playPause: "⏯", next: "⏭" };

/** La carátula de lo que suena: la imagen, la ruedita mientras llega, o la inicial de la app si no hay. */
function Art({ artKey, name }: { artKey: string | null; name: string }) {
  const { uri, loading } = useArt(artKey);
  if (uri) return <Image testID="media-art" accessibilityIgnoresInvertColors source={{ uri }} style={styles.art} resizeMode="cover" />;
  return (
    <View testID={loading ? "media-art-loading" : "media-art-fallback"} style={[styles.art, styles.artEmpty]}>
      <AppText kind="heading" muted decorative={loading}>
        {loading ? "…" : (name.trim()[0] ?? "?").toUpperCase()}
      </AppText>
    </View>
  );
}

/** "Ahora suena" (boceto audio 01 y 07): carátula, tema, ⏮ ⏯ ⏭ y a qué app van los botones. */
export function NowPlayingCard({
  media,
  online = true,
  onKey,
  onPickApp,
}: {
  media: MediaState;
  online?: boolean;
  onKey: (key: MediaKey) => void;
  onPickApp: () => void;
}) {
  const { t } = useTranslation();
  const target = media.sessions.find((s) => s.id === media.targetId) ?? null;
  if (!target) {
    return (
      <View testID="now-empty" style={styles.card}>
        <AppText kind="heading">{t("audio.nothing.title")}</AppText>
        <AppText kind="small" muted>
          {t("audio.nothing.detail")}
        </AppText>
      </View>
    );
  }
  const playing = target.status === "playing";
  return (
    <View testID="now-playing" style={styles.card}>
      <View style={styles.top}>
        <Art artKey={target.artKey} name={target.app} />
        <View style={styles.grow}>
          <AppText kind="heading" numberOfLines={2}>
            {target.title || t("audio.untitled")}
          </AppText>
          <AppText kind="small" muted numberOfLines={1}>
            {[target.artist, target.app].filter(Boolean).join(" · ")}
          </AppText>
        </View>
      </View>
      <View style={styles.controls}>
        {(["prev", "playPause", "next"] as const).map((k) => {
          const enabled = online && target.controls[k];
          const label = k === "playPause" ? t(playing ? "audio.pause" : "audio.play") : t(`home.deck.media.${k}`);
          return (
            <Pressable
              key={k}
              testID={`media-${k}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: !enabled }}
              disabled={!enabled}
              onPress={() => onKey(k)}
              style={[styles.btn, k === "playPause" && styles.main, !enabled && styles.off]}
            >
              <AppText decorative style={k === "playPause" ? { color: colors.accentText } : undefined}>
                {k === "playPause" ? (playing ? "⏸" : "▶") : GLYPH[k]}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        testID="media-pick"
        accessibilityRole="button"
        accessibilityLabel={t(media.chosen ? "audio.media.goesTo" : "audio.media.goesToAuto", { name: target.app })}
        disabled={!online}
        onPress={onPickApp}
        style={[styles.chip, media.chosen && styles.chipOn]}
      >
        <AppText kind="small" style={{ color: media.chosen ? colors.accent : colors.muted }}>
          {t(media.chosen ? "audio.media.goesTo" : "audio.media.goesToAuto", { name: target.app })}
          {" ▾"}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface },
  top: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  grow: { flex: 1, gap: 2 },
  art: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  artEmpty: { alignItems: "center", justifyContent: "center", borderWidth: hairline, borderColor: colors.border },
  controls: { flexDirection: "row", justifyContent: "center", gap: spacing.lg },
  btn: { width: touch, height: touch, borderRadius: touch / 2, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  main: { backgroundColor: colors.accent },
  off: { opacity: 0.3 },
  chip: { alignSelf: "center", borderRadius: 24, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: touch, justifyContent: "center" },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
});
