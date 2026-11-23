import type { AudioState, Monitor, Step, Zone } from "@proyecto-e/protocol";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { outputLabel } from "@/audio/view";
import { AppIcon } from "@/components/AppIcon";
import { AppPicker } from "@/components/AppPicker";
import { isHttpUrl } from "@/components/AddLauncherSheet";
import { Sheet } from "@/components/Sheet";
import { VolumeSlider } from "@/components/VolumeSlider";
import { AppText, Button, Notice } from "@/components/ui";
import { PlacePicker } from "@/components/ZonePicker";
import { colors, radius, spacing, touch, type } from "@/theme";

type Kind = "screens" | "app" | "link" | "audio";
type Pick = "keep" | "on" | "off";

const siteOf = (u: string) => (/^https?:\/\/([^/?#]+)/i.exec(u.trim())?.[1] ?? "").replace(/^www\./i, "").slice(0, 32);

/**
 * Agregar o editar un paso de una escena (boceto apps-escenas 11): primero el tipo, después la configuración.
 * "Juntar todo" no se configura: se agrega directo.
 */
export function StepSheet({
  initial,
  monitors,
  audio = null,
  onSave,
  onClose,
}: {
  initial: Step | null;
  monitors: Monitor[];
  /** El estado de audio de la PC (B4): de ahí salen las salidas que se pueden elegir. */
  audio?: AudioState | null;
  onSave: (step: Step) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const startKind: Kind | null = initial ? (initial.kind === "screens" ? "screens" : initial.kind === "open" ? (initial.target.kind === "app" ? "app" : "link") : initial.kind === "audio" ? "audio" : null) : null;
  const [kind, setKind] = useState<Kind | null>(startKind);

  // Pantallas
  const [picks, setPicks] = useState<Record<string, Pick>>(() => {
    const out: Record<string, Pick> = {};
    if (initial?.kind === "screens") for (const m of initial.monitors) out[m.monitorId] = m.enabled ? "on" : "off";
    return out;
  });
  // Abrir app / link
  const [app, setApp] = useState<{ appId: string; name: string; iconKey: string } | null>(
    initial?.kind === "open" && initial.target.kind === "app" ? { appId: initial.target.appId, name: initial.name, iconKey: initial.iconKey ?? "" } : null,
  );
  const [url, setUrl] = useState(initial?.kind === "open" && initial.target.kind === "url" ? initial.target.url : "");
  const [placeMonitor, setPlaceMonitor] = useState<string | null>(initial?.kind === "open" ? (initial.place?.monitorId ?? null) : null);
  const [zone, setZone] = useState<Zone>(initial?.kind === "open" ? (initial.place?.zone ?? "keep") : "keep");

  // Audio (D37)
  const [outputId, setOutputId] = useState<string | null>(initial?.kind === "audio" ? initial.outputId : null);
  const [makeDefault, setMakeDefault] = useState(initial?.kind === "audio" ? initial.makeDefault : true);
  const [setsVolume, setSetsVolume] = useState(initial?.kind === "audio" ? initial.volume !== null : false);
  const [volume, setVolume] = useState(initial?.kind === "audio" && initial.volume !== null ? initial.volume : 30);

  const nextPick = (p: Pick, canOff: boolean): Pick => (p === "keep" ? "on" : p === "on" ? (canOff ? "off" : "keep") : "keep");
  const place = zone === "keep" ? null : { monitorId: placeMonitor ?? monitors[0]?.id ?? "", zone };

  const types: { k: Kind | "bringAll"; title: string; detail: string }[] = [
    { k: "screens", title: t("scenes.step.type.screens"), detail: t("scenes.step.type.screensDetail") },
    { k: "app", title: t("scenes.step.type.app"), detail: t("scenes.step.type.appDetail") },
    { k: "link", title: t("scenes.step.type.link"), detail: t("scenes.step.type.linkDetail") },
    { k: "bringAll", title: t("scenes.step.type.bringAll"), detail: t("scenes.step.type.bringAllDetail") },
    { k: "audio", title: t("scenes.step.type.audio"), detail: t("scenes.step.type.audioDetail") },
  ];

  const header = (title: string) => <AppText kind="heading">{title}</AppText>;
  const footer = (ok: boolean, save: () => void) => (
    <View style={styles.actions}>
      <Button kind="secondary" label={initial ? t("common.cancel") : t("common.back")} onPress={initial ? onClose : () => setKind(null)} />
      <Button label={t("scenes.step.done")} disabled={!ok} onPress={save} />
    </View>
  );

  if (kind === null) {
    return (
      <Sheet onClose={onClose} testID="step-sheet">
        {header(t("scenes.step.new"))}
        {types.map((x) => (
          <Pressable
            key={x.k}
            testID={`type-${x.k}`}
            accessibilityRole="button"
            onPress={() => (x.k === "bringAll" ? onSave({ kind: "bringAll" }) : setKind(x.k))}
            style={styles.type}
          >
            <View style={styles.grow}>
              <AppText>{x.title}</AppText>
              <AppText kind="small" muted>
                {x.detail}
              </AppText>
            </View>
            <AppText muted>›</AppText>
          </Pressable>
        ))}
        <View style={styles.actions}>
          <Button kind="secondary" label={t("common.cancel")} onPress={onClose} />
        </View>
      </Sheet>
    );
  }

  if (kind === "audio") {
    const audioOk = audio?.available.audio === true;
    // Las salidas que se ofrecen: las activas y las que tienen apodo (la tele apagada), nunca las ocultas sin apodo.
    const offered = (audio?.outputs ?? []).filter((o) => o.state === "active" || o.nick !== null).filter((o) => !(o.hidden && o.nick === null));
    const something = makeDefault || setsVolume;
    const ok = audioOk && outputId !== null && something;
    return (
      <Sheet tall dismissOnBackdrop={false} onClose={onClose} testID="step-sheet">
        {header(t("scenes.step.audioTitle"))}
        {!audioOk ? (
          <Notice tone="info">{t("scenes.step.audioOff")}</Notice>
        ) : (
          <>
            <AppText kind="label" muted>
              {t("scenes.step.audioOutput")}
            </AppText>
            <View style={styles.chips}>
              {offered.map((o) => (
                <Pressable
                  key={o.id}
                  testID={`audio-out-${o.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={outputLabel(o)}
                  accessibilityState={{ selected: outputId === o.id }}
                  onPress={() => setOutputId(o.id)}
                  style={[styles.chip, outputId === o.id && styles.chipOn]}
                >
                  <AppText kind="small" style={{ color: outputId === o.id ? colors.accent : colors.text }}>
                    {outputLabel(o)}
                  </AppText>
                </Pressable>
              ))}
            </View>
            <View style={styles.switchRow}>
              <View style={styles.grow}>
                <AppText>{t("scenes.step.audioMakeDefault")}</AppText>
                <AppText kind="small" muted>
                  {t("scenes.step.audioMakeDefaultSub")}
                </AppText>
              </View>
              <Switch accessibilityLabel={t("scenes.step.audioMakeDefault")} value={makeDefault} onValueChange={setMakeDefault} trackColor={{ true: colors.accent, false: colors.border }} />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.grow}>
                <AppText>{t("scenes.step.audioSetVolume")}</AppText>
                {setsVolume && (
                  <View style={styles.volumeRow}>
                    <VolumeSlider sliderKey="step-audio" value={volume} label={t("scenes.step.audioVolumeLabel")} onChange={setVolume} testID="step-audio-volume" />
                    <AppText kind="data" muted>
                      {volume}
                    </AppText>
                  </View>
                )}
              </View>
              <Switch accessibilityLabel={t("scenes.step.audioSetVolume")} value={setsVolume} onValueChange={setSetsVolume} trackColor={{ true: colors.accent, false: colors.border }} />
            </View>
            {!something && <Notice>{t("scenes.step.audioNothing")}</Notice>}
          </>
        )}
        {footer(ok, () => onSave({ kind: "audio", outputId: outputId!, makeDefault, volume: setsVolume ? volume : null }))}
      </Sheet>
    );
  }

  if (kind === "screens") {
    const enabledCount = monitors.filter((m) => m.enabled).length;
    const chosen = Object.entries(picks).filter(([, p]) => p !== "keep");
    return (
      <Sheet tall dismissOnBackdrop={false} onClose={onClose} testID="step-sheet">
        {header(t("scenes.step.type.screens"))}
        <AppText kind="small" muted>
          {t("scenes.step.screensHelp")}
        </AppText>
        {monitors.map((m) => {
          const p = picks[m.id] ?? "keep";
          return (
            <View key={m.id} style={styles.row}>
              <View style={styles.badge}>
                <AppText kind="data" muted>
                  {m.index ?? "–"}
                </AppText>
              </View>
              <AppText style={styles.grow} numberOfLines={1}>
                {`${m.nickname ?? m.name}${m.primary ? " ★" : ""}`}
              </AppText>
              <Button
                testID={`pick-${m.id}`}
                kind={p === "keep" ? "secondary" : "primary"}
                label={t(`scenes.step.pick.${p}`)}
                onPress={() => setPicks({ ...picks, [m.id]: nextPick(p, !m.primary && enabledCount > 1) })}
                style={styles.pick}
              />
            </View>
          );
        })}
        {footer(chosen.length > 0, () => onSave({ kind: "screens", monitors: chosen.map(([monitorId, p]) => ({ monitorId, enabled: p === "on" })) }))}
      </Sheet>
    );
  }

  const isApp = kind === "app";
  const urlOk = isHttpUrl(url);
  const ok = isApp ? app !== null : urlOk;
  return (
    <Sheet tall dismissOnBackdrop={false} onClose={onClose} testID="step-sheet">
      {header(t(isApp ? "scenes.step.type.app" : "scenes.step.type.link"))}
      {isApp ? (
        app ? (
          <View style={styles.row}>
            <AppIcon iconKey={app.iconKey || null} name={app.name} size={32} />
            <AppText style={styles.grow}>{app.name}</AppText>
            <Button kind="secondary" label={t("scenes.step.change")} onPress={() => setApp(null)} style={styles.pick} />
          </View>
        ) : (
          <AppPicker actionLabel={t("scenes.step.choose")} onPick={(a) => setApp({ appId: a.appId, name: a.name.slice(0, 32), iconKey: a.iconKey })} />
        )
      ) : (
        <View style={styles.form}>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            style={[styles.field, url.length > 0 && !urlOk && { borderColor: colors.danger }]}
            accessibilityLabel={t("apps.add.url")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2048}
          />
          {url.length > 0 && !urlOk && (
            <AppText kind="small" style={{ color: colors.danger }}>
              {t("apps.add.urlInvalid")}
            </AppText>
          )}
          <AppText kind="small" muted>
            {t("scenes.step.linkHelp")}
          </AppText>
        </View>
      )}
      {(isApp ? app !== null : true) && (
        <PlacePicker monitors={monitors} monitorId={placeMonitor} zone={zone} onChange={(m, z) => (setPlaceMonitor(m), setZone(z))} />
      )}
      {footer(ok, () =>
        onSave(
          isApp
            ? { kind: "open", target: { kind: "app", appId: app!.appId }, name: app!.name, iconKey: app!.iconKey || null, place }
            : { kind: "open", target: { kind: "url", url: url.trim() }, name: siteOf(url) || t("scenes.step.linkDefault"), iconKey: null, place },
        ),
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: touch, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch },
  volumeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  type: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch + 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch },
  badge: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  pick: { minHeight: 48, paddingHorizontal: spacing.md },
  form: { gap: spacing.sm },
  field: { ...type.body, minHeight: touch, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", marginTop: spacing.md },
});
