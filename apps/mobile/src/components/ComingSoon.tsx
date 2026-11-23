import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppText, Screen } from "@/components/ui";
import { useLayout } from "@/layout/useLayout";
import { spacing } from "@/theme";

/** Pestañas que todavía no existen: avisan en qué fase llegan. */
export function ComingSoon({ phase }: { phase: "B2" | "B3" | "B4" | "B5" }) {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  return (
    <Screen scroll={false}>
      <View style={[styles.center, isLandscape && styles.row]}>
        <AppText kind="title" style={styles.icon} decorative>
          🚧
        </AppText>
        <View style={styles.text}>
          <AppText kind="heading">{t("comingSoon.title", { phase })}</AppText>
          <AppText kind="small" muted>
            {t("comingSoon.others")}
          </AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.xl },
  icon: { fontSize: 44, lineHeight: 52 },
  text: { alignItems: "center", gap: spacing.xs },
});
