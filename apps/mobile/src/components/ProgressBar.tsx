import type { MediaTimeline } from "@proyecto-e/protocol";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { clockText, positionAt } from "@/audio/progress";
import { AppText } from "@/components/ui";
import { colors, spacing } from "@/theme";

/**
 * La barra de reproducción (boceto rediseño 01, D97): por dónde va y cuánto falta. La PC manda la posición de cuando armó el
 * mensaje (`receivedAt` = cuándo llegó al celu); mientras reproduce, la barra avanza sola una vez por segundo. No se anima
 * cuadro a cuadro ni se arrastra: solo muestra.
 */
export function ProgressBar({ timeline, playing, receivedAt, testID = "progress" }: { timeline: MediaTimeline; playing: boolean; receivedAt: number; testID?: string }) {
  const { t } = useTranslation();
  // El reloj corre solo, una vez por segundo. Cuando llega un estado nuevo (`receivedAt` más reciente que el último tic) la
  // cuenta arranca de cero: `positionAt` no deja que el tiempo transcurrido sea negativo. No se remonta ni se reinicia nada.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [playing]);

  const position = positionAt(timeline, playing, now - receivedAt);
  const at = clockText(position);
  const left = clockText(timeline.durationMs - position);
  const percent = Math.round((position / timeline.durationMs) * 1000) / 10;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("apps.progress.label", { at, total: clockText(timeline.durationMs) })}
      accessibilityValue={{ min: 0, max: Math.round(timeline.durationMs / 1000), now: Math.round(position / 1000) }}
      style={styles.row}
    >
      <AppText kind="data" decorative style={styles.time}>
        {at}
      </AppText>
      <View style={styles.track}>
        <View testID={`${testID}-fill`} style={[styles.fill, { width: `${percent}%` }]} />
      </View>
      <AppText kind="data" decorative style={[styles.time, styles.right]}>
        {`−${left}`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  time: { fontSize: 11, color: colors.muted, minWidth: 34 },
  right: { textAlign: "right" },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.text },
});
