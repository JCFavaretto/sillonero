import type { OutputInfo } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { outputIcon, outputLabel } from "@/audio/view";
import { VolumeSlider } from "@/components/VolumeSlider";
import { AppText } from "@/components/ui";
import { colors, hairline, radius, spacing, touch } from "@/theme";

/** Una salida de audio (boceto audio 01): ícono, apodo, "predeterminada", volumen y silencio. Los tres puntos abren sus acciones. */
export function OutputRow({
  output: o,
  busy = false,
  online = true,
  onVolume,
  onToggleMute,
  onMenu,
}: {
  output: OutputInfo;
  busy?: boolean;
  online?: boolean;
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
  onMenu: () => void;
}) {
  const { t } = useTranslation();
  const name = outputLabel(o);
  const volume = o.state === "active" ? o.volume : null;
  const active = volume !== null;
  return (
    <View testID={`output-${o.id}`} style={[styles.row, !active && styles.gone, o.isDefault && styles.def]}>
      <View style={styles.icon}>
        <Ionicons name={outputIcon(o.kind)} size={22} color={o.isDefault ? colors.accent : colors.muted} />
      </View>
      <View style={styles.grow}>
        <View style={styles.title}>
          <AppText numberOfLines={1} style={styles.name}>
            {name}
          </AppText>
          {o.isDefault && (
            <View style={styles.chip}>
              <AppText kind="small" style={{ color: colors.accent }}>
                {t("audio.default")}
              </AppText>
            </View>
          )}
          {busy && <AppText kind="small" muted>{t("audio.changing")}</AppText>}
        </View>
        {active ? (
          <View style={styles.slide}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(o.muted ? "audio.unmute" : "audio.mute", { name })}
              accessibilityState={{ selected: o.muted }}
              disabled={!online}
              onPress={onToggleMute}
              hitSlop={8}
              style={styles.mute}
            >
              <Ionicons name={o.muted ? "volume-mute" : "volume-low"} size={20} color={o.muted ? colors.danger : colors.muted} />
            </Pressable>
            <VolumeSlider sliderKey={`output:${o.id}`} value={volume} muted={o.muted} disabled={!online} label={t("audio.volumeOf", { name })} onChange={onVolume} testID={`slider-output-${o.id}`} />
            <AppText kind="data" muted decorative style={styles.num}>
              {volume}
            </AppText>
          </View>
        ) : (
          <AppText kind="small" muted>
            {t("audio.unavailable")}
          </AppText>
        )}
      </View>
      <Pressable testID={`output-menu-${o.id}`} accessibilityRole="button" accessibilityLabel={t("audio.actionsOf", { name })} disabled={!online} onPress={onMenu} style={styles.menu}>
        <AppText decorative>⋯</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: hairline, borderColor: colors.border },
  def: { backgroundColor: colors.accentSoft },
  gone: { opacity: 0.55 },
  icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, gap: 2 },
  title: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  name: { flexShrink: 1 },
  chip: { borderRadius: 20, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  slide: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mute: { width: 32, height: touch, alignItems: "center", justifyContent: "center" },
  num: { width: 30, textAlign: "right" },
  menu: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
});
