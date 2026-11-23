import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, BackHandler, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { TABS } from "@/navigation";
import { colors, motion, radius, spacing, touch, type } from "@/theme";

const PANEL_WIDTH = 240;

/** Ancho que reserva cada pantalla a la izquierda para que el botón no tape el título. */
export const MENU_BUTTON_INSET = touch + 8;

/**
 * Menú de apaisado: un botón ☰ siempre visible y, al tocarlo, un panel por encima del contenido.
 * Reemplaza a la barra de pestañas, que en apaisado ocupaba demasiado.
 */
export function LandscapeMenu() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // 0 = cerrado, 1 = abierto. El panel desliza 220 ms; con "reducir movimiento" solo se funde.
  const [progress] = useState(() => new Animated.Value(0));
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
  }, []);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? motion.base : motion.fast,
      easing: Easing.bezier(...motion.easing),
      useNativeDriver: true,
    }).start();
  }, [open, progress]);

  // El botón "atrás" de Android cierra el menú en vez de salir de la app
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.navigate(href as never);
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {open && (
        <>
          <Animated.View style={[styles.backdropWrap, { opacity: progress }]}>
            <Pressable testID="menu-backdrop" accessible={false} style={styles.backdrop} onPress={() => setOpen(false)} />
          </Animated.View>
          <Animated.View
            style={[
              styles.panel,
              { paddingTop: insets.top + MENU_BUTTON_INSET, paddingLeft: insets.left + spacing.sm },
              reduce
                ? { opacity: progress }
                : { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-PANEL_WIDTH, 0] }) }] },
            ]}
          >
            {TABS.map((tab) => {
              const active = isActive(tab.href);
              return (
                <Pressable
                  key={tab.name}
                  accessibilityRole="button"
                  accessibilityLabel={t(tab.label)}
                  accessibilityState={{ selected: active }}
                  onPress={() => go(tab.href)}
                  style={[styles.item, active && styles.itemActive]}
                >
                  <Ionicons name={tab.icon} size={22} color={active ? colors.accent : colors.muted} />
                  <Text style={[type.key, { fontSize: 15, color: active ? colors.accent : colors.muted }]}>{t(tab.label)}</Text>
                </Pressable>
              );
            })}
          </Animated.View>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? t("menu.close") : t("menu.open")}
        onPress={() => setOpen((v) => !v)}
        style={[styles.toggle, { top: insets.top + 4, left: insets.left + 4 }]}
      >
        <Ionicons name={open ? "close" : "menu"} size={26} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdropWrap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_WIDTH,
    backgroundColor: colors.background,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingRight: spacing.sm,
    gap: spacing.xs,
  },
  item: {
    minHeight: touch,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  itemActive: { backgroundColor: colors.accentSoft, borderLeftWidth: 3, borderLeftColor: colors.accent },
  toggle: {
    position: "absolute",
    width: touch,
    height: touch,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
