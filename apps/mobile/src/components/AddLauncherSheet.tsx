import { SafeUrl, type Library, type Target } from "@proyecto-e/protocol";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { appsActions } from "@/apps/actions";
import { AppPicker } from "@/components/AppPicker";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { readClipboardText } from "@/clipboard";
import { linkFromClipboard, normalizeUrl, siteOf, stripScheme } from "@/links";
import { useMounted } from "@/useMounted";
import { colors, radius, spacing, touch, type } from "@/theme";

/** Lo mismo que valida el protocolo: solo http(s) con un sitio (boceto 08, C). */
export const isHttpUrl = (u: string) => SafeUrl.safeParse(u.trim()).success;

type OpenMode = "tab" | "window" | "private";
const MODES: OpenMode[] = ["tab", "window", "private"];

/**
 * Hoja "Agregar lanzador" (boceto apps-escenas 08): una app de la PC o un link. Sin rutas ni comandos escritos a mano.
 * El link no pide "https://" (se agrega solo y, si se pega, se esconde), ofrece lo que hay en el portapapeles y deja elegir
 * cómo se abre: pestaña nueva, ventana nueva o incógnito.
 */
export function AddLauncherSheet({
  library,
  onClose,
  onPick,
}: {
  /** Para marcar lo que ya está guardado en la PC; sin ella (modo elegir) no se marca nada. */
  library?: Library;
  onClose: () => void;
  /** Modo elegir (decks, D104): devuelve el destino y su nombre en vez de guardarlo como lanzador de la PC. */
  onPick?: (target: Target, name: string | null, iconKey: string | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"app" | "link">("app");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<OpenMode>("tab");
  const [offer, setOffer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useMounted();
  const full = normalizeUrl(url);
  const urlOk = full !== null;

  // Al abrir la pestaña Link se mira el portapapeles: si hay un link copiado, se ofrece.
  useEffect(() => {
    if (tab !== "link") return;
    let alive = true;
    void readClipboardText().then((text) => alive && setOffer(linkFromClipboard(text)));
    return () => {
      alive = false;
    };
  }, [tab]);

  async function add(target: Parameters<typeof appsActions.addLauncher>[0], label: string | null, iconKey: string | null = null) {
    if (onPick) {
      onPick(target, label, iconKey);
      return true;
    }
    if (saving) return;
    setSaving(true);
    setError(null);
    const r = await appsActions.addLauncher(target, label);
    if (!mounted.current) return false;
    setSaving(false);
    if (!r.ok) setError(r.error);
    return r.ok;
  }

  return (
    <Sheet tall dismissOnBackdrop={false} onClose={onClose} testID="add-launcher-sheet">
      <AppText kind="heading">{t("apps.add.title")}</AppText>
      <View style={styles.tabs}>
        {(["app", "link"] as const).map((k) => (
          <Button key={k} kind={tab === k ? "primary" : "secondary"} selected={tab === k} label={t(`apps.add.tab.${k}`)} onPress={() => setTab(k)} style={styles.tab} />
        ))}
      </View>
      {error && <Notice>{t(error)}</Notice>}
      {tab === "app" ? (
        <AppPicker
          actionLabel={t("apps.add.add")}
          isDone={(a) => library?.launchers.some((l) => l.target.kind === "app" && l.target.appId === a.appId) ?? false}
          onPick={(a) => void add({ kind: "app", appId: a.appId }, onPick ? a.name : null, a.iconKey)}
        />
      ) : (
        <View style={styles.form}>
          {offer && url.trim() === "" && (
            <Pressable
              testID="clipboard-offer"
              accessibilityRole="button"
              accessibilityLabel={t("apps.add.clipboardUse", { site: siteOf(offer) })}
              onPress={() => {
                setUrl(stripScheme(offer));
                setOffer(null);
              }}
              style={styles.offer}
            >
              <View style={styles.grow}>
                <AppText kind="small" muted>
                  {t("apps.add.clipboard")}
                </AppText>
                <AppText numberOfLines={1}>{stripScheme(offer)}</AppText>
              </View>
              <AppText kind="key" style={{ color: colors.accent }}>
                {t("apps.add.clipboardAction")}
              </AppText>
            </Pressable>
          )}
          <AppText kind="label" muted>
            {t("apps.add.url")}
          </AppText>
          <TextInput
            value={url}
            onChangeText={(v) => setUrl(stripScheme(v))}
            placeholder="youtube.com"
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            style={[styles.field, url.length > 0 && !urlOk && { borderColor: colors.danger }]}
            accessibilityLabel={t("apps.add.url")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2048}
          />
          {url.length > 0 && !urlOk && <Notice>{t("apps.add.urlInvalid")}</Notice>}
          <AppText kind="label" muted>
            {t("apps.add.name")}
          </AppText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={urlOk ? siteOf(url) : ""}
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            style={styles.field}
            accessibilityLabel={t("apps.add.name")}
            maxLength={32}
          />
          <AppText kind="label" muted>
            {t("apps.add.how")}
          </AppText>
          <View style={styles.tabs}>
            {MODES.map((m) => (
              <Button key={m} kind={mode === m ? "primary" : "secondary"} selected={mode === m} label={t(`apps.add.mode.${m}`)} onPress={() => setMode(m)} style={styles.tab} />
            ))}
          </View>
          <AppText kind="small" muted>
            {t(`apps.add.modeHelp.${mode}`)}
          </AppText>
          <View style={styles.actions}>
            <Button
              label={t("apps.add.add")}
              disabled={!urlOk || saving}
              onPress={async () => {
                if (!full) return;
                // El campo `open` solo viaja si se pidió algo distinto de lo común: un link en pestaña queda igual que siempre.
                const target = mode === "tab" ? { kind: "url" as const, url: full } : { kind: "url" as const, url: full, open: mode };
                const label = name.trim() || (mode === "private" ? t("apps.add.privateName", { name: siteOf(full) }).slice(0, 32) : null);
                if (await add(target, label)) onClose();
              }}
            />
          </View>
        </View>
      )}
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  offer: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch + 8, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: { flex: 1, minHeight: 48 },
  form: { gap: spacing.sm },
  field: { ...type.body, minHeight: touch, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
});
