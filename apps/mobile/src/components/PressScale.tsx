import type { ReactNode } from "react";
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { PRESS_SPRING } from "@/audio/motion";

/**
 * Un botón que se achica un poco mientras se aprieta (feedback al apretar, se confirma al soltar). El movimiento corre en el
 * hilo de UI. Con "reducir movimiento" no se achica. `style` va sobre lo que se mueve; el área táctil es la del hijo.
 */
export function PressScale({
  children,
  style,
  scale = 0.92,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style" | "children"> & { children: ReactNode; style?: StyleProp<ViewStyle>; scale?: number }) {
  const s = useSharedValue(1);
  const reduce = useReducedMotion();
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        if (!reduce) s.set(withSpring(scale, PRESS_SPRING));
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        s.set(withSpring(1, PRESS_SPRING));
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, a]}>{children}</Animated.View>
    </Pressable>
  );
}
