import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText, StatusDot } from "@/components/ui";
import type { ConnState } from "@/connection/machine";
import { colors, hairline, radius, spacing, touch } from "@/theme";

const DOT: Record<ConnState["status"], string> = {
  unpaired: colors.muted,
  pairing: colors.warn,
  connecting: colors.warn,
  online: colors.ok,
  reconnecting: colors.warn,
  offline: colors.muted,
};

/** La tarjeta de estado de B1 en una línea (boceto apps-escenas 01): nombre de la PC, CPU y RAM, o qué pasa con la conexión. */
export function StatusStrip({
  status,
  snapshot,
  lastError,
  pcName,
  onPress,
  onRetry,
}: Pick<ConnState, "status" | "snapshot" | "lastError"> & { pcName: string; onPress: () => void; onRetry: () => void }) {
  const { t } = useTranslation();
  const label = status === "online" || status === "reconnecting" || status === "offline" ? status : "connecting";
  const live = snapshot && status === "online";
  const detail = live
    ? `${t("status.cpu")} ${Math.round(snapshot.cpuPercent)} % · ${t("status.ram")} ${Math.round((snapshot.memUsedBytes / snapshot.memTotalBytes) * 100)} %`
    : status === "offline" && lastError
      ? t(lastError)
      : status === "offline"
        ? t("errors.unreachable")
        : t(`status.${label}`);
  return (
    <View style={styles.strip}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${pcName}, ${t("settings.title")}`} onPress={onPress} style={styles.main}>
        <StatusDot color={DOT[status]} />
        <AppText kind="small" numberOfLines={1} style={styles.name}>
          {pcName}
        </AppText>
        <AppText kind="data" muted numberOfLines={1} style={styles.detail}>
          {detail}
        </AppText>
      </Pressable>
      {status === "offline" && (
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.retry")} onPress={onRetry} style={styles.retry}>
          <AppText kind="small" style={{ color: colors.accent }}>
            {t("common.retry")}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", borderWidth: hairline, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, minHeight: touch - 8 },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touch - 8 },
  name: { fontFamily: "IBMPlexSans_600SemiBold" },
  detail: { flex: 1, textAlign: "right" },
  retry: { paddingLeft: spacing.md, minHeight: touch - 8, justifyContent: "center" },
});
