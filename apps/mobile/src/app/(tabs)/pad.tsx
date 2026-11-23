import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { measurePad } from "@/apps/commands";
import { AltTabPanel } from "@/components/AltTabPanel";
import { ClickBar } from "@/components/ClickBar";
import { FunctionRow, KeyRow, ModRow } from "@/components/PadKeys";
import { PadSettingsSheet } from "@/components/PadSettingsSheet";
import { ShortcutGrid } from "@/components/ShortcutGrid";
import { Touchpad } from "@/components/Touchpad";
import { AppText, Notice, Screen, StatusDot } from "@/components/ui";
import { useConn } from "@/connection";
import { tap } from "@/haptics";
import { useLayout } from "@/layout/useLayout";
import { padActions } from "@/pad/actions";
import { padFx } from "@/pad/fx";
import { toggleMod } from "@/pad/mods";
import { usePad } from "@/pad/store";
import { usePadEngine } from "@/pad/usePadEngine";
import { loadPadSettings } from "@/storage/prefs";
import { colors, fonts, hairline, radius, spacing, touch, type } from "@/theme";

type Tab = "touch" | "keyboard" | "shortcuts";
const TABS: readonly Tab[] = ["touch", "keyboard", "shortcuts"];
const MEASURE_MS = 2_000;
const ALT_CONFIRM_MS = 2_500;

/** Pad (bocetos pad 01 a 06): touchpad, teclado y atajos para manejar la PC desde el celu. El touchpad ocupa todo lo que puede. */
export default function PadTab() {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  const status = useConn((s) => s.status);
  const online = status === "online";
  const pad = usePad((s) => s.state);
  const settings = usePad((s) => s.settings);
  const mods = usePad((s) => s.mods);
  const lock = usePad((s) => s.lock);
  const altTab = usePad((s) => s.altTab);
  const rtt = usePad((s) => s.rtt);
  const slow = usePad((s) => s.slow);

  const [tab, setTab] = useState<Tab>("touch");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (errTimer.current && clearTimeout(errTimer.current)), []);

  const flash = useCallback((key: string | null) => {
    setError(key);
    if (errTimer.current) clearTimeout(errTimer.current);
    if (key) errTimer.current = setTimeout(() => setError(null), 4000);
  }, []);

  useEffect(() => {
    void loadPadSettings().then((s) => usePad.getState().loadSettings(s));
  }, []);

  // El controlador (gestos → curva → mensajes) y la sesión de escritura viven mientras la pantalla está montada.
  const { controller, typing } = usePadEngine({ flash, setText });

  const ready = online && pad !== null && pad.enabled && pad.available;

  // Mientras el Pad está a la vista: mide la latencia y mantiene la pantalla prendida. Al salir, suelta todo lo que haya quedado.
  useFocusEffect(
    useCallback(() => {
      const id = setInterval(measurePad, MEASURE_MS);
      measurePad();
      if (usePad.getState().settings.keepAwake) void activateKeepAwakeAsync("pad").catch(() => undefined);
      return () => {
        clearInterval(id);
        void deactivateKeepAwake("pad").catch(() => undefined);
        controller.dispose();
        typing.dispose();
        if (usePad.getState().altTab) void padActions.altTab("cancel");
        usePad.getState().clearTransient();
        usePad.getState().resetLatency();
      };
    }, [controller, typing]),
  );

  // Si se corta la conexión o la PC apaga el Pad: nada queda enganchado (la PC suelta sola lo que quedó apretado).
  useEffect(() => {
    if (!ready) {
      controller.reset();
      usePad.getState().clearTransient();
    }
  }, [ready, controller]);

  // La PC eligió sola la ventana de Alt+Tab (a los 2 s sin tocar nada): Alt ya no está apretado y el panel se cierra. Si la PC nunca
  // confirmó que Alt quedó apretado, también se cierra (a los 2,5 s) para no dejar un panel que no hace nada.
  const sawAlt = useRef(false);
  useEffect(() => {
    if (!altTab) {
      sawAlt.current = false;
      return;
    }
    if (pad?.holding.alt) {
      sawAlt.current = true;
      return;
    }
    if (sawAlt.current) {
      usePad.getState().setAltTab(false);
      return;
    }
    const id = setTimeout(() => usePad.getState().setAltTab(false), ALT_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [altTab, pad]);

  useEffect(() => {
    if (!settings.keepAwake) void deactivateKeepAwake("pad").catch(() => undefined);
  }, [settings.keepAwake]);

  const toggleLock = () => {
    const next = !lock;
    controller.setLock(next);
    usePad.getState().setLock(next);
  };
  const releaseAll = () => {
    controller.setLock(false);
    usePad.getState().setLock(false);
    void padActions.release().then((r) => !r.ok && flash(r.error));
  };
  const click = (b: "left" | "middle" | "right") => {
    tap();
    padFx.emit("click");
    void padActions.button(b, "click").then((r) => !r.ok && flash(r.error));
  };
  const altStep = async (step: "start" | "next" | "prev" | "commit" | "cancel") => {
    const r = await padActions.altTab(step);
    if (!r.ok) return flash(r.error);
    usePad.getState().setAltTab(step === "start" || step === "next" || step === "prev");
  };
  const pressKey = (k: Parameters<typeof typing.pressKey>[0]) => void typing.pressKey(k).then((r) => flash(r.ok ? null : r.error));

  const latency = rtt === null ? t("pad.surface.pending") : t(slow ? "pad.surface.slow" : "pad.surface.latency", { ms: Math.round(rtt) });

  const chipKind = !online ? "offline" : pad === null ? "loading" : !pad.enabled || !pad.available ? "disabled" : "on";
  const chip = (
    <View testID="pad-chip" style={[styles.chip, chipKind === "on" && styles.chipOn, chipKind !== "on" && chipKind !== "loading" && styles.chipOff]}>
      <StatusDot color={chipKind === "on" ? colors.accent : chipKind === "loading" ? colors.muted : colors.danger} />
      <AppText kind="label" style={{ color: chipKind === "on" ? colors.accent : chipKind === "loading" ? colors.muted : colors.danger, fontSize: 10 }}>
        {t(`pad.chip.${chipKind}`)}
      </AppText>
    </View>
  );

  // — Sin conexión, esperando, apagado en la PC o sin entrada de Windows: se explica y no se muestra la superficie —
  if (!ready) {
    const gate = !online
      ? { id: "offline", title: t("pad.gate.offlineTitle"), detail: t("pad.gate.offlineDetail") }
      : pad === null
        ? { id: "loading", title: t("pad.gate.loading"), detail: "" }
        : !pad.available
          ? { id: "unavailable", title: t("pad.gate.unavailableTitle"), detail: t("pad.gate.unavailableDetail") }
          : { id: "disabled", title: t("pad.gate.disabledTitle"), detail: t("pad.gate.disabledDetail") };
    return (
      <Screen scroll={false} style={styles.screen}>
        <View style={styles.header}>
          <AppText kind="title">{t("pad.title")}</AppText>
          {chip}
        </View>
        <View testID={`pad-gate-${gate.id}`} style={styles.gate}>
          <Ionicons name={gate.id === "offline" ? "cloud-offline-outline" : "hand-left-outline"} size={34} color={colors.muted} />
          <AppText kind="heading" style={styles.center}>
            {gate.title}
          </AppText>
          {gate.detail !== "" && (
            <AppText kind="small" muted style={styles.center}>
              {gate.detail}
            </AppText>
          )}
        </View>
      </Screen>
    );
  }

  const seg = (
    <View style={[styles.seg, isLandscape && styles.segCol]} accessibilityRole="tablist">
      {TABS.map((id) => {
        const on = tab === id;
        return (
          <Pressable
            key={id}
            testID={`seg-${id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => setTab(id)}
            style={[styles.segItem, on && styles.segOn]}
          >
            <AppText kind="small" style={{ color: on ? colors.text : colors.muted, fontFamily: on ? fonts.bodySemi : fonts.body }}>
              {t(id === "touch" ? (isLandscape ? "pad.tabs.touchShort" : "pad.tabs.touchpad") : id === "keyboard" ? "pad.tabs.keyboard" : "pad.tabs.shortcuts")}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );

  const touchView = (
    <View style={styles.fill}>
      <Touchpad controller={controller} latency={latency} slow={slow} dragging={lock} onA11yClick={click} />
      <ClickBar locked={lock} onLeft={() => click("left")} onMiddle={() => click("middle")} onRight={() => click("right")} onToggleLock={toggleLock} />
    </View>
  );

  const keyboardView = (
    <ScrollView testID="pad-keyboard" style={styles.fill} contentContainerStyle={styles.kbContent} keyboardShouldPersistTaps="handled">
      <View style={styles.fieldRow}>
        <TextInput
          testID="pad-field"
          accessibilityLabel={t("pad.keyboard.field")}
          value={text}
          onChangeText={(v) => {
            setText(v);
            typing.change(v);
          }}
          placeholder={t("pad.keyboard.placeholder")}
          placeholderTextColor={colors.muted}
          style={styles.field}
          autoCapitalize="none"
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={() => void typing.enter().then((r) => !r.ok && flash(r.error))}
        />
        <Pressable testID="pad-send" accessibilityRole="button" accessibilityLabel={t("pad.keyboard.sendLabel")} onPress={() => void typing.enter().then((r) => !r.ok && flash(r.error))} style={styles.send}>
          <AppText kind="small" style={{ color: colors.accentText, fontFamily: fonts.bodySemi }}>
            {t("pad.keyboard.send")}
          </AppText>
        </Pressable>
        <Pressable testID="pad-clear" accessibilityRole="button" accessibilityLabel={t("pad.keyboard.clearLabel")} onPress={() => typing.clear()} style={styles.clear}>
          <AppText kind="small">{t("pad.keyboard.clear")}</AppText>
        </Pressable>
      </View>
      {!isLandscape && <Touchpad controller={controller} latency={latency} slow={slow} hint={false} compact dragging={lock} onA11yClick={click} />}
      <ModRow mods={mods} onToggle={(m) => usePad.getState().setMods(toggleMod(usePad.getState().mods, m, Date.now()))} />
      <KeyRow keys={["esc", "tab", "backspace", "enter", "left", "up", "down", "right"]} onKey={pressKey} />
      <KeyRow keys={["home", "end", "delete", "pageUp", "pageDown"]} onKey={pressKey} />
      <FunctionRow onKey={pressKey} />
      <AppText kind="small" muted>
        {t("pad.keyboard.hint")}
      </AppText>
    </ScrollView>
  );

  const shortcutsView = altTab ? (
    <AltTabPanel onPrev={() => void altStep("prev")} onNext={() => void altStep("next")} onCommit={() => void altStep("commit")} onCancel={() => void altStep("cancel")} />
  ) : (
    <ShortcutGrid columns={isLandscape ? 5 : 3} onShortcut={(id) => padActions.shortcut(id)} onAltTab={() => void altStep("start")} />
  );

  const content = tab === "touch" ? touchView : tab === "keyboard" ? keyboardView : shortcutsView;

  const settingsBtn = (
    <Pressable testID="pad-settings-open" accessibilityRole="button" accessibilityLabel={t("pad.settingsOpen")} onPress={() => setSettingsOpen(true)} style={styles.iconBtn}>
      <Ionicons name="settings-outline" size={22} color={colors.muted} />
    </Pressable>
  );
  const releaseBtn = (
    <Pressable testID="pad-release" accessibilityRole="button" accessibilityLabel={t("pad.releaseHint")} onPress={releaseAll} style={styles.release}>
      <Ionicons name="stop" size={12} color={colors.danger} />
      <AppText kind="small" style={{ color: colors.danger, fontFamily: fonts.bodySemi }}>
        {t("pad.release")}
      </AppText>
    </Pressable>
  );

  const notices = (
    <>
      {pad?.elevated && <Notice live>{t("pad.elevated")}</Notice>}
      {error && <Notice live>{t(error)}</Notice>}
    </>
  );

  return (
    <Screen scroll={false} style={styles.screen}>
      {isLandscape ? (
        <View style={styles.landscape}>
          <View style={styles.fill}>
            {notices}
            {content}
          </View>
          <View style={styles.side}>
            {chip}
            {seg}
            {settingsBtn}
            <View style={styles.fill} />
            {releaseBtn}
          </View>
        </View>
      ) : (
        <View style={styles.fill}>
          <View style={styles.header}>
            {chip}
            <View style={styles.headerRight}>
              {settingsBtn}
              {releaseBtn}
            </View>
          </View>
          {seg}
          {notices}
          {content}
        </View>
      )}
      {settingsOpen && <PadSettingsSheet settings={settings} onChange={(p) => usePad.getState().setSettings(p)} onClose={() => setSettingsOpen(false)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.sm + 2, paddingTop: spacing.xs, paddingBottom: 0, gap: spacing.sm },
  fill: { flex: 1, gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: hairline, borderColor: colors.border, borderRadius: 20, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipOff: { borderColor: colors.danger },
  seg: { flexDirection: "row", backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border, borderRadius: radius.md, padding: 3 },
  segCol: { flexDirection: "column" },
  segItem: { flex: 1, minHeight: touch, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  segOn: { backgroundColor: colors.surfaceAlt, borderBottomWidth: 2, borderBottomColor: colors.accent },
  landscape: { flex: 1, flexDirection: "row", gap: spacing.sm },
  side: { width: 128, gap: spacing.sm },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  iconBtn: { width: touch, height: touch, alignItems: "center", justifyContent: "center" },
  small: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: touch, paddingHorizontal: spacing.xs },
  release: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: touch, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.dangerBg },
  gate: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  center: { textAlign: "center" },
  kbContent: { gap: spacing.sm, paddingBottom: spacing.sm },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  field: { flex: 1, minHeight: touch, borderWidth: 1.5, borderColor: colors.accent, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: spacing.md, ...type.body },
  send: { minHeight: touch, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  clear: { minHeight: touch, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
});
