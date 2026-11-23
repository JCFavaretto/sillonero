import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { DeckKey as Key } from "@/apps/deck";
import { AppIcon } from "@/components/AppIcon";
import { AppText } from "@/components/ui";
import { colors, hairline, radius, spacing } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;
/** El ícono de una tecla de audio según su contenido (anterior, play, siguiente, volumen). */
export function iconFor(k: Key): IconName {
  const item = k.item;
  if (item.kind === "media") return item.key === "prev" ? "play-skip-back" : item.key === "next" ? "play-skip-forward" : "play";
  if (item.kind === "volume") return item.delta > 0 ? "volume-high" : "volume-low";
  return KIND_ICON[k.kind];
}

const KIND_ICON: Record<Key["kind"], IconName> = {
  scene: "play",
  launcher: "apps",
  monitorToggle: "desktop",
  bringAll: "albums",
  identify: "eye",
  media: "musical-notes",
  volume: "volume-medium",
  mute: "volume-mute",
  output: "headset",
  sound: "musical-note",
};

/** Una tecla del Inicio o de los lanzadores (boceto apps-escenas 01, 02, 07). */
export function DeckKey({
  deckKey,
  state = "idle",
  editing = false,
  canMoveLeft = false,
  canMoveRight = false,
  disabled = false,
  onPress,
  onLongPress,
  onRemove,
  onMove,
  testID,
}: {
  deckKey: Key;
  state?: "idle" | "running" | "error";
  editing?: boolean;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onRemove?: () => void;
  onMove?: (dir: -1 | 1) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  // Una tecla con nombre propio (la salida desconectada, con su apodo) lo conserva aunque esté gris.
  const label = deckKey.labelKey ? t(deckKey.labelKey) : deckKey.label ? deckKey.label : t("home.deck.unavailable");
  const sub =
    deckKey.kind === "monitorToggle" && deckKey.available
      ? t(deckKey.on ? "home.deck.on" : "home.deck.off")
      : deckKey.kind === "output" && deckKey.available && deckKey.on
        ? t("home.deck.isDefault")
        : null;
  const off = !deckKey.available || disabled;
  return (
    <View style={styles.cell}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={sub ? `${label}, ${sub}` : label}
        accessibilityState={{ disabled: off && !editing, busy: state === "running" }}
        onPress={editing ? undefined : onPress}
        onLongPress={editing ? undefined : onLongPress}
        style={({ pressed }) => [
          styles.key,
          state === "running" && styles.running,
          state === "error" && styles.error,
          !deckKey.available && styles.na,
          pressed && !editing && { transform: [{ scale: 0.96 }] },
          disabled && { opacity: 0.45 },
        ]}
      >
        {deckKey.kind === "launcher" ? (
          <AppIcon iconKey={deckKey.iconKey} name={deckKey.label ?? "?"} size={34} />
        ) : (
          <Ionicons name={iconFor(deckKey)} size={26} color={state === "running" ? colors.accent : colors.muted} />
        )}
        <AppText kind="key" numberOfLines={2} style={styles.label}>
          {label}
        </AppText>
        {sub && (
          <AppText kind="small" muted>
            {sub}
          </AppText>
        )}
      </Pressable>
      {editing && (
        <>
          <Pressable testID={`${testID}-remove`} accessibilityRole="button" accessibilityLabel={t("home.edit.remove", { name: label })} onPress={onRemove} style={styles.x} hitSlop={8}>
            <Ionicons name="close" size={14} color="#fff" />
          </Pressable>
          <View style={styles.moves}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("home.edit.moveLeft", { name: label })} disabled={!canMoveLeft} onPress={() => onMove?.(-1)} style={[styles.move, !canMoveLeft && styles.dis]} hitSlop={6}>
              <Ionicons name="chevron-back" size={16} color={colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t("home.edit.moveRight", { name: label })} disabled={!canMoveRight} onPress={() => onMove?.(1)} style={[styles.move, !canMoveRight && styles.dis]} hitSlop={6}>
              <Ionicons name="chevron-forward" size={16} color={colors.text} />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { flex: 1, aspectRatio: 1 },
  key: {
    flex: 1,
    borderRadius: radius.key,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.xs,
  },
  running: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  error: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  na: { borderStyle: "dashed", opacity: 0.5 },
  label: { textAlign: "center", color: colors.text },
  x: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  moves: { position: "absolute", left: 4, right: 4, bottom: 3, flexDirection: "row", justifyContent: "space-between" },
  move: { width: 28, height: 24, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  dis: { opacity: 0.3 },
});

/** El botón vacío "+ Agregar" de las grillas. */
/** `accessibilityLabel`: cuando en la pantalla hay más de un "Agregar", el lector de pantalla dice cuál es. */
export function AddKey({ label, onPress, testID, accessibilityLabel }: { label: string; onPress: () => void; testID?: string; accessibilityLabel?: string }) {
  return (
    <View style={styles.cell}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={[styles.key, { borderStyle: "dashed" }]}>
        <Ionicons name="add" size={26} color={colors.muted} />
        <AppText kind="key" muted>
          {label}
        </AppText>
      </Pressable>
    </View>
  );
}
