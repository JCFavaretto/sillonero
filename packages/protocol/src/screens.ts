import { z } from "zod";

// Tipos de la pestaña Pantallas (docs/PLAN.md 8.2.3). R1 los usa para la UI; los mensajes
// que los transportan (screens.snapshot / screens.update) llegan en R2.

/** Rectángulo en píxeles físicos, coordenadas del escritorio de Windows (pueden ser negativas). */
export const Rect = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().nonnegative(),
  h: z.number().int().nonnegative(),
});
export type Rect = z.infer<typeof Rect>;

export const MonitorConnector = z.enum(["hdmi", "displayport", "dvi", "vga", "internal", "other"]);
export type MonitorConnector = z.infer<typeof MonitorConnector>;

export const MonitorBlockedBy = z.enum(["primary", "last_active"]);

export const MONITOR_NICKNAME_MAX = 32;

/** "m_" + 16 caracteres base64url del hash de la ruta del dispositivo: estable entre arranques. */
export const MonitorId = z.string().regex(/^m_[A-Za-z0-9_-]{16}$/);

export const Monitor = z.strictObject({
  id: MonitorId,
  /** 1..n entre las prendidas, de izquierda a derecha; null si está apagada. */
  index: z.number().int().min(1).nullable(),
  nickname: z.string().max(MONITOR_NICKNAME_MAX).nullable(),
  name: z.string().max(64),
  connector: MonitorConnector,
  enabled: z.boolean(),
  primary: z.boolean(),
  /** Dónde está ahora; null si está apagada. */
  bounds: Rect.nullable(),
  /** La última vez que estuvo prendida: sirve para dibujarla en el mapa. */
  lastBounds: Rect.nullable(),
  resolution: z.strictObject({ w: z.number().int(), h: z.number().int() }).nullable(),
  canDisable: z.boolean(),
  blockedBy: MonitorBlockedBy.nullable(),
  /** Hay un cambio en curso en esa pantalla. */
  busy: z.boolean(),
});
export type Monitor = z.infer<typeof Monitor>;

/** La ventana que tiene el foco en la PC. */
export const Foreground = z.strictObject({
  title: z.string().max(120),
  app: z.string().max(64),
  monitorId: z.string().nullable(),
});
export type Foreground = z.infer<typeof Foreground>;

export const ScreensState = z.strictObject({
  monitors: z.array(Monitor).max(16),
  foreground: Foreground.nullable(),
});
export type ScreensState = z.infer<typeof ScreensState>;
