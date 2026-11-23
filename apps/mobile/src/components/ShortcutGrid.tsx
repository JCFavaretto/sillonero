import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText, Notice } from "@/components/ui";
import { tap } from "@/haptics";
import type { ActionResult } from "@/pad/actions";
import { SHORTCUT_GROUPS, type ShortcutId } from "@/pad/shortcuts";
import { colors, hairline, radius, spacing, touch } from "@/theme";

/**
 * La grilla fija de atajos (boceto pad 04), por grupos. Cada tecla dice qué hace y la combinación en mono ámbar. Al tocar se
 * ilumina 160 ms (llegó); si la PC contesta con error se pone roja y abajo dice por qué. Alt+Tab abre su propio panel.
 */
export function ShortcutGrid({
  columns,
  disabled = false,
  onShortcut,
  onAltTab,
}: {
  columns: number;
  disabled?: boolean;
  onShortcut: (id: Exclude<ShortcutId, "altTab">) => Promise<ActionResult>;
  onAltTab: () => void;
}) {
  const { t } = useTranslation();
  const [hit, setHit] = useState<string | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const press = async (id: ShortcutId) => {
    tap();
    if (id === "altTab") return onAltTab();
    setBad(null);
    setError(null);
    setHit(id);
    timers.current.push(setTimeout(() => setHit((h) => (h === id ? null : h)), 160));
    const r = await onShortcut(id);
    if (!r.ok) {
      setHit(null);
      setBad(id);
      setError(r.error);
      timers.current.push(setTimeout(() => setBad((b) => (b === id ? null : b)), 1000));
    }
  };

  return (
    <ScrollView testID="shortcuts" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {SHORTCUT_GROUPS.map((g) => (
        <View key={g.id}>
          <AppText kind="label" muted style={styles.group}>
            {t(`pad.shortcuts.groups.${g.id}`)}
          </AppText>
          <View style={styles.grid}>
            {g.items.map((i) => (
              <Pressable
                key={i.id}
                testID={`shortcut-${i.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${t(`pad.shortcuts.${i.id}`)}, ${i.combo}`}
                disabled={disabled}
                onPress={() => void press(i.id)}
                style={[styles.cell, { width: `${100 / columns - 2}%` }, hit === i.id && styles.hit, bad === i.id && styles.bad, disabled && styles.off]}
              >
                <AppText kind="small" muted style={styles.name} numberOfLines={2}>
                  {t(`pad.shortcuts.${i.id}`)}
                </AppText>
                <AppText kind="data" style={styles.combo}>
                  {i.combo}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {error && <Notice live>{t(error)}</Notice>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.lg },
  group: { marginTop: spacing.xs, marginBottom: spacing.xs, fontSize: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, rowGap: spacing.sm },
  cell: { minHeight: touch + 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  hit: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  bad: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  off: { opacity: 0.4 },
  name: { fontSize: 11, textAlign: "center" },
  combo: { color: colors.accent, fontSize: 11, marginTop: 2 },
});
