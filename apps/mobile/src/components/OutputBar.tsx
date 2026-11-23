import type { AudioState } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { audioActions } from "@/audio/actions";
import { outputIcon, outputLabel } from "@/audio/view";
import { OutputPickSheet } from "@/components/OutputPickSheet";
import { PowerButton } from "@/components/PowerButton";
import { VolumeSlider } from "@/components/VolumeSlider";
import { AppText } from "@/components/ui";
import { tap } from "@/haptics";
import { colors, hairline, radius, spacing, touch } from "@/theme";

/**
 * El volumen general (el de la salida predeterminada), arriba de Apps: el botón de encendido la silencia, la barra mueve su
 * volumen y el botón de la derecha cambia de salida. Es la misma fila que tenía la tarjeta "Ahora" del Inicio (boceto
 * comodidad 01): se conserva para que el rediseño no saque nada de lo que ya se usaba (docs/PLAN.md 8.8.4, F1).
 */
export function OutputBar({ audio, online, onError }: { audio: AudioState; online: boolean; onError: (error: string) => void }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const report = (r: { ok: true } | { ok: false; error: string }) => {
    if (!r.ok) onError(r.error);
  };
  const def = audio.outputs.find((o) => o.isDefault && o.state === "active") ?? null;
  const name = def ? outputLabel(def) : "";
  return (
    <View testID="output-bar" style={[styles.bar, !online && styles.stale]}>
      {def && <PowerButton muted={def.muted} size={36} disabled={!online} label={t(def.muted ? "audio.unmute" : "audio.mute", { name })} onPress={() => (tap(), void audioActions.toggleMute().then(report))} />}
      <VolumeSlider
        sliderKey={`output:${def?.id ?? "none"}`}
        value={def?.volume ?? 0}
        muted={def?.muted ?? false}
        disabled={!online || !def}
        label={t("audio.volumeOf", { name })}
        onChange={(v) => def && void audioActions.setVolume({ kind: "output", id: def.id }, v).then(report)}
        testID={def ? `slider-output-${def.id}` : "slider-output-none"}
      />
      <AppText kind="data" decorative style={[styles.num, { color: def?.muted ? colors.muted : colors.accent }]}>
        {def?.volume ?? 0}
      </AppText>
      <Pressable
        testID="card-change-output"
        accessibilityRole="button"
        accessibilityLabel={def ? t("home.now.outputChange", { name }) : t("home.audio.noOutput")}
        accessibilityState={{ disabled: !online }}
        disabled={!online}
        onPress={() => setPicking(true)}
        style={styles.out}
      >
        <Ionicons name={def ? outputIcon(def.kind) : "volume-high"} size={18} color={colors.accent} />
        <Ionicons name="chevron-down" size={12} color={colors.accent} />
      </Pressable>
      {picking && <OutputPickSheet audio={audio} onClose={() => setPicking(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.lg, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface },
  stale: { opacity: 0.55 },
  num: { minWidth: 26, textAlign: "right" },
  out: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, minWidth: touch, minHeight: touch, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
});
