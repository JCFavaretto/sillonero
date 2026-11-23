import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { OutputInfo, Scene } from "@proyecto-e/protocol";
import { outputLabel } from "@/audio/view";
import { Sheet } from "@/components/Sheet";
import { AppText, Button } from "@/components/ui";
import type { RunState, RunStep } from "@/apps/store";
import { colors, radius, spacing } from "@/theme";

/** Qué hace cada paso, en palabras (lo usan el progreso y el editor). */
export function stepSummary(step: Scene["steps"][number], t: (k: string, o?: Record<string, unknown>) => string, outputs: Pick<OutputInfo, "id" | "nick" | "name">[] = []): string {
  if (step.kind === "screens") return t("scenes.step.screensSummary", { count: step.monitors.length });
  if (step.kind === "bringAll") return t("scenes.step.bringAll");
  if (step.kind === "audio") {
    const o = outputs.find((x) => x.id === step.outputId);
    return [t("scenes.step.audioSummary", { name: o ? outputLabel(o) : "?" }), step.makeDefault && t("scenes.step.audioDefault"), step.volume !== null && t("scenes.step.audioVolume", { vol: step.volume })].filter(Boolean).join(" · ");
  }
  return t(step.target.kind === "app" ? "scenes.step.openApp" : "scenes.step.openLink", { name: step.name });
}

const TONE: Record<RunStep, { bg: string; fg: string }> = {
  wait: { bg: colors.surfaceAlt, fg: colors.muted },
  running: { bg: colors.accentSoft, fg: colors.accent },
  ok: { bg: "rgba(61,214,163,0.15)", fg: colors.ok },
  partial: { bg: colors.accentSoft, fg: colors.accent },
  failed: { bg: colors.dangerBg, fg: colors.danger },
  skipped: { bg: colors.surfaceAlt, fg: colors.muted },
};

/** Progreso de una escena paso por paso (boceto apps-escenas 09, B y C). Ocultar no la frena: sigue en la PC. */
export function RunSheet({ scene, run, onClose, onEdit }: { scene: Scene; run: RunState; onClose: () => void; onEdit: () => void }) {
  const { t } = useTranslation();
  const problems = run.finished && run.steps.some((s) => s === "failed" || s === "partial" || s === "skipped");
  const title = !run.finished ? scene.name : problems ? t("scenes.run.problems", { name: scene.name }) : t("scenes.run.done", { name: scene.name });
  return (
    <Sheet onClose={onClose} testID="run-sheet">
      <AppText kind="heading">{title}</AppText>
      {scene.steps.map((step, i) => {
        const status = run.steps[i] ?? "wait";
        const reason = run.reasons[i];
        return (
          <View key={i} style={styles.step} testID={`run-step-${i}`}>
            <View style={styles.line}>
              <AppText kind="body" style={styles.text}>
                {stepSummary(step, t)}
              </AppText>
              <View style={[styles.pill, { backgroundColor: TONE[status].bg }]}>
                <AppText kind="small" style={{ color: TONE[status].fg }}>
                  {t(`scenes.run.status.${status}`)}
                </AppText>
              </View>
            </View>
            {reason && (status === "failed" || status === "partial") && (
              <AppText kind="small" muted>
                {t(`apps.error.${reason}`)}
              </AppText>
            )}
          </View>
        );
      })}
      <View style={styles.actions}>
        {problems && <Button kind="secondary" label={t("scenes.run.edit")} onPress={onEdit} />}
        <Button label={run.finished ? t("scenes.run.ok") : t("scenes.run.hide")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  step: { gap: 2, paddingVertical: spacing.xs },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  text: { flex: 1 },
  pill: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", marginTop: spacing.md },
});
