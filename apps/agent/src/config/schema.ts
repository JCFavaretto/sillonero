import { Base64Url, Library, Name, OutputId, OutputKind, emptyLibrary } from "@proyecto-e/protocol";
import { z } from "zod";

// agent.json v2 (docs/PLAN.md 8.2.3). Vive en %APPDATA%\proyecto-e\agent.json.
// v1 → v2: se borran los dispositivos (sus tokens viajaron en claro en B1) y se suma la identidad cifrada.

// v2 → v3 (B3): se suma la biblioteca (lanzadores, escenas e Inicio); los celus emparejados siguen valiendo.
// v3 → v4 (B4): se suma el audio (apodos y salidas ocultas, salidas conocidas, interruptores de las funciones no documentadas).
// v4 → v5 (B5): se suma la llave global de mouse y teclado remotos (prendida por defecto).
// v5 → v6 (B6.4): en el archivo, la clave privada de la PC va cifrada con DPAPI (`identity.privateKeyProtected`). En memoria sigue siendo
// `identity.privateKey`: el cifrado vive en el límite del store (config/store.ts), el resto del agente no se entera.
export const CURRENT_CONFIG_VERSION = 6;

const Port = z.number().int().min(1024).max(65535);
const Key = Base64Url.length(43); // 32 bytes

const Rect = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().nonnegative(),
  h: z.number().int().nonnegative(),
});

/** Lo que se recuerda de las salidas de audio de Windows (D32) y los interruptores de D29 y D30. */
export const AudioConfig = z.strictObject({
  /** Apodo y "oculta en el celu" por salida. */
  outputs: z.record(OutputId, z.strictObject({ nick: Name.nullable(), hidden: z.boolean() })).default({}),
  /** Salidas vistas que Jay renombró o usa en una escena o el Inicio: así se muestran "no disponible" cuando se desconectan. */
  known: z.record(OutputId, z.strictObject({ name: z.string().max(80), kind: OutputKind })).default({}),
  /** Apaga a mano la función (D29: cambiar la predeterminada; D30: mandar una app a una salida) si una actualización de Windows la rompe. */
  disable: z.strictObject({ defaultOutput: z.boolean(), appRouting: z.boolean() }).default({ defaultOutput: false, appRouting: false }),
});
export type AudioConfig = z.infer<typeof AudioConfig>;
export const emptyAudioConfig = (): AudioConfig => ({ outputs: {}, known: {}, disable: { defaultOutput: false, appRouting: false } });

/** La llave global del Pad (panel de la PC). */
export const InputConfig = z.strictObject({ enabled: z.boolean().default(true) });
export type InputConfig = z.infer<typeof InputConfig>;
export const emptyInputConfig = (): InputConfig => ({ enabled: true });

/** Atajos globales de teclado (docs/PLAN.md 8.6): la llave global del panel y cuál es "la tele" de Ctrl+Alt+T (un id de pantalla). */
export const HotkeysConfig = z.strictObject({
  enabled: z.boolean().default(true),
  tvMonitorId: z.string().regex(/^m_[A-Za-z0-9_-]{16}$/).nullable().default(null),
});
export type HotkeysConfig = z.infer<typeof HotkeysConfig>;
export const emptyHotkeysConfig = (): HotkeysConfig => ({ enabled: true, tvMonitorId: null });

export const AgentConfigV6 = z.object({
  version: z.literal(6),
  remote: z.object({
    enabled: z.boolean().default(false),
    port: Port.default(47800),
    adminPort: Port.default(47801),
    preferredInterface: z.string().nullable().default(null),
  }),
  /** Par de claves X25519 de la PC. Se genera la primera vez que arranca el agente. */
  identity: z.strictObject({ publicKey: Key, privateKey: Key }).nullable().default(null),
  devices: z
    .array(
      z.strictObject({
        id: z.uuid(),
        name: z.string().max(40),
        platform: z.enum(["android", "ios"]),
        /** Clave pública X25519 del celu: ser dispositivo emparejado = que el agente conozca esta clave. */
        publicKey: Key,
        pairedAt: z.iso.datetime(),
        lastSeenAt: z.iso.datetime().nullable(),
      }),
    )
    .default([]),
  /** Apodos y última posición de cada pantalla vista (la usa la pestaña Pantallas desde R4). */
  monitors: z
    .object({
      known: z
        .array(
          z.strictObject({
            id: z.string().regex(/^m_[A-Za-z0-9_-]{16}$/),
            nickname: z.string().max(32).nullable(),
            lastName: z.string().max(64),
            lastBounds: Rect.nullable(),
            lastSeenAt: z.iso.datetime(),
          }),
        )
        .max(32)
        .default([]),
    })
    .default({ known: [] }),
  /** Lanzadores, escenas y las teclas del Inicio: viven en la PC y el celu solo las edita. */
  // Si alguna entrada guardada ya no pasa el esquema (p. ej. un link viejo con el esquema de URL más estricto), se descarta solo la
  // biblioteca: nunca se pierden los celus emparejados ni la identidad por un lanzador inválido.
  library: Library.catch(() => emptyLibrary()).default(() => emptyLibrary()),
  /** El Inicio ya se sembró con los botones por defecto (una sola vez; ver defaultDeck.ts). */
  deckSeeded: z.boolean().default(false),
  /** Audio (docs/PLAN.md 8.4.3). Igual que la biblioteca: si no pasa el esquema se descarta solo esta sección. */
  audio: AudioConfig.catch(() => emptyAudioConfig()).default(() => emptyAudioConfig()),
  /** Mouse y teclado remotos (docs/PLAN.md 8.5): sin permiso por celu (emparejado = usa todo); una sola llave global, prendida por defecto. */
  input: InputConfig.catch(() => emptyInputConfig()).default(() => emptyInputConfig()),
  /** Atajos de teclado de la PC (B6.1). Se suma a v5 sin cambiar la versión: un archivo viejo trae los valores por defecto. */
  hotkeys: HotkeysConfig.catch(() => emptyHotkeysConfig()).default(() => emptyHotkeysConfig()),
});

export type AgentConfig = z.infer<typeof AgentConfigV6>;
export type Device = AgentConfig["devices"][number];

export function parseConfig(raw: unknown) {
  return AgentConfigV6.safeParse(raw);
}

/** Config de fábrica: remoto apagado, puertos por defecto, sin identidad ni dispositivos. */
export function defaultConfig(): AgentConfig {
  return AgentConfigV6.parse({ version: CURRENT_CONFIG_VERSION, remote: {} });
}

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** `MIGRATIONS[i]` lleva de la versión `i + 1` a la `i + 2`. */
export const MIGRATIONS: Migration[] = [
  // 1 → 2: los tokens de B1 viajaron sin cifrar, así que se dan por quemados y hay que re-emparejar.
  (raw) => ({ ...raw, version: 2, devices: [], identity: null, monitors: { known: [] } }),
  // 2 → 3: biblioteca vacía; no se toca nada más (los celus siguen emparejados).
  (raw) => ({ ...raw, version: 3, library: emptyLibrary() }),
  // 3 → 4: audio vacío; no se toca nada más.
  (raw) => ({ ...raw, version: 4, audio: emptyAudioConfig() }),
  // 4 → 5: la llave de mouse y teclado remotos, prendida; no se toca nada más.
  (raw) => ({ ...raw, version: 5, input: emptyInputConfig() }),
  // 5 → 6: solo cambia cómo se guarda la clave privada (lo hace el store al leer, con DPAPI); acá no se toca nada.
  (raw) => ({ ...raw, version: 6 }),
];

/** Aplica las migraciones en orden desde la versión del archivo hasta `target`. */
export function migrate(
  raw: Record<string, unknown>,
  steps: Migration[] = MIGRATIONS,
  target: number = CURRENT_CONFIG_VERSION,
): Record<string, unknown> {
  let current = raw;
  let version = current.version as number;
  while (version < target) {
    const step = steps[version - 1];
    if (!step) throw new Error(`Falta la migración de agent.json v${version}`);
    current = step(current);
    version = current.version as number;
  }
  return current;
}
