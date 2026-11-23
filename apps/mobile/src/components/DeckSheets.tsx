import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { DeckKey } from "@/apps/deck";
import { MAX_DECKS, MAX_GRID, MAX_NAME, MIN_GRID, setGrid, slotCount, type Deck, type DeckSlot } from "@/decks/model";
import { Sheet } from "@/components/Sheet";
import { SlotKey } from "@/components/SlotKey";
import { AppText, Button, Notice } from "@/components/ui";
import { colors, hairline, radius, spacing, touch, type } from "@/theme";

// Las hojas de los decks (bocetos rediseño 05): la de una tecla, el selector de qué hace, la grilla y la lista de decks.

const field = { ...type.body, minHeight: touch, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text } as const;

/** La hoja de una tecla (05 B): qué hace, nombre, imagen, mover y quitar. Cada cambio se guarda al instante. */
export function KeySheet({
  slot,
  view,
  imageUri,
  index,
  total,
  deckName,
  actionText,
  error,
  onRename,
  onChangeAction,
  onPickImage,
  onClearImage,
  onMove,
  onRemove,
  onClose,
}: {
  slot: DeckSlot;
  view: DeckKey;
  imageUri: string | null;
  index: number;
  total: number;
  deckName: string;
  /** Qué hace, ya escrito ("Corre la escena «Trabajo»"). */
  actionText: string;
  error: string | null;
  onRename: (name: string) => void;
  onChangeAction: () => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onMove: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(slot.label);
  return (
    // Al cerrar con el teclado abierto el campo puede no avisar que terminó: se guarda el nombre al cerrar.
    <Sheet tall onClose={() => (name !== slot.label && onRename(name), onClose())} testID="key-sheet">
      <View style={styles.head}>
        <View style={styles.preview}>
          <SlotKey view={view} imageUri={imageUri} animated={false} animate={false} />
        </View>
        <View style={styles.grow}>
          <AppText kind="heading">{t("decks.keySheet.title")}</AppText>
          <AppText kind="small" muted>
            {t("decks.keySheet.at", { n: index + 1, total, deck: deckName })}
          </AppText>
        </View>
      </View>
      {error && <Notice>{error}</Notice>}
      <AppText kind="label" muted>
        {t("decks.keySheet.does")}
      </AppText>
      <Pressable testID="key-does" accessibilityRole="button" accessibilityLabel={`${t("decks.keySheet.does")}: ${actionText}`} onPress={onChangeAction} style={styles.row}>
        <AppText style={styles.grow} numberOfLines={2}>
          {actionText}
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>
      <AppText kind="label" muted>
        {t("decks.keySheet.name")}
      </AppText>
      <TextInput
        testID="key-name"
        value={name}
        onChangeText={(v) => setName(v.slice(0, MAX_NAME))}
        onEndEditing={() => name !== slot.label && onRename(name)}
        placeholder={t("decks.keySheet.namePlaceholder")}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        accessibilityLabel={t("decks.keySheet.name")}
        maxLength={MAX_NAME}
        style={field}
      />
      <AppText kind="label" muted>
        {slot.image ? t("decks.keySheet.imageIs", { kind: t(slot.image.animated ? "decks.keySheet.animated" : "decks.keySheet.still") }) : t("decks.keySheet.image")}
      </AppText>
      <View style={styles.pair}>
        <Button testID="key-pick" kind="secondary" label={t("decks.keySheet.pick")} onPress={onPickImage} style={styles.half} />
        <Button testID="key-noimage" kind="secondary" label={t("decks.keySheet.noImage")} disabled={!slot.image} onPress={onClearImage} style={styles.half} />
      </View>
      <View style={styles.pair}>
        <Button testID="key-move" kind="secondary" label={t("decks.keySheet.move")} onPress={onMove} style={styles.half} />
        <Button testID="key-remove" kind="secondary" label={t("decks.keySheet.remove")} onPress={onRemove} style={[styles.half, { borderColor: colors.danger }]} />
      </View>
      <View style={styles.actions}>
        <Button kind="secondary" label={t("decks.keySheet.close")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** Qué hace la tecla (05 C): cosas de la PC (escenas, pantallas, audio, ventanas) o un link o una app que se guardan en el celu. */
export function ChooserSheet({ onPc, onTarget, onSound, onClose }: { onPc: () => void; onTarget: () => void; onSound: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const item = (id: string, icon: keyof typeof Ionicons.glyphMap, title: string, detail: string, onPress: () => void) => (
    <Pressable key={id} testID={id} accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} onPress={onPress} style={styles.row}>
      <Ionicons name={icon} size={22} color={colors.accent} />
      <View style={styles.grow}>
        <AppText kind="key">{title}</AppText>
        <AppText kind="small" muted>
          {detail}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
  return (
    <Sheet onClose={onClose} testID="chooser-sheet">
      <AppText kind="heading">{t("decks.chooser.title")}</AppText>
      {item("chooser-pc", "desktop-outline", t("decks.chooser.pc"), t("decks.chooser.pcDetail"), onPc)}
      {item("chooser-target", "link-outline", t("decks.chooser.target"), t("decks.chooser.targetDetail"), onTarget)}
      {item("chooser-sound", "musical-notes-outline", t("decks.chooser.sound"), t("decks.chooser.soundDetail"), onSound)}
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** Cambiar la grilla (05 D): columnas de 2 a 5, filas de 2 a 6. Si se achica y sobran teclas, avisa cuáles quedan afuera. */
export function GridSheet({ deck, onApply, onClose }: { deck: Deck; onApply: (cols: number, rows: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [cols, setCols] = useState(deck.cols);
  const [rows, setRows] = useState(deck.rows);
  const used = slotCount(deck);
  const slots = cols * rows;
  const out = Math.max(0, used - slots);
  const preview = setGrid({ v: 1 as const, decks: [deck] }, deck.id, cols, rows).decks[0]!;
  const stepper = (id: string, title: string, value: number, min: number, max: number, set: (n: number) => void, less: string, more: string) => (
    <View style={styles.stepRow}>
      <AppText kind="key" style={styles.grow}>
        {title}
      </AppText>
      <Pressable testID={`${id}-less`} accessibilityRole="button" accessibilityLabel={less} accessibilityState={{ disabled: value <= min }} disabled={value <= min} onPress={() => set(value - 1)} style={[styles.step, value <= min && styles.dim]}>
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>
      <View testID={`${id}-value`}>
        <AppText kind="heading" style={styles.stepValue}>
          {value}
        </AppText>
      </View>
      <Pressable testID={`${id}-more`} accessibilityRole="button" accessibilityLabel={more} accessibilityState={{ disabled: value >= max }} disabled={value >= max} onPress={() => set(value + 1)} style={[styles.step, value >= max && styles.dim]}>
        <Ionicons name="add" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
  return (
    <Sheet onClose={onClose} testID="grid-sheet">
      <AppText kind="heading">{t("decks.grid.title", { name: deck.name })}</AppText>
      {stepper("cols", t("decks.grid.cols"), cols, MIN_GRID.cols, MAX_GRID.cols, setCols, t("decks.grid.less"), t("decks.grid.more"))}
      {stepper("rows", t("decks.grid.rows"), rows, MIN_GRID.rows, MAX_GRID.rows, setRows, t("decks.grid.lessRows"), t("decks.grid.moreRows"))}
      <View accessibilityElementsHidden importantForAccessibility="no" style={[styles.mini, { aspectRatio: cols / rows }]}>
        {Array.from({ length: rows }, (_, r) => (
          <View key={r} style={styles.miniRow}>
            {Array.from({ length: cols }, (_, c) => (
              <View key={c} style={[styles.miniCell, preview.slots[r * cols + c] ? styles.miniUsed : null]} />
            ))}
          </View>
        ))}
      </View>
      <AppText kind="small" muted style={styles.center}>
        {t("decks.grid.summary", { slots, used: Math.min(used, slots) })}
      </AppText>
      {out > 0 && (
        <View testID="grid-overflow">
          <Notice tone="info">{t("decks.grid.overflow", { slots, out })}</Notice>
        </View>
      )}
      <View style={styles.actions}>
        <Button kind="secondary" label={t("decks.grid.cancel")} onPress={onClose} />
        <Button testID="grid-apply" label={out > 0 ? t("decks.grid.apply") : t("decks.done")} disabled={cols === deck.cols && rows === deck.rows} onPress={() => (onApply(cols, rows), onClose())} />
      </View>
    </Sheet>
  );
}

/** La lista de decks (05 E): ir a uno, subir y bajar, renombrar, borrar y crear (hasta 32). */
export function DecksSheet({
  decks,
  currentId,
  onSelect,
  onMove,
  onDelete,
  onRename,
  onCreate,
  onClose,
  initialEditing = null,
}: {
  decks: Deck[];
  currentId: string;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
  /** Abrir ya renombrando este deck (el botón Nombre de la edición). */
  initialEditing?: string | null;
}) {
  const { t } = useTranslation();
  /** `null` = no se escribe nada; "new" = deck nuevo; un id = renombrando ese. */
  const [editing, setEditing] = useState<string | "new" | null>(initialEditing);
  const [text, setText] = useState(initialEditing ? (decks.find((d) => d.id === initialEditing)?.name ?? "") : "");
  const full = decks.length >= MAX_DECKS;
  const start = (what: string | "new") => {
    setEditing(what);
    setText(what === "new" ? t("decks.list.defaultName", { n: decks.length + 1 }) : (decks.find((d) => d.id === what)?.name ?? ""));
  };
  const save = () => {
    if (editing === "new") onCreate(text);
    else if (editing) onRename(editing, text);
    setEditing(null);
  };
  return (
    <Sheet tall onClose={onClose} testID="decks-sheet">
      <AppText kind="heading">{t("decks.list.title", { n: decks.length, max: MAX_DECKS })}</AppText>
      {decks.map((d, i) => (
        <View key={d.id} testID={`deck-row-${d.id}`} style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("decks.list.open", { name: d.name })} accessibilityState={{ selected: d.id === currentId }} onPress={() => (onSelect(d.id), onClose())} style={styles.grow}>
            <AppText kind="key" style={d.id === currentId ? { color: colors.accent } : undefined} numberOfLines={1}>
              {d.name}
            </AppText>
            <AppText kind="small" muted>
              {t("decks.list.info", { cols: d.cols, rows: d.rows, n: slotCount(d) })}
            </AppText>
          </Pressable>
          <RowButton testID={`deck-rename-${d.id}`} icon="create-outline" label={t("decks.list.rename", { name: d.name })} onPress={() => start(d.id)} />
          <RowButton testID={`deck-up-${d.id}`} icon="chevron-up" label={t("decks.list.up", { name: d.name })} disabled={i === 0} onPress={() => onMove(d.id, -1)} />
          <RowButton testID={`deck-down-${d.id}`} icon="chevron-down" label={t("decks.list.down", { name: d.name })} disabled={i === decks.length - 1} onPress={() => onMove(d.id, 1)} />
          <RowButton testID={`deck-delete-${d.id}`} icon="close" danger label={t("decks.list.delete", { name: d.name })} disabled={decks.length <= 1} onPress={() => onDelete(d.id)} />
        </View>
      ))}
      {editing !== null && (
        <View style={styles.stack}>
          <AppText kind="label" muted>
            {t("decks.list.nameLabel")}
          </AppText>
          <TextInput testID="deck-name" value={text} onChangeText={(v) => setText(v.slice(0, MAX_NAME))} autoFocus selectionColor={colors.accent} accessibilityLabel={t("decks.list.nameLabel")} maxLength={MAX_NAME} style={field} />
          <View style={styles.actions}>
            <Button kind="secondary" label={t("decks.cancel")} onPress={() => setEditing(null)} />
            <Button testID="deck-name-save" label={t("decks.list.save")} disabled={text.trim() === ""} onPress={save} />
          </View>
        </View>
      )}
      {full && <Notice tone="info">{t("decks.list.full", { max: MAX_DECKS })}</Notice>}
      <View style={styles.actions}>
        <Button testID="deck-create" label={t("decks.list.create")} disabled={full || editing !== null} onPress={() => start("new")} />
      </View>
    </Sheet>
  );
}

function RowButton({ icon, label, onPress, disabled = false, danger = false, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; danger?: boolean; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={2} style={[styles.rowBtn, disabled && styles.dim]}>
      <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  preview: { width: 72 },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touch + 4, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface },
  rowBtn: { width: 48, height: touch, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  dim: { opacity: 0.3 },
  pair: { flexDirection: "row", gap: spacing.sm },
  half: { flex: 1, minHeight: 48 },
  stack: { gap: spacing.sm },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  step: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  stepValue: { minWidth: 28, textAlign: "center" },
  mini: { alignSelf: "center", width: 120, maxHeight: 140, gap: 3 },
  miniRow: { flex: 1, flexDirection: "row", gap: 3 },
  miniCell: { flex: 1, borderRadius: 4, backgroundColor: colors.border },
  miniUsed: { backgroundColor: colors.accent },
  center: { textAlign: "center" },
});
