import type { Monitor, Zone } from "@proyecto-e/protocol";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { zoneFraction } from "@/apps/zonesPreview";
import { AppText, Button } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

const ZONES: Zone[] = ["keep", "full", "fullscreen", "left", "right", "top", "bottom", "tl", "tr", "bl", "br"];

/** Miniatura de una pantalla con la zona pintada (boceto apps-escenas 10 y 11). */
export function ZoneThumb({ zone, width = 64, height = 40 }: { zone: Zone; width?: number; height?: number }) {
  const f = zoneFraction(zone);
  return (
    <View style={[styles.thumb, { width, height }]}>
      {f && <View style={{ position: "absolute", left: f.x * width, top: f.y * height, width: f.w * width - 2, height: f.h * height - 2, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent, borderRadius: 2 }} />}
    </View>
  );
}

/** "Ubicar en": en qué pantalla y en qué zona queda la ventana (docs/PLAN.md D24). */
export function PlacePicker({
  monitors,
  monitorId,
  zone,
  onChange,
}: {
  monitors: Monitor[];
  monitorId: string | null;
  zone: Zone;
  onChange: (monitorId: string | null, zone: Zone) => void;
}) {
  const { t } = useTranslation();
  const sorted = [...monitors].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  const current = monitorId ?? sorted[0]?.id ?? null;
  return (
    <View style={styles.wrap}>
      <AppText kind="label" muted>
        {t("scenes.step.placeOn")}
      </AppText>
      {zone !== "keep" && (
        <View style={styles.chips}>
          {sorted.map((m) => (
            <Button
              key={m.id}
              kind={m.id === current ? "primary" : "secondary"}
              label={m.nickname ?? (m.index !== null ? `${m.index} · ${m.name}` : m.name)}
              onPress={() => onChange(m.id, zone)}
              style={styles.chip}
            />
          ))}
        </View>
      )}
      <View style={styles.zones}>
        {ZONES.map((z) => (
          <Pressable
            key={z}
            testID={`zone-${z}`}
            accessibilityRole="button"
            accessibilityLabel={t(`scenes.zone.${z}`)}
            accessibilityState={{ selected: z === zone }}
            onPress={() => onChange(z === "keep" ? null : current, z)}
            style={[styles.zone, z === zone && styles.zoneOn]}
          >
            <ZoneThumb zone={z} width={56} height={34} />
            <AppText kind="small" muted={z !== zone} numberOfLines={1} style={styles.zoneLabel}>
              {t(`scenes.zone.${z}`)}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 48, paddingHorizontal: spacing.md },
  zones: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  zone: { alignItems: "center", gap: 2, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: "transparent", width: 78 },
  zoneOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  zoneLabel: { fontSize: 11 },
  thumb: { borderWidth: 1.5, borderColor: colors.muted, borderRadius: 4, backgroundColor: colors.surfaceAlt },
});
