import { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CatalogApp } from "@proyecto-e/protocol";
import { appsActions } from "@/apps/actions";
import { useApps } from "@/apps/store";
import { AppIcon } from "@/components/AppIcon";
import { AppText, Button, Notice } from "@/components/ui";
import { colors, radius, spacing, touch, type } from "@/theme";

const DEBOUNCE_MS = 250;

/**
 * Buscador de las apps instaladas en la PC (boceto apps-escenas 08, A y B). Se usa para agregar un lanzador y para el paso
 * "Abrir app" de una escena. La PC devuelve hasta 40 resultados; el celu nunca ve la lista entera.
 */
export function AppPicker({
  actionLabel,
  isDone,
  onPick,
}: {
  actionLabel: string;
  /** Lo que ya está elegido/agregado se muestra con ✓ y sin botón. */
  isDone?: (app: CatalogApp) => boolean;
  onPick: (app: CatalogApp) => void;
}) {
  const { t } = useTranslation();
  const search = useApps((s) => s.search);
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sin escribir nada se ven las primeras 40 en orden alfabético.
  useEffect(() => {
    appsActions.search("");
    return () => {
      if (timer.current) clearTimeout(timer.current);
      appsActions.clearSearch();
    };
  }, []);

  function onChange(v: string) {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => appsActions.search(v), DEBOUNCE_MS);
  }

  return (
    <View style={styles.wrap}>
      <TextInput
        value={text}
        onChangeText={onChange}
        placeholder={t("apps.add.searchPlaceholder")}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        style={styles.field}
        accessibilityLabel={t("apps.add.searchPlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
      />
      {search.error ? (
        <Notice>
          {t("apps.add.error")}
        </Notice>
      ) : search.loading && search.items.length === 0 ? (
        <AppText kind="small" muted style={styles.center}>
          {t("apps.add.loading")}
        </AppText>
      ) : search.items.length === 0 ? (
        <AppText kind="small" muted style={styles.center}>
          {t("apps.add.none", { query: search.query })}
        </AppText>
      ) : (
        <View style={search.loading && styles.dim}>
          <AppText kind="label" muted>
            {t("apps.add.count", { count: search.total })}
          </AppText>
          {search.items.map((a) => (
            <View key={a.appId} style={styles.row} testID={`result-${a.name}`}>
              <AppIcon iconKey={a.iconKey} name={a.name} size={32} />
              <AppText style={styles.grow} numberOfLines={1}>
                {a.name}
              </AppText>
              {isDone?.(a) ? (
                <AppText kind="small" muted>
                  {t("apps.add.added")}
                </AppText>
              ) : (
                <Button kind="secondary" label={actionLabel} onPress={() => onPick(a)} style={styles.btn} />
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  field: { ...type.body, minHeight: touch, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
  center: { textAlign: "center", paddingVertical: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  grow: { flex: 1 },
  dim: { opacity: 0.5 },
  btn: { minHeight: touch, paddingHorizontal: spacing.md },
});
