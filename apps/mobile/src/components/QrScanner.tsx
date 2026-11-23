import { CameraView } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";
import { boxFromScan, type Box } from "./qrBox";

/** Cuánto se ve el recuadro sobre el QR antes de entregar la lectura. */
const CONFIRM_DELAY_MS = 450;
const BOX_MARGIN = 8;

/**
 * Cámara que lee QR. `onBarcodeScanned` dispara muchas veces seguidas mientras el QR está a la vista:
 * solo se entrega la primera lectura, y recién después de mostrar un recuadro verde sobre el código
 * (si la cámara informa dónde está) para que se note que lo vio.
 */
export function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <View style={styles.box}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(result) => {
          const found = boxFromScan(result, BOX_MARGIN);
          if (found) setBox(found); // sigue al QR mientras se mueve
          if (done.current) return;
          done.current = true;
          timer.current = setTimeout(() => onScan(result.data), found ? CONFIRM_DELAY_MS : 0);
        }}
      />
      {box ? (
        <View
          pointerEvents="none"
          testID="qr-highlight"
          style={[styles.highlight, { left: box.x, top: box.y, width: box.width, height: box.height }]}
        />
      ) : (
        <View pointerEvents="none" style={styles.frame} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, minHeight: 200, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  frame: { width: "55%", aspectRatio: 1, borderWidth: 2, borderColor: colors.text, borderRadius: radius.md },
  highlight: {
    position: "absolute",
    borderWidth: 3,
    borderColor: colors.ok,
    borderRadius: radius.sm,
    backgroundColor: "rgba(63, 185, 80, 0.18)",
  },
});
