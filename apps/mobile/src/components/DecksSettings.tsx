import { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Card, Notice } from "@/components/ui";
import { exportDecks, importDecks, previewImport, readImportFile, type ReadResult } from "@/decks/backup";
import { pickText, shareText } from "@/decks/backupIo";
import { MAX_DECKS } from "@/decks/model";
import { decksActions, useDecks } from "@/decks/store";
import { formatDate } from "@/format";
import { colors, radius, spacing, touch } from "@/theme";

/** Ajustes → Decks (boceto rediseño 06 C y D): animar imágenes, exportar e importar. */
export function DecksSettings() {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const animate = useDecks((s) => s.animate);
  const lastExport = useDecks((s) => s.lastExport);
  const mine = useDecks((s) => s.data?.decks.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [incoming, setIncoming] = useState<Extract<ReadResult, { ok: true }> | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function doExport() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await exportDecks({ share: shareText, now: () => new Date() });
    setBusy(false);
    if (!r.ok) setMessage({ text: t("decks.settings.exportFailed"), ok: false });
  }

  async function doPick() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await readImportFile(pickText);
    setBusy(false);
    if (r.ok) return setIncoming(r);
    if (r.reason === "canceled") return;
    setMessage({ text: t(r.reason === "too_big" ? "decks.import.tooBig" : r.reason === "invalid" ? "decks.import.invalid" : "decks.import.unreadable"), ok: false });
  }

  async function apply(mode: "add" | "replace") {
    if (!incoming) return;
    const r = await importDecks(incoming.data, incoming.images, mode);
    setIncoming(null);
    if (r.failed) return setMessage({ text: t("decks.import.failed"), ok: false });
    setDone(mode === "add" ? t("decks.import.doneAdd", { n: r.added }) : t("decks.import.doneReplace", { n: r.added }));
  }

  const keys = incoming ? incoming.data.decks.reduce((n, d) => n + d.slots.filter(Boolean).length + d.extra.length, 0) : 0;
  const cut = incoming ? previewImport(incoming.data, "add") : { added: 0, dropped: 0 };
  const row = (title: string, detail: string, right: React.ReactNode, testID: string, onPress?: () => void) => (
    <Pressable testID={testID} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={`${title}. ${detail}`} disabled={!onPress || busy} onPress={onPress} style={styles.row}>
      <View style={styles.grow}>
        <AppText kind="key">{title}</AppText>
        <AppText kind="small" muted>
          {detail}
        </AppText>
      </View>
      {right}
    </Pressable>
  );

  return (
    <View testID="decks-settings" style={styles.wrap}>
      <AppText kind="label" muted>
        {t("decks.settings.title")}
      </AppText>
      <Card>
        {row(
          t("decks.settings.animate"),
          reduce ? t("decks.settings.animateReduce") : t("decks.settings.animateOn"),
          <Switch accessibilityLabel={t("decks.settings.animate")} value={animate && !reduce} disabled={reduce} onValueChange={decksActions.setAnimate} trackColor={{ false: colors.border, true: colors.ok }} thumbColor={colors.text} />,
          "decks-animate",
        )}
        {row(t("decks.settings.export"), lastExport ? t("decks.settings.exportLast", { date: formatDate(lastExport) }) : t("decks.settings.exportNever"), <AppText kind="heading" muted>{"›"}</AppText>, "decks-export", () => void doExport())}
        {row(t("decks.settings.import"), t("decks.settings.importDetail"), <AppText kind="heading" muted>{"›"}</AppText>, "decks-import", () => void doPick())}
      </Card>
      {message && <Notice>{message.text}</Notice>}
      {done && (
        <Notice tone="info" live>
          {done}
        </Notice>
      )}
      {incoming && (
        <Sheet onClose={() => setIncoming(null)} testID="import-sheet">
          <AppText kind="heading">{t("decks.import.title")}</AppText>
          <AppText kind="small" muted>
            {t("decks.import.found", { decks: incoming.data.decks.length, keys, mine })}
          </AppText>
          <View style={styles.option}>
            <View style={styles.grow}>
              <AppText kind="key">{t("decks.import.add")}</AppText>
              <AppText kind="small" muted>
                {cut.dropped > 0 ? t("decks.import.addCut", { n: cut.added, out: cut.dropped, max: MAX_DECKS }) : t("decks.import.addDetail", { n: mine + cut.added })}
              </AppText>
            </View>
            <Button testID="import-add" label={t("decks.import.add")} onPress={() => void apply("add")} disabled={cut.added === 0} />
          </View>
          <View style={styles.option}>
            <View style={styles.grow}>
              <AppText kind="key">{t("decks.import.replace")}</AppText>
              <AppText kind="small" muted>
                {t("decks.import.replaceDetail", { n: mine })}
              </AppText>
            </View>
            <Button testID="import-replace" kind="secondary" label={t("decks.import.replace")} onPress={() => void apply("replace")} style={{ borderColor: colors.danger }} />
          </View>
          <Button kind="secondary" label={t("common.close")} onPress={() => setIncoming(null)} />
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch + 8 },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
});
