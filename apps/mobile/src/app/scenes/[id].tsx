import type { Scene, SceneHotkey, SceneTrigger, Step } from "@proyecto-e/protocol";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { appsActions } from "@/apps/actions";
import { moveKey } from "@/apps/deck";
import { useApps } from "@/apps/store";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RunSheet, stepSummary } from "@/components/RunSheet";
import { useAudio } from "@/audio/store";
import { StepSheet } from "@/components/StepSheet";
import { HotkeySheet, TriggerSheet } from "@/components/SceneAutoSheets";
import { hotkeyText, monitorName, takenByScenes } from "@/apps/sceneAuto";
import { PlacePickerSummary } from "@/components/PlaceSummary";
import { AppText, Button, Notice, Screen } from "@/components/ui";
import { useConn } from "@/connection";
import { useLayout } from "@/layout/useLayout";
import { useScreens } from "@/screens/store";
import { MAX_STEPS } from "@proyecto-e/protocol";
import { colors, radius, spacing, touch, type } from "@/theme";

/**
 * Editor de escena (boceto apps-escenas 10 y 11): nombre, pasos en orden, Probar, Guardar y Borrar.
 * El cuerpo se arma una sola vez con la escena de la PC (`key`): si la biblioteca llega después de abrir el editor,
 * se vuelve a armar con lo que llegó.
 */
export default function SceneEditor() {
  const { id: param } = useLocalSearchParams<{ id: string }>();
  const library = useApps((s) => s.library);
  const saved = param === "new" ? null : (library?.scenes.find((s) => s.id === param) ?? null);
  return <EditorBody key={saved?.id ?? param} param={param} saved={saved} />;
}

function EditorBody({ param, saved }: { param: string; saved: Scene | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isLandscape } = useLayout();
  const isNew = param === "new";
  const online = useConn((s) => s.status) === "online";
  const library = useApps((s) => s.library);
  const run = useApps((s) => s.run);
  const audio = useAudio((s) => s.audio);
  const monitors = useScreens((s) => s.monitors);

  const [name, setName] = useState(saved?.name ?? "");
  const [steps, setSteps] = useState<Step[]>(saved?.steps ?? []);
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [hotkey, setHotkey] = useState<SceneHotkey | null>(saved?.hotkey ?? null);
  const [trigger, setTrigger] = useState<SceneTrigger | null>(saved?.trigger ?? null);
  const [sheet, setSheet] = useState<"hotkey" | "trigger" | null>(null);

  const sameAuto = hotkey === (saved?.hotkey ?? null) && JSON.stringify(trigger) === JSON.stringify(saved?.trigger ?? null);
  const dirty = isNew
    ? name.trim() !== "" || steps.length > 0 || hotkey !== null || trigger !== null
    : saved !== null && (name !== saved.name || JSON.stringify(steps) !== JSON.stringify(saved.steps) || !sameAuto);
  const valid = name.trim().length > 0 && steps.length > 0;

  function leave() {
    if (dirty) setConfirmLeave(true);
    else router.back();
  }
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (editing || confirmLeave || confirmDelete || showRun || sheet) return false; // lo cierra la hoja
      if (dirty) {
        setConfirmLeave(true);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [dirty, editing, confirmLeave, confirmDelete, showRun, sheet]);

  // Solo se mandan el atajo y el disparador si cambiaron: así un agente anterior a B6.3 (que no conoce esos campos) sigue guardando escenas.
  const autoChanges = {
    ...(hotkey !== (saved?.hotkey ?? null) ? { hotkey } : {}),
    ...(JSON.stringify(trigger) !== JSON.stringify(saved?.trigger ?? null) ? { trigger } : {}),
  };

  async function save(): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await appsActions.saveScene({ ...(saved ? { id: saved.id } : {}), name: name.trim(), steps, ...autoChanges });
    setBusy(false);
    if (!r.ok) setError(r.error);
    return r.ok;
  }

  async function saveAndLeave() {
    if (await save()) router.back();
  }

  async function test() {
    if (!saved || !(await save())) return;
    setShowRun(true);
    const r = await appsActions.runScene(saved.id);
    if (!r.ok && r.error !== "apps.error.sceneFailed") {
      setShowRun(false);
      setError(r.error);
    }
  }

  async function remove() {
    if (!saved) return;
    setConfirmDelete(false);
    setBusy(true);
    const r = await appsActions.removeScene(saved.id);
    setBusy(false);
    if (r.ok) router.back();
    else setError(r.error);
  }

  const monitorLabel = (id: string) => {
    const m = monitors.find((x) => x.id === id);
    return m ? (m.nickname ?? t("apps.window.onScreen", { n: m.index ?? "–" })) : t("scenes.step.unknownScreen");
  };

  const screenLabel = (n: number) => t("apps.window.onScreen", { n });
  const triggerText = !trigger
    ? t("scenes.trigger.manualShort")
    : trigger.type === "agentStart"
      ? t("scenes.trigger.agentStartShort")
      : t("scenes.trigger.displayOnShort", { name: monitorName(monitors, trigger.displayId, screenLabel) ?? t("scenes.step.unknownScreen") });

  const stepRows = steps.map((s, i) => (
    <View key={i} style={styles.step} testID={`step-${i}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("scenes.step.editStep", { n: i + 1 })} onPress={() => setEditing({ index: i })} style={styles.stepMain}>
        <View style={styles.n}>
          <AppText kind="data" muted>
            {i + 1}
          </AppText>
        </View>
        <View style={styles.grow}>
          <AppText numberOfLines={2}>{stepSummary(s, t, audio?.outputs)}</AppText>
          <AppText kind="small" muted numberOfLines={2}>
            {s.kind === "open" && s.place ? `${monitorLabel(s.place.monitorId)} · ${t(`scenes.zone.${s.place.zone}`)}` : s.kind === "open" ? t("scenes.zone.keep") : ""}
          </AppText>
        </View>
        {s.kind === "open" && s.place && <PlacePickerSummary zone={s.place.zone} />}
      </Pressable>
      <View style={styles.moves}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("scenes.step.up", { n: i + 1 })} disabled={i === 0} onPress={() => setSteps(moveKey(steps, i, -1))} style={[styles.mv, i === 0 && styles.dis]}>
          <AppText kind="small">↑</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("scenes.step.down", { n: i + 1 })} disabled={i === steps.length - 1} onPress={() => setSteps(moveKey(steps, i, 1))} style={[styles.mv, i === steps.length - 1 && styles.dis]}>
          <AppText kind="small">↓</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("scenes.step.remove", { n: i + 1 })} onPress={() => setSteps(steps.filter((_, j) => j !== i))} style={styles.mv}>
          <AppText kind="small" style={{ color: colors.danger }}>
            ✕
          </AppText>
        </Pressable>
      </View>
    </View>
  ));

  const form = (
    <>
      <AppText kind="label" muted>
        {t("scenes.name")}
      </AppText>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={32}
        placeholder={t("scenes.namePlaceholder")}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        style={styles.field}
        accessibilityLabel={t("scenes.name")}
      />
      <AppText kind="label" muted>
        {t("scenes.onPc")}
      </AppText>
      <Pressable testID="row-hotkey" accessibilityRole="button" accessibilityLabel={`${t("scenes.hotkey.row")}, ${hotkey ? hotkeyText(hotkey) : t("scenes.hotkey.none")}`} onPress={() => setSheet("hotkey")} style={styles.autoRow}>
        <AppText style={styles.grow}>{t("scenes.hotkey.row")}</AppText>
        <AppText kind="data" muted>
          {hotkey ? hotkeyText(hotkey) : t("scenes.hotkey.none")} ›
        </AppText>
      </Pressable>
      <Pressable testID="row-trigger" accessibilityRole="button" accessibilityLabel={`${t("scenes.trigger.row")}, ${triggerText}`} onPress={() => setSheet("trigger")} style={styles.autoRow}>
        <AppText style={styles.grow}>{t("scenes.trigger.row")}</AppText>
        <AppText kind="data" muted numberOfLines={1} style={styles.shrink}>
          {triggerText} ›
        </AppText>
      </Pressable>
      <AppText kind="label" muted>
        {t("scenes.steps", { count: steps.length, max: MAX_STEPS })}
      </AppText>
      {steps.length === 0 ? (
        <View style={styles.emptySteps}>
          <AppText kind="small" muted style={styles.center}>
            {t("scenes.step.empty")}
          </AppText>
        </View>
      ) : (
        stepRows
      )}
      <Button kind="secondary" label={t("scenes.step.add")} onPress={() => setEditing({ index: null })} disabled={steps.length >= MAX_STEPS} style={styles.addStep} />
    </>
  );

  const footer = (
    <View style={styles.footer}>
      {saved && <Button kind="secondary" label={t("scenes.delete")} onPress={() => setConfirmDelete(true)} disabled={busy || !online} style={styles.deleteBtn} />}
      {saved && <Button kind="secondary" label={t("scenes.test")} onPress={() => void test()} disabled={busy || !online || !valid} />}
      <Button label={t("scenes.save")} onPress={() => void saveAndLeave()} disabled={busy || !online || !valid || (!dirty && !isNew)} />
    </View>
  );

  const runScene = library?.scenes.find((s) => s.id === run?.sceneId) ?? null;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={leave} style={styles.back}>
          <AppText kind="title" style={{ color: colors.accent }}>
            ‹
          </AppText>
        </Pressable>
        <AppText kind="title" style={styles.grow} numberOfLines={1}>
          {t(isNew ? "scenes.newTitle" : "scenes.editTitle")}
        </AppText>
      </View>
      {error && <Notice>{t(error)}</Notice>}
      {!isNew && library !== null && saved === null ? (
        <Notice>{t("scenes.gone")}</Notice>
      ) : isLandscape ? (
        <View style={styles.cols}>
          <View style={styles.grow}>{form}</View>
          <View style={styles.side}>
            <AppText kind="label" muted>
              {t("scenes.preview")}
            </AppText>
            {footer}
          </View>
        </View>
      ) : (
        <>
          {form}
          {footer}
        </>
      )}

      {editing && (
        <StepSheet
          initial={editing.index === null ? null : (steps[editing.index] ?? null)}
          monitors={monitors}
          audio={audio}
          onClose={() => setEditing(null)}
          onSave={(step) => {
            setSteps(editing.index === null ? [...steps, step] : steps.map((s, i) => (i === editing.index ? step : s)));
            setEditing(null);
          }}
        />
      )}
      {sheet === "hotkey" && (
        <HotkeySheet
          sceneName={name.trim()}
          current={hotkey}
          takenByScene={takenByScenes(library?.scenes ?? [], saved?.id ?? null)}
          onClose={() => setSheet(null)}
          onSave={(k) => {
            setHotkey(k);
            setSheet(null);
          }}
        />
      )}
      {sheet === "trigger" && (
        <TriggerSheet
          current={trigger}
          monitors={monitors}
          screenLabel={screenLabel}
          onClose={() => setSheet(null)}
          onSave={(tr) => {
            setTrigger(tr);
            setSheet(null);
          }}
        />
      )}
      {confirmLeave && (
        <ConfirmDialog
          title={t("scenes.leaveTitle")}
          detail={t("scenes.leaveDetail", { name: name || t("scenes.newTitle") })}
          confirmLabel={t("scenes.leave")}
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            router.back();
          }}
        />
      )}
      {confirmDelete && saved && (
        <ConfirmDialog
          title={t("scenes.deleteTitle", { name: saved.name })}
          detail={t("scenes.deleteDetail", { count: saved.steps.length })}
          confirmLabel={t("scenes.deleteConfirm")}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
      {showRun && runScene && run && <RunSheet scene={runScene} run={run} onClose={() => setShowRun(false)} onEdit={() => setShowRun(false)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  field: { ...type.body, minHeight: touch, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
  autoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touch, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt, minHeight: touch + 8 },
  stepMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touch + 8 },
  n: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  moves: { flexDirection: "row", gap: 4 },
  mv: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  dis: { opacity: 0.3 },
  emptySteps: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg },
  center: { textAlign: "center" },
  addStep: { alignSelf: "flex-start" },
  footer: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", flexWrap: "wrap", marginTop: spacing.md },
  deleteBtn: { marginRight: "auto", borderColor: colors.danger, borderWidth: 1 },
  cols: { flexDirection: "row", gap: spacing.lg },
  side: { flex: 1, gap: spacing.sm },
});
