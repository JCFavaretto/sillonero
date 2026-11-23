import type { AppAudio } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { isBrowser } from "@/apps/profiles";
import { audioActions } from "@/audio/actions";
import { VolumeSlider } from "@/components/VolumeSlider";
import { AppText } from "@/components/ui";
import { tap } from "@/haptics";
import { colors, spacing, touch } from "@/theme";

/**
 * El volumen de UNA app dentro de su tarjeta (boceto rediseño 01, D96): el ícono silencia esa app, la barra mueve su volumen
 * y el número lo dice. En un navegador aclara "todo chrome": Windows le da un solo volumen a todas sus ventanas.
 */
export function AppVolumeRow({ app, online, onError }: { app: AppAudio; online: boolean; onError: (error: string) => void }) {
  const { t } = useTranslation();
  const report = (r: { ok: true } | { ok: false; error: string }) => {
    if (!r.ok) onError(r.error);
  };
  const color = app.muted ? colors.danger : colors.accent;
  return (
    <View testID={`app-volume-${app.id}`} style={styles.row}>
      <Pressable
        testID={`app-mute-${app.id}`}
        accessibilityRole="button"
        accessibilityLabel={t(app.muted ? "audio.unmute" : "audio.mute", { name: app.name })}
        accessibilityState={{ disabled: !online }}
        disabled={!online}
        hitSlop={6}
        onPress={() => (tap(), void audioActions.setMute({ kind: "app", id: app.id }, !app.muted).then(report))}
        style={styles.mute}
      >
        <Ionicons name={app.muted ? "volume-mute" : "volume-medium"} size={20} color={color} />
      </Pressable>
      <VolumeSlider
        sliderKey={`app:${app.id}`}
        value={app.volume}
        muted={app.muted}
        disabled={!online}
        label={t("audio.volumeOf", { name: app.name })}
        onChange={(v) => void audioActions.setVolume({ kind: "app", id: app.id }, v).then(report)}
        testID={`slider-app-${app.id}`}
      />
      <AppText kind="data" decorative style={[styles.num, { color: app.muted ? colors.muted : colors.accent }]}>
        {app.volume}
      </AppText>
      {isBrowser(app.name) && (
        <AppText kind="small" muted>
          {t("apps.volume.shared", { name: app.name })}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touch },
  mute: { width: 36, height: touch, alignItems: "center", justifyContent: "center" },
  num: { minWidth: 26, textAlign: "right" },
});
