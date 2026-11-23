import type { Foreground, Monitor } from "@proyecto-e/protocol";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText, Button, Card } from "@/components/ui";
import { displayName, resolutionText } from "@/screens/display";
import { colors, spacing } from "@/theme";

/** Lo que se hace con la pantalla elegida: prender/apagar, mandarle la ventana activa, identificar, renombrar y ordenar. */
export function ScreenPanel({
  monitor: m,
  foreground,
  online,
  can,
  canOrder,
  identifying,
  onToggle,
  onSendHere,
  onIdentify,
  onRename,
  onOrder,
}: {
  monitor: Monitor;
  foreground: Foreground | null;
  online: boolean;
  can: { rename: boolean; toggle: boolean; move: boolean; order: boolean };
  /** Hay 2 o más pantallas prendidas. */
  canOrder: boolean;
  identifying: boolean;
  onToggle: (enabled: boolean) => void;
  onSendHere: () => void;
  onIdentify: () => void;
  onRename: () => void;
  onOrder: () => void;
}) {
  const { t } = useTranslation();
  const detail = [resolutionText(m), t(`screens.connector.${m.connector}`)].filter((x): x is string => Boolean(x)).join(" · ");
  const state = m.busy ? (m.enabled ? t("screens.turningOff") : t("screens.turningOn")) : null;
  const limit = m.enabled && m.blockedBy ? t(`screens.blocked.${m.blockedBy}`) : null;
  const switchBlocked = !online || !can.toggle || m.busy || !(m.enabled ? m.canDisable : true);
  const here = foreground?.monitorId === m.id;
  const sendBlocked = !online || !can.move || m.busy || !m.enabled || !foreground || here;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.titles}>
          <AppText kind="heading" numberOfLines={1}>
            {`${m.index ?? "–"} · ${displayName(m)}`}
          </AppText>
          <AppText kind="small" muted numberOfLines={1}>
            {[detail, !m.enabled ? t("screens.off") : null].filter(Boolean).join(" · ")}
          </AppText>
        </View>
        <Switch
          accessibilityLabel={displayName(m)}
          value={m.enabled}
          disabled={switchBlocked}
          onValueChange={onToggle}
          trackColor={{ false: colors.border, true: colors.ok }}
          thumbColor={colors.text}
        />
      </View>
      {state ? (
        <View style={styles.busy}>
          <ActivityIndicator size="small" color={colors.warn} />
          <AppText kind="small" muted>
            {state}
          </AppText>
        </View>
      ) : limit ? (
        <AppText kind="small" muted>
          {limit}
        </AppText>
      ) : null}

      <View style={styles.window}>
        <AppText kind="small" muted numberOfLines={1}>
          {foreground ? foreground.title : t("screens.noActiveWindow")}
        </AppText>
        {!foreground ? (
          <AppText kind="small" muted>
            {t("screens.noActiveWindowHint")}
          </AppText>
        ) : null}
        <Button
          kind="primary"
          label={here ? t("screens.alreadyHere") : t("screens.sendHere")}
          disabled={sendBlocked}
          onPress={onSendHere}
        />
      </View>

      <View style={styles.tools}>
        <Button kind="secondary" label={t("screens.identify")} onPress={onIdentify} disabled={!online || identifying} style={styles.tool} />
        {can.rename ? (
          <Button kind="secondary" label={t("screens.rename.button")} onPress={onRename} disabled={!online} style={styles.tool} />
        ) : null}
        {can.order && canOrder ? <Button kind="secondary" label={t("screens.order.button")} onPress={onOrder} disabled={!online} style={styles.tool} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  titles: { flex: 1 },
  busy: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  window: { gap: spacing.sm },
  tools: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tool: { paddingHorizontal: spacing.lg },
});
