import { MEDIA_RATES, type AudioState, type BrowserOp, type MediaKey, type Monitor } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { PlayCard as PlayCardData } from "@/apps/playing";
import { isBrowser } from "@/apps/profiles";
import { useArt } from "@/audio/art";
import { DUR } from "@/audio/motion";
import { youtubeTabFor } from "@/browser/match";
import { useBrowser } from "@/browser/store";
import { CardAction } from "@/components/AppCard";
import { AppVolumeRow } from "@/components/AppVolumeRow";
import { WebVolumeRow } from "@/components/WebVolumeRow";
import { PressScale } from "@/components/PressScale";
import { ProgressBar } from "@/components/ProgressBar";
import { RouteSheet } from "@/components/RouteSheet";
import { YouTubeSheet, type YouTubeSection } from "@/components/YouTubeSheet";
import { AppText } from "@/components/ui";
import { tap } from "@/haptics";
import { colors, hairline, radius, spacing, touch } from "@/theme";

/**
 * La tarjeta de una REPRODUCCIÓN (boceto rediseño 01, sección Reproduciendo; D95 a D97). Plegada: carátula, tema, de qué app
 * y en qué pantalla, ⏯, la barra de reproducción (si la app dice por dónde va) y el volumen de esa app. Desplegada: Anterior,
 * Siguiente y Salida; con la extensión, Cola y Buscar de YouTube; y debajo las acciones de su ventana (`children`).
 */
export function PlayCard({
  card,
  audio,
  monitors,
  open,
  online,
  busy,
  receivedAt,
  onToggle,
  onKey,
  onError,
  onWeb,
  onFullscreen,
  children,
}: {
  card: PlayCardData;
  audio: AudioState;
  monitors: Monitor[];
  open: boolean;
  online: boolean;
  busy: boolean;
  /** Cuándo llegó al celu el estado de audio (para avanzar la barra). */
  receivedAt: number;
  onToggle: () => void;
  /** ⏮ ⏯ ⏭ para ESTA reproducción. */
  onKey: (key: MediaKey) => void;
  onError: (error: string) => void;
  /** Una orden para el reproductor de la pestaña (solo tarjetas web, D99). */
  onWeb: (op: BrowserOp) => void;
  /** Pantalla completa de la ventana (manda la tecla F, así que la trae al frente: D101). */
  onFullscreen: () => void;
  /** Las acciones de su ventana (si tiene). */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const { session, window: win, app } = card;
  const { uri } = useArt(session.artKey);
  const browserState = useBrowser((s) => s.browser);
  const [routing, setRouting] = useState(false);
  const [ytSheet, setYtSheet] = useState<YouTubeSection | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const web = card.web;
  const media = web?.media ?? null;
  const rateText = (r: number) => String(r).replace(".", ",");

  const playing = session.status === "playing";
  const screenN = win ? (monitors.find((m) => m.id === win.monitorId)?.index ?? null) : null;
  const title = session.title || t("audio.untitled");
  // Con la extensión conectada: la pestaña de YouTube de lo que suena (Cola y Buscar sin traer la ventana al frente).
  const ytTab = isBrowser(session.app) ? youtubeTabFor(browserState, session) : null;

  const label = [title, session.artist || null, session.app, screenN !== null ? t("apps.card.onScreen", { n: screenN }) : null, t(playing ? "apps.play.playing" : "apps.play.paused")].filter(Boolean).join(", ");

  return (
    <Animated.View testID={`play-${card.key}`} layout={reduce ? undefined : LinearTransition.duration(DUR.base)} style={[styles.card, win?.focused && styles.front]}>
      <View style={styles.head}>
        <Pressable
          // Si tiene ventana, es también la tarjeta de esa ventana: se la encuentra por el id de la ventana.
          testID={win ? `app-card-${win.id}` : `play-card-${card.key}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open, disabled: !online }}
          disabled={!online}
          onPress={() => (tap(), onToggle())}
          style={styles.headMain}
        >
          {uri ? (
            <Image testID="media-art" accessibilityIgnoresInvertColors source={{ uri }} resizeMode="cover" style={styles.cover} />
          ) : (
            <View testID="media-art-fallback" style={[styles.cover, styles.coverEmpty]}>
              <Ionicons name="musical-notes" size={22} color={colors.muted} />
            </View>
          )}
          <View style={styles.grow}>
            <AppText kind="key" numberOfLines={2}>
              {title}
            </AppText>
            {session.artist ? (
              <AppText kind="small" numberOfLines={1}>
                {session.artist}
              </AppText>
            ) : null}
            <View style={styles.meta}>
              <AppText kind="small" muted numberOfLines={1} style={styles.shrink}>
                {session.app}
              </AppText>
              {screenN !== null && (
                <View style={styles.metaItem}>
                  <Ionicons name="tv-outline" size={13} color={colors.muted} />
                  <AppText kind="small" muted>
                    {screenN}
                  </AppText>
                </View>
              )}
            </View>
          </View>
        </Pressable>
        <PressScale
          testID={`play-toggle-${card.key}`}
          accessibilityRole="button"
          accessibilityLabel={t(playing ? "apps.play.pauseOf" : "apps.play.playOf", { name: session.app })}
          accessibilityState={{ disabled: !online || !session.controls.playPause }}
          disabled={!online || !session.controls.playPause}
          onPress={() => (tap(), onKey("playPause"))}
          style={[styles.toggle, (!online || !session.controls.playPause) && styles.off]}
        >
          <Ionicons name={playing ? "pause" : "play"} size={20} color={colors.accentText} />
        </PressScale>
        <View accessibilityElementsHidden importantForAccessibility="no" pointerEvents="none" style={styles.chev}>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
        </View>
      </View>

      {session.timeline && <ProgressBar testID={`progress-${card.key}`} timeline={session.timeline} playing={playing} receivedAt={receivedAt} />}
      {web && media ? <WebVolumeRow tabId={web.id} media={media} online={online} onError={onError} /> : app && <AppVolumeRow app={app} online={online} onError={onError} />}

      {open && (
        <Animated.View testID="play-actions" entering={reduce ? undefined : FadeIn.duration(DUR.base)} exiting={reduce ? undefined : FadeOut.duration(DUR.press)} style={styles.body}>
          {web && media ? (
            <>
              <View testID="web-row" style={styles.row}>
                {media.canSeek && <CardAction id="web-back" icon="play-back" text={t("apps.web.back")} label={t("apps.web.backOf", { name: session.app })} busy={busy} onPress={() => onWeb({ op: "media.seekBy", tabId: web.id, seconds: -10 })} />}
                {media.canSeek && <CardAction id="web-fwd" icon="play-forward" text={t("apps.web.forward")} label={t("apps.web.forwardOf", { name: session.app })} busy={busy} onPress={() => onWeb({ op: "media.seekBy", tabId: web.id, seconds: 10 })} />}
                {media.canSeek && <CardAction id="web-speed" icon="speedometer-outline" text={`${rateText(media.rate)}×`} label={t("apps.web.speedNow", { rate: rateText(media.rate) })} busy={busy} onPress={() => setSpeedOpen((v) => !v)} />}
                <CardAction id="web-full" icon="expand" text={t("apps.web.fullscreen")} label={t("apps.web.fullscreenOf", { name: session.app })} busy={busy} onPress={onFullscreen} />
              </View>
              {speedOpen && media.canSeek && (
                <View testID="web-speeds" style={styles.row}>
                  {MEDIA_RATES.map((r) => (
                    <CardAction key={r} id={`web-rate-${r}`} icon="speedometer-outline" text={rateText(r)} label={t("apps.web.speedSet", { rate: rateText(r) })} busy={busy} selected={media.rate === r} onPress={() => (setSpeedOpen(false), onWeb({ op: "media.rate", tabId: web.id, rate: r }))} />
                  ))}
                </View>
              )}
              <View testID="web-note">
                <AppText kind="small" muted>
                  {media.canSeek ? t("apps.web.fullscreenNote") : t("apps.web.noSeek")}
                </AppText>
              </View>
            </>
          ) : (
            <View style={styles.row}>
              <CardAction id="prev" icon="play-skip-back" text={t("apps.play.prev")} label={t("apps.play.prevOf", { name: session.app })} busy={busy} disabled={!session.controls.prev} onPress={() => onKey("prev")} />
              <CardAction id="next" icon="play-skip-forward" text={t("apps.play.next")} label={t("apps.play.nextOf", { name: session.app })} busy={busy} disabled={!session.controls.next} onPress={() => onKey("next")} />
              <CardAction id="route" icon="swap-horizontal" text={t("home.now.route")} label={t("audio.routeOf", { name: session.app })} busy={busy} disabled={app === null || !audio.available.appRouting} onPress={() => setRouting(true)} />
            </View>
          )}
          {ytTab && (
            <View testID="play-youtube-row" style={styles.row}>
              <CardAction id="yt-queue" icon="list" text={t("home.now.queue")} label={t("home.now.queueOf")} busy={busy} onPress={() => setYtSheet("queue")} />
              {ytTab.site === "youtube" && <CardAction id="yt-search" icon="search" text={t("home.now.search")} label={t("home.now.searchOf")} busy={busy} onPress={() => setYtSheet("search")} />}
            </View>
          )}
          {children}
        </Animated.View>
      )}

      {ytSheet && ytTab && <YouTubeSheet yt={ytTab} initial={ytSheet} onClose={() => setYtSheet(null)} />}
      {routing && app && <RouteSheet app={app} outputs={audio.outputs} onClose={() => setRouting(false)} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  front: { borderColor: colors.accent, borderWidth: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch + 4 },
  cover: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  coverEmpty: { alignItems: "center", justifyContent: "center", borderWidth: hairline, borderColor: colors.border },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 1 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  toggle: { width: touch, height: touch, borderRadius: touch / 2, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  chev: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  body: { gap: spacing.sm, paddingBottom: spacing.xs, paddingTop: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm },
  off: { opacity: 0.35 },
});
