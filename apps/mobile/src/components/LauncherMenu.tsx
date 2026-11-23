import type { Launcher, Library } from "@proyecto-e/protocol";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { appsActions, type ActionResult } from "@/apps/actions";
import { AppIcon } from "@/components/AppIcon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { useMounted } from "@/useMounted";
import { colors, radius, spacing, touch, type } from "@/theme";

/** Menú de toque largo de un lanzador (boceto apps-escenas 07, C): renombrar, agregar al Inicio, quitar (con confirmación). */
export function LauncherMenu({ launcher, library, onClose }: { launcher: Launcher; library: Library; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(launcher.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const mounted = useMounted();
  const inDeck = library.deck.some((d) => d.kind === "launcher" && d.id === launcher.id);
  const value = name.trim();

  async function run(action: () => Promise<ActionResult>, closeAfter = true) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await action();
    if (!mounted.current) return;
    setBusy(false);
    if (r.ok) {
      if (closeAfter) onClose();
    } else setError(r.error);
  }

  return (
    <>
      <Sheet onClose={onClose} testID="launcher-menu">
        <View style={styles.head}>
          <AppIcon iconKey={launcher.iconKey} name={launcher.name} size={36} />
          <AppText kind="heading" style={styles.grow} numberOfLines={1}>
            {launcher.name}
          </AppText>
        </View>
        {error && <Notice>{t(error)}</Notice>}
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={32}
          selectionColor={colors.accent}
          style={styles.field}
          accessibilityLabel={t("apps.launcher.nameField")}
          editable={!busy}
        />
        <Button
          kind="secondary"
          label={t("apps.launcher.rename")}
          disabled={busy || value.length === 0 || value === launcher.name}
          onPress={() => void run(() => appsActions.renameLauncher(launcher.id, value))}
        />
        <Button
          kind="secondary"
          label={inDeck ? t("apps.launcher.inDeck") : t("apps.launcher.addToDeck")}
          disabled={busy || inDeck}
          onPress={() => void run(() => appsActions.setDeck([...library.deck, { kind: "launcher", id: launcher.id }]))}
        />
        <Button kind="secondary" label={t("apps.launcher.remove")} disabled={busy} onPress={() => setConfirm(true)} style={styles.danger} />
      </Sheet>
      {confirm && (
        <ConfirmDialog
          title={t("apps.launcher.removeTitle", { name: launcher.name })}
          detail={t("apps.launcher.removeDetail")}
          confirmLabel={t("apps.launcher.removeConfirm")}
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void run(() => appsActions.removeLauncher(launcher.id));
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  grow: { flex: 1 },
  field: { ...type.body, minHeight: touch, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
  danger: { borderColor: colors.danger, borderWidth: 1 },
});
