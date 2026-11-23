import type { AudioState } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { outputLabel } from "@/audio/view";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { colors, hairline, radius, spacing, touch } from "@/theme";

export interface SoundChoice {
  /** El nombre del archivo, sin la extensión (para rotular la tecla). */
  name: string;
  outputId: string;
  volume: number;
}

/**
 * Una tecla de sonido (boceto rediseño 06, F4a): se elige el archivo, la salida de la PC por donde suena y el volumen. "Probar"
 * lo toca ya; "Usar" crea la tecla. El archivo se guarda en el celu; la PC lo recibe la primera vez que suena.
 */
export function SoundSheet({
  audio,
  picked,
  error,
  testing,
  onPickFile,
  onTest,
  onUse,
  onClose,
}: {
  audio: AudioState | null;
  /** El nombre del archivo elegido, o `null` si todavía no hay. */
  picked: string | null;
  error: string | null;
  testing: boolean;
  onPickFile: () => void;
  onTest: (c: SoundChoice) => void;
  onUse: (c: SoundChoice) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const outputs = (audio?.outputs ?? []).filter((o) => o.state === "active");
  const [outputId, setOutputId] = useState<string | null>(outputs.find((o) => o.isDefault)?.id ?? outputs[0]?.id ?? null);
  const [volume, setVolume] = useState(50);
  const ready = picked !== null && outputId !== null;
  const choice = (): SoundChoice => ({ name: picked ?? "", outputId: outputId!, volume });
  const step = (d: number) => setVolume((v) => Math.min(100, Math.max(10, v + d)));
  return (
    <Sheet tall onClose={onClose} testID="sound-sheet">
      <AppText kind="heading">{t("decks.sound.title")}</AppText>
      {!audio?.available.audio && <Notice tone="info">{t("decks.sound.audioOff")}</Notice>}
      {error && <Notice>{t(error)}</Notice>}
      <AppText kind="label" muted>
        {t("decks.sound.file")}
      </AppText>
      <Pressable testID="sound-pick" accessibilityRole="button" accessibilityLabel={picked ? t("decks.sound.change", { name: picked }) : t("decks.sound.pick")} onPress={onPickFile} style={styles.row}>
        <Ionicons name="musical-notes" size={20} color={colors.accent} />
        <AppText style={styles.grow} numberOfLines={1}>
          {picked ?? t("decks.sound.pick")}
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>
      <AppText kind="label" muted>
        {t("decks.sound.output")}
      </AppText>
      {outputs.map((o) => (
        <Pressable key={o.id} testID={`sound-out-${o.id}`} accessibilityRole="radio" accessibilityLabel={outputLabel(o)} accessibilityState={{ selected: outputId === o.id }} onPress={() => setOutputId(o.id)} style={[styles.row, outputId === o.id && styles.on]}>
          <Ionicons name={outputId === o.id ? "radio-button-on" : "radio-button-off"} size={20} color={outputId === o.id ? colors.accent : colors.muted} />
          <AppText style={styles.grow} numberOfLines={1}>
            {outputLabel(o)}
          </AppText>
        </Pressable>
      ))}
      <AppText kind="label" muted>
        {t("decks.sound.volume")}
      </AppText>
      <View style={styles.vol}>
        <Pressable testID="sound-vol-less" accessibilityRole="button" accessibilityLabel={t("decks.sound.volLess")} accessibilityState={{ disabled: volume <= 10 }} disabled={volume <= 10} onPress={() => step(-10)} style={[styles.step, volume <= 10 && styles.dim]}>
          <Ionicons name="remove" size={20} color={colors.text} />
        </Pressable>
        <View testID="sound-vol-value" style={styles.grow}>
          <AppText kind="heading" style={styles.center}>{`${volume}`}</AppText>
        </View>
        <Pressable testID="sound-vol-more" accessibilityRole="button" accessibilityLabel={t("decks.sound.volMore")} accessibilityState={{ disabled: volume >= 100 }} disabled={volume >= 100} onPress={() => step(10)} style={[styles.step, volume >= 100 && styles.dim]}>
          <Ionicons name="add" size={20} color={colors.text} />
        </Pressable>
      </View>
      <AppText kind="small" muted>
        {t("decks.sound.note")}
      </AppText>
      <View style={styles.actions}>
        <Button testID="sound-close" kind="secondary" label={t("common.close")} onPress={onClose} />
        <Button testID="sound-test" kind="secondary" label={testing ? t("decks.sound.testing") : t("decks.sound.test")} disabled={!ready || testing} onPress={() => onTest(choice())} />
        <Button testID="sound-use" label={t("decks.sound.use")} disabled={!ready} onPress={() => onUse(choice())} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch + 4, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface },
  on: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  vol: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  step: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.3 },
  center: { textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
});
