import { Pressable, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/Sheet";
import { AppText, Button } from "@/components/ui";
import { DEFAULT_SETTINGS, SCROLL_RANGE, SENSITIVITY_RANGE, type PadSettings } from "@/pad/controller";
import { colors, radius, spacing, touch } from "@/theme";

const STEP = 0.2;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Un valor con − y + (más simple y más fácil de acertar con el pulgar que un deslizador). */
function Stepper({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  const set = (v: number) => onChange(round1(Math.min(max, Math.max(min, v))));
  return (
    <View style={styles.row}>
      <View style={styles.grow}>
        <AppText kind="body">{label}</AppText>
      </View>
      <Pressable testID={`${id}-less`} accessibilityRole="button" accessibilityLabel={`${label}: ${t("pad.settings.less")}`} onPress={() => set(value - STEP)} style={styles.step}>
        <AppText kind="heading">−</AppText>
      </Pressable>
      <View testID={`${id}-value`} accessible accessibilityLabel={t("pad.settings.value", { label, value })} style={styles.value}>
        <AppText kind="data" style={styles.valueText}>
          {value.toFixed(1)}
        </AppText>
      </View>
      <Pressable testID={`${id}-more`} accessibilityRole="button" accessibilityLabel={`${label}: ${t("pad.settings.more")}`} onPress={() => set(value + STEP)} style={styles.step}>
        <AppText kind="heading">+</AppText>
      </Pressable>
    </View>
  );
}

function Toggle({ id, label, detail, value, onChange }: { id: string; label: string; detail?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.grow}>
        <AppText kind="body">{label}</AppText>
        {detail && (
          <AppText kind="small" muted>
            {detail}
          </AppText>
        )}
      </View>
      <Switch testID={id} accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.text} />
    </View>
  );
}

/** Ajustes del pad (boceto pad 05): pocos, los que cambian cómo se siente. Se guardan en el celu. */
export function PadSettingsSheet({ settings, onChange, onClose }: { settings: PadSettings; onChange: (patch: Partial<PadSettings>) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet onClose={onClose} testID="pad-settings">
      <AppText kind="heading">{t("pad.settings.title")}</AppText>
      <Stepper id="sens" label={t("pad.settings.cursor")} value={settings.sensitivity} min={SENSITIVITY_RANGE.min} max={SENSITIVITY_RANGE.max} onChange={(v) => onChange({ sensitivity: v })} />
      <Stepper id="scroll" label={t("pad.settings.scroll")} value={settings.scrollSpeed} min={SCROLL_RANGE.min} max={SCROLL_RANGE.max} onChange={(v) => onChange({ scrollSpeed: v })} />
      <Toggle id="natural" label={t("pad.settings.natural")} detail={t("pad.settings.naturalDetail")} value={settings.naturalScroll} onChange={(v) => onChange({ naturalScroll: v })} />
      <Toggle id="vibrate" label={t("pad.settings.vibrate")} value={settings.vibrateClick} onChange={(v) => onChange({ vibrateClick: v })} />
      <Toggle id="awake" label={t("pad.settings.awake")} value={settings.keepAwake} onChange={(v) => onChange({ keepAwake: v })} />
      <View style={styles.actions}>
        <Button kind="secondary" label={t("pad.settings.reset")} onPress={() => onChange({ ...DEFAULT_SETTINGS })} style={styles.grow} />
        <Button label={t("pad.settings.done")} onPress={onClose} style={styles.grow} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touch, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.xs },
  grow: { flex: 1 },
  step: { width: touch, height: touch, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  value: { minWidth: 36, alignItems: "center" },
  valueText: { textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
});
