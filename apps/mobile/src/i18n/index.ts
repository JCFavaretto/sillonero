import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./es.json";

/** Por ahora solo hay español. Los textos van siempre por i18n para sumar idiomas sin tocar pantallas. */
export function initI18n(language?: string) {
  if (i18n.isInitialized) return i18n;
  const device = getLocales()[0]?.languageCode ?? "es";
  void i18n.use(initReactI18next).init({
    resources: { es: { translation: es } },
    lng: language ?? (device === "es" ? "es" : "es"),
    fallbackLng: "es",
    interpolation: { escapeValue: false }, // React Native ya escapa
    returnNull: false,
  });
  return i18n;
}

export { i18n };
