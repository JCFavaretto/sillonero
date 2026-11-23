import { useRouter } from "expo-router";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { DecksSettings } from "@/components/DecksSettings";
import { AppText, Button, Card, Notice, Screen } from "@/components/ui";
import { client, useConn } from "@/connection";
import { formatDate } from "@/format";
import { useLayout } from "@/layout/useLayout";
import { spacing, touch } from "@/theme";

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isLandscape } = useLayout();
  const pc = useConn((s) => s.pc);
  const online = useConn((s) => s.status === "online");

  const confirmForget = () => {
    if (!pc) return;
    Alert.alert(t("settings.forget"), t("settings.forgetConfirm", { pc: pc.pcName }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("settings.forget"), style: "destructive", onPress: () => client.forget() },
    ]);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} style={styles.back}>
          <AppText kind="title">‹</AppText>
        </Pressable>
        <AppText kind="title">{t("settings.title")}</AppText>
      </View>

      <View style={[styles.columns, isLandscape && styles.row]}>
        <View style={styles.column}>
          <AppText kind="label" muted>
            {t("settings.connection")}
          </AppText>
          <Card>
            <AppText kind="heading">{pc?.pcName}</AppText>
            {pc && (
              <>
                <AppText kind="small" muted>
                  {t("settings.address", { host: pc.host, port: pc.port })}
                </AppText>
                <AppText kind="small" muted>
                  {t("settings.pairedOn", { date: pc.pairedAt ? formatDate(pc.pairedAt) : "—" })}
                </AppText>
              </>
            )}
            <Button label={t("settings.forget")} kind="secondary" onPress={confirmForget} />
          </Card>
        </View>
        <View style={styles.column}>
          <DecksSettings />
          <Notice tone="info">{t(online ? "settings.forgetNoteOnline" : "settings.forgetNote")}</Notice>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  back: { minWidth: touch, minHeight: touch, alignItems: "center", justifyContent: "center" },
  columns: { gap: spacing.lg },
  row: { flexDirection: "row" },
  column: { flex: 1, gap: spacing.sm },
});
