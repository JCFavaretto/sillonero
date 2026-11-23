import { z } from "zod";
import { MonitorId } from "./screens";

// Ventanas abiertas de la PC (docs/PLAN.md 8.3.3). El celu nunca ve un HWND: solo ids opacos que asigna el agente.

export const WindowId = z.string().regex(/^w_[0-9]{1,9}$/);
/** "i_" + 16 caracteres base64url del hash del AppID o de la ruta del .exe: identifica un ícono. */
export const IconKey = z.string().regex(/^i_[A-Za-z0-9_-]{16}$/);

export const WindowInfo = z.strictObject({
  id: WindowId,
  title: z.string().max(120),
  /** Nombre del .exe sin ".exe". */
  app: z.string().max(64),
  iconKey: IconKey.nullable(),
  /** Pantalla donde está el centro de la ventana; null si está minimizada o fuera de toda pantalla. */
  monitorId: MonitorId.nullable(),
  state: z.enum(["normal", "maximized", "minimized", "fullscreen"]),
  focused: z.boolean(),
});
export type WindowInfo = z.infer<typeof WindowInfo>;

export const MAX_WINDOWS = 40;
export const WindowsState = z.strictObject({ windows: z.array(WindowInfo).max(MAX_WINDOWS) });
export type WindowsState = z.infer<typeof WindowsState>;

/** `newPrivate` y `newWindow`: abrir una ventana de incógnito o una común del navegador de esa ventana (D93); en otra app contesta `not_supported`. */
export const WindowAction = z.enum(["focus", "minimize", "maximize", "restore", "fullscreen", "close", "newPrivate", "newWindow"]);
export type WindowAction = z.infer<typeof WindowAction>;
