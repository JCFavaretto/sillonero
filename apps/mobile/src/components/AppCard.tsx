import type { Monitor, Shortcut, WindowAction, WindowInfo } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { WindowCard } from "@/apps/groups";
import { isBrowser, shortcutRows } from "@/apps/profiles";
import { DUR } from "@/audio/motion";
import { AppIcon } from "@/components/AppIcon";
import { AppVolumeRow } from "@/components/AppVolumeRow";
import { PressScale } from "@/components/PressScale";
import { AppText } from "@/components/ui";
import { tap } from "@/haptics";
import { colors, hairline, radius, spacing, touch } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

/** Lo que hace falta para actuar sobre una ventana desde su tarjeta (la de ventana y la de reproducción comparten esto). */
export interface WindowBodyProps {
  /** Nombre del programa (el `.exe` sin extensión). */
  app: string;
  /** La ventana sobre la que actúan todos los botones. */
  main: WindowInfo;
  monitors: Monitor[];
  busy: boolean;
  onAct: (action: WindowAction) => void;
  onMove: (monitorId: string) => void;
  onClose: () => void;
  onMore: (w: WindowInfo) => void;
  /** Un atajo de teclado para la ventana (la trae al frente antes). */
  onShortcut: (name: Shortcut) => void;
  /** Abre las pestañas y marcadores del navegador (solo navegadores). */
  onTabs: () => void;
  /** Cuántas pestañas tiene el navegador según la extensión; `null` si no hay extensión conectada. */
  tabCount: number | null;
  /** ¿Suena algo en esta ventana? Sin eso no se ofrece la fila genérica de reproductor (D101). */
  playing: boolean;
}

/** Un botón de acción de una tarjeta: ícono arriba, texto abajo, 48 dp de alto. */
export function CardAction({
  id,
  icon,
  text,
  label,
  onPress,
  busy = false,
  disabled = false,
  selected,
  danger = false,
}: {
  id: string;
  icon: IconName;
  text: string;
  /** Lo que dice el lector de pantalla. */
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  selected?: boolean;
  danger?: boolean;
}) {
  const off = busy || disabled || selected === true;
  const color = selected ? colors.accent : danger ? colors.danger : colors.text;
  return (
    <View style={styles.cell}>
      <PressScale
        testID={`app-act-${id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={selected === undefined ? { disabled: off } : { disabled: off, selected }}
        disabled={off}
        onPress={() => (tap(), onPress())}
        style={[styles.act, selected && styles.actOn, (busy || disabled) && styles.off]}
      >
        <Ionicons name={icon} size={18} color={color} />
        <AppText kind="small" numberOfLines={1} style={{ color }}>
          {text}
        </AppText>
      </PressScale>
    </View>
  );
}

/**
 * Las acciones de una ventana (boceto comodidad 05): fila 1, Traer y un botón por pantalla; fila 2, acciones de ventana,
 * Cerrar y "Todo"; en un navegador, su fila propia y los atajos del sitio.
 */
export function WindowBody({ app, main, monitors, busy, onAct, onMove, onClose, onMore, onShortcut, onTabs, tabCount, playing }: WindowBodyProps) {
  const { t } = useTranslation();
  const screens = monitors.filter((m) => m.enabled && m.index !== null).sort((a, b) => a.index! - b.index!);
  const browser = isBrowser(app);
  const shortcuts = shortcutRows(app, main.title, playing);
  const maximized = main.state === "maximized";
  return (
    <>
      <View style={styles.row}>
        <CardAction id="focus" icon="albums-outline" text={t("apps.card.focus")} label={t("apps.card.focusOf", { name: app })} busy={busy} onPress={() => onAct("focus")} />
        {screens.map((m) => (
          <CardAction key={m.id} id={`move-${m.id}`} icon="tv-outline" text={String(m.index)} label={t("apps.card.moveOf", { name: app, n: m.index })} busy={busy} selected={main.monitorId === m.id} onPress={() => onMove(m.id)} />
        ))}
      </View>
      <View style={styles.row}>
        <CardAction id="minimize" icon="remove-outline" text={t("apps.window.minimize")} label={t("apps.card.minimizeOf", { name: app })} busy={busy} onPress={() => onAct("minimize")} />
        {maximized ? (
          <CardAction id="restore" icon="contract-outline" text={t("apps.window.restore")} label={t("apps.card.restoreOf", { name: app })} busy={busy} onPress={() => onAct("restore")} />
        ) : (
          <CardAction id="maximize" icon="square-outline" text={t("apps.window.maximize")} label={t("apps.card.maximizeOf", { name: app })} busy={busy} onPress={() => onAct("maximize")} />
        )}
        <CardAction id="close" icon="close" text={t("apps.window.closeConfirm")} label={t("apps.card.closeOf", { name: app })} busy={busy} danger onPress={onClose} />
        <CardAction id="more" icon="ellipsis-horizontal" text={t("apps.card.more")} label={t("apps.card.moreOf", { name: app })} busy={busy} onPress={() => onMore(main)} />
      </View>
      {browser && (
        <View testID="app-browser-row" style={styles.row}>
          <CardAction id="tabs" icon="albums-outline" text={tabCount === null ? t("apps.card.tabs") : t("apps.card.tabsN", { count: tabCount })} label={t("apps.card.tabsOf", { name: app })} busy={busy} onPress={onTabs} />
          <CardAction id="newWindow" icon="add-circle-outline" text={t("apps.card.newWindow")} label={t("apps.card.newWindowOf", { name: app })} busy={busy} onPress={() => onAct("newWindow")} />
          <CardAction id="private" icon="glasses-outline" text={t("apps.card.private")} label={t("apps.card.privateOf", { name: app })} busy={busy} onPress={() => onAct("newPrivate")} />
        </View>
      )}
      {shortcuts.length > 0 && (
        <View testID="app-shortcuts" style={styles.shortcuts}>
          <AppText kind="small" muted>
            {t("apps.profile.hint")}
          </AppText>
          {shortcuts.map((r) => (
            <View key={r.id} style={styles.row}>
              {r.buttons.map((b) => (
                <CardAction key={b.shortcut} id={`sc-${b.shortcut}`} icon={b.icon as IconName} text={t(b.label)} label={`${t(r.title)}: ${t(b.label)}`} busy={busy} onPress={() => onShortcut(b.shortcut)} />
              ))}
            </View>
          ))}
        </View>
      )}
    </>
  );
}

/**
 * La tarjeta de una VENTANA abierta (boceto rediseño 01, sección Abiertas; antes comodidad 05): una por ventana. Plegada:
 * ícono, el título de la ventana, los datos en íconos (pantalla, pantalla completa, sonando, al frente) y, si la app figura en
 * el mezclador de Windows, su barra de volumen (D96). Desplegada: las acciones de `WindowBody`.
 */
export function AppCard({
  card: group,
  monitors,
  open,
  online,
  busy,
  onToggle,
  onAct,
  onMove,
  onClose,
  onMore,
  onShortcut,
  onTabs,
  tabCount,
  playing,
  onError,
}: Omit<WindowBodyProps, "app" | "main"> & {
  card: WindowCard;
  open: boolean;
  online: boolean;
  onToggle: () => void;
  /** Un error al cambiar el volumen (clave de i18n). */
  onError: (error: string) => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const { app, main } = group;
  const screenN = monitors.find((m) => m.id === main.monitorId)?.index ?? null;

  // Lo que el lector de pantalla dice de la tarjeta, en el mismo orden que los íconos.
  const label = [
    main.title || app,
    app,
    group.minimized ? t("apps.window.minimized") : screenN !== null ? t("apps.card.onScreen", { n: screenN }) : null,
    main.state === "fullscreen" ? t("apps.window.fullscreenShort") : null,
    group.sounding ? t("audio.sounding") : null,
    group.front ? t("apps.card.front") : null,
  ]
    .filter(Boolean)
    .join(", ");

  const meta = (icon: IconName, text?: string | number, color: string = colors.muted) => (
    <View key={`${icon}${text ?? ""}`} style={styles.metaItem}>
      <Ionicons name={icon} size={13} color={color} />
      {text !== undefined && (
        <AppText kind="small" style={{ color }}>
          {text}
        </AppText>
      )}
    </View>
  );

  return (
    <Animated.View layout={reduce ? undefined : LinearTransition.duration(DUR.base)} style={[styles.card, group.front && styles.front]}>
      <Pressable
        testID={`app-card-${group.key}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open, disabled: !online }}
        disabled={!online}
        onPress={() => (tap(), onToggle())}
        style={[styles.head, group.minimized && styles.dim]}
      >
        <AppIcon iconKey={group.iconKey} name={app} size={36} />
        <View style={styles.grow}>
          <AppText kind="key" numberOfLines={1}>
            {main.title || app}
          </AppText>
          <View style={styles.meta}>
            <AppText kind="small" muted numberOfLines={1} style={styles.appName}>
              {app}
            </AppText>
            {group.minimized ? meta("remove-outline", t("apps.window.minimized")) : screenN !== null ? meta("tv-outline", screenN) : null}
            {main.state === "fullscreen" && meta("expand-outline")}
            {group.sounding && meta("volume-high", undefined, colors.ok)}
            {group.front && (
              <AppText kind="small" style={styles.frontTag}>
                {t("apps.card.front")}
              </AppText>
            )}
          </View>
        </View>
        <View style={styles.chev}>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
        </View>
      </Pressable>

      {group.audio && <AppVolumeRow app={group.audio} online={online} onError={onError} />}

      {open && (
        <Animated.View testID="app-actions" entering={reduce ? undefined : FadeIn.duration(DUR.base)} exiting={reduce ? undefined : FadeOut.duration(DUR.press)} style={styles.body}>
          <WindowBody app={app} main={main} monitors={monitors} busy={busy} onAct={onAct} onMove={onMove} onClose={onClose} onMore={onMore} onShortcut={onShortcut} onTabs={onTabs} tabCount={tabCount} playing={playing} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  front: { borderColor: colors.accent, borderWidth: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch + 4 },
  dim: { opacity: 0.55 },
  grow: { flex: 1, minWidth: 0 },
  appName: { flexShrink: 1 },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 1 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  frontTag: { color: colors.accent, backgroundColor: colors.accentSoft, paddingHorizontal: 6, borderRadius: 8, overflow: "hidden" },
  chev: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  body: { gap: spacing.sm, paddingBottom: spacing.sm, paddingTop: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm },
  shortcuts: { gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: hairline, borderTopColor: colors.border },
  cell: { flex: 1, minWidth: 0 },
  act: { minHeight: touch, alignItems: "center", justifyContent: "center", gap: 1, paddingHorizontal: 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  actOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  off: { opacity: 0.4 },
});
