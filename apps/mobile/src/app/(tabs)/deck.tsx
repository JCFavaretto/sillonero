import type { DeckItem } from "@proyecto-e/protocol";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useApps } from "@/apps/store";
import { useAudio } from "@/audio/store";
import { AddKeySheet } from "@/components/AddKeySheet";
import { AddLauncherSheet } from "@/components/AddLauncherSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DeckChips, DeckDots, DeckPager } from "@/components/DeckPager";
import { ChooserSheet, DecksSheet, GridSheet, KeySheet } from "@/components/DeckSheets";
import { SoundSheet } from "@/components/SoundSheet";
import { MigrationDialog } from "@/components/MigrationDialog";
import { RunSheet } from "@/components/RunSheet";
import { EmptySlot, SlotKey } from "@/components/SlotKey";
import { AppText, Button, Notice, Screen } from "@/components/ui";
import { useConn } from "@/connection";
import { initDecks } from "@/decks/init";
import { pickDeckImage } from "@/decks/images";
import { playSoundKey } from "@/decks/sound";
import { pickSoundFile, type PickedSound } from "@/decks/soundIo";
import type { Deck, DeckSlot, KeyAction } from "@/decks/model";
import { pressSlot } from "@/decks/press";
import { resolveSlot } from "@/decks/resolve";
import { currentDeck, decksActions, getDecksStorage, newKeyId, useDecks } from "@/decks/store";
import { tap } from "@/haptics";
import { useLayout } from "@/layout/useLayout";
import { useScreens } from "@/screens/store";
import { siteOf } from "@/links";
import { colors, spacing } from "@/theme";

const ERROR_MS = 4_000;

/** Qué se está haciendo con una tecla: "new" en un lugar vacío, o cambiarle la acción a una que ya está. */
type Pick = { at: number; replace: boolean } | null;

/**
 * Escenas como decks (boceto rediseño 04, 05 y 06; D103 y D104): hasta 32 decks de teclas con imagen que viven en el celu. Un
 * toque ejecuta la tecla; deslizar pasa al deck vecino. Editar deja cambiar la grilla, el nombre y los decks, y tocar una tecla
 * abre su hoja. Las escenas, las pantallas y el audio siguen en la PC: la tecla solo lo pide.
 */
export default function DeckTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isLandscape } = useLayout();
  const online = useConn((s) => s.status) === "online";
  const status = useConn((s) => s.status);
  const library = useApps((s) => s.library);
  const run = useApps((s) => s.run);
  const monitors = useScreens((s) => s.monitors);
  const audio = useAudio((s) => s.audio);
  const data = useDecks((s) => s.data);
  const deck = useDecks(currentDeck);
  const animate = useDecks((s) => s.animate);
  const recovered = useDecks((s) => s.recovered);
  const saveError = useDecks((s) => s.saveError);

  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<number | null>(null);
  const [pick, setPick] = useState<Pick>(null);
  const [chooser, setChooser] = useState<"pc" | "target" | "sound" | null>(null);
  /** El sonido que se está eligiendo: el archivo ya está guardado en el celu con su nombre final. */
  const [soundDraft, setSoundDraft] = useState<{ file: string; name: string } | null>(null);
  const [soundError, setSoundError] = useState<string | null>(null);
  const [soundTesting, setSoundTesting] = useState(false);
  const [moving, setMoving] = useState<number | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [decksOpen, setDecksOpen] = useState<null | { rename: string | null }>(null);
  const [confirm, setConfirm] = useState<{ kind: "key"; index: number } | { kind: "deck"; id: string } | null>(null);
  const [showRun, setShowRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<{ text: string; big: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => void timers.current.push(setTimeout(fn, ms));

  useEffect(() => {
    void initDecks(t("decks.firstName"));
  }, [t]);

  // En Android, Atrás sale del modo editar en vez de salir de la pestaña.
  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setEditing(false);
      setMoving(null);
      return true;
    });
    return () => sub.remove();
  }, [editing]);

  // Lo que apunta a un lugar de un deck (mover, la hoja de una tecla, agregar) no sobrevive a cambiar de deck ni a cambiar la grilla.
  const deckKey = deck ? `${deck.id}:${deck.slots.length}` : "";
  const [seenKey, setSeenKey] = useState(deckKey);
  if (seenKey !== deckKey) {
    setSeenKey(deckKey);
    setMoving(null);
    setSheet(null);
    setPick(null);
    setChooser(null);
  }

  if (!data || !deck) {
    return (
      <Screen>
        <AppText kind="title">{t("tabs.scenes")}</AppText>
      </Screen>
    );
  }

  const storage = getDecksStorage();
  const index = data.decks.findIndex((d) => d.id === deck.id);
  const running = run && !run.finished ? run.sceneId : null;
  const runScene = library?.scenes.find((s) => s.id === run?.sceneId) ?? null;
  const cols = (d: Deck) => (isLandscape ? d.rows : d.cols);
  const keyFor = (s: DeckSlot) => resolveSlot(s, library, monitors, audio);

  async function press(slot: DeckSlot) {
    if (!online) return;
    tap();
    setError(null);
    const r = await pressSlot(slot, keyFor(slot), monitors);
    if (r.ok) {
      setFailed(null);
      if (r.toast) {
        setToast(t("home.deck.volumeToast", r.toast));
        later(() => setToast(null), 1_000);
      }
      return;
    }
    setError(t(r.error, r.vars));
    if (r.flag) {
      setFailed(slot.id);
      later(() => setFailed(null), ERROR_MS);
    }
  }

  /** Pone una acción en un lugar: nueva tecla en un lugar vacío, o cambia lo que hace una que ya está (conserva imagen y nombre). */
  function putAction(action: KeyAction, label: string | null, iconKey: string | null) {
    if (!pick || !deck) return;
    const old = deck.slots[pick.at];
    if (pick.replace && old) decksActions.setSlot(deck.id, pick.at, { ...old, action, label: label || old.label, iconKey });
    else decksActions.setSlot(deck.id, pick.at, { id: newKeyId(), label: (label ?? "").slice(0, 24), action, image: null, iconKey });
  }
  const finishPick = () => (setPick(null), setChooser(null));

  async function choosePicture(slot: DeckSlot, index: number, firstFrameOnly = false) {
    setImageError(null);
    const deckId = deck?.id;
    const r = await pickDeckImage(firstFrameOnly);
    if (r.ok) {
      if (!storage || !deckId) return;
      const file = `${slot.id}_${Date.now().toString(36)}.${r.ext}`;
      await storage.writeImage(file, r.base64);
      // Después de esperar al selector y al disco, la tecla puede haberse movido o borrado: se vuelve a mirar antes de tocarla.
      const now = useDecks.getState().data?.decks.find((d) => d.id === deckId)?.slots[index];
      if (!now || now.id !== slot.id) return void (await storage.removeImage(file));
      decksActions.setSlot(deckId, index, { ...now, image: { file, animated: r.animated } });
    } else if (r.reason === "permission") setImageError({ text: t("decks.image.permission"), big: false });
    else if (r.reason === "tooBig") setImageError({ text: t("decks.image.tooBig", { mb: (r.bytes / 1048576).toFixed(1) }), big: true });
    else if (r.reason === "failed") setImageError({ text: t("decks.image.failed"), big: false });
  }

  /** Elegir el archivo de un sonido: se guarda ya en el celu con el nombre que va a tener (si se cancela, se borra). */
  async function chooseSound() {
    setSoundError(null);
    const r: PickedSound = await pickSoundFile();
    if (!r.ok) {
      if (r.reason !== "canceled") setSoundError(r.reason === "type" ? "decks.sound.typeError" : r.reason === "tooBig" ? "decks.sound.tooLarge" : "decks.sound.failed");
      return;
    }
    if (!storage) return;
    const file = `s_sound_${newKeyId().slice(2)}.${r.ext}`;
    await storage.writeImage(file, r.base64);
    if (soundDraft) await storage.removeImage(soundDraft.file).catch(() => undefined);
    setSoundDraft({ file, name: r.name });
  }
  const closeSound = () => {
    if (soundDraft && storage) void storage.removeImage(soundDraft.file).catch(() => undefined);
    setSoundDraft(null);
    setSoundError(null);
    finishPick();
  };

  const actionText = (s: DeckSlot) => {
    const a = s.action;
    if (a.kind === "scene") {
      const name = library?.scenes.find((x) => x.id === a.id)?.name;
      return name ? t("decks.action.scene", { name }) : t("decks.action.sceneGone");
    }
    if (a.kind === "link") return t("decks.action.link", { site: siteOf(a.url) });
    return t(`decks.action.${a.kind}`);
  };

  const renderDeck = (d: Deck, active: boolean) => {
    const c = cols(d);
    const rows = Math.ceil(d.slots.length / c);
    const aspectRatio = isLandscape ? 1.5 : 1;
    const empty = d.slots.every((s) => s === null);
    return (
      <View testID={`deck-${d.id}`} style={styles.grid}>
        {empty && !editing && (
          <AppText kind="small" muted>
            {t("decks.hint")}
          </AppText>
        )}
        {Array.from({ length: rows }, (_, r) => (
          <View key={r} style={styles.row}>
            {Array.from({ length: c }, (_, k) => {
              const i = r * c + k;
              const s = d.slots[i];
              if (s === undefined) return <View key={k} style={styles.gap} />;
              if (s === null) return <EmptySlot key={k} testID={`slot-${i}`} n={i + 1} aspectRatio={aspectRatio} disabled={!active} onPress={() => (moving !== null ? (decksActions.moveSlot(d.id, moving, i), setMoving(null)) : (setPick({ at: i, replace: false }), setChooser(null)))} />;
              const view = keyFor(s);
              return (
                <SlotKey
                  key={s.id}
                  testID={`slot-${i}`}
                  view={view}
                  imageUri={s.image && storage ? storage.imageUri(s.image.file) : null}
                  animated={s.image?.animated === true}
                  animate={animate && active && !editing}
                  aspectRatio={aspectRatio}
                  editing={editing}
                  picked={moving === i}
                  disabled={!online}
                  state={failed === s.id ? "error" : s.action.kind === "scene" && s.action.id === running ? "running" : "idle"}
                  onPress={() => (editing ? (moving !== null ? (moving === i ? setMoving(null) : (decksActions.moveSlot(d.id, moving, i), setMoving(null))) : setSheet(i)) : void press(s))}
                  onLongPress={() => !editing && setEditing(true)}
                  onRemove={() => setConfirm({ kind: "key", index: i })}
                />
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const titleRight = editing ? (
    <Button testID="edit-done" label={t("decks.done")} onPress={() => (setEditing(false), setMoving(null))} style={styles.small} />
  ) : (
    <Button testID="edit-start" kind="secondary" label={t("decks.edit")} onPress={() => (tap(), setEditing(true))} style={styles.small} />
  );

  return (
    <Screen>
      <View style={styles.header}>
        {isLandscape ? (
          <Pressable testID="deck-title" accessibilityRole="button" accessibilityLabel={t("decks.deckPicker", { name: deck.name })} onPress={() => setDecksOpen({ rename: null })} style={styles.titleBtn}>
            <AppText kind="title" numberOfLines={1}>{`${deck.name} ▾`}</AppText>
          </Pressable>
        ) : (
          <AppText kind="title">{t("tabs.scenes")}</AppText>
        )}
        {titleRight}
      </View>
      {status === "offline" && <Notice>{t("deckTab.offline")}</Notice>}
      {recovered && <Notice>{t("decks.recovered")}</Notice>}
      {saveError && <Notice>{t("decks.saveError")}</Notice>}
      {error && <Notice>{error}</Notice>}
      {toast && (
        <Notice tone="info" live>
          {toast}
        </Notice>
      )}
      {imageError && (
        <View style={styles.imageError}>
          <Notice>{imageError.text}</Notice>
          {imageError.big && sheet !== null && deck.slots[sheet] && <Button kind="secondary" label={t("decks.image.firstFrame")} onPress={() => void choosePicture(deck.slots[sheet]!, sheet, true)} />}
        </View>
      )}
      {!isLandscape && data.decks.length > 1 && <DeckChips decks={data.decks} currentId={deck.id} onSelect={decksActions.select} onMore={data.decks.length > 5 ? () => setDecksOpen({ rename: null }) : undefined} />}
      {editing && (
        <View testID="edit-tools" style={styles.tools}>
          <Button kind="secondary" label={t("decks.tools.grid", { cols: deck.cols, rows: deck.rows })} onPress={() => setGridOpen(true)} style={styles.tool} />
          <Button kind="secondary" label={t("decks.tools.name")} onPress={() => setDecksOpen({ rename: deck.id })} style={styles.tool} />
          <Button kind="secondary" label={t("decks.tools.decks")} onPress={() => setDecksOpen({ rename: null })} style={styles.tool} />
          <Button kind="secondary" label={t("decks.tools.scenes")} onPress={() => router.push("/scenes")} style={styles.tool} />
        </View>
      )}
      {moving !== null && deck.slots[moving] && (
        <View testID="moving-bar">
          <Notice tone="info">{t("decks.moving", { name: keyFor(deck.slots[moving]!).label ?? deck.slots[moving]!.label })}</Notice>
          <Button kind="secondary" label={t("decks.cancel")} onPress={() => setMoving(null)} />
        </View>
      )}
      <View style={!online && !editing ? styles.stale : undefined}>
        <DeckPager decks={data.decks} index={index} scrollEnabled={!editing} onIndex={(i) => decksActions.select(data.decks[i]!.id)} renderDeck={renderDeck} />
      </View>
      <DeckDots count={data.decks.length} index={index} />
      {!editing && (
        <Pressable testID="scenes-link" accessibilityRole="button" accessibilityLabel={t("decks.scenesLink")} onPress={() => router.push("/scenes")} style={styles.link}>
          <AppText kind="small" style={{ color: colors.accent }}>
            {`${t("decks.scenesLink")} ›`}
          </AppText>
        </Pressable>
      )}

      {running && runScene && !showRun && (
        <Pressable testID="run-bar" accessibilityRole="button" onPress={() => setShowRun(true)} style={styles.runBar}>
          <AppText kind="small" style={{ color: colors.accent, flex: 1 }}>
            {t("home.running", { name: runScene.name, current: Math.min(run!.steps.filter((s) => s !== "wait" && s !== "running").length + 1, runScene.steps.length), total: runScene.steps.length })}
          </AppText>
          <AppText kind="small" style={{ color: colors.accent, textDecorationLine: "underline" }}>
            {t("home.runView")}
          </AppText>
        </Pressable>
      )}

      {sheet !== null && deck.slots[sheet] && !pick && !chooser && (
        <KeySheet
          slot={deck.slots[sheet]!}
          view={keyFor(deck.slots[sheet]!)}
          imageUri={deck.slots[sheet]!.image && storage ? storage.imageUri(deck.slots[sheet]!.image!.file) : null}
          index={sheet}
          total={deck.slots.length}
          deckName={deck.name}
          actionText={actionText(deck.slots[sheet]!)}
          error={null}
          onRename={(name) => decksActions.setSlot(deck.id, sheet, { ...deck.slots[sheet]!, label: name.trim() })}
          onChangeAction={() => setPick({ at: sheet, replace: true })}
          onPickImage={() => void choosePicture(deck.slots[sheet]!, sheet)}
          onClearImage={() => decksActions.setSlot(deck.id, sheet, { ...deck.slots[sheet]!, image: null })}
          onMove={() => (setMoving(sheet), setSheet(null))}
          onRemove={() => setConfirm({ kind: "key", index: sheet })}
          onClose={() => (setSheet(null), setImageError(null))}
        />
      )}
      {pick && !chooser && <ChooserSheet onPc={() => setChooser("pc")} onTarget={() => setChooser("target")} onSound={() => setChooser("sound")} onClose={() => setPick(null)} />}
      {pick && chooser === "sound" && (
        <SoundSheet
          audio={audio}
          picked={soundDraft?.name ?? null}
          error={soundError}
          testing={soundTesting}
          onPickFile={() => void chooseSound()}
          onTest={async (c) => {
            if (!soundDraft) return;
            setSoundTesting(true);
            setSoundError(null);
            const r = await playSoundKey({ kind: "sound", file: soundDraft.file, outputId: c.outputId, volume: c.volume }, storage);
            setSoundTesting(false);
            if (!r.ok) setSoundError(r.error);
          }}
          onUse={(c) => {
            if (!soundDraft) return;
            putAction({ kind: "sound", file: soundDraft.file, outputId: c.outputId, volume: c.volume }, c.name.slice(0, 24), null);
            setSoundDraft(null);
            finishPick();
          }}
          onClose={closeSound}
        />
      )}
      {pick && chooser === "pc" && library && (
        <AddKeySheet
          library={library}
          deck={[]}
          monitors={monitors}
          audio={audio}
          onAdd={async (item: DeckItem) => {
            if (item.kind === "launcher") return { ok: true };
            putAction(item, null, null);
            if (pick.replace) finishPick();
            else {
              // Las siguientes (Media agrega tres) van al próximo hueco; si no queda ninguno, se termina (nunca se pisa una tecla).
              const next = deck.slots.findIndex((s, i) => s === null && i > pick.at);
              if (next < 0) finishPick();
              else setPick({ at: next, replace: false });
            }
            return { ok: true };
          }}
          onCreateScene={() => (finishPick(), router.push("/scenes/new"))}
          onCreateLauncher={() => setChooser("target")}
          onClose={finishPick}
        />
      )}
      {pick && chooser === "target" && (
        <AddLauncherSheet
          onClose={finishPick}
          onPick={(target, name, iconKey) => {
            putAction(target.kind === "app" ? { kind: "app", appId: target.appId } : { kind: "link", url: target.url, ...(target.open && target.open !== "tab" ? { open: target.open } : {}) }, name, iconKey);
            finishPick();
          }}
        />
      )}
      {gridOpen && <GridSheet deck={deck} onApply={(c, r) => decksActions.setGrid(deck.id, c, r)} onClose={() => setGridOpen(false)} />}
      {decksOpen && (
        <DecksSheet
          decks={data.decks}
          currentId={deck.id}
          initialEditing={decksOpen.rename}
          onSelect={decksActions.select}
          onMove={decksActions.moveDeck}
          onDelete={(id) => setConfirm({ kind: "deck", id })}
          onRename={decksActions.renameDeck}
          onCreate={(name) => void decksActions.createDeck(name)}
          onClose={() => setDecksOpen(null)}
        />
      )}
      {confirm?.kind === "key" && deck.slots[confirm.index] && (
        <ConfirmDialog
          title={t("decks.confirm.removeTitle", { name: keyFor(deck.slots[confirm.index]!).label || deck.slots[confirm.index]!.label || "…" })}
          detail={t("decks.confirm.removeDetail")}
          confirmLabel={t("decks.confirm.remove")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            decksActions.setSlot(deck.id, confirm.index, null);
            setConfirm(null);
            setSheet(null);
          }}
        />
      )}
      {confirm?.kind === "deck" && (
        <ConfirmDialog
          title={t("decks.confirm.deckTitle", { name: data.decks.find((d) => d.id === confirm.id)?.name ?? "" })}
          detail={t("decks.confirm.deckDetail", { n: (() => { const d = data.decks.find((x) => x.id === confirm.id); return d ? d.slots.filter(Boolean).length + d.extra.length : 0; })() })}
          confirmLabel={t("decks.confirm.deck")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            decksActions.deleteDeck(confirm.id);
            setConfirm(null);
          }}
        />
      )}
      {showRun && runScene && run && (
        <RunSheet
          scene={runScene}
          run={run}
          onClose={() => setShowRun(false)}
          onEdit={() => {
            setShowRun(false);
            router.push(`/scenes/${runScene.id}`);
          }}
        />
      )}
      <MigrationDialog online={online} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  titleBtn: { flex: 1, minHeight: 48, justifyContent: "center" },
  small: { minHeight: 48, paddingHorizontal: spacing.lg },
  tools: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tool: { flexGrow: 1, minHeight: 48 },
  grid: { gap: spacing.sm, paddingVertical: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm },
  gap: { flex: 1 },
  stale: { opacity: 0.5 },
  link: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  imageError: { gap: spacing.sm },
  runBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.accentSoft, borderRadius: 12, padding: spacing.md, borderWidth: 1, borderColor: colors.accent },
});
