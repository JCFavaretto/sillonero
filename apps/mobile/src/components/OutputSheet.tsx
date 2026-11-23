import { NAME_MAX, type OutputInfo } from "@proyecto-e/protocol";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { audioActions, type ActionResult } from "@/audio/actions";
import { outputLabel } from "@/audio/view";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { useMounted } from "@/useMounted";
import { colors, radius, spacing, touch, type } from "@/theme";

/**
 * Acciones de una salida (boceto audio 02): hacerla predeterminada, silenciar, ponerle apodo y ocultarla en el celu.
 * "Hacer predeterminada" no está si la PC no puede (D29): en su lugar va la nota.
 */
export function OutputSheet({ output: o, canSetDefault, onClose }: { output: OutputInfo; canSetDefault: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const mounted = useMounted();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState(o.nick ?? "");
  const name = outputLabel(o);
  const active = o.state === "active";

  async function run(id: string, action: () => Promise<ActionResult>) {
    if (busy) return;
    setBusy(id);
    setError(null);
    const r = await action();
    if (!mounted.current) return; // la hoja ya se cerró: la respuesta tardía no hace nada
    setBusy(null);
    if (r.ok) onClose();
    else setError(r.error);
  }

  const value = text.trim();
  if (renaming) {
    return (
      <Sheet onClose={onClose} dismissOnBackdrop={false} testID="output-sheet">
        <AppText kind="heading">{t("audio.rename.title")}</AppText>
        <AppText kind="small" muted>
          {o.name}
        </AppText>
        <TextInput
          testID="rename-input"
          accessibilityLabel={t("audio.rename.title")}
          value={text}
          onChangeText={setText}
          maxLength={NAME_MAX}
          autoFocus
          placeholder={o.name}
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <AppText kind="small" muted>
          {t("audio.rename.hint")}
        </AppText>
        {error && <Notice>{t(error)}</Notice>}
        <View style={styles.actions}>
          <Button kind="secondary" label={t("common.cancel")} onPress={() => setRenaming(false)} disabled={busy !== null} />
          <Button label={t("audio.rename.save")} onPress={() => void run("rename", () => audioActions.rename(o.id, value === "" ? null : value))} disabled={busy !== null || value === (o.nick ?? "")} />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} testID="output-sheet">
      <AppText kind="heading" numberOfLines={2}>
        {name}
      </AppText>
      {o.nick && (
        <AppText kind="small" muted>
          {o.name}
        </AppText>
      )}
      {error && <Notice>{t(error)}</Notice>}
      {canSetDefault ? (
        <Button
          kind="secondary"
          label={busy === "default" ? t("audio.setDefaultBusy") : o.isDefault ? t("audio.isDefault") : t("audio.setDefault")}
          onPress={() => void run("default", () => audioActions.setDefault(o.id))}
          disabled={busy !== null || o.isDefault || !active}
        />
      ) : (
        <Notice tone="info">{t("audio.noDefaultNote")}</Notice>
      )}
      {active && <Button kind="secondary" label={t(o.muted ? "audio.unmute" : "audio.mute", { name })} onPress={() => void run("mute", () => audioActions.setMute({ kind: "output", id: o.id }, !o.muted))} disabled={busy !== null} />}
      <Button kind="secondary" label={t("audio.rename.action")} onPress={() => setRenaming(true)} disabled={busy !== null} />
      <Button kind="secondary" label={t(o.hidden ? "audio.show" : "audio.hide")} onPress={() => void run("hide", () => audioActions.hide(o.id, !o.hidden))} disabled={busy !== null || (o.isDefault && !o.hidden)} />
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { ...type.body, minHeight: touch, color: colors.text, borderWidth: 1.5, borderColor: colors.accent, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.background },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", marginTop: spacing.sm },
});
