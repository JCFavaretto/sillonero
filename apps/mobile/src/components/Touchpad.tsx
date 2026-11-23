import { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { AppText } from "@/components/ui";
import type { PadController } from "@/pad/controller";
import { padFx } from "@/pad/fx";
import { ownTouches } from "@/pad/touches";
import { colors, motion, radius, spacing, type } from "@/theme";

const GLOW = 150;
const DOT = 34;
const RING = 58;
const CLICK_MS = 160;

const toPoints = (e: GestureResponderEvent) => ownTouches(e.nativeEvent);

/**
 * La superficie del touchpad (boceto pad 01): una plancha con grilla de puntos y una luz ámbar que aparece debajo del dedo.
 * Los dedos van al controlador tal cual; lo único que anima es la marca del dedo (sigue 1:1, sin curva), el anillo del clic y el
 * borde del arrastre. Solo transform y opacity, en el hilo de UI.
 */
export function Touchpad({
  controller,
  latency,
  slow,
  disabled = false,
  dragging = false,
  hint = true,
  compact = false,
  onA11yClick,
}: {
  controller: PadController;
  /** "18 ms", o "140 ms · Wi-Fi lento". */
  latency: string;
  slow: boolean;
  disabled?: boolean;
  dragging?: boolean;
  /** Las tres líneas de ayuda (se esconden en la tira del teclado). */
  hint?: boolean;
  compact?: boolean;
  /** TalkBack: el toque de un dedo explora en vez de llegar al touchpad, así que el clic va por acciones. */
  onA11yClick?: (button: "left" | "right") => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [drag, setDrag] = useState(false);
  const live = useRef({ controller, disabled });
  useEffect(() => {
    live.current = { controller, disabled };
  });

  const x1 = useSharedValue(0);
  const y1 = useSharedValue(0);
  const o1 = useSharedValue(0);
  const x2 = useSharedValue(0);
  const y2 = useSharedValue(0);
  const o2 = useSharedValue(0);
  const ringO = useSharedValue(0);
  const ringS = useSharedValue(0.9);

  const mark = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches;
    const a = ts[0];
    const b = ts[1];
    if (a) {
      x1.set(a.locationX);
      y1.set(a.locationY);
      o1.set(1);
    } else {
      o1.set(withTiming(0, { duration: motion.fast }));
    }
    if (b) {
      x2.set(b.locationX);
      y2.set(b.locationY);
      o2.set(1);
    } else {
      o2.set(withTiming(0, { duration: motion.fast }));
    }
  };

  useEffect(
    () =>
      padFx.subscribe((fx) => {
        if (fx === "dragStart") setDrag(true);
        else if (fx === "dragEnd") setDrag(false);
        else if (fx === "click") {
          ringO.set(1);
          ringS.set(0.9);
          ringO.set(withTiming(0, { duration: CLICK_MS }));
          if (!reduce) ringS.set(withTiming(1.15, { duration: CLICK_MS }));
        }
      }),
    [reduce, ringO, ringS],
  );

  /* eslint-disable react-hooks/refs */
  const [pan] = useState(() => {
    const send = (e: GestureResponderEvent) => {
      if (live.current.disabled) return;
      mark(e);
      live.current.controller.touches(toPoints(e));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: send,
      onPanResponderStart: send,
      onPanResponderMove: send,
      onPanResponderEnd: send,
      onPanResponderRelease: (e) => {
        mark(e);
        live.current.controller.touches([]);
      },
      onPanResponderTerminate: () => {
        o1.set(0);
        o2.set(0);
        live.current.controller.cancel();
      },
    });
  });
  /* eslint-enable react-hooks/refs */

  const glow1 = useAnimatedStyle(() => ({ opacity: o1.value, transform: [{ translateX: x1.value - GLOW / 2 }, { translateY: y1.value - GLOW / 2 }] }));
  const dot1 = useAnimatedStyle(() => ({ opacity: o1.value, transform: [{ translateX: x1.value - DOT / 2 }, { translateY: y1.value - DOT / 2 }] }));
  const dot2 = useAnimatedStyle(() => ({ opacity: o2.value, transform: [{ translateX: x2.value - DOT / 2 }, { translateY: y2.value - DOT / 2 }] }));
  const ring = useAnimatedStyle(() => ({ opacity: ringO.value, transform: [{ translateX: x1.value - RING / 2 }, { translateY: y1.value - RING / 2 }, { scale: ringS.value }] }));

  const holding = drag || dragging;

  return (
    <View
      testID="touchpad"
      accessible
      accessibilityLabel={t("pad.surface.label")}
      accessibilityHint={t("pad.surface.a11yHint")}
      accessibilityActions={[
        { name: "activate", label: t("pad.click.left") },
        { name: "rightclick", label: t("pad.click.right") },
      ]}
      onAccessibilityAction={(e) => onA11yClick?.(e.nativeEvent.actionName === "rightclick" ? "right" : "left")}
      onLayout={(_e: LayoutChangeEvent) => undefined}
      style={[styles.surface, compact && styles.compact, holding && styles.holding, disabled && styles.off]}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={styles.tagLeft}>
        <AppText kind="label" muted style={styles.tagText} decorative>
          {t("pad.tabs.touchpad")}
        </AppText>
      </View>
      <View testID="pad-latency" pointerEvents="none" style={styles.tagRight}>
        <AppText kind="label" style={[styles.tagText, { color: slow ? colors.warn : colors.muted }]} decorative>
          {latency}
        </AppText>
      </View>
      {hint && (
        <View pointerEvents="none" style={styles.hint}>
          <AppText kind="small" muted style={styles.hintText}>
            {t("pad.surface.hint")}
          </AppText>
        </View>
      )}
      <Animated.View pointerEvents="none" style={[styles.glow, glow1]} />
      <Animated.View pointerEvents="none" style={[styles.dot, holding && styles.dotHeld, dot1]} />
      <Animated.View pointerEvents="none" style={[styles.dot, dot2]} />
      <Animated.View pointerEvents="none" style={[styles.ring, ring]} />
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    minHeight: 120,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    backgroundColor: "#1C1B22",
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  compact: { flex: 0, height: 84, minHeight: 84, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  holding: { borderColor: colors.accent },
  off: { opacity: 0.35 },
  tagLeft: { position: "absolute", top: spacing.sm, left: spacing.md },
  tagRight: { position: "absolute", top: spacing.sm, right: spacing.md },
  tagText: { ...type.label, fontSize: 9 },
  hint: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  hintText: { textAlign: "center", lineHeight: 22 },
  glow: { position: "absolute", left: 0, top: 0, width: GLOW, height: GLOW, borderRadius: GLOW / 2, backgroundColor: "rgba(245,165,36,0.20)" },
  dot: { position: "absolute", left: 0, top: 0, width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderColor: "rgba(245,165,36,0.85)", backgroundColor: "rgba(245,165,36,0.12)" },
  dotHeld: { backgroundColor: colors.accent, borderColor: colors.ember },
  ring: { position: "absolute", left: 0, top: 0, width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2, borderColor: "rgba(245,165,36,0.5)" },
});
