import type { Monitor } from "@proyecto-e/protocol";
import { useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText } from "@/components/ui";
import { displayName, resolutionText } from "@/screens/display";
import { mapLayout } from "@/screens/mapLayout";
import { colors, radius, spacing } from "@/theme";

/** Anchos mínimos (dp) para que entren el apodo y la resolución dentro de la ficha. */
const SHOW_NAME = 70;
const SHOW_RES = 100;

/**
 * Mapa a escala de las pantallas. Tocar una ficha la elige; toque largo: renombrar.
 * La ventana activa se dibuja dentro de la pantalla donde está (el agente no manda su tamaño: es un recuadro de referencia).
 */
export function ScreensMap({
  monitors,
  height,
  selectedId,
  activeMonitorId,
  onSelect,
  onLongPress,
}: {
  monitors: Monitor[];
  height: number;
  selectedId: string | null;
  /** La pantalla donde está la ventana activa, si hay una. */
  activeMonitorId: string | null;
  onSelect: (m: Monitor) => void;
  onLongPress?: (m: Monitor) => void;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(280);
  const items = mapLayout(monitors, { width, height });
  const byId = new Map(monitors.map((m) => [m.id, m]));

  return (
    <View
      testID="map-box"
      style={[styles.box, { height }]}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(1, Math.round(e.nativeEvent.layout.width)))}
    >
      {items.map((it) => {
        const m = byId.get(it.id);
        if (!m) return null;
        const selected = m.id === selectedId;
        const res = resolutionText(m);
        return (
          <Pressable
            key={it.id}
            testID={`map-mon-${it.id}`}
            accessibilityRole="button"
            accessibilityLabel={displayName(m)}
            accessibilityState={{ selected }}
            onPress={() => onSelect(m)}
            onLongPress={onLongPress ? () => onLongPress(m) : undefined}
            style={[
              styles.mon,
              { left: it.left, top: it.top, width: it.width, height: it.height },
              it.off && styles.off,
              m.busy && styles.busy,
              selected && styles.selected,
            ]}
          >
            <AppText kind="heading" muted={it.off} style={styles.num}>
              {it.index ?? "–"}
            </AppText>
            {it.width >= SHOW_NAME ? (
              <AppText kind="small" muted numberOfLines={1} style={styles.name}>
                {displayName(m)}
              </AppText>
            ) : null}
            {it.width >= SHOW_RES && res ? (
              <AppText kind="small" muted numberOfLines={1} style={styles.name}>
                {res}
              </AppText>
            ) : null}
            {m.primary ? (
              <AppText kind="small" style={styles.tag}>
                {t("screens.primaryTag")}
              </AppText>
            ) : null}
            {m.id === activeMonitorId && m.enabled ? (
              <View testID={`map-window-${m.id}`} style={styles.window} pointerEvents="none" />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: "100%",
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mon: {
    position: "absolute",
    borderWidth: 2,
    borderRadius: 6,
    borderColor: colors.muted,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  off: { borderStyle: "dashed", backgroundColor: "transparent", borderColor: colors.border },
  busy: { borderColor: colors.warn },
  selected: { borderColor: colors.accent, borderWidth: 3 },
  num: { textAlign: "center" },
  name: { textAlign: "center", paddingHorizontal: spacing.xs },
  tag: { color: colors.accent, textAlign: "center" },
  window: {
    position: "absolute",
    left: "18%",
    top: "22%",
    width: "42%",
    height: "40%",
    borderWidth: 2,
    borderRadius: 3,
    borderColor: colors.ok,
    backgroundColor: "rgba(60,200,120,0.18)",
  },
});
