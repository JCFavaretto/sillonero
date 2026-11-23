import type { Ionicons } from "@expo/vector-icons";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Las 5 secciones de la app, en el orden de la barra (D94, docs/PLAN.md 8.8): Escenas · Pantallas · Apps · Audio · Pad.
 * `name` es el archivo en src/app/(tabs); `href` es la ruta para navegar. Apps es `index`: la pantalla que abre la app.
 */
export const TABS: readonly { name: string; href: string; label: string; icon: IconName }[] = [
  { name: "deck", href: "/deck", label: "tabs.scenes", icon: "grid" },
  { name: "screens", href: "/screens", label: "tabs.screens", icon: "desktop" },
  { name: "index", href: "/", label: "tabs.apps", icon: "apps" },
  { name: "audio", href: "/audio", label: "tabs.audio", icon: "volume-high" },
  { name: "pad", href: "/pad", label: "tabs.pad", icon: "hand-left" },
];

/** La pestaña inicial: a ella vuelve el botón Atrás de Android desde las otras. */
export const INITIAL_TAB = "index";
