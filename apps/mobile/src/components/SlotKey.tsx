import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { DeckKey } from "@/apps/deck";
import { AppIcon } from "@/components/AppIcon";
import { iconFor } from "@/components/DeckKey";
import { AppText } from "@/components/ui";
import { colors, hairline, radius, spacing } from "@/theme";

/**
 * Una tecla de un deck (boceto rediseño 04 y 05): con imagen (fija o animada), con el ícono de su app o con el dibujo de su acción.
 * La imagen animada solo se mueve si `animate` (el deck a la vista, sin "reducir movimiento" y con el interruptor prendido).
 */
export function SlotKey({
  view,
  imageUri,
  animated,
  animate,
  state = "idle",
  editing = false,
  picked = false,
  disabled = false,
  aspectRatio = 1,
  onPress,
  onLongPress,
  onRemove,
  testID,
}: {
  view: DeckKey;
  imageUri: string | null;
  /** La imagen es un GIF o un WebP animado (se marca con "GIF"). */
  animated: boolean;
  animate: boolean;
  state?: "idle" | "running" | "error";
  editing?: boolean;
  /** Es la tecla que se está moviendo. */
  picked?: boolean;
  disabled?: boolean;
  aspectRatio?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  onRemove?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const label = view.labelKey ? t(view.labelKey) : view.label ? view.label : t("decks.unavailable");
  const sub = view.kind === "monitorToggle" && view.available ? t(view.on ? "home.deck.on" : "home.deck.off") : view.kind === "output" && view.available && view.on ? t("home.deck.isDefault") : null;
  const off = !view.available || (disabled && !editing);
  const hasImage = imageUri !== null;
  return (
    <View style={[styles.cell, { aspectRatio }]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={sub ? `${label}, ${sub}` : label}
        accessibilityState={{ disabled: off && !editing, busy: state === "running", selected: picked }}
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.key, state === "running" && styles.running, state === "error" && styles.error, picked && styles.picked, !view.available && styles.na, disabled && !editing && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.96 }] }]}
      >
        {hasImage ? (
          <>
            <Image testID="slot-image" source={{ uri: imageUri }} contentFit="cover" autoplay={animate} accessibilityIgnoresInvertColors style={StyleSheet.absoluteFill} />
            {label !== "" && <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.72)"]} style={styles.shade} pointerEvents="none" />}
          </>
        ) : view.kind === "launcher" ? (
          <AppIcon iconKey={view.iconKey} name={view.label ?? "?"} size={34} />
        ) : (
          <Ionicons name={iconFor(view)} size={26} color={state === "running" ? colors.accent : colors.muted} />
        )}
        {(label !== "" || !hasImage) && (
          <AppText kind="key" numberOfLines={2} style={[styles.label, hasImage && styles.labelOnImage]}>
            {label}
          </AppText>
        )}
        {sub && !hasImage && (
          <AppText kind="small" muted>
            {sub}
          </AppText>
        )}
        {animated && hasImage && (
          <View style={styles.tag} pointerEvents="none">
            <AppText kind="small" style={{ color: colors.accent }}>
              GIF
            </AppText>
          </View>
        )}
      </Pressable>
      {editing && (
        <Pressable testID={`${testID}-remove`} accessibilityRole="button" accessibilityLabel={t("home.edit.remove", { name: label })} onPress={onRemove} style={styles.x} hitSlop={14}>
          <Ionicons name="close" size={14} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

/** Un lugar vacío: un "+" con borde de rayas. */
export function EmptySlot({ n, aspectRatio = 1, onPress, disabled = false, testID }: { n: number; aspectRatio?: number; onPress: () => void; disabled?: boolean; testID?: string }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.cell, { aspectRatio }]}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={t("decks.emptyKey", { n })} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.key, styles.empty]}>
        <Ionicons name="add" size={24} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { flex: 1 },
  key: { flex: 1, borderRadius: radius.key, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: spacing.xs, padding: spacing.xs, overflow: "hidden" },
  empty: { borderStyle: "dashed", backgroundColor: "transparent", opacity: 0.8 },
  running: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  error: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  picked: { borderColor: colors.accent, borderWidth: 2 },
  na: { borderStyle: "dashed", opacity: 0.5 },
  label: { textAlign: "center", color: colors.text },
  labelOnImage: { position: "absolute", left: 4, right: 4, bottom: 4, textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 3 },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%" },
  tag: { position: "absolute", top: 4, right: 4, paddingHorizontal: 5, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.6)" },
  x: { position: "absolute", top: -6, left: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
});
