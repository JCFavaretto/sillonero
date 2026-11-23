import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { DUR } from "@/audio/motion";
import { PressScale } from "@/components/PressScale";
import { colors } from "@/theme";

/**
 * El botón de encendido (boceto audio 09): es el silencio de la salida. Prendido en ámbar; apagado en rojo. El borde y el brillo
 * se funden en 160 ms y el botón se achica un poco al apretarlo.
 */
export function PowerButton({ muted, size = 40, disabled = false, label, onPress }: { muted: boolean; size?: number; disabled?: boolean; label: string; onPress: () => void }) {
  const reduce = useReducedMotion();
  const off = useSharedValue(muted ? 1 : 0);
  useEffect(() => {
    off.set(reduce ? (muted ? 1 : 0) : withTiming(muted ? 1 : 0, { duration: DUR.state }));
  }, [muted, reduce, off]);
  const style = useAnimatedStyle(() => ({
    borderColor: interpolateColor(off.value, [0, 1], [colors.accent, colors.danger]),
    shadowColor: interpolateColor(off.value, [0, 1], [colors.accent, colors.danger]),
  }));
  return (
    <PressScale testID="card-power" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: muted, disabled }} disabled={disabled} onPress={onPress} hitSlop={6}>
      <Animated.View style={[styles.btn, { width: size, height: size, borderRadius: size / 2 }, style]}>
        <Ionicons name="power" size={Math.round(size * 0.46)} color={muted ? colors.danger : colors.accent} />
      </Animated.View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: "center", justifyContent: "center", backgroundColor: colors.background, borderWidth: 2, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
});
