import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { appsActions } from "@/apps/actions";
import { useApps } from "@/apps/store";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { applyMigration, buildMigration } from "@/decks/migrate";
import { decksActions, decksSaved, newDeckId, newKeyId, useDecks } from "@/decks/store";
import { useScreens } from "@/screens/store";
import { spacing } from "@/theme";

/**
 * La mudanza (boceto rediseño 06 E, D107). La primera vez que llegan la biblioteca de la PC y los decks del celu, las teclas del
 * Inicio y los lanzadores se copian a decks. Después se ofrece borrarlos de la PC: los links y apps que eran pasos de una escena
 * no se tocan, porque la escena corre en la PC.
 */
export function MigrationDialog({ online }: { online: boolean }) {
  const { t } = useTranslation();
  const library = useApps((s) => s.library);
  const monitors = useScreens((s) => s.monitors);
  const data = useDecks((s) => s.data);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failedCount, setFailedCount] = useState(0);

  // 1) Copiar, una sola vez. Se espera a tener la biblioteca de la PC (si nunca llega, no hay nada que pasar todavía).
  useEffect(() => {
    if (!data || data.migrated || !library) return;
    const names: Record<string, string> = {};
    for (const m of monitors) names[m.id] = m.nickname ?? m.name;
    const m = buildMigration(library, { main: t("decks.firstName"), open: t("decks.openName"), names }, (p) => (p === "d" ? newDeckId() : newKeyId()));
    decksActions.mutate((d) => applyMigration(d, m));
  }, [data, library, monitors, t]);

  // 2) Ofrecer borrar de la PC lo que todavía queda ahí.
  const pending = (library?.launchers.length ?? 0) + (library?.deck.length ?? 0);
  if (!data || data.migrated !== "copied" || !library || pending === 0 || dismissed) return null;

  async function clear() {
    if (!library) return;
    setBusy(true);
    // Solo se borra de la PC lo que YA está guardado en el celu: si el guardado falló, no se toca nada.
    await decksSaved();
    if (useDecks.getState().saveError) {
      setBusy(false);
      setFailedCount(-1);
      return;
    }
    let failed = 0;
    for (const l of library.launchers) if (!(await appsActions.removeLauncher(l.id)).ok) failed++;
    if (!(await appsActions.setDeck([])).ok) failed++;
    setBusy(false);
    setFailedCount(failed);
  }

  return (
    <Sheet center dismissOnBackdrop={false} onClose={() => setDismissed(true)} testID="migration-dialog">
      <AppText kind="heading">{t("decks.migration.title")}</AppText>
      <AppText kind="small" muted>
        {t("decks.migration.detail", { keys: library.launchers.length + library.deck.length })}
      </AppText>
      {failedCount > 0 && <Notice>{t("decks.migration.failed", { n: failedCount })}</Notice>}
      {failedCount < 0 && <Notice>{t("decks.saveError")}</Notice>}
      <View style={styles.actions}>
        <Button testID="migration-later" kind="secondary" label={t("decks.migration.later")} disabled={busy} onPress={() => setDismissed(true)} />
        <Button testID="migration-delete" label={failedCount !== 0 ? t("decks.migration.retry") : t("decks.migration.delete")} disabled={busy || !online} onPress={() => void clear()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm } });
