/**
 * Tema (pasada de diseño, boceto docs/bocetos/diseno/01): grafito con una luz ámbar para lo activo y lo que está
 * en curso; verde solo para "prendido / en línea". Todo el color, la letra, el espacio y el movimiento sale de acá.
 */
export const colors = {
  background: "#17161D",
  surface: "#211F29",
  surfaceAlt: "#2C2935",
  border: "#3B3746",
  text: "#F1EEE8",
  muted: "#A29DAE",
  accent: "#F5A524",
  accentText: "#1B1405",
  accentSoft: "rgba(245,165,36,0.14)",
  /** El coral al que vira el ámbar (anillo de volumen, brillo del reproductor, botón de play). */
  ember: "#FF6B4A",
  emberGlow: "rgba(255,107,74,0.34)",
  ok: "#3DD6A3",
  warn: "#F5A524",
  danger: "#FF5C5C",
  dangerBg: "#3A1E22",
} as const;

/** Nombres con los que `useFonts` registra las familias (ver app/_layout.tsx). */
export const fonts = {
  display: "IBMPlexSansCondensed_600SemiBold",
  body: "IBMPlexSans_400Regular",
  bodyMedium: "IBMPlexSans_500Medium",
  bodySemi: "IBMPlexSans_600SemiBold",
  mono: "IBMPlexMono_500Medium",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 12, lg: 18, key: 14, sheet: 24 } as const;
/** Tamaño mínimo de algo que se toca (Android recomienda 48 dp). */
export const touch = 48;
/** Borde fino de tarjetas, listas y teclas. */
export const hairline = 1;

/** Movimiento: duraciones en ms y curva de salida. Con "reducir movimiento" solo se funde. */
export const motion = { fast: 120, base: 220, slow: 300, easing: [0.2, 0.8, 0.2, 1] as const } as const;

export const type = {
  title: { fontFamily: fonts.display, fontSize: 26 },
  heading: { fontFamily: fonts.bodySemi, fontSize: 17 },
  body: { fontFamily: fonts.body, fontSize: 15 },
  small: { fontFamily: fonts.body, fontSize: 13 },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" as const },
  data: { fontFamily: fonts.mono, fontSize: 13 },
  key: { fontFamily: fonts.display, fontSize: 13, letterSpacing: 0.3 },
};
