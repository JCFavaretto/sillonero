import { SCENE_KEYS, type Monitor, type SceneHotkey, type SceneTrigger } from "@proyecto-e/protocol";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { hotkeyText, isReserved, monitorName, RESERVED_KEYS, triggerKind, type TriggerKind } from "@/apps/sceneAuto";
import { Sheet } from "@/components/Sheet";
import { AppText, Button } from "@/components/ui";
import { colors, radius, spacing, touch } from "@/theme";

/**
 * Hoja "Atajo" (boceto atajos 01 B y C): grilla de teclas para Ctrl+Alt+<tecla>. Las que ya tienen dueño van tachadas;
 * tocar una no la elige y dice de quién es. Nada se guarda hasta "Listo" y "Guardar" en el editor.
 */
export function HotkeySheet({
  sceneName,
  current,
  takenByScene,
  onSave,
  onClose,
}: {
  sceneName: string;
  current: SceneHotkey | null;
  /** Teclas de otras escenas: tecla → nombre de la escena. */
  takenByScene: ReadonlyMap<string, string>;
  onSave: (key: SceneHotkey | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<SceneHotkey | null>(current);
  const [blocked, setBlocked] = useState<string | null>(null);

  const all: string[] = [...SCENE_KEYS, ...RESERVED_KEYS];
  function press(key: string) {
    if (isReserved(key)) return setBlocked(t("scenes.hotkey.ownedBy", { key: hotkeyText(key), owner: t(`scenes.hotkey.owner.${key}`) }));
    const other = takenByScene.get(key);
    if (other !== undefined) return setBlocked(t("scenes.hotkey.takenScene", { key: hotkeyText(key as SceneHotkey), name: other }));
    setBlocked(null);
    setSelected(key as SceneHotkey);
  }

  return (
    <Sheet onClose={onClose} testID="hotkey-sheet">
      <AppText kind="heading">{t("scenes.hotkey.title", { name: sceneName || t("scenes.newTitle") })}</AppText>
      <AppText kind="small" muted>
        {selected ? hotkeyText(selected) : t("scenes.hotkey.none")}
      </AppText>
      <View style={styles.grid}>
        {all.map((key) => {
          const taken = isReserved(key) || takenByScene.has(key);
          const on = key === selected;
          return (
            <Pressable
              key={key}
              testID={`hotkey-${key}`}
              accessibilityRole="button"
              accessibilityLabel={taken ? t("scenes.hotkey.keyTaken", { key }) : key}
              accessibilityState={{ selected: on, disabled: taken }}
              onPress={() => press(key)}
              style={[styles.key, on && styles.keyOn, taken && styles.keyTaken]}
            >
              <AppText kind="key" style={[on && { color: colors.accentText }, taken && styles.strike]}>
                {key}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <AppText kind="small" muted={!blocked} style={blocked ? { color: colors.danger } : undefined}>
        {blocked ?? (selected ? t("scenes.hotkey.free") : t("scenes.hotkey.hint"))}
      </AppText>
      <View style={styles.actions}>
        <Button kind="secondary" label={t("scenes.hotkey.remove")} onPress={() => onSave(null)} />
        <Button label={t("scenes.step.done")} onPress={() => onSave(selected)} disabled={selected === null} />
      </View>
    </Sheet>
  );
}

/**
 * Hoja "Ejecutar solo" (boceto atajos 01 D): a mano, al iniciar el agente, o al prender una pantalla. Una sola a la vez.
 */
export function TriggerSheet({
  current,
  monitors,
  screenLabel,
  onSave,
  onClose,
}: {
  current: SceneTrigger | null;
  monitors: Monitor[];
  screenLabel: (n: number) => string;
  onSave: (trigger: SceneTrigger | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<TriggerKind>(triggerKind(current));
  const [displayId, setDisplayId] = useState<string | null>(current?.type === "displayOn" ? current.displayId : null);

  // Si la pantalla guardada ya no se conoce, igual se ofrece (para poder verla y cambiarla).
  const choices = [...monitors.map((m) => ({ id: m.id, name: monitorName(monitors, m.id, screenLabel) ?? m.name }))];
  if (displayId !== null && !choices.some((c) => c.id === displayId)) choices.push({ id: displayId, name: t("scenes.step.unknownScreen") });

  const options: { value: TriggerKind; title: string; detail: string }[] = [
    { value: "manual", title: t("scenes.trigger.manual"), detail: t("scenes.trigger.manualDetail") },
    { value: "agentStart", title: t("scenes.trigger.agentStart"), detail: t("scenes.trigger.agentStartDetail") },
    { value: "displayOn", title: t("scenes.trigger.displayOn"), detail: t("scenes.trigger.displayOnDetail") },
  ];

  function save() {
    if (kind === "manual") onSave(null);
    else if (kind === "agentStart") onSave({ type: "agentStart" });
    else if (displayId !== null) onSave({ type: "displayOn", displayId });
  }

  return (
    <Sheet onClose={onClose} testID="trigger-sheet">
      <AppText kind="heading">{t("scenes.trigger.title")}</AppText>
      <View accessibilityRole="radiogroup" style={styles.group}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          testID={`trigger-${o.value}`}
          accessibilityRole="radio"
          accessibilityLabel={o.title}
          accessibilityState={{ selected: kind === o.value }}
          onPress={() => setKind(o.value)}
          style={[styles.option, kind === o.value && styles.optionOn]}
        >
          <AppText kind="key" decorative>{kind === o.value ? "●" : "○"}</AppText>
          <View style={styles.grow}>
            <AppText>{o.title}</AppText>
            <AppText kind="small" muted>
              {o.detail}
            </AppText>
          </View>
        </Pressable>
      ))}
      </View>
      {kind === "displayOn" && (
        <View style={styles.choices}>
          {choices.length === 0 && (
            <AppText kind="small" muted>
              {t("scenes.trigger.noScreens")}
            </AppText>
          )}
          {choices.map((c) => (
            <Button key={c.id} testID={`display-${c.id}`} kind="secondary" label={c.name} selected={displayId === c.id} onPress={() => setDisplayId(c.id)} style={displayId === c.id ? styles.optionOn : undefined} />
          ))}
        </View>
      )}
      {kind !== "manual" && (
        <AppText kind="small" muted>
          {t("scenes.trigger.guard")}
        </AppText>
      )}
      <View style={styles.actions}>
        <Button kind="secondary" label={t("common.cancel")} onPress={onClose} />
        <Button label={t("scenes.step.done")} onPress={save} disabled={kind === "displayOn" && displayId === null} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: spacing.sm },
  key: { width: "12.5%", minWidth: touch, flexGrow: 1, minHeight: touch, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  keyOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  keyTaken: { opacity: 0.4 },
  strike: { textDecorationLine: "line-through" },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", marginTop: spacing.md },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch + 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  optionOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choices: { gap: spacing.sm },
  group: { gap: spacing.sm },
});
