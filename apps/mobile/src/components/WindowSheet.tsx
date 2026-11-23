import type { Monitor, WindowInfo } from "@proyecto-e/protocol";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { appsActions, type ActionResult } from "@/apps/actions";
import { AppIcon } from "@/components/AppIcon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { useMounted } from "@/useMounted";
import { colors, spacing } from "@/theme";

/** Acciones de una ventana de la PC (boceto apps-escenas 05, 06): a qué pantalla mandarla, traerla, maximizarla, cerrarla… */
export function WindowSheet({ window: w, monitors, onClose }: { window: WindowInfo; monitors: Monitor[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const mounted = useMounted();
  const enabled = monitors.filter((m) => m.enabled && m.index !== null).sort((a, b) => a.index! - b.index!);

  async function run(id: string, action: () => Promise<ActionResult>) {
    if (busy) return;
    setBusy(id);
    setError(null);
    const r = await action();
    if (!mounted.current) return; // la hoja ya se cerró (o es otra): la respuesta tardía no hace nada
    setBusy(null);
    if (r.ok) onClose();
    else setError(r.error);
  }

  const act = (id: Parameters<typeof appsActions.act>[1], label: string) => (
    <Button key={id} kind="secondary" label={label} onPress={() => void run(id, () => appsActions.act(w.id, id))} disabled={busy !== null} style={styles.action} />
  );
  const maximized = w.state === "maximized";
  const full = w.state === "fullscreen";

  return (
    <>
      <Sheet onClose={onClose} testID="window-sheet">
        <View style={styles.head}>
          <AppIcon iconKey={w.iconKey} name={w.app} size={36} />
          <View style={styles.grow}>
            <AppText kind="heading" numberOfLines={2}>
              {w.title}
            </AppText>
            <AppText kind="small" muted>
              {w.app}
            </AppText>
          </View>
        </View>
        {error && <Notice>{t(error)}</Notice>}
        {enabled.length > 0 && (
          <>
            <AppText kind="label" muted>
              {t("apps.window.moveTo")}
            </AppText>
            <View style={styles.chips}>
              {enabled.map((m) => {
                const here = w.monitorId === m.id;
                return (
                  <Button
                    key={m.id}
                    kind="secondary"
                    label={here ? t("apps.window.here", { n: m.index }) : m.nickname ? `${m.index} · ${m.nickname}` : String(m.index)}
                    onPress={() => void run(`move-${m.id}`, () => appsActions.moveTo(w.id, m.id))}
                    disabled={here || busy !== null}
                    style={styles.chip}
                  />
                );
              })}
            </View>
          </>
        )}
        <AppText kind="label" muted>
          {t("apps.window.window")}
        </AppText>
        <View style={styles.grid}>
          {act("focus", t("apps.window.focus"))}
          {act(maximized ? "restore" : "maximize", t(maximized ? "apps.window.restore" : "apps.window.maximize"))}
          {act("fullscreen", t(full ? "apps.window.exitFullscreen" : "apps.window.fullscreen"))}
          {act("minimize", t("apps.window.minimize"))}
        </View>
        <Button kind="secondary" label={t("apps.window.close")} onPress={() => setConfirmClose(true)} disabled={busy !== null} style={styles.danger} />
      </Sheet>
      {confirmClose && (
        <ConfirmDialog
          title={t("apps.window.closeTitle", { title: w.title })}
          detail={t("apps.window.closeDetail")}
          confirmLabel={t("apps.window.closeConfirm")}
          busy={busy !== null}
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false);
            void run("close", () => appsActions.act(w.id, "close"));
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  grow: { flex: 1 },
  chips: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  chip: { minHeight: 48, paddingHorizontal: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  action: { flexGrow: 1, minWidth: "45%" },
  danger: { marginTop: spacing.sm, borderColor: colors.danger, borderWidth: 1 },
});
