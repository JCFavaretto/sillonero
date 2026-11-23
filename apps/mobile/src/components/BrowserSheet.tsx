import type { BrowserFailure, BrowserItem, BrowserTab } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { browserActions } from "@/browser/actions";
import { windowTabs } from "@/browser/match";
import { useBrowser } from "@/browser/store";
import { ListRow, ListState, SiteBadge } from "@/components/BrowserRows";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { tap } from "@/haptics";
import { useMounted } from "@/useMounted";
import { normalizeUrl, stripScheme } from "@/links";
import { colors, radius, spacing, touch, type } from "@/theme";

type Section = "tabs" | "bookmarks";

/** Cómo sumar la extensión (boceto comodidad 03 D): lo que hay que hacer una sola vez en el navegador de la PC. */
function ExtensionHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <View testID="extension-help" style={styles.help}>
      <AppText kind="heading">{t("browser.help.title")}</AppText>
      <AppText kind="small" muted>
        {t("browser.help.why")}
      </AppText>
      {(["one", "two", "three", "four"] as const).map((k, i) => (
        <View key={k} style={styles.step}>
          <AppText kind="key" style={styles.stepN}>
            {i + 1}
          </AppText>
          <AppText style={styles.grow}>{t(`browser.help.${k}`)}</AppText>
        </View>
      ))}
      <AppText kind="small" muted>
        {t("browser.help.after")}
      </AppText>
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} />
      </View>
    </View>
  );
}

/**
 * Las pestañas y los marcadores del navegador (boceto comodidad 03), por la extensión. Un toque en una pestaña la pone a la
 * vista en la PC (sin traer la ventana al frente); ✕ la cierra. Sin la extensión explica cómo sumarla: lo demás de la app anda igual.
 */
export function BrowserSheet({ appName, windowTitle, onClose }: { appName: string; /** El título de la ventana de la que se abrió: si se reconoce, se muestran solo SUS pestañas. */ windowTitle?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const state = useBrowser((s) => s.browser);
  const [section, setSection] = useState<Section>("tabs");
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // `null` = todavía leyendo los marcadores (se piden la primera vez que se mira esa sección).
  const [marks, setMarks] = useState<BrowserItem[] | null>(null);
  const [marksError, setMarksError] = useState<BrowserFailure | "offline" | null>(null);
  const asked = useRef(false);
  const mounted = useMounted();

  const connected = state?.connected === true;
  const scoped = windowTabs(windowTitle ?? "", state);
  const shownTabs = scoped ? scoped.tabs : (state?.tabs ?? []);
  const full = normalizeUrl(address);

  useEffect(() => {
    if (section !== "bookmarks" || !connected || asked.current) return;
    asked.current = true;
    void browserActions.ask({ kind: "bookmarks" }).then((r) => {
      if (!mounted.current) return;
      if (r.ok) setMarks(r.items);
      else setMarksError(r.reason);
    });
  }, [section, connected, mounted]);

  function retryMarks() {
    asked.current = false;
    setMarksError(null);
    setMarks(null);
  }

  async function run(op: Parameters<typeof browserActions.act>[0], doneText?: string) {
    tap();
    const r = await browserActions.act(op);
    setNotice(r.ok ? (doneText ?? null) : t(r.error));
  }

  const tabsByWindow: Record<number, BrowserTab[]> = {};
  for (const tab of shownTabs) (tabsByWindow[tab.windowId] ??= []).push(tab);
  const windowIds = Object.keys(tabsByWindow).map(Number);

  return (
    <Sheet tall dismissOnBackdrop={false} onClose={onClose} testID="browser-sheet">
      <View style={styles.head}>
        <View style={styles.grow}>
          <AppText kind="heading" numberOfLines={1}>
            {scoped && windowTitle ? windowTitle : appName}
          </AppText>
          {connected && (
            <AppText kind="small" muted>
              {t("browser.tabCount", { count: shownTabs.length })}
            </AppText>
          )}
        </View>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} style={styles.small} />
      </View>

      {!connected ? (
        <ExtensionHelp onClose={onClose} />
      ) : (
        <>
          <View style={styles.tabs}>
            {(["tabs", "bookmarks"] as const).map((k) => (
              <Button key={k} kind={section === k ? "primary" : "secondary"} selected={section === k} label={t(`browser.${k}`)} onPress={() => setSection(k)} style={styles.seg} />
            ))}
          </View>
          {notice && <Notice tone={notice === t("browser.opened") ? "info" : "danger"}>{notice}</Notice>}

          {section === "tabs" ? (
            <>
              <View style={styles.addressRow}>
                <TextInput
                  value={address}
                  onChangeText={(v) => setAddress(stripScheme(v))}
                  placeholder={t("browser.addressHint")}
                  placeholderTextColor={colors.muted}
                  selectionColor={colors.accent}
                  style={[styles.field, address.length > 0 && !full && { borderColor: colors.danger }]}
                  accessibilityLabel={t("browser.address")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="go"
                  maxLength={2048}
                  onSubmitEditing={() => {
                    if (!full) return;
                    void run({ op: "tab.open", url: full, mode: "tab" }, t("browser.opened"));
                    setAddress("");
                  }}
                />
                <Button
                  label={t("browser.go")}
                  disabled={!full}
                  onPress={() => {
                    if (!full) return;
                    void run({ op: "tab.open", url: full, mode: "tab" }, t("browser.opened"));
                    setAddress("");
                  }}
                  style={styles.small}
                />
              </View>
              <View style={styles.quick}>
                <Button kind="secondary" label={t("browser.newWindow")} onPress={() => void run({ op: "tab.open", url: "https://www.google.com", mode: "window" }, t("browser.opened"))} style={styles.seg} />
                <Button kind="secondary" label={t("browser.reopen")} onPress={() => void run({ op: "tab.reopen" })} style={styles.seg} />
              </View>

              {windowIds.length === 0 && <ListState empty={t("browser.noTabs")} />}
              {windowIds.map((w, i) => (
                <View key={w} style={styles.group}>
                  {windowIds.length > 1 && (
                    <AppText kind="label" muted>
                      {t("browser.windowN", { n: i + 1 })}
                    </AppText>
                  )}
                  {tabsByWindow[w]!.map((tab) => (
                    <ListRow
                      key={tab.id}
                      testID={`tab-${tab.id}`}
                      label={`${tab.title}, ${tab.host}${tab.audible ? `, ${t("browser.playing")}` : ""}`}
                      left={<SiteBadge host={tab.host} title={tab.title} />}
                      title={tab.title || tab.host}
                      subtitle={tab.host}
                      current={tab.active}
                      onPress={() => void run({ op: "tab.activate", tabId: tab.id })}
                      right={
                        <View style={styles.rightBox}>
                          {tab.audible && <Ionicons name="volume-high" size={16} color={colors.ok} />}
                          <Pressable testID={`tab-close-${tab.id}`} accessibilityRole="button" accessibilityLabel={t("browser.closeTab", { title: tab.title || tab.host })} onPress={() => void run({ op: "tab.close", tabId: tab.id })} hitSlop={6} style={styles.x}>
                            <Ionicons name="close" size={18} color={colors.muted} />
                          </Pressable>
                        </View>
                      }
                    />
                  ))}
                </View>
              ))}
            </>
          ) : (
            <>
              <ListState loading={marks === null && !marksError} error={marksError} onRetry={retryMarks} empty={marks?.length === 0 ? t("browser.noBookmarks") : undefined} />
              {(marks ?? []).map((m, i, all) => (
                <View key={m.id}>
                  {(i === 0 || all[i - 1]!.subtitle !== m.subtitle) && m.subtitle ? (
                    <AppText kind="label" muted style={styles.folder}>
                      {m.subtitle}
                    </AppText>
                  ) : null}
                  <ListRow
                    testID={`bookmark-${m.id}`}
                    left={<SiteBadge host={(/^https?:\/\/([^/]+)/i.exec(m.url ?? "")?.[1] ?? "").replace(/^www\./, "")} title={m.title} />}
                    title={m.title}
                    onPress={() => m.url && void run({ op: "tab.open", url: m.url, mode: "tab" }, t("browser.opened"))}
                    onLongPress={() => m.url && void run({ op: "tab.open", url: m.url, mode: "window" }, t("browser.opened"))}
                  />
                </View>
              ))}
              {marks && marks.length > 0 && (
                <AppText kind="small" muted>
                  {t("browser.bookmarkHelp")}
                </AppText>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  small: { minHeight: 48, paddingHorizontal: spacing.lg },
  tabs: { flexDirection: "row", gap: spacing.sm },
  seg: { flex: 1, minHeight: 48 },
  quick: { flexDirection: "row", gap: spacing.sm },
  addressRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  field: { ...type.body, flex: 1, minHeight: touch, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
  group: { gap: 2 },
  folder: { marginTop: spacing.sm },
  rightBox: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  x: { width: touch - 8, height: touch - 8, alignItems: "center", justifyContent: "center" },
  help: { gap: spacing.md },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  stepN: { width: 26, height: 26, borderRadius: 13, textAlign: "center", lineHeight: 26, backgroundColor: colors.accentSoft, color: colors.accent, overflow: "hidden" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
