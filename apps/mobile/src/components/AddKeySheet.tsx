import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MAX_DECK, type AudioState, type DeckItem, type Library, type Monitor } from "@proyecto-e/protocol";
import { outputLabel } from "@/audio/view";
import type { ActionResult } from "@/apps/actions";
import { AppIcon } from "@/components/AppIcon";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { useMounted } from "@/useMounted";
import { colors, spacing } from "@/theme";

const same = (a: DeckItem, b: DeckItem) => JSON.stringify(a) === JSON.stringify(b);

/** Hoja "Agregar al Inicio" (boceto apps-escenas 03): escenas, lanzadores y acciones de la PC. */
export function AddKeySheet({
  library,
  deck,
  monitors,
  audio = null,
  onAdd,
  onCreateScene,
  onCreateLauncher,
  onClose,
}: {
  library: Library;
  deck: DeckItem[];
  monitors: Monitor[];
  /** El estado de audio de la PC (B4); `null` o caído: el grupo Audio avisa y no deja agregar. */
  audio?: AudioState | null;
  /** Contesta cuando la PC confirmó (o no); la hoja muestra el error y no deja agregar dos cosas a la vez. */
  onAdd: (item: DeckItem) => Promise<ActionResult | void>;
  onCreateScene: () => void;
  onCreateLauncher: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingOutput, setPickingOutput] = useState(false);
  const mounted = useMounted();
  const full = deck.length >= MAX_DECK;
  const inDeck = (item: DeckItem) => deck.some((d) => same(d, item));
  async function add(item: DeckItem) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await onAdd(item);
    if (!mounted.current) return;
    setBusy(false);
    if (r && !r.ok) setError(r.error);
  }
  /** Agrega varias teclas juntas (Media: 3; volumen: 2), de a una y en orden. */
  async function addAll(items: DeckItem[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    for (const item of items) {
      if (inDeck(item)) continue;
      const r = await onAdd(item);
      if (!mounted.current) return;
      if (r && !r.ok) {
        setError(r.error);
        break;
      }
    }
    if (mounted.current) setBusy(false);
  }
  const audioOk = audio?.available.audio === true;
  // Las salidas que se ofrecen para la tecla "Salida": las activas y las que tienen apodo (la tele apagada), nunca las ocultas sin apodo.
  const offerable = (audio?.outputs ?? []).filter((o) => o.state === "active" || o.nick !== null).filter((o) => !(o.hidden && o.nick === null));
  const audioRow = (testID: string, name: string, sub: string | null, items: DeckItem[]) => (
    <View key={testID} style={styles.row}>
      {dot}
      <View style={styles.grow}>
        <AppText numberOfLines={1}>{name}</AppText>
        {sub && (
          <AppText kind="small" muted numberOfLines={2}>
            {sub}
          </AppText>
        )}
      </View>
      {items.every(inDeck) ? (
        <AppText kind="small" muted>
          {t("home.add.inDeck")}
        </AppText>
      ) : (
        <Button testID={testID} kind="secondary" label={t("home.add.add")} onPress={() => void addAll(items)} disabled={busy || deck.length + items.filter((i) => !inDeck(i)).length > MAX_DECK} style={styles.btn} />
      )}
    </View>
  );
  const row = (key: string, icon: ReactNode, name: string, sub: string | null, item: DeckItem) => (
    <View key={key} testID={`add-row-${key}`} style={styles.row}>
      {icon}
      <View style={styles.grow}>
        <AppText numberOfLines={1}>{name}</AppText>
        {sub && (
          <AppText kind="small" muted numberOfLines={1}>
            {sub}
          </AppText>
        )}
      </View>
      {inDeck(item) ? (
        <AppText kind="small" muted>
          {t("home.add.inDeck")}
        </AppText>
      ) : (
        <Button kind="secondary" label={t("home.add.add")} onPress={() => void add(item)} disabled={busy || full} style={styles.btn} />
      )}
    </View>
  );
  const dot = <View style={styles.dot} />;
  const toggles = monitors.filter((m) => !m.primary);
  if (pickingOutput) {
    return (
      <Sheet onClose={() => setPickingOutput(false)} testID="output-pick">
        <AppText kind="heading">{t("home.add.pickOutput")}</AppText>
        {offerable.map((o) => (
          <View key={o.id} style={styles.row}>
            {dot}
            <View style={styles.grow}>
              <AppText numberOfLines={1}>{outputLabel(o)}</AppText>
              <AppText kind="small" muted>
                {o.isDefault ? t("audio.default") : o.state === "active" ? "" : t("home.add.outputOff")}
              </AppText>
            </View>
            <Button
              testID={`pick-${o.id}`}
              kind="secondary"
              label={t("home.add.choose")}
              disabled={busy}
              onPress={() => {
                void addAll([{ kind: "output", outputId: o.id }]).then(() => mounted.current && setPickingOutput(false));
              }}
              style={styles.btn}
            />
          </View>
        ))}
        <AppText kind="small" muted>
          {t("home.add.pickOutputHint")}
        </AppText>
        {error && <Notice>{t(error)}</Notice>}
        <View style={styles.actions}>
          <Button kind="secondary" label={t("common.back")} onPress={() => setPickingOutput(false)} />
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet tall onClose={onClose} testID="add-key-sheet">
      <AppText kind="heading">{t("home.add.title")}</AppText>
      {error && <Notice>{t(error)}</Notice>}
      {full && <Notice tone="info">{t("home.add.full")}</Notice>}
      <AppText kind="label" muted>
        {t("home.add.scenes")}
      </AppText>
      {library.scenes.map((s) => row(s.id, dot, s.name, t("home.add.steps", { count: s.steps.length }), { kind: "scene", id: s.id }))}
      <Button kind="secondary" label={t("home.add.createScene")} onPress={onCreateScene} />
      <AppText kind="label" muted>
        {t("home.add.launchers")}
      </AppText>
      {library.launchers.map((l) => row(l.id, <AppIcon iconKey={l.iconKey} name={l.name} size={30} />, l.name, null, { kind: "launcher", id: l.id }))}
      <Button kind="secondary" label={t("home.add.createLauncher")} onPress={onCreateLauncher} />
      <AppText kind="label" muted>
        {t("home.add.actions")}
      </AppText>
      {toggles.map((m) => row(`m-${m.id}`, dot, t("home.add.toggle", { name: m.nickname ?? m.name }), null, { kind: "monitorToggle", monitorId: m.id }))}
      {row("bring", dot, t("home.deck.bringAll"), null, { kind: "bringAll" })}
      {row("ident", dot, t("home.deck.identify"), null, { kind: "identify" })}
      <AppText kind="label" muted>
        {t("home.add.audio")}
      </AppText>
      {audioOk ? (
        <>
          {audioRow("add-media", t("home.add.mediaKeys"), t("home.add.mediaKeysSub"), [{ kind: "media", key: "prev" }, { kind: "media", key: "playPause" }, { kind: "media", key: "next" }])}
          {audioRow("add-volume", t("home.add.volumeKeys"), t("home.add.volumeKeysSub"), [{ kind: "volume", delta: -5 }, { kind: "volume", delta: 5 }])}
          {audioRow("add-mute", t("home.deck.mute"), null, [{ kind: "mute" }])}
          <View style={styles.row}>
            {dot}
            <View style={styles.grow}>
              <AppText numberOfLines={1}>{t("home.add.outputKey")}</AppText>
              <AppText kind="small" muted>
                {t("home.add.outputKeySub")}
              </AppText>
            </View>
            <Button testID="add-output" kind="secondary" label={t("home.add.add")} onPress={() => setPickingOutput(true)} disabled={busy || full || offerable.length === 0 || audio?.available.defaultOutput === false} style={styles.btn} />
          </View>
        </>
      ) : (
        <Notice tone="info">{t("home.add.audioOff")}</Notice>
      )}
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, minHeight: 48 },
  grow: { flex: 1 },
  btn: { minHeight: 48, paddingHorizontal: spacing.md },
  dot: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  actions: { alignItems: "flex-end", marginTop: spacing.md },
});
