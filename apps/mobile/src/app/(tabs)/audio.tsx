import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { audioActions } from "@/audio/actions";
import { useAudio } from "@/audio/store";
import { visibleOutputs } from "@/audio/view";
import { AudioAppRow } from "@/components/AudioAppRow";
import { MediaSheet } from "@/components/MediaSheet";
import { NowPlayingCard } from "@/components/NowPlayingCard";
import { OutputRow } from "@/components/OutputRow";
import { OutputSheet } from "@/components/OutputSheet";
import { RouteSheet } from "@/components/RouteSheet";
import { AppText, Notice, Screen, StatusDot } from "@/components/ui";
import { useConn } from "@/connection";
import { tap } from "@/haptics";
import { useLayout } from "@/layout/useLayout";
import { colors, hairline, radius, spacing, touch } from "@/theme";

/** Audio (boceto audio 01 a 03 y 07): qué suena, las salidas de Windows y las apps con sonido. */
export default function AudioTab() {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  const status = useConn((s) => s.status);
  const online = status === "online";
  const audio = useAudio((s) => s.audio);
  const showHidden = useAudio((s) => s.showHidden);
  const setShowHidden = useAudio((s) => s.setShowHidden);
  const [menu, setMenu] = useState<string | null>(null);
  const [routing, setRouting] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const flash = (key: string | null) => {
    setError(key);
    if (timer.current) clearTimeout(timer.current);
    if (key) timer.current = setTimeout(() => setError(null), 4000);
  };
  const report = (r: { ok: true } | { ok: false; error: string }) => {
    if (!r.ok) flash(r.error); // un cambio que salió bien no borra el error de otro
  };

  const header = (
    <View style={styles.header}>
      <AppText kind="title">{t("audio.title")}</AppText>
      {!online && (
        <View style={styles.state}>
          <StatusDot color={status === "offline" ? colors.muted : colors.warn} />
          <AppText kind="small" muted>
            {t(`status.${status === "unpaired" || status === "pairing" ? "offline" : status}`)}
          </AppText>
        </View>
      )}
    </View>
  );

  if (audio === null) {
    return (
      <Screen>
        {header}
        <View testID="audio-loading" style={styles.empty}>
          <AppText kind="small" muted>
            {t(online ? "audio.loading" : "home.waiting")}
          </AppText>
        </View>
      </Screen>
    );
  }
  if (!audio.available.audio) {
    return (
      <Screen>
        {header}
        <View testID="audio-off" style={styles.empty}>
          <AppText kind="heading">{t("audio.off.title")}</AppText>
          <AppText kind="small" muted>
            {t("audio.off.detail")}
          </AppText>
        </View>
      </Screen>
    );
  }

  const outputs = visibleOutputs(audio, showHidden);
  const hiddenCount = audio.outputs.filter((o) => o.hidden && !o.isDefault).length;
  const menuOutput = menu ? (audio.outputs.find((o) => o.id === menu) ?? null) : null;
  const routingApp = routing ? (audio.apps.find((a) => a.id === routing) ?? null) : null;

  const nowPlaying = <NowPlayingCard media={audio.media} online={online} onKey={(k) => void (tap(), audioActions.pressKey(k).then(report))} onPickApp={() => setPicking(true)} />;

  const outputsList = (
    <View>
      <AppText kind="label" muted style={styles.sec}>
        {t("audio.outputs")}
      </AppText>
      <View testID="outputs" style={[styles.box, !online && styles.stale]}>
        {outputs.map((o) => (
          <OutputRow
            key={o.id}
            output={o}
            online={online}
            onVolume={(v) => void audioActions.setVolume({ kind: "output", id: o.id }, v).then(report)}
            onToggleMute={() => void audioActions.setMute({ kind: "output", id: o.id }, !o.muted).then(report)}
            onMenu={() => setMenu(o.id)}
          />
        ))}
      </View>
      {hiddenCount > 0 && (
        <Pressable testID="toggle-hidden" accessibilityRole="button" onPress={() => setShowHidden(!showHidden)} style={styles.link}>
          <AppText kind="small" muted>
            {t(showHidden ? "audio.hideHidden" : "audio.showHidden", { count: hiddenCount })}
          </AppText>
        </Pressable>
      )}
      {!audio.available.defaultOutput && <Notice tone="info">{t("audio.noDefaultNote")}</Notice>}
    </View>
  );

  const appsList = (
    <View>
      <AppText kind="label" muted style={styles.sec}>
        {t("audio.apps")}
      </AppText>
      {audio.apps.length === 0 ? (
        <View testID="apps-empty" style={styles.box}>
          <AppText kind="small" muted style={styles.pad}>
            {t("audio.appsEmpty")}
          </AppText>
        </View>
      ) : (
        <View testID="audio-apps" style={[styles.box, !online && styles.stale]}>
          {audio.apps.map((a) => (
            <AudioAppRow
              key={a.id}
              app={a}
              outputs={audio.outputs}
              online={online}
              canRoute={audio.available.appRouting}
              players={audio.media.sessions.filter((s) => s.app.toLowerCase() === a.name.toLowerCase()).map((s) => s.title || s.app)}
              onVolume={(v) => void audioActions.setVolume({ kind: "app", id: a.id }, v).then(report)}
              onToggleMute={() => void audioActions.setMute({ kind: "app", id: a.id }, !a.muted).then(report)}
              onRoute={() => setRouting(a.id)}
            />
          ))}
        </View>
      )}
    </View>
  );

  return (
    <Screen>
      {header}
      {error && <Notice>{t(error)}</Notice>}
      {isLandscape ? (
        <View testID="audio-cols" style={styles.cols}>
          <View style={styles.col}>
            {nowPlaying}
            {outputsList}
          </View>
          <View style={styles.col}>{appsList}</View>
        </View>
      ) : (
        <View style={styles.stack}>
          {nowPlaying}
          {outputsList}
          {appsList}
        </View>
      )}
      {menuOutput && <OutputSheet output={menuOutput} canSetDefault={audio.available.defaultOutput} onClose={() => setMenu(null)} />}
      {routingApp && <RouteSheet app={routingApp} outputs={audio.outputs} onClose={() => setRouting(null)} />}
      {picking && <MediaSheet media={audio.media} onClose={() => setPicking(false)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  state: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stack: { gap: spacing.lg },
  cols: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" },
  col: { flex: 1, gap: spacing.lg },
  sec: { marginBottom: spacing.xs },
  box: { borderRadius: radius.lg, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" },
  stale: { opacity: 0.6 },
  empty: { gap: spacing.sm, padding: spacing.lg, alignItems: "center" },
  pad: { padding: spacing.md },
  link: { marginTop: spacing.sm, minHeight: touch, justifyContent: "center" },
});
