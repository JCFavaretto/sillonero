import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFonts } from "expo-font";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans";
import { IBMPlexSansCondensed_600SemiBold } from "@expo-google-fonts/ibm-plex-sans-condensed";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { client, useConn } from "@/connection";
import { initI18n } from "@/i18n";
import { colors } from "@/theme";

initI18n();

/** Tema de navegación oscuro con nuestros colores: si no, React Navigation pinta fondos blancos. */
const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    primary: colors.accent,
    text: colors.text,
  },
};

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  // Si una fuente falla, se sigue con la del sistema: nunca se queda en blanco.
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSansCondensed_600SemiBold,
    IBMPlexMono_500Medium,
  });
  const status = useConn((s) => s.status);

  // Fondo de la ventana (se ve detrás de las barras del sistema y en los bordes al rotar)
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, []);

  // Lee la PC guardada y conecta
  useEffect(() => {
    void client.boot().then(() => setReady(true));
    return () => client.dispose();
  }, []);

  // En segundo plano se corta el socket; al volver al frente se reconecta
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") client.appForeground();
      else if (next === "background") client.appBackground();
    });
    return () => sub.remove();
  }, []);

  if (!ready || (!fontsLoaded && !fontError)) return null;

  const paired = status !== "unpaired" && status !== "pairing";

  return (
    <ThemeProvider value={navTheme}>
      <SafeAreaProvider style={{ backgroundColor: colors.background }}>
        {/* íconos claros en las barras del sistema, para el fondo oscuro */}
        <StatusBar style="light" />
        <NavigationBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Protected guard={paired}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="scenes/index" />
            <Stack.Screen name="scenes/[id]" />
          </Stack.Protected>
          <Stack.Protected guard={!paired}>
            <Stack.Screen name="connect" />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
