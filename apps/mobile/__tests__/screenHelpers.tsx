import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { PairedPc } from "@/connection/types";

const METRICS = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

export const renderScreen = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

/** ¿Algún contenedor por encima de este elemento acomoda a sus hijos en fila (apaisado)? */
export function hasRowAncestor(el: { parent: unknown }): boolean {
  let p = el.parent as { parent: unknown; props?: { style?: unknown } } | null;
  while (p) {
    const style = StyleSheet.flatten(p.props?.style as never) as { flexDirection?: string } | undefined;
    if (style?.flexDirection === "row") return true;
    p = p.parent as typeof p;
  }
  return false;
}

export const PC: PairedPc = {
  v: 2,
  host: "192.168.100.5",
  port: 47800,
  pcName: "PC-DE-JAY",
  pcPublicKey: "P".repeat(43),
  devicePrivateKey: "K".repeat(43),
  deviceId: "11111111-1111-4111-8111-111111111111",
  pairedAt: "2026-11-06T15:00:00.000Z",
};

export const SNAPSHOT = {
  hostname: "PC-DE-JAY",
  agentVersion: "0.1.0",
  uptimeSec: 8100, // 2 h 15 min
  cpuPercent: 23,
  memUsedBytes: 10_500_000_000, // 9,8 GB
  memTotalBytes: 17_179_869_184, // 16,0 GB
  sampledAt: 1_800_000_000_000,
};
