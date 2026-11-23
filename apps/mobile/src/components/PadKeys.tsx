import type { PadKey, PadMod } from "@proyecto-e/protocol";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText } from "@/components/ui";
import { MODS, type ModState } from "@/pad/mods";
import { colors, hairline, radius, spacing, touch } from "@/theme";

const REPEAT_KEYS = new Set<PadKey>(["left", "right", "up", "down", "backspace", "delete", "pageUp", "pageDown"]);
/** Mantener apretada una tecla de flecha o de borrar la repite: arranca a los 400 ms y va a 10 por segundo (bajo el tope de la PC). */
const REPEAT_AFTER_MS = 400;
const REPEAT_EVERY_MS = 100;

/** Una tecla. Las de flechas y borrar se repiten al mantenerlas. */
function Key({ id, onKey, disabled }: { id: PadKey; onKey: (k: PadKey) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const timers = useRef<{ start: ReturnType<typeof setTimeout> | null; rep: ReturnType<typeof setInterval> | null }>({ start: null, rep: null });
  const stop = () => {
    if (timers.current.start) clearTimeout(timers.current.start);
    if (timers.current.rep) clearInterval(timers.current.rep);
    timers.current = { start: null, rep: null };
  };
  useEffect(() => stop, []);
  const label = t(`pad.keys.${id}`);
  return (
    <Pressable
      testID={`key-${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPressIn={() => {
        onKey(id);
        if (REPEAT_KEYS.has(id)) {
          stop();
          timers.current.start = setTimeout(() => {
            timers.current.rep = setInterval(() => onKey(id), REPEAT_EVERY_MS);
          }, REPEAT_AFTER_MS);
        }
      }}
      onPressOut={stop}
      style={({ pressed }) => [styles.key, pressed && styles.pressed, disabled && styles.off]}
    >
      <AppText kind="data" style={styles.keyText}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function KeyRow({ keys, onKey, disabled = false }: { keys: readonly PadKey[]; onKey: (k: PadKey) => void; disabled?: boolean }) {
  return (
    <View style={styles.row}>
      {keys.map((k) => (
        <Key key={k} id={k} onKey={onKey} disabled={disabled} />
      ))}
    </View>
  );
}

/** Las teclas F1 a F12 en una fila que se desliza. */
export function FunctionRow({ onKey, disabled = false }: { onKey: (k: PadKey) => void; disabled?: boolean }) {
  const keys = Array.from({ length: 12 }, (_, i) => `f${i + 1}` as PadKey);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fRow}>
      {keys.map((k) => (
        <View key={k} style={styles.fKey}>
          <Key id={k} onKey={onKey} disabled={disabled} />
        </View>
      ))}
    </ScrollView>
  );
}

/** Ctrl, Alt, Shift y Win "enganchados": un toque = para la próxima tecla (ámbar); dos toques seguidos = fijo (con raya). */
export function ModRow({ mods, onToggle, disabled = false }: { mods: ModState; onToggle: (m: PadMod) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {MODS.map((m) => {
        const level = mods[m];
        const on = level !== "off";
        const label = t(`pad.mods.${m}`);
        return (
          <Pressable
            key={m}
            testID={`mod-${m}`}
            accessibilityRole="switch"
            accessibilityLabel={on && level === "locked" ? `${label}, ${t("pad.keyboard.modLocked")}` : label}
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={() => onToggle(m)}
            style={[styles.key, styles.mod, on && styles.modOn, disabled && styles.off]}
          >
            <AppText kind="data" style={[styles.keyText, { color: on ? colors.accentText : colors.muted, fontWeight: on ? "700" : "500" }]}>
              {label}
            </AppText>
            {level === "locked" && <View testID={`mod-${m}-locked`} style={styles.lockBar} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.xs + 1 },
  key: { flex: 1, minHeight: touch, alignItems: "center", justifyContent: "center", borderRadius: radius.sm + 1, backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
  keyText: { fontSize: 12 },
  pressed: { backgroundColor: colors.surfaceAlt },
  off: { opacity: 0.4 },
  mod: { overflow: "hidden" },
  modOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  lockBar: { position: "absolute", left: 6, right: 6, bottom: 4, height: 3, borderRadius: 2, backgroundColor: colors.accentText },
  fRow: { gap: spacing.xs + 1 },
  fKey: { width: 56 },
});
