import { z } from "zod";
import { MediaKey, OutputId, Volume } from "./audioIds";
import { MonitorId } from "./screens";
import { IconKey } from "./windows";

// Lanzadores, escenas e Inicio (docs/PLAN.md 8.3.3). Viven en la PC; el celu solo elige lo que la PC le ofrece.

/** AppID de `Get-StartApps`: una ruta, un AUMID de la tienda ("Familia!App") o uno propio ("Anysphere.Cursor"). */
export const AppId = z.string().min(1).max(260);
/** Solo http(s): nunca `file:`, `javascript:` ni esquemas raros. */
export const SafeUrl = z
  .string()
  .max(2048)
  // Sin `URL` (Hermes la trae incompleta): esquema http(s); host sin espacios, barras invertidas ni usuario@; y el resto
  // en ASCII imprimible sin comillas ni barras invertidas (el link llega a rundll32, y un host con \ sería una ruta UNC).
  .regex(/^https?:\/\/[^\s/?#@\\]+(?:[/?#][\x21\x23-\x5B\x5D-\x7E]*)?$/i, "tiene que ser http o https");

export const Target = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("app"), appId: AppId }),
  /**
   * `open`: cómo se abre el link en el navegador predeterminado (D93): `tab` = pestaña nueva en la ventana que ya está (lo que
   * hace Windows), `window` = ventana nueva, `private` = ventana de incógnito. Falta = `tab`.
   */
  z.strictObject({ kind: z.literal("url"), url: SafeUrl, open: z.enum(["tab", "window", "private"]).optional() }),
]);
export type Target = z.infer<typeof Target>;

export const NAME_MAX = 32;
export const Name = z.string().trim().min(1).max(NAME_MAX);
export const LauncherId = z.string().regex(/^l_[A-Za-z0-9_-]{10}$/);
export const SceneId = z.string().regex(/^s_[A-Za-z0-9_-]{10}$/);

export const Launcher = z.strictObject({ id: LauncherId, name: Name, target: Target, iconKey: IconKey.nullable() });
export type Launcher = z.infer<typeof Launcher>;

/** Dónde queda la ventana: mitades, cuartos, maximizada, pantalla completa sin bordes, o `keep` (no tocarla). */
export const Zone = z.enum(["keep", "full", "fullscreen", "left", "right", "top", "bottom", "tl", "tr", "bl", "br"]);
export type Zone = z.infer<typeof Zone>;

export const MAX_STEPS = 12;
export const Step = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("screens"),
    monitors: z.array(z.strictObject({ monitorId: MonitorId, enabled: z.boolean() })).min(1).max(16),
  }),
  z.strictObject({
    kind: z.literal("open"),
    target: Target,
    name: Name,
    iconKey: IconKey.nullable(),
    place: z.strictObject({ monitorId: MonitorId, zone: Zone }).nullable(),
  }),
  z.strictObject({ kind: z.literal("bringAll") }),
  // D37: cambiar la salida (hacerla predeterminada) y/o ponerle el volumen; al menos una de las dos cosas.
  z
    .strictObject({ kind: z.literal("audio"), outputId: OutputId, makeDefault: z.boolean(), volume: Volume.nullable() })
    .refine((s) => s.makeDefault || s.volume !== null, "no hace nada"),
]);
export type Step = z.infer<typeof Step>;

export const SceneSteps = z.array(Step).min(1).max(MAX_STEPS);

/**
 * B6.3 (D70): el atajo de una escena es `Ctrl+Alt+<tecla>` con una tecla de esta lista: las letras menos T y M (que ya tienen
 * dueño: la tele y el panel), 8 y 9. Los números 1 a 7 y Esc son de los atajos fijos (D69).
 */
export const SCENE_KEYS = [
  "0", "8", "9", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "N", "O", "P", "Q", "R", "S", "U", "V", "W", "X", "Y", "Z",
] as const;
export const SceneHotkey = z.enum(SCENE_KEYS);
export type SceneHotkey = z.infer<typeof SceneHotkey>;

/** B6.3 (D71): cuándo corre sola. `agentStart` a los 20 s de arrancar el agente; `displayOn` al prender esa pantalla. */
export const SceneTrigger = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("agentStart") }),
  z.strictObject({ type: z.literal("displayOn"), displayId: MonitorId }),
]);
export type SceneTrigger = z.infer<typeof SceneTrigger>;

export const Scene = z.strictObject({ id: SceneId, name: Name, steps: SceneSteps, hotkey: SceneHotkey.optional(), trigger: SceneTrigger.optional() });
export type Scene = z.infer<typeof Scene>;
/**
 * Lo que manda el celu: sin `id` = escena nueva (el agente lo asigna). `hotkey` y `trigger`: sin el campo = dejar como está
 * (un celu viejo no los borra al editar); `null` = quitarlo.
 */
export const SceneDraft = z.strictObject({
  id: SceneId.optional(),
  name: Name,
  steps: SceneSteps,
  hotkey: SceneHotkey.nullable().optional(),
  trigger: SceneTrigger.nullable().optional(),
});
export type SceneDraft = z.infer<typeof SceneDraft>;

export const MAX_DECK = 30;
export const DeckItem = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scene"), id: SceneId }),
  z.strictObject({ kind: z.literal("launcher"), id: LauncherId }),
  z.strictObject({ kind: z.literal("monitorToggle"), monitorId: MonitorId }),
  z.strictObject({ kind: z.literal("bringAll") }),
  z.strictObject({ kind: z.literal("identify") }),
  // B4 (D36): Media, volumen sobre la predeterminada, silenciar y cambiar de salida.
  z.strictObject({ kind: z.literal("media"), key: MediaKey }),
  z.strictObject({ kind: z.literal("volume"), delta: z.union([z.literal(-5), z.literal(5)]) }),
  z.strictObject({ kind: z.literal("mute") }),
  z.strictObject({ kind: z.literal("output"), outputId: OutputId }),
]);
export type DeckItem = z.infer<typeof DeckItem>;

export const MAX_LAUNCHERS = 40;
export const MAX_SCENES = 24;
export const Library = z.strictObject({
  launchers: z.array(Launcher).max(MAX_LAUNCHERS),
  scenes: z.array(Scene).max(MAX_SCENES),
  deck: z.array(DeckItem).max(MAX_DECK),
});
export type Library = z.infer<typeof Library>;
export const emptyLibrary = (): Library => ({ launchers: [], scenes: [], deck: [] });

/** Una app de la lista de Windows, tal como la ve el celu al buscar. */
export const CatalogApp = z.strictObject({ appId: AppId, name: z.string().max(80), iconKey: IconKey });
export type CatalogApp = z.infer<typeof CatalogApp>;
export const SEARCH_MAX = 40;
