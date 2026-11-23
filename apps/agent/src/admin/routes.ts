import { z } from "zod";

// Rutas de la API del panel (docs/PLAN.md 5.5). No conocen HTTP: reciben el
// cuerpo ya parseado y devuelven estado + JSON. La seguridad (Host, cookie,
// Origin) vive en server.ts.

export interface AdminStatus {
  remote: { enabled: boolean; port: number; error?: string };
  addresses: { name: string; address: string }[];
  selected: { name: string; address: string } | null;
  pairing: {
    state: "idle" | "showing" | "awaiting";
    qrSvg?: string;
    expiresAt?: number;
    pending?: { deviceName: string; platform: "android" | "ios"; ip: string };
  };
  devices: {
    id: string;
    name: string;
    platform: "android" | "ios";
    pairedAt: string;
    lastSeenAt: string | null;
    connected: boolean;
    /** Primeros caracteres de la clave pública del celu: sirve para reconocerlo (no es secreto). */
    fingerprint: string;
  }[];
  firewallHint: boolean;
  /** Audio (B4): si anda en esta PC y los interruptores de las dos funciones no documentadas de Windows (D29 y D30). */
  audio?: { available: boolean; defaultOutput: boolean; appRouting: boolean; disabled: { defaultOutput: boolean; appRouting: boolean } };
  /** Pad (B5): la llave global de mouse y teclado remotos (prendida por defecto) y lo que tiene apretado ahora. */
  input?: { available: boolean; enabled: boolean; elevated: boolean; holding: { left: boolean; alt: boolean } };
  /** Arranque con Windows (B6.2): el estado REAL del sistema y, si el último intento falló, el motivo. */
  autostart?: { enabled: boolean; error?: string };
  /** Atajos de teclado de la PC (B6.1): la llave global, el estado de cada tecla y la pantalla elegida como "la tele". */
  hotkeys?: {
    available: boolean;
    enabled: boolean;
    keys: { id: number; label: string; status: "active" | "busy" | "failed" | "off"; scene?: { id: string; name: string } }[];
    tv: { monitorId: string | null; options: { id: string; name: string }[] };
  };
  /** Avisos para la página (claves; el texto lo pone la página). */
  notices?: ("config_recovered" | "config_newer" | "tray_failed" | "security_upgraded" | "identity_lost")[];
}

/** Lo que el panel necesita de la app. Lo implementa `app.ts` (paso 10). */
export interface AdminController {
  status(): AdminStatus;
  setRemote(enabled: boolean): Promise<void>;
  /** `false` si no se puede (remoto apagado, sin red local o con un pedido esperando). */
  startPairing(): Promise<boolean>;
  /** `false` si no había pedido pendiente. */
  decide(allow: boolean): Promise<boolean>;
  /** `false` si el dispositivo no existe. */
  revoke(deviceId: string): Promise<boolean>;
  /** `name: null` = automática. `false` si esa interfaz no es candidata. */
  setInterface(name: string | null): Promise<boolean>;
  /** Apaga o prende a mano una función no documentada de Windows, por si una actualización la rompe. */
  setAudioSwitch(which: "defaultOutput" | "appRouting", disabled: boolean): Promise<boolean>;
  /** Prende o apaga la llave global del Pad (apagarla suelta lo apretado). `false` si no hay Pad en esta PC. */
  setInput(enabled: boolean): Promise<boolean>;
  /** "Soltar todo": suelta el botón y Alt si quedaron apretados. `false` si no hay Pad. */
  releaseInput(): Promise<boolean>;
  /** Prende o apaga la llave global de los atajos de teclado (Ctrl+Alt+Esc queda siempre). `false` si no hay atajos en esta PC. */
  setHotkeys(enabled: boolean): Promise<boolean>;
  /** Genera una clave nueva para la PC tras perder la anterior (otra cuenta de Windows). Los celus tienen que volver a emparejar. `false` si no hacía falta. */
  resetIdentity(): Promise<boolean>;
  /** Crea o borra la entrada de inicio con Windows. Un fallo de Windows no rechaza: queda en `status().autostart.error`. `false` si no hay soporte. */
  setAutostart(enabled: boolean): Promise<boolean>;
  /** Elige qué pantalla es "la tele" de Ctrl+Alt+T (`null` = ninguna). `false` si no hay atajos o esa pantalla no se conoce. */
  setTvMonitor(monitorId: string | null): Promise<boolean>;
  quit(): void;
}

export interface ApiResult {
  status: number;
  json: unknown;
  /** Se ejecuta cuando la respuesta ya salió (p. ej. apagar el agente). */
  after?: () => void;
}

type Handler = (controller: AdminController, params: string[], body: unknown) => Promise<ApiResult>;
interface Route {
  pattern: RegExp;
  methods: Partial<Record<"GET" | "POST", Handler>>;
}

const ok = (): ApiResult => ({ status: 200, json: { ok: true } });
const bad = (error: string): ApiResult => ({ status: 400, json: { ok: false, error } });

const RemoteBody = z.strictObject({ enabled: z.boolean() });
const DecisionBody = z.strictObject({ allow: z.boolean() });
const InterfaceBody = z.strictObject({ name: z.string().min(1).max(200).nullable() });
const AudioSwitchBody = z.strictObject({ which: z.enum(["defaultOutput", "appRouting"]), disabled: z.boolean() });
const InputBody = z.strictObject({ enabled: z.boolean() });
const HotkeysBody = z.strictObject({ enabled: z.boolean() });
const TvBody = z.strictObject({ monitorId: z.string().regex(/^m_[A-Za-z0-9_-]{16}$/).nullable() });
const EmptyBody = z.object({});

const ROUTES: Route[] = [
  {
    pattern: /^\/api\/status$/,
    methods: { GET: async (c) => ({ status: 200, json: c.status() }) },
  },
  {
    pattern: /^\/api\/remote$/,
    methods: {
      POST: async (c, _p, body) => {
        const r = RemoteBody.safeParse(body);
        if (!r.success) return bad("enabled debe ser true o false");
        await c.setRemote(r.data.enabled);
        return ok();
      },
    },
  },
  {
    pattern: /^\/api\/pairing\/start$/,
    methods: {
      POST: async (c, _p, body) => {
        if (!EmptyBody.safeParse(body).success) return bad("cuerpo inválido");
        return (await c.startPairing()) ? ok() : { status: 409, json: { ok: false, error: "no se puede emparejar ahora" } };
      },
    },
  },
  {
    pattern: /^\/api\/pairing\/decision$/,
    methods: {
      POST: async (c, _p, body) => {
        const r = DecisionBody.safeParse(body);
        if (!r.success) return bad("allow debe ser true o false");
        return (await c.decide(r.data.allow)) ? ok() : { status: 409, json: { ok: false, error: "no hay pedido pendiente" } };
      },
    },
  },
  {
    pattern: /^\/api\/devices\/([^/]+)\/revoke$/,
    methods: {
      POST: async (c, params) => {
        const id = z.uuid().safeParse(params[0]);
        if (!id.success) return bad("id inválido");
        return (await c.revoke(id.data)) ? ok() : { status: 404, json: { ok: false, error: "dispositivo desconocido" } };
      },
    },
  },
  {
    pattern: /^\/api\/interface$/,
    methods: {
      POST: async (c, _p, body) => {
        const r = InterfaceBody.safeParse(body);
        if (!r.success) return bad("name debe ser un texto o null");
        return (await c.setInterface(r.data.name)) ? ok() : bad("esa interfaz no es una red local candidata");
      },
    },
  },
  {
    pattern: /^\/api\/audio$/,
    methods: {
      POST: async (c, _p, body) => {
        const r = AudioSwitchBody.safeParse(body);
        if (!r.success) return bad("which debe ser defaultOutput o appRouting y disabled true o false");
        return (await c.setAudioSwitch(r.data.which, r.data.disabled)) ? ok() : { status: 409, json: { ok: false, error: "no se pudo guardar" } };
      },
    },
  },
  {
    pattern: /^\/api\/input$/,
    methods: {
      POST: async (c, _p, body) => {
        const r = InputBody.safeParse(body);
        if (!r.success) return bad("enabled debe ser true o false");
        return (await c.setInput(r.data.enabled)) ? ok() : { status: 409, json: { ok: false, error: "el Pad no está disponible en esta PC" } };
      },
    },
  },
  {
    pattern: /^\/api\/input\/release$/,
    methods: {
      POST: async (c, _p, body) => {
        if (!EmptyBody.safeParse(body).success) return bad("el cuerpo debe ser un objeto");
        return (await c.releaseInput()) ? ok() : { status: 409, json: { ok: false, error: "el Pad no está disponible en esta PC" } };
      },
    },
  },
  {
    pattern: /^\/api\/identity\/reset$/,
    methods: {
      POST: async (c, _p, body) => {
        if (!EmptyBody.safeParse(body).success) return bad("el cuerpo debe ser un objeto");
        return (await c.resetIdentity()) ? ok() : { status: 409, json: { ok: false, error: "la clave de la PC está bien: no hace falta generar otra" } };
      },
    },
  },
  {
    pattern: /^\/api\/autostart$/,
    methods: {
      POST: async (c, _p, body) => {
        const r = HotkeysBody.safeParse(body);
        if (!r.success) return bad("enabled debe ser true o false");
        return (await c.setAutostart(r.data.enabled)) ? ok() : { status: 409, json: { ok: false, error: "el inicio con Windows no está disponible en esta PC" } };
      },
    },
  },
  {
    pattern: /^\/api\/hotkeys$/,
    methods: {
      POST: async (c, _p, body) => {
        const r = HotkeysBody.safeParse(body);
        if (!r.success) return bad("enabled debe ser true o false");
        return (await c.setHotkeys(r.data.enabled)) ? ok() : { status: 409, json: { ok: false, error: "los atajos no están disponibles en esta PC" } };
      },
    },
  },
  {
    pattern: /^\/api\/hotkeys\/tv$/,
    methods: {
      POST: async (c, _p, body) => {
        const r = TvBody.safeParse(body);
        if (!r.success) return bad("monitorId debe ser el id de una pantalla o null");
        return (await c.setTvMonitor(r.data.monitorId)) ? ok() : { status: 409, json: { ok: false, error: "esa pantalla no se conoce" } };
      },
    },
  },
  {
    pattern: /^\/api\/quit$/,
    methods: {
      POST: async (c) => ({ ...ok(), after: () => c.quit() }),
    },
  },
];

export type ApiMatch =
  | { kind: "none" }
  | { kind: "wrong_method" }
  | { kind: "match"; run: (controller: AdminController, body: unknown) => Promise<ApiResult> };

export function matchApi(method: string, pathname: string): ApiMatch {
  for (const route of ROUTES) {
    const m = route.pattern.exec(pathname);
    if (!m) continue;
    const handler = route.methods[method as "GET" | "POST"];
    if (!handler) return { kind: "wrong_method" };
    const params = m.slice(1).map((p) => decodeURIComponent(p));
    return { kind: "match", run: (controller, body) => handler(controller, params, body) };
  }
  return { kind: "none" };
}
