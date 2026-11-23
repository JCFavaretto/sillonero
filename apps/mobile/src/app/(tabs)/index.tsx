import type { MediaKey, WindowAction, WindowInfo } from "@proyecto-e/protocol";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { appsActions, type ActionResult } from "@/apps/actions";
import type { WindowCard } from "@/apps/groups";
import { appsView, stableOrder, type PlayCard as PlayCardData } from "@/apps/playing";
import { useApps } from "@/apps/store";
import { audioActions } from "@/audio/actions";
import { useAudio } from "@/audio/store";
import { browserActions } from "@/browser/actions";
import { windowTabs } from "@/browser/match";
import { useBrowser } from "@/browser/store";
import { AppCard, WindowBody, type WindowBodyProps } from "@/components/AppCard";
import { BrowserSheet } from "@/components/BrowserSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { OutputBar } from "@/components/OutputBar";
import { PlayCard } from "@/components/PlayCard";
import { StatusStrip } from "@/components/StatusStrip";
import { WindowSheet } from "@/components/WindowSheet";
import { AppText, Button, Notice, Screen, StatusDot } from "@/components/ui";
import { client, useConn } from "@/connection";
import { useLayout } from "@/layout/useLayout";
import { useScreens } from "@/screens/store";
import { colors, hairline, radius, spacing } from "@/theme";

/**
 * Apps, la pantalla que abre la app (boceto rediseño 01; D94 a D97): la tira de estado de la PC (un toque abre Ajustes), el
 * volumen general, y dos secciones. **Reproduciendo:** una tarjeta por cosa que suena, con ⏯, barra de reproducción y el
 * volumen de esa app. **Abiertas:** una tarjeta por cada ventana que no reproduce, con su volumen si la app figura en el
 * mezclador. Una sola tarjeta desplegada a la vez. Las tarjetas no cambian de lugar solas. Los lanzadores están en Escenas.
 */
export default function AppsTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isLandscape } = useLayout();
  const status = useConn((s) => s.status);
  const snapshot = useConn((s) => s.snapshot);
  const lastError = useConn((s) => s.lastError);
  const pcName = useConn((s) => s.pc?.pcName ?? "");
  const online = status === "online";
  const windows = useApps((s) => s.windows);
  const loaded = useApps((s) => s.windowsLoaded);
  const monitors = useScreens((s) => s.monitors);
  const audio = useAudio((s) => s.audio);
  const audioAt = useAudio((s) => s.audioAt);
  const browser = useBrowser((s) => s.browser);
  const browserAt = useBrowser((s) => s.browserAt);
  const [browserOf, setBrowserOf] = useState<{ app: string; title: string } | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [closing, setClosing] = useState<WindowInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // El orden en que se vieron las reproducciones: la PC manda primero lo que suena, y sin esto se cruzarían al pausar (D95).
  const [order, setOrder] = useState<readonly string[]>([]);
  const view = appsView(windows, audio, order, browser);
  const nextOrder = stableOrder(order, view.playing.map((p) => p.key));
  if (nextOrder !== order) setOrder(nextOrder);

  // Si la ventana elegida desaparece (se cerró en la PC), el menú se cierra solo y queda un aviso unos segundos.
  const selectedWin = selected ? (windows.find((w) => w.id === selected) ?? null) : null;
  const gone = selected !== null && selectedWin === null;
  useEffect(() => {
    if (!gone) return;
    const id = setTimeout(() => setSelected(null), 3000);
    return () => clearTimeout(id);
  }, [gone]);

  /** Una acción rápida de la tarjeta: mientras la PC contesta no se aceptan otras; si falla, el motivo queda arriba. */
  async function quick(action: () => Promise<ActionResult>) {
    if (busy || !online) return;
    setBusy(true);
    try {
      const r = await action();
      setNotice(r.ok ? null : t(r.error));
    } catch {
      setNotice(t("apps.error.failed"));
    } finally {
      setBusy(false);
    }
  }
  const volumeError = (error: string) => setNotice(t(error));

  /** ⏮ ⏯ ⏭ de UNA tarjeta: primero se le dice a la PC que los botones van a esa reproducción, después la tecla. */
  function mediaKey(p: PlayCardData, key: MediaKey) {
    // Con la extensión (D99), ⏯ maneja el VIDEO de la pestaña: no toca Windows ni trae la ventana al frente.
    if (p.web) {
      if (key === "playPause") void quick(() => browserActions.act({ op: "media.playPause", tabId: p.web!.id }));
      return;
    }
    // Una reproducción que salió del título de una ventana (sin extensión) solo se pausa con la tecla de YouTube.
    if (p.fromWindow) {
      const win = p.window;
      if (key === "playPause" && win) void quick(() => appsActions.shortcut(win.id, "ytPlayPause"));
      return;
    }
    void quick(async () => {
      if (audio?.media.targetId !== p.session.id) {
        const chosen = await audioActions.selectMedia(p.session.id);
        if (!chosen.ok) return chosen;
      }
      return audioActions.pressKey(key);
    });
  }

  /** Lo que hace cada botón de ventana, igual en la tarjeta de ventana y en la de reproducción. */
  const windowActions = (app: string, main: WindowInfo, playing: boolean): Omit<WindowBodyProps, "app" | "main"> => ({
    playing,
    monitors,
    busy,
    onAct: (action: WindowAction) => void quick(() => appsActions.act(main.id, action)),
    onMove: (monitorId) => void quick(() => appsActions.moveTo(main.id, monitorId)),
    onClose: () => setClosing(main),
    onMore: (w) => setSelected(w.id),
    onShortcut: (name) => void quick(() => appsActions.shortcut(main.id, name)),
    onTabs: () => setBrowserOf({ app, title: main.title }),
    tabCount: windowTabs(main.title, browser)?.tabs.length ?? (browser?.connected ? browser.tabs.length : null),
  });
  const toggle = (key: string) => setOpenCard(openCard === key ? null : key);

  const header = (
    <View style={styles.header}>
      <AppText kind="title">{t("apps.title")}</AppText>
      {!online ? (
        <View style={styles.state}>
          <StatusDot color={status === "offline" ? colors.muted : colors.warn} />
          <AppText kind="small" muted>
            {t(`status.${status === "unpaired" || status === "pairing" ? "offline" : status}`)}
          </AppText>
        </View>
      ) : (
        <Button kind="secondary" label={t("apps.bringAll")} onPress={() => void appsActions.bringAll().then((r) => setNotice(r.ok ? null : t(r.error)))} style={styles.small} />
      )}
    </View>
  );

  const windowCard = (g: WindowCard) => (
    <AppCard key={g.key} card={g} open={online && openCard === g.key} online={online} onToggle={() => toggle(g.key)} onError={volumeError} {...windowActions(g.app, g.main, g.sounding)} />
  );

  const playCard = (p: PlayCardData) =>
    audio && (
      <PlayCard key={p.key} card={p} audio={audio} monitors={monitors} open={online && openCard === p.key} online={online} busy={busy} receivedAt={p.web ? browserAt : audioAt} onToggle={() => toggle(p.key)} onKey={(key) => mediaKey(p, key)} onError={volumeError} onWeb={(op) => void quick(() => browserActions.act(op))} onFullscreen={() => p.window && void quick(() => appsActions.shortcut(p.window!.id, "ytFullscreen"))}>
        {p.window && (
          <View testID="app-actions" style={styles.gap}>
            <WindowBody app={p.window.app} main={p.window} {...windowActions(p.window.app, p.window, p.session.status === "playing")} />
          </View>
        )}
      </PlayCard>
    );

  const playingLabel = (
    <AppText kind="label" muted>
      {t("apps.playingCount", { n: view.playing.length })}
    </AppText>
  );
  const openLabel = (
    <AppText kind="label" muted>
      {t("apps.openCount", { n: view.open.length })}
    </AppText>
  );
  const hasPlaying = view.playing.length > 0;

  const empty = (
    <View testID="windows-empty" style={styles.empty}>
      <AppText kind="heading">{t("apps.empty.title")}</AppText>
      <AppText kind="small" muted style={styles.center}>
        {t("apps.empty.detail")}
      </AppText>
      <Button label={t("apps.empty.goScenes")} onPress={() => router.navigate("/deck")} />
    </View>
  );
  const loading = (
    <View testID="windows-loading" style={styles.gap}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skeleton} />
      ))}
    </View>
  );

  const stale = !online && styles.stale;
  let sections;
  if (!loaded) {
    sections = (
      <>
        {openLabel}
        {loading}
      </>
    );
  } else if (isLandscape && hasPlaying && view.open.length > 0) {
    // Apaisado con algo sonando y otras ventanas: Reproduciendo a la izquierda, Abiertas a la derecha.
    sections = (
      <View style={[styles.twoCols, stale]}>
        <View testID="apps-playing" style={styles.col}>
          {playingLabel}
          {view.playing.map(playCard)}
        </View>
        <View testID="apps-open" style={styles.col}>
          {openLabel}
          {view.open.map(windowCard)}
        </View>
      </View>
    );
  } else {
    sections = (
      <>
        {hasPlaying && (
          <View testID="apps-playing" style={[styles.gap, stale]}>
            {playingLabel}
            {view.playing.map(playCard)}
          </View>
        )}
        {/* Con todo reproduciendo no queda una sección "Abiertas · 0" vacía. */}
        {(view.open.length > 0 || !hasPlaying) && openLabel}
        {view.open.length === 0 ? (
          !hasPlaying && empty
        ) : isLandscape ? (
          <View testID="apps-open" style={[styles.twoCols, stale]}>
            <View style={styles.col}>{view.open.filter((_, i) => i % 2 === 0).map(windowCard)}</View>
            <View style={styles.col}>{view.open.filter((_, i) => i % 2 === 1).map(windowCard)}</View>
          </View>
        ) : (
          <View testID="apps-open" style={[styles.gap, stale]}>
            {view.open.map(windowCard)}
          </View>
        )}
      </>
    );
  }

  return (
    <Screen>
      {header}
      <StatusStrip status={status} snapshot={snapshot} lastError={lastError} pcName={pcName} onPress={() => router.push("/settings")} onRetry={() => client.retry()} />
      {audio?.available.audio && <OutputBar audio={audio} online={online} onError={volumeError} />}
      {audio && !audio.available.audio && (
        <View testID="apps-audio-off">
          <Notice tone="info">{t("apps.audioOff")}</Notice>
        </View>
      )}
      {(gone || notice) && (
        <View testID="apps-notice">
          <Notice>{gone ? t("apps.window.gone") : notice}</Notice>
        </View>
      )}
      {sections}
      {browserOf && <BrowserSheet appName={browserOf.app} windowTitle={browserOf.title} onClose={() => setBrowserOf(null)} />}
      {selectedWin && <WindowSheet key={selectedWin.id} window={selectedWin} monitors={monitors} onClose={() => setSelected(null)} />}
      {closing && (
        <ConfirmDialog
          title={t("apps.window.closeTitle", { title: closing.title })}
          detail={t("apps.window.closeDetail")}
          confirmLabel={t("apps.window.closeConfirm")}
          busy={busy}
          onCancel={() => setClosing(null)}
          onConfirm={() => {
            const id = closing.id;
            setClosing(null);
            void quick(() => appsActions.act(id, "close"));
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  state: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  small: { minHeight: 48, paddingHorizontal: spacing.lg },
  gap: { gap: spacing.sm },
  twoCols: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  col: { flex: 1, minWidth: 0, gap: spacing.sm },
  skeleton: { height: 56, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
  empty: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.lg, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface },
  center: { textAlign: "center" },
  stale: { opacity: 0.5 },
});
