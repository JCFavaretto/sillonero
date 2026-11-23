import type { AppAudio, OutputInfo } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { appRouteLabel } from "@/audio/view";
import { AppIcon } from "@/components/AppIcon";
import { VolumeSlider } from "@/components/VolumeSlider";
import { AppText } from "@/components/ui";
import { colors, hairline, spacing, touch } from "@/theme";

/** Una app con sesión de audio (boceto audio 01 y 03): ícono, si suena, a qué salida va y su volumen. */
export function AudioAppRow({
  app,
  outputs,
  online = true,
  canRoute,
  players = [],
  onVolume,
  onToggleMute,
  onRoute,
}: {
  app: AppAudio;
  outputs: OutputInfo[];
  online?: boolean;
  /** La PC permite mandar apps a otra salida (D30). Sin eso se ve la salida pero sin ▾. */
  canRoute: boolean;
  /** Títulos de los reproductores de media de esta app (dos ventanas de Chrome = dos reproductores, un solo volumen). */
  players?: string[];
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
  onRoute: () => void;
}) {
  const { t } = useTranslation();
  const route = appRouteLabel(app, outputs);
  const text = route.kind === "fixed" ? t("audio.routeFixed", { name: route.label }) : t("audio.routeDefault", { name: route.label });
  return (
    <View testID={`audio-app-${app.id}`} style={styles.row}>
      <AppIcon iconKey={app.iconKey} name={app.name} size={36} />
      <View style={styles.grow}>
        <View style={styles.title}>
          <AppText numberOfLines={1}>{app.name}</AppText>
          {app.sounding && (
            <View testID={`sounding-${app.id}`} accessible accessibilityLabel={t("audio.sounding")} style={styles.sounding}>
              <AppText kind="small" decorative style={{ color: colors.ok }}>
                {`▮▮▮ ${t("audio.sounding")}`}
              </AppText>
            </View>
          )}
        </View>
        {canRoute ? (
          <Pressable testID={`route-${app.id}`} accessibilityRole="button" accessibilityLabel={t("audio.routeOf", { name: app.name })} disabled={!online} onPress={onRoute} style={[styles.route, route.kind === "fixed" && styles.routeFixed]}>
            <AppText kind="small" style={{ color: route.kind === "fixed" ? colors.accent : colors.text }}>{`${text} ▾`}</AppText>
          </Pressable>
        ) : (
          <AppText kind="small" muted>
            {text}
          </AppText>
        )}
        {players.length > 1 && (
          <AppText kind="small" muted numberOfLines={2}>
            {t("audio.players", { count: players.length, titles: players.join(" · ") })}
          </AppText>
        )}
        <View style={styles.slide}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(app.muted ? "audio.unmute" : "audio.mute", { name: app.name })}
            accessibilityState={{ selected: app.muted }}
            disabled={!online}
            onPress={onToggleMute}
            hitSlop={8}
            style={styles.mute}
          >
            <Ionicons name={app.muted ? "volume-mute" : "volume-low"} size={20} color={app.muted ? colors.danger : colors.muted} />
          </Pressable>
          <VolumeSlider sliderKey={`app:${app.id}`} value={app.volume} muted={app.muted} disabled={!online} label={t("audio.volumeOf", { name: app.name })} onChange={onVolume} testID={`slider-app-${app.id}`} />
          <AppText kind="data" muted decorative style={styles.num}>
            {app.volume}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: hairline, borderColor: colors.border },
  grow: { flex: 1, gap: 2 },
  title: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  // Se ve como un botón: Jay no lo encontraba cuando era texto gris suelto.
  route: { alignSelf: "flex-start", minHeight: touch - 8, justifyContent: "center", paddingHorizontal: spacing.md, marginVertical: 2, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  routeFixed: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  sounding: { borderRadius: 8, backgroundColor: "rgba(61,214,163,0.15)", paddingHorizontal: spacing.sm },
  slide: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mute: { width: 32, height: touch, alignItems: "center", justifyContent: "center" },
  num: { width: 30, textAlign: "right" },
});
