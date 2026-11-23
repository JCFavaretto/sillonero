import * as Device from "expo-device";
import { useCameraPermissions } from "expo-camera";
import { useEffect, useState } from "react";
import { BackHandler, Linking, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { QrScanner } from "@/components/QrScanner";
import { AppText, Button, Notice, Screen } from "@/components/ui";
import { client, useConn } from "@/connection";
import type { PairedPc } from "@/connection/types";
import { useLayout } from "@/layout/useLayout";
import { loadAppsDemo } from "@/apps/demo";
import { loadAudioDemo } from "@/audio/demo";
import { loadBrowserDemo } from "@/browser/demo";
import { loadPadDemo } from "@/pad/demo";
import { loadScreensDemo } from "@/screens/demo";
import { spacing } from "@/theme";

/** Solo en desarrollo: muestra la app con una PC de mentira, sin agente. */
function showDemo() {
  const pc: PairedPc = {
    v: 2,
    host: "192.168.0.10",
    port: 47800,
    pcName: "DESKTOP-DEMO",
    pcPublicKey: "D".repeat(43),
    devicePrivateKey: "E".repeat(43),
    deviceId: "00000000-0000-4000-8000-000000000000",
    pairedAt: new Date().toISOString(),
  };
  loadScreensDemo();
  loadAppsDemo();
  loadBrowserDemo();
  loadAudioDemo();
  loadPadDemo();
  useConn.setState({
    status: "online",
    pc,
    lastError: null,
    snapshot: {
      hostname: "DESKTOP-DEMO",
      agentVersion: "0.1.0",
      uptimeSec: 8100,
      cpuPercent: 23,
      memUsedBytes: 10_500_000_000,
      memTotalBytes: 17_179_869_184,
      sampledAt: Date.now(),
    },
  });
}

export default function ConnectScreen() {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  const status = useConn((s) => s.status);
  const pairing = useConn((s) => s.pairing);
  const pcName = useConn((s) => s.pendingPair?.name ?? "");
  const lastError = useConn((s) => s.lastError);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [denied, setDenied] = useState(false);

  // "Atrás" de Android mientras se escanea cierra la cámara (no saca de la app).
  useEffect(() => {
    if (!scanning) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setScanning(false);
      return true;
    });
    return () => sub.remove();
  }, [scanning]);

  const startScan = async () => {
    let granted = permission?.granted ?? false;
    if (!granted) granted = (await requestPermission()).granted;
    setDenied(!granted);
    setScanning(granted);
  };

  const onScan = (text: string) => {
    setScanning(false);
    client.pair(text, Device.deviceName ?? "Android");
  };

  // 1) Emparejando: esperando a la PC
  if (status === "pairing") {
    const waitingPc = pairing?.phase === "waitingPc";
    return (
      <Screen scroll={false}>
        <View style={[styles.center, isLandscape && styles.row]}>
          <AppText kind="title" style={styles.icon} decorative>
            ⏳
          </AppText>
          <View style={styles.centerText}>
            <AppText kind="heading">{waitingPc ? t("connect.waitingPc") : t("status.connecting")}</AppText>
            {waitingPc && (
              <AppText kind="small" muted>
                {t("connect.waitingPcDetail", { pc: pcName })}
              </AppText>
            )}
            <Button label={t("common.cancel")} kind="secondary" onPress={() => client.cancelPair()} style={styles.gap} />
          </View>
        </View>
      </Screen>
    );
  }

  // 2) Escaneando
  if (scanning) {
    return (
      <Screen scroll={false}>
        <View style={styles.header}>
          <AppText kind="title">{t("connect.scanTitle")}</AppText>
          <Button label={t("common.cancel")} kind="secondary" onPress={() => setScanning(false)} />
        </View>
        <View style={[styles.scanBody, isLandscape && styles.row]}>
          <QrScanner onScan={onScan} />
          <AppText kind="small" muted style={styles.hint}>
            {t("connect.scanHint")}
          </AppText>
        </View>
      </Screen>
    );
  }

  // 3) Inicio: instrucciones
  return (
    <Screen>
      <AppText kind="title">{t("connect.title")}</AppText>
      <View style={[styles.cols, isLandscape && styles.row]}>
        <View style={styles.col}>
          <AppText>{t("connect.help")}</AppText>
          <Button label={t("connect.scan")} onPress={() => void startScan()} />
        </View>
        <View style={styles.col}>
          {lastError && <Notice>{t(lastError)}</Notice>}
          {denied && (
            <Notice>
              {t("connect.camera.denied")}
            </Notice>
          )}
          {denied && <Button label={t("connect.camera.openSettings")} kind="secondary" onPress={() => void Linking.openSettings()} />}
          <Notice tone="info">{t("connect.localOnly")}</Notice>
          {__DEV__ && <Button label={t("connect.demo")} kind="secondary" onPress={showDemo} />}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  centerText: { alignItems: "center", gap: spacing.xs },
  row: { flexDirection: "row" },
  icon: { fontSize: 44, lineHeight: 52 },
  gap: { marginTop: spacing.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scanBody: { flex: 1, gap: spacing.md },
  hint: { textAlign: "center" },
  cols: { gap: spacing.lg },
  col: { flex: 1, gap: spacing.md },
});
