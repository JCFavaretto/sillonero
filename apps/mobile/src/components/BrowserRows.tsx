import type { BrowserFailure } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText, Button } from "@/components/ui";
import { colors, hairline, radius, spacing, touch } from "@/theme";

/** Un color estable para cada sitio (la misma letra y el mismo color cada vez), para reconocer las pestañas de un vistazo. */
const PALETTE = ["#E5484D", "#F5A524", "#3DD6A3", "#4C8DFF", "#A371F7", "#E26BA7", "#2FB8D6", "#8FB339"];
export function siteColor(host: string): string {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** La inicial del sitio en un cuadradito de su color. */
export function SiteBadge({ host, title, size = 32 }: { host: string; title: string; size?: number }) {
  const letter = (host || title).trim()[0]?.toUpperCase() ?? "?";
  return (
    <View accessible={false} style={[styles.badge, { width: size, height: size, borderRadius: Math.round(size / 4), backgroundColor: siteColor(host || title) }]}>
      <AppText kind="key" decorative style={{ color: "#17161D", fontSize: Math.round(size * 0.45) }}>
        {letter}
      </AppText>
    </View>
  );
}

/** Una fila de una lista del navegador: a la izquierda lo que identifica, en el medio título y detalle, a la derecha una acción o dato. */
export function ListRow({
  testID,
  left,
  title,
  subtitle,
  meta,
  current = false,
  disabled = false,
  onPress,
  onLongPress,
  right,
  label,
}: {
  testID?: string;
  left?: React.ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
  current?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  right?: React.ReactNode;
  label?: string;
}) {
  return (
    <View style={[styles.row, current && styles.current]}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ selected: current, disabled }} disabled={disabled} onPress={onPress} onLongPress={onLongPress} style={styles.main}>
        {left}
        <View style={styles.grow}>
          <AppText numberOfLines={1} style={current ? { color: colors.accent } : undefined}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText kind="small" muted numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {meta ? (
          <AppText kind="small" muted decorative>
            {meta}
          </AppText>
        ) : null}
      </Pressable>
      {right}
    </View>
  );
}

/** Cargando, vacío o con error: el texto de cada estado de una lista del navegador. */
export function ListState({ loading, error, empty, onRetry }: { loading?: boolean; error?: BrowserFailure | "offline" | null; empty?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <View testID="browser-loading" style={styles.state}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeleton} />
        ))}
        <AppText kind="small" muted>
          {t("browser.loading")}
        </AppText>
      </View>
    );
  }
  if (error) {
    return (
      <View testID="browser-error" style={styles.state}>
        <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
        <AppText kind="small" style={{ color: colors.danger, textAlign: "center" }}>
          {t(`browser.fail.${error}`)}
        </AppText>
        {onRetry && error !== "no_extension" && <Button kind="secondary" label={t("browser.retry")} onPress={onRetry} />}
      </View>
    );
  }
  if (empty) {
    return (
      <View testID="browser-empty" style={styles.state}>
        <AppText kind="small" muted style={{ textAlign: "center" }}>
          {empty}
        </AppText>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", minHeight: touch + 4, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: "transparent" },
  current: { backgroundColor: colors.accentSoft, borderLeftColor: colors.accent },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: touch + 4, paddingHorizontal: spacing.xs },
  state: { alignItems: "center", gap: spacing.sm, padding: spacing.lg },
  skeleton: { height: 44, alignSelf: "stretch", borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: hairline, borderColor: colors.border },
});
