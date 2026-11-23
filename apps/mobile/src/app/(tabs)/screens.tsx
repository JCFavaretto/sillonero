import type { Monitor } from "@proyecto-e/protocol";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { OrderSheet } from "@/components/OrderSheet";
import { RenameSheet } from "@/components/RenameSheet";
import { ScreenPanel } from "@/components/ScreenPanel";
import { ScreensMap } from "@/components/ScreensMap";
import { AppText, Button, Notice, Screen, StatusDot } from "@/components/ui";
import { client, useConn } from "@/connection";
import { useLayout } from "@/layout/useLayout";
import { screensActions, screensCapabilities } from "@/screens/actions";
import { useScreens } from "@/screens/store";
import { colors, spacing } from "@/theme";

export default function ScreensTab() {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  const status = useConn((s) => s.status);
  const monitors = useScreens((s) => s.monitors);
  const foreground = useScreens((s) => s.foreground);
  const error = useScreens((s) => s.error);
  const demo = useScreens((s) => s.demo);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Monitor | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const online = status === "online";
  /** Las pantallas prendidas, en su orden de izquierda a derecha (el que numera la PC). */
  const enabledMonitors = monitors.filter((m) => m.enabled && m.index !== null).sort((a, b) => a.index! - b.index!);
  const orderingNow = ordering && enabledMonitors.length >= 2;
  /** La pantalla que se está renombrando, tal como está ahora; si desapareció (se desenchufó) la hoja se cierra. */
  const renamingNow = renaming ? (monitors.find((m) => m.id === renaming.id) ?? null) : null;
  const can = screensCapabilities(demo);
  /** La elegida; si no hay (o se desenchufó): donde está la ventana activa, si no la principal, si no la primera. */
  const selected =
    monitors.find((m) => m.id === selectedId) ??
    monitors.find((m) => m.id === foreground?.monitorId) ??
    monitors.find((m) => m.primary) ??
    monitors[0] ??
    null;

  const header = (
    <View style={styles.header}>
      <AppText kind="title">{t("screens.title")}</AppText>
      {!online ? (
        <View style={styles.state}>
          <StatusDot color={status === "offline" ? colors.muted : colors.warn} />
          <AppText kind="small" muted>
            {t(`status.${status === "unpaired" || status === "pairing" ? "offline" : status}`)}
          </AppText>
        </View>
      ) : null}
    </View>
  );

  const map = (
    <View style={styles.block}>
      <ScreensMap
        monitors={monitors}
        height={isLandscape ? 200 : 210}
        selectedId={selected?.id ?? null}
        activeMonitorId={foreground?.monitorId ?? null}
        onSelect={(m) => setSelectedId(m.id)}
        onLongPress={online && can.rename ? setRenaming : undefined}
      />
      {online && can.rename && monitors.length > 0 && (
        <AppText kind="small" muted>
          {t("screens.hint")}
        </AppText>
      )}
    </View>
  );
  const panel = selected ? (
    <ScreenPanel
      monitor={selected}
      foreground={foreground}
      online={online}
      can={can}
      canOrder={enabledMonitors.length >= 2}
      identifying={identifying}
      onToggle={(on) => void screensActions.setEnabled(selected.id, on)}
      onSendHere={() => void screensActions.moveActive(selected.id)}
      onIdentify={() => {
        setIdentifying(true);
        void screensActions.identify().finally(() => setIdentifying(false));
      }}
      onRename={() => setRenaming(selected)}
      onOrder={() => setOrdering(true)}
    />
  ) : null;

  return (
    <Screen>
      {header}
      {error && <Notice>{t(error)}</Notice>}
      {isLandscape ? (
        <View style={styles.columns}>
          <View style={styles.mapColumn}>{map}</View>
          <View style={styles.column}>{panel}</View>
        </View>
      ) : (
        <>
          {map}
          {panel}
        </>
      )}
      {status === "offline" && <Button kind="primary" label={t("common.retry")} onPress={() => client.retry()} />}
      {orderingNow && (
        <OrderSheet
          key={enabledMonitors.map((m) => m.id).join()}
          monitors={enabledMonitors}
          onApply={(order) => screensActions.setOrder(order)}
          onClose={() => setOrdering(false)}
        />
      )}
      {renamingNow && (
        <RenameSheet
          monitor={renamingNow}
          onClose={() => setRenaming(null)}
          onSave={(nickname) => screensActions.rename(renamingNow.id, nickname)}
          onClear={() => screensActions.rename(renamingNow.id, null)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  state: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  columns: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" },
  mapColumn: { flex: 1.3 },
  column: { flex: 1, gap: spacing.md },
  block: { gap: spacing.sm },
});
