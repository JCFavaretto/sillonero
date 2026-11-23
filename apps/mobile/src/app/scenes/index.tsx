import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { appsActions } from "@/apps/actions";
import { useApps } from "@/apps/store";
import { RunSheet, stepSummary } from "@/components/RunSheet";
import { AppText, Button, Card, Notice, Screen } from "@/components/ui";
import { useConn } from "@/connection";
import { tap } from "@/haptics";
import { useLayout } from "@/layout/useLayout";
import { hotkeyText, monitorName } from "@/apps/sceneAuto";
import { useScreens } from "@/screens/store";
import { colors, radius, spacing } from "@/theme";

/** Lista de escenas (boceto apps-escenas 09): ▶ ejecuta, Editar abre el editor. Una sola escena corre a la vez. */
export default function ScenesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isLandscape } = useLayout();
  const online = useConn((s) => s.status) === "online";
  const library = useApps((s) => s.library);
  const run = useApps((s) => s.run);
  const monitors = useScreens((s) => s.monitors);
  const [showRun, setShowRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = run && !run.finished ? run.sceneId : null;
  const runScene = library?.scenes.find((s) => s.id === run?.sceneId) ?? null;

  async function play(id: string) {
    if (!online) return;
    tap();
    setError(null);
    setShowRun(true);
    const r = await appsActions.runScene(id);
    if (!r.ok && r.error !== "apps.error.sceneFailed") {
      setShowRun(false);
      setError(r.error === "apps.error.busy" ? t("scenes.busy", { name: library?.scenes.find((s) => s.id === running)?.name ?? "" }) : t(r.error));
    }
  }

  const list = (library?.scenes ?? []).map((s) => (
    <Card key={s.id} style={styles.card}>
      <Pressable testID={`play-${s.id}`} accessibilityRole="button" accessibilityLabel={t("scenes.play", { name: s.name })} disabled={!online} onPress={() => void play(s.id)} style={styles.main}>
        <View style={[styles.play, running === s.id && styles.playing]}>
          <AppText kind="key" style={{ color: running === s.id ? colors.accent : colors.text }}>
            {running === s.id ? "…" : "▶"}
          </AppText>
        </View>
        <View style={styles.grow}>
          <AppText numberOfLines={1}>{s.name}</AppText>
          <AppText kind="small" muted numberOfLines={2}>
            {t("scenes.summary", { count: s.steps.length, first: stepSummary(s.steps[0]!, t) })}
          </AppText>
          {(s.hotkey || s.trigger) && (
            <View style={styles.badges}>
              {s.hotkey && (
                <View style={styles.badge}>
                  <AppText kind="small" muted>
                    {hotkeyText(s.hotkey)}
                  </AppText>
                </View>
              )}
              {s.trigger && (
                <View style={styles.badge}>
                  <AppText kind="small" muted>
                    {s.trigger.type === "agentStart"
                      ? t("scenes.trigger.agentStartBadge")
                      : monitors.length === 0
                        ? t("scenes.trigger.displayOnBadgeLoading")
                        : t("scenes.trigger.displayOnBadge", { name: monitorName(monitors, s.trigger.displayId, (n) => t("apps.window.onScreen", { n })) ?? t("scenes.step.unknownScreen") })}
                  </AppText>
                </View>
              )}
            </View>
          )}
        </View>
      </Pressable>
      <Button kind="secondary" label={t("scenes.edit")} onPress={() => router.push(`/scenes/${s.id}`)} disabled={!online} style={styles.edit} />
    </Card>
  ));

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} style={styles.back}>
          <AppText kind="title" style={{ color: colors.accent }}>
            ‹
          </AppText>
        </Pressable>
        <AppText kind="title" style={styles.grow}>
          {t("scenes.title")}
        </AppText>
        <Button label={t("scenes.new")} onPress={() => router.push("/scenes/new")} disabled={!online} style={styles.small} />
      </View>
      {error && <Notice>{error}</Notice>}
      {library === null ? (
        <AppText kind="small" muted>
          {t(online ? "home.loading" : "home.waiting")}
        </AppText>
      ) : library.scenes.length === 0 ? (
        <View testID="scenes-empty" style={styles.empty}>
          <AppText kind="heading">{t("scenes.empty.title")}</AppText>
          <AppText kind="small" muted style={styles.center}>
            {t("scenes.empty.detail")}
          </AppText>
          <Button label={t("scenes.empty.button")} onPress={() => router.push("/scenes/new")} disabled={!online} />
        </View>
      ) : isLandscape ? (
        <View style={styles.cols}>
          <View style={styles.grow}>{list.filter((_, i) => i % 2 === 0)}</View>
          <View style={styles.grow}>{list.filter((_, i) => i % 2 === 1)}</View>
        </View>
      ) : (
        list
      )}
      {showRun && runScene && run && (
        <RunSheet
          scene={runScene}
          run={run}
          onClose={() => setShowRun(false)}
          onEdit={() => {
            setShowRun(false);
            router.push(`/scenes/${runScene.id}`);
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  grow: { flex: 1 },
  small: { minHeight: 48, paddingHorizontal: spacing.lg },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  play: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  playing: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  edit: { minHeight: 48, paddingHorizontal: spacing.md },
  cols: { flexDirection: "row", gap: spacing.md },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: 4 },
  badge: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  empty: { alignItems: "center", gap: spacing.sm, padding: spacing.xl },
  center: { textAlign: "center" },
});
