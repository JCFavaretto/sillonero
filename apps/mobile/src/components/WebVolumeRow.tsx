import type { TabMedia } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { browserActions } from "@/browser/actions";
import { VolumeSlider } from "@/components/VolumeSlider";
import { AppText } from "@/components/ui";
import { tap } from "@/haptics";
import { colors, spacing, touch } from "@/theme";

/**
 * El volumen del VIDEO de una pestaña (D99): el ícono lo silencia, la barra mueve el volumen del reproductor de la página.
 * No es el volumen de todo el navegador (ese lo comparten todas sus ventanas, D96): con la extensión se puede ser más fino.
 */
export function WebVolumeRow({ tabId, media, online, onError }: { tabId: number; media: TabMedia; online: boolean; onError: (error: string) => void }) {
  const { t } = useTranslation();
  const report = (r: { ok: true } | { ok: false; error: string }) => {
    if (!r.ok) onError(r.error);
  };
  const color = media.muted ? colors.danger : colors.accent;
  return (
    <View testID={`web-volume-${tabId}`} style={styles.row}>
      <Pressable
        testID={`web-mute-${tabId}`}
        accessibilityRole="button"
        accessibilityLabel={t(media.muted ? "apps.web.unmute" : "apps.web.mute")}
        accessibilityState={{ disabled: !online }}
        disabled={!online}
        hitSlop={6}
        onPress={() => (tap(), void browserActions.act({ op: "media.mute", tabId, muted: !media.muted }).then(report))}
        style={styles.mute}
      >
        <Ionicons name={media.muted ? "volume-mute" : "volume-medium"} size={20} color={color} />
      </Pressable>
      <VolumeSlider
        sliderKey={`tab:${tabId}`}
        value={media.volume}
        muted={media.muted}
        disabled={!online}
        label={t("apps.web.volume")}
        onChange={(v) => void browserActions.act({ op: "media.volume", tabId, volume: v }).then(report)}
        testID={`slider-tab-${tabId}`}
      />
      <AppText kind="data" decorative style={[styles.num, { color: media.muted ? colors.muted : colors.accent }]}>
        {media.volume}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touch },
  mute: { width: 36, height: touch, alignItems: "center", justifyContent: "center" },
  num: { minWidth: 26, textAlign: "right" },
});
