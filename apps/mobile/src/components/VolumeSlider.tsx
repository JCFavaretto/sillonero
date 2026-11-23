import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { createThrottle } from "@/audio/throttle";
import { useAudio } from "@/audio/store";
import { colors, touch } from "@/theme";

const SEND_MS = 100;
const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

interface Live {
  width: number;
  disabled: boolean;
  sliderKey: string;
  onChange: (volume: number) => void;
}

/**
 * Deslizador de volumen (0 a 100). Propio, sin módulos nativos (anda en Expo Go). Mientras se arrastra manda como mucho
 * un cambio cada 100 ms y el último al soltar (D38). Para TalkBack: "ajustable", con subir y bajar de a 5.
 */
export function VolumeSlider({
  sliderKey,
  value,
  label,
  muted = false,
  disabled = false,
  onChange,
  testID,
}: {
  /** `output:<id>` o `app:<id>`: ahí se guarda el valor local mientras se mueve (el `audio.update` de la PC no lo pisa). */
  sliderKey: string;
  /** El valor que dice la PC. */
  value: number;
  /** Para el lector de pantalla ("Volumen de Spotify"). */
  label: string;
  muted?: boolean;
  disabled?: boolean;
  onChange: (volume: number) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const local = useAudio((s) => s.dragging[sliderKey]);
  const drag = useAudio((s) => s.drag);
  const [width, setWidth] = useState(0);
  // El valor local manda mientras se mueve y 1,5 s después: un temporizador marca ese valor como vencido (nunca se lee el reloj al dibujar).
  const [expired, setExpired] = useState<unknown>(null);
  const live = useRef<Live>({ width: 0, disabled, sliderKey, onChange });
  useEffect(() => {
    live.current = { width, disabled, sliderKey, onChange };
  });
  useEffect(() => {
    if (!local) return;
    const id = setTimeout(() => setExpired(local), Math.max(0, local.until - Date.now()) + 1);
    return () => clearTimeout(id);
  }, [local]);

  // PanResponder y el throttle viven toda la vida del componente y leen el estado más nuevo por `live` desde sus callbacks (nunca al dibujar).
  /* eslint-disable react-hooks/refs */
  const [throttle] = useState(() => createThrottle<number>((v) => live.current.onChange(v), SEND_MS));
  useEffect(() => () => throttle.cancel(), [throttle]);

  const [pan] = useState(() => {
    const move = (x: number) => {
      const { width: w, disabled: off, sliderKey: k } = live.current;
      if (off || w <= 0) return;
      const v = clamp((x / w) * 100);
      useAudio.getState().drag(k, v, Date.now());
      throttle.push(v);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => move(e.nativeEvent.locationX),
      onPanResponderMove: (e) => move(e.nativeEvent.locationX),
      onPanResponderRelease: () => throttle.flush(),
      onPanResponderTerminate: () => throttle.flush(),
    });
  });
  /* eslint-enable react-hooks/refs */

  const shown = local && expired !== local ? local.value : value;

  const step = (delta: number) => {
    if (disabled) return;
    const v = clamp(shown + delta);
    drag(sliderKey, v, Date.now());
    onChange(v);
  };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: shown, text: t(muted ? "audio.volumeValueMuted" : "audio.volumeValue", { n: shown }) }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 5 : -5)}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.hit, disabled && styles.off]}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${shown}%`, backgroundColor: muted ? colors.muted : colors.accent }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${shown}%`, borderColor: muted ? colors.muted : colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // La zona que se toca mide `touch` de alto (48), la barra se dibuja finita en el medio.
  hit: { height: touch, justifyContent: "center", flex: 1 },
  off: { opacity: 0.35 },
  track: { height: 6, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6 },
  thumb: { position: "absolute", width: 20, height: 20, borderRadius: 10, marginLeft: -10, backgroundColor: colors.background, borderWidth: 2 },
});
