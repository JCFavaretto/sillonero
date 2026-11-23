import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { LandscapeMenu, MENU_BUTTON_INSET } from "@/components/LandscapeMenu";
import { menuModeFor } from "@/layout/rules";
import { useLayout } from "@/layout/useLayout";
import { INITIAL_TAB, TABS } from "@/navigation";
import { colors, type } from "@/theme";

/** La pestaña inicial de este grupo (expo-router 58: `anchor`; `initialRouteName` quedó obsoleto). */
export const unstable_settings = { anchor: INITIAL_TAB };

/** La luz de la pestaña activa: una barrita ámbar sobre el ícono. */
const styles = StyleSheet.create({
  glow: {
    position: "absolute",
    top: -8,
    alignSelf: "center",
    width: 28,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: colors.accent,
  },
});

/**
 * Vertical: barra de pestañas abajo.
 * Apaisado: sin barra; un botón ☰ abre un panel con las secciones (ocupa poco hasta que se pide).
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  const drawer = menuModeFor(isLandscape) === "drawer";

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        // Apps está en el centro de la barra pero es la pantalla inicial (D94): Atrás vuelve ahí (ver `unstable_settings`).
        backBehavior="initialRoute"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: drawer ? { display: "none" } : { backgroundColor: colors.background, borderTopColor: colors.border },
          tabBarLabelStyle: { fontFamily: type.key.fontFamily, fontSize: 11, letterSpacing: 0.3 },
          // deja lugar al botón ☰ para que no tape los títulos
          sceneStyle: drawer ? { paddingLeft: MENU_BUTTON_INSET } : undefined,
        }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.label),
              tabBarIcon: ({ color, size, focused }) => (
                <View>
                  {focused && <View style={styles.glow} />}
                  <Ionicons name={tab.icon} size={size} color={color as string} />
                </View>
              ),
            }}
          />
        ))}
      </Tabs>
      {drawer && <LandscapeMenu />}
    </View>
  );
}
