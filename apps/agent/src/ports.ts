// Interfaces inyectables del agente (docs/PLAN.md 5.1). La lógica depende de estas
// interfaces y no de Node directo, así los tests usan fakes (test/fakes.ts).

export type TimerHandle = { readonly __timer: unique symbol };

export interface Clock {
  now(): number; // epoch ms
  setTimeout(fn: () => void, ms: number): TimerHandle;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clear(h: TimerHandle): void;
}

export interface Random {
  bytes(n: number): Uint8Array; // crypto.randomBytes
  uuid(): string; // crypto.randomUUID
}

export interface FileSystem {
  readFile(path: string): Promise<string | null>; // null si no existe (ENOENT)
  writeFileAtomic(path: string, data: string): Promise<void>; // .tmp + rename
  copyFile(from: string, to: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
  size(path: string): Promise<number | null>; // null si no existe
  rename(from: string, to: string): Promise<void>;
  /** Escribe bytes en `<path>.tmp` y renombra (un sonido que subió el celu). */
  writeBytesAtomic(path: string, data: Uint8Array): Promise<void>;
  /** Borra un archivo; si no existe, no hace nada. */
  remove(path: string): Promise<void>;
}

export interface NetInterface {
  name: string;
  address: string;
  family: "IPv4" | "IPv6";
  internal: boolean;
  mac: string;
  netmask: string;
}
export interface NetInfo {
  list(): NetInterface[]; // aplana os.networkInterfaces()
}

export interface SystemInfo {
  hostname(): string;
  uptimeSec(): number;
  cpuTimes(): { idle: number; total: number }; // suma de os.cpus()[i].times
  memTotal(): number;
  memFree(): number;
}

export type TrayMenuItem = {
  id: "open" | "remoteToggle" | "autostartToggle" | "cutInput" | "quit";
  label: string;
  checked?: boolean;
};
export interface Tray {
  start(opts: { tooltip: string; items: TrayMenuItem[] }): Promise<void>;
  setItems(items: TrayMenuItem[]): void; // refresca el check de Remoto
  onClick(cb: (id: TrayMenuItem["id"]) => void): void;
  stop(): Promise<void>;
}

export interface Browser {
  open(url: string): Promise<void>;
}

/** Rectángulo en píxeles físicos, coordenadas del escritorio de Windows. */
export interface RawRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Una pantalla tal como la reporta Windows (CCD + EnumDisplayMonitors), sin interpretar. */
export interface RawDisplay {
  /** Ruta del dispositivo del monitor (estable); si Windows no la da, una clave de respaldo armada por la capa nativa. */
  devicePath: string;
  friendlyName: string;
  /** DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY. */
  outputTechnology: number;
  active: boolean;
  primary: boolean;
  gdiName: string | null;
  bounds: RawRect | null;
  workArea: RawRect | null;
}

/** Una ventana de nivel superior, tal como la reporta Windows. */
export interface RawWindow {
  /** HWND como texto (no cruza al celu). */
  handle: string;
  title: string;
  exe: string;
  className: string;
  rect: RawRect;
  state: "normal" | "maximized" | "minimized";
}

/** Pantallas de Windows: leer cómo están y prender o apagar una. */
export interface Displays {
  list(): Promise<RawDisplay[]>;
  /**
   * Prende o apaga la pantalla con esa ruta de dispositivo. Vuelve cuando Windows ya aplicó el cambio.
   * Al prender, `restoreAt` es dónde estaba (posición y tamaño) para que vuelva a su lugar.
   */
  setEnabled(devicePath: string, on: boolean, restoreAt?: RawRect): Promise<void>;
  /** Cambia de lugar a las pantallas prendidas (coordenadas del escritorio). Todo o nada. */
  arrange(items: { devicePath: string; x: number; y: number }[]): Promise<void>;
}

/** Una ventana de la lista completa: lo de `RawWindow` más el proceso y el estado de foco y pantalla completa. */
export interface RawWindowFull extends RawWindow {
  pid: number;
  /** Ruta completa del .exe ("" si no se pudo leer, p. ej. un proceso protegido). */
  exePath: string;
  focused: boolean;
  /** La puso en pantalla completa sin bordes este agente (la vuelta atrás depende de eso). */
  fullscreen: boolean;
}

/** Ventanas de Windows: leer, mover, traer al frente y cerrar. */
export interface Windows {
  foreground(): Promise<RawWindow | null>;
  /**
   * Mueve la ventana a `rect` (restaurándola antes si estaba maximizada o minimizada) y, si `maximize`, la
   * vuelve a maximizar. Rechaza con un mensaje que contiene "elevated" si es una ventana de administrador.
   */
  place(handle: string, rect: RawRect, maximize: boolean): Promise<void>;
  /** Las ventanas de usuario, de arriba hacia abajo (orden Z). */
  list(): Promise<RawWindowFull[]>;
  /** La trae al frente (restaurándola si estaba minimizada). Rechaza con "focus_denied" si Windows no lo deja. */
  focus(handle: string): Promise<void>;
  show(handle: string, cmd: "minimize" | "maximize" | "restore"): Promise<void>;
  /** Le pide a la app que se cierre (WM_CLOSE): puede preguntar "¿guardar?". */
  close(handle: string): Promise<void>;
  /** Pantalla completa sin bordes sobre `monitor`; si ya estaba así, la deja como estaba. */
  toggleFullscreen(handle: string, monitor: RawRect): Promise<void>;
}

/** Las apps del menú Inicio de Windows (`Get-StartApps`). */
export interface AppCatalog {
  list(): Promise<{ appId: string; name: string }[]>;
}

/** Saca el ícono de cada elemento y lo deja como `<key>.b64` (PNG en base64) dentro de `outDir`. Los que fallan quedan sin archivo. */
export interface IconExtractor {
  extract(items: { key: string; parsing: string }[], outDir: string): Promise<void>;
}

/** Abre una app o un link. Nada de lo que recibe viene del celu sin validar. */
export interface AppLauncher {
  openApp(appId: string): Promise<void>;
  /**
   * `tab` (o sin modo) = lo que hace Windows, una pestaña en la ventana que ya está; `window` = ventana nueva; `private` = ventana
   * de incógnito. Si no se puede abrir como se pidió, rechaza: nunca abre otra cosa en su lugar.
   */
  openUrl(url: string, opts?: { mode?: "tab" | "window" | "private" }): Promise<void>;
  /** Abre una ventana nueva (común o de incógnito) del navegador que está en esa ruta. Rechaza con `not_supported` si no es un navegador conocido. */
  openBrowserWindow(exePath: string, mode: "window" | "private"): Promise<void>;
}

// ── Audio (B4, docs/PLAN.md 8.4.4) ──────────────────────────────────────────

/** Una salida de audio ACTIVA de Windows. Los volúmenes y el pico son escalares de 0 a 1, como los da Windows. */
export interface RawOutput {
  /** El id de Windows ("{0.0.0.00000000}.{…}"). Nunca sale del agente. */
  winId: string;
  name: string;
  /** `PKEY_AudioEndpoint_FormFactor` (EndpointFormFactor): 1 parlantes, 3 auriculares, 5 headset, 9 pantalla HDMI… */
  formFactor: number;
  volume: number;
  muted: boolean;
}

/** Una sesión de audio de una app en una salida. Sonidos del sistema y procesos sin .exe vienen con `exePath: ""`. */
export interface RawSession {
  pid: number;
  exePath: string;
  /** La salida donde está la sesión. */
  winOutputId: string;
  volume: number;
  muted: boolean;
  peak: number;
  /** A qué salida la fijó Jay en Windows (D30); null = sigue a la predeterminada. */
  routedWinId: string | null;
}

/** Una sesión de media de Windows (los controles del teclado y el cartel de volumen). */
export interface RawMedia {
  /** `SourceAppUserModelId` ("chrome.exe", "SpotifyAB.SpotifyMusic_…!Spotify"). */
  aumid: string;
  /** Número de orden entre las sesiones con el mismo AUMID (0 la primera): dos pestañas o apps de Chrome comparten AUMID. */
  index: number;
  title: string;
  artist: string;
  status: "playing" | "paused" | "other";
  controls: { prev: boolean; playPause: boolean; next: boolean };
  hasArt: boolean;
  /** Es la "sesión actual" que Windows elige para las teclas de Media. */
  isCurrent: boolean;
  /**
   * `GetTimelineProperties()` tal como lo da Windows (D97): la posición vale para el momento en que la app la informó, hace
   * `ageMs` (null si la app nunca dijo cuándo). `rate` es `PlaybackRate` (null si no lo informa). Falta o null = sin datos.
   */
  timeline?: { startMs: number; endMs: number; positionMs: number; ageMs: number | null; rate: number | null } | null;
}

export interface RawAudio {
  outputs: RawOutput[];
  sessions: RawSession[];
  /** La predeterminada de Multimedia; null si no hay ninguna. */
  defaultWinId: string | null;
  media: RawMedia[];
}

/** Lo que el hijo de audio dice al arrancar: qué funciones andan en esta PC. */
export interface AudioReady {
  defaultOutput: boolean;
  appRouting: boolean;
}

/** Audio de Windows. Todo lo que entra son ids de Windows que el agente sacó de su último `snapshot`, nunca del celu. */
export interface AudioSystem {
  ready(): Promise<AudioReady>;
  snapshot(): Promise<RawAudio>;
  setOutputVolume(winId: string, scalar: number): Promise<void>;
  setOutputMute(winId: string, muted: boolean): Promise<void>;
  /** Cambia el volumen de todas las sesiones de esos procesos, en todas las salidas. */
  setAppVolume(pids: number[], scalar: number): Promise<void>;
  setAppMute(pids: number[], muted: boolean): Promise<void>;
  /** Hace predeterminada la salida en los tres roles (D29). */
  setDefault(winId: string): Promise<void>;
  /** Manda esos procesos a una salida; `null` = que vuelvan a seguir a la predeterminada (D30). */
  route(pids: number[], winId: string | null): Promise<void>;
  /** ⏮ ⏯ ⏭ sobre la sesión de media de esa app. Rechaza con "not_supported" si la app no acepta el control. */
  mediaControl(aumid: string, key: "prev" | "playPause" | "next", index: number): Promise<void>;
  /** La carátula como JPEG en base64 (lado mayor 200 px), o null si no hay. */
  art(aumid: string, index: number): Promise<string | null>;
  /** F4a (D108): reproduce un archivo de sonido por esa salida (sin tocar la predeterminada) y vuelve enseguida. `volume` 0 a 1. */
  playSound(file: string, winId: string, volume: number): Promise<void>;
}

/** Las teclas de Media del teclado: respaldo cuando no hay ninguna sesión de media. */
export interface MediaKeys {
  press(key: "prev" | "playPause" | "next"): Promise<void>;
}

/** Un monitor en píxeles físicos del escritorio virtual, con su escala (1 = 100 %). */
export interface InputMonitor {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}
export interface InputMonitors {
  list: InputMonitor[];
  /** El escritorio virtual completo (todas las pantallas). */
  virtual: { x: number; y: number; w: number; h: number };
}
/** [vk, soltar, extendida] */
export type InputKeyEvent = readonly [vk: number, up: boolean, ext: boolean];

/**
 * Entrada de Windows para el Pad (docs/PLAN.md 8.5, D56): un proceso hijo propio, aparte del de ventanas, para que
 * una lectura lenta no frene el mouse. `moveAbs` y `wheel` no esperan respuesta y se fusionan si hay uno en vuelo.
 */
export interface InputSystem {
  /** false si el hijo se cayó 3 veces en un minuto o no se pudo lanzar. */
  available(): boolean;
  cursor(): Promise<{ x: number; y: number }>;
  monitors(): Promise<InputMonitors>;
  /** Mueve el cursor a coordenadas normalizadas 0–65535 del escritorio virtual (MOVE | ABSOLUTE | VIRTUALDESK). */
  moveAbs(nx: number, ny: number): void;
  /** Rueda (120 = un clic). Se suma lo que haya en vuelo. */
  wheel(dx: number, dy: number): void;
  button(button: "left" | "middle" | "right", action: "click" | "down" | "up"): Promise<void>;
  /** Todos los eventos en un solo SendInput (atómico: no se intercala con nada). */
  keys(events: readonly InputKeyEvent[]): Promise<void>;
  /** Texto con KEYEVENTF_UNICODE, una unidad UTF-16 por vez, en tandas. */
  text(units: readonly number[]): Promise<void>;
  /** ¿La ventana del frente es de administrador (UIPI bloquea la entrada)? */
  elevated(): Promise<boolean>;
}

/** Un atajo `Ctrl+Alt+<vk>` que se pide registrar. */
export interface HotkeyRegistration {
  id: number;
  vk: number;
}
/** Resultado de registrar uno. `busy`: otro programa ya tiene esa combinación (error 1409 de `RegisterHotKey`). */
export type HotkeyResult = { id: number; ok: true } | { id: number; ok: false; busy: boolean; error: string };

/**
 * Atajos globales de Windows (docs/PLAN.md 8.6, D67): un proceso hijo propio registra con `RegisterHotKey` y avisa qué
 * id se apretó. El agente decide qué hace cada id.
 */
export interface Hotkeys {
  /** false si el hijo se cayó 3 veces en un minuto o no se pudo lanzar. */
  available(): boolean;
  /** Reemplaza todo el conjunto: suelta los registrados antes y registra estos. Una lista vacía los suelta a todos. */
  set(keys: HotkeyRegistration[]): Promise<HotkeyResult[]>;
  /** Se llama con el id cada vez que se aprieta uno registrado. */
  onPressed(cb: (id: number) => void): void;
  /** Se llama cuando el hijo se cayó y volvió a levantarse con los atajos registrados otra vez (o no pudo): hay que releer el estado. */
  onRestored(cb: () => void): void;
  /** Suelta todo y mata al hijo. */
  stop(): void;
}

/**
 * Cifrado con la cuenta de Windows del usuario (DPAPI, docs/PLAN.md 8.6, D73). Sirve para guardar la clave privada de la PC
 * en `agent.json`: solo esta cuenta de Windows, en esta PC, la puede abrir. Síncrono (tarda unos 3 ms). Rechaza si Windows no puede.
 */
export interface Secret {
  protect(plain: Uint8Array): Uint8Array;
  unprotect(cipher: Uint8Array): Uint8Array;
}

/** Arranque con Windows por usuario (docs/PLAN.md 8.6, D72). `read` mira el estado REAL del sistema, no la config. */
export interface Autostart {
  read(): Promise<{ enabled: boolean }>;
  /** Crea o borra la entrada. Rechaza con el motivo si Windows no deja. Borrar lo que no estaba no es error. */
  set(on: boolean): Promise<void>;
}

/** Un cuadro con el número de una pantalla, ubicado en esa pantalla. Solo números: nada que venga del celu. */
export interface IdentifyItem {
  index: number;
  bounds: RawRect;
}

/** Muestra un número en cada pantalla prendida durante unos segundos ("Identificar"). */
export interface Identifier {
  /** Vuelve cuando los cuadros ya se lanzaron; `done` se cumple cuando desaparecieron. Rechaza si no se pudo lanzar. */
  show(items: IdentifyItem[]): Promise<{ done: Promise<void> }>;
}

export type LogFields = Record<string, unknown>;
export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface Deps {
  clock: Clock;
  random: Random;
  fs: FileSystem;
  net: NetInfo;
  sys: SystemInfo;
  tray: Tray;
  browser: Browser;
  log: Logger;
  paths: { dataDir: string };
  /** Pantallas y ventanas de Windows (R2). Sin esto el agente funciona igual, sin la pestaña Pantallas. */
  displays?: Displays;
  windows?: Windows;
  identifier?: Identifier;
  /** B3: catálogo de apps, íconos y lanzador. Sin esto no hay lanzadores ni escenas. */
  catalog?: AppCatalog;
  iconExtractor?: IconExtractor;
  launcher?: AppLauncher;
  /** Fase C: el puente con la extensión del navegador. */
  browserBridge?: import("./browser/service").BrowserService;
  /** B4: audio de Windows (salidas, volumen por salida y por app, media). Sin esto la pestaña Audio dice "no disponible". */
  audio?: AudioSystem;
  /** Respaldo de ⏮ ⏯ ⏭ cuando no hay ninguna sesión de media. */
  mediaKeys?: MediaKeys;
  /** B5: mouse y teclado de Windows para el Pad. Sin esto el Pad dice "no disponible". */
  input?: InputSystem;
  /** B6: atajos globales de teclado. Sin esto el agente funciona igual, sin atajos. */
  hotkeys?: Hotkeys;
  /** B6.2: arranque con Windows. Sin esto el panel no muestra la tarjeta. */
  autostart?: Autostart;
  /** B6.4: cifrado de la clave privada con la cuenta de Windows. Sin esto `agent.json` guarda la clave en claro (solo desarrollo). */
  secret?: Secret;
}
