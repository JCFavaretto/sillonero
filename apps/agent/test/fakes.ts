import type {
  Secret,
  Autostart,
  AppCatalog,
  AudioReady,
  AudioSystem,
  MediaKeys,
  RawAudio,
  AppLauncher,
  Browser,
  Clock,
  Displays,
  FileSystem,
  HotkeyRegistration,
  HotkeyResult,
  Hotkeys,
  IconExtractor,
  InputKeyEvent,
  InputMonitors,
  InputSystem,
  Identifier,
  IdentifyItem,
  LogFields,
  Logger,
  NetInfo,
  NetInterface,
  RawDisplay,
  RawWindow,
  RawWindowFull,
  Random,
  SystemInfo,
  TimerHandle,
  Windows,
  Tray,
  TrayMenuItem,
} from "../src/ports";

type Timer = { id: number; at: number; fn: () => void; every: number | null };

export class FakeClock implements Clock {
  private time: number;
  private nextId = 1;
  private timers = new Map<number, Timer>();

  constructor(start = 1_700_000_000_000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    return this.add(fn, ms, null);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    return this.add(fn, ms, ms);
  }

  clear(h: TimerHandle): void {
    this.timers.delete(h as unknown as number);
  }

  /** Avanza el reloj y dispara los timers vencidos en orden. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = this.nextDue(target);
      if (!next) break;
      this.time = next.at;
      if (next.every === null) this.timers.delete(next.id);
      else next.at += next.every;
      next.fn();
    }
    this.time = target;
  }

  pendingTimers(): number {
    return this.timers.size;
  }

  private add(fn: () => void, ms: number, every: number | null): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { id, at: this.time + ms, fn, every });
    return id as unknown as TimerHandle;
  }

  private nextDue(target: number): Timer | undefined {
    let best: Timer | undefined;
    for (const t of this.timers.values()) {
      if (t.at <= target && (!best || t.at < best.at || (t.at === best.at && t.id < best.id))) {
        best = t;
      }
    }
    return best;
  }
}

/** Bytes deterministas: 0, 1, 2… (o `fill` fijo). */
export class FakeRandom implements Random {
  private counter = 0;
  private uuidCounter = 0;

  constructor(private readonly fill?: number) {}

  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.fill ?? this.counter++ % 256;
    return out;
  }

  uuid(): string {
    const n = (this.uuidCounter++).toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${n}`;
  }
}

export class MemFs implements FileSystem {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  /** Archivos binarios (sonidos). */
  readonly bytes = new Map<string, Uint8Array>();
  private failWrites = 0;

  /** La próxima escritura (writeFileAtomic o appendFile) falla. */
  failNextWrite(times = 1): void {
    this.failWrites = times;
  }

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeFileAtomic(path: string, data: string): Promise<void> {
    this.maybeFail();
    // Como el real: si algo falla, el archivo original queda intacto.
    this.files.set(path, data);
  }

  async writeBytesAtomic(path: string, data: Uint8Array): Promise<void> {
    this.maybeFail();
    this.bytes.set(path, new Uint8Array(data));
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.bytes.delete(path);
  }

  async copyFile(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (data === undefined) throw new Error(`ENOENT: ${from}`);
    this.files.set(to, data);
  }

  async mkdirp(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async appendFile(path: string, data: string): Promise<void> {
    this.maybeFail();
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async size(path: string): Promise<number | null> {
    const data = this.files.get(path);
    return data === undefined ? null : Buffer.byteLength(data);
  }

  async rename(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (data === undefined) throw new Error(`ENOENT: ${from}`);
    this.files.delete(from);
    this.files.set(to, data);
  }

  private maybeFail(): void {
    if (this.failWrites > 0) {
      this.failWrites--;
      throw new Error("EIO: simulated write failure");
    }
  }
}

export class FakeNetInfo implements NetInfo {
  constructor(public interfaces: NetInterface[] = []) {}
  list(): NetInterface[] {
    return this.interfaces;
  }
}

export class FakeSystemInfo implements SystemInfo {
  host = "PC-DE-JAY";
  uptime = 3600;
  times = { idle: 0, total: 0 };
  totalMem = 16 * 1024 ** 3;
  freeMem = 8 * 1024 ** 3;
  hostname(): string {
    return this.host;
  }
  uptimeSec(): number {
    return this.uptime;
  }
  cpuTimes(): { idle: number; total: number } {
    return this.times;
  }
  memTotal(): number {
    return this.totalMem;
  }
  memFree(): number {
    return this.freeMem;
  }
}

export class FakeTray implements Tray {
  started = false;
  stopped = false;
  tooltip = "";
  items: TrayMenuItem[] = [];
  private cb: ((id: TrayMenuItem["id"]) => void) | null = null;

  async start(opts: { tooltip: string; items: TrayMenuItem[] }): Promise<void> {
    this.started = true;
    this.tooltip = opts.tooltip;
    this.items = opts.items;
  }
  setItems(items: TrayMenuItem[]): void {
    this.items = items;
  }
  onClick(cb: (id: TrayMenuItem["id"]) => void): void {
    this.cb = cb;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  /** Simula un clic en un item del menú. */
  click(id: TrayMenuItem["id"]): void {
    this.cb?.(id);
  }
}

export class FakeBrowser implements Browser {
  readonly opened: string[] = [];
  async open(url: string): Promise<void> {
    this.opened.push(url);
  }
}

export type LogEntry = { level: "info" | "warn" | "error"; msg: string; fields?: LogFields };

export class MemLogger implements Logger {
  readonly entries: LogEntry[] = [];
  info(msg: string, fields?: LogFields): void {
    this.entries.push({ level: "info", msg, fields });
  }
  warn(msg: string, fields?: LogFields): void {
    this.entries.push({ level: "warn", msg, fields });
  }
  error(msg: string, fields?: LogFields): void {
    this.entries.push({ level: "error", msg, fields });
  }
}

export class FakeDisplays implements Displays {
  raw: RawDisplay[] = [];
  calls = 0;
  /** Cada prender/apagar que se pidió, en orden. */
  readonly sets: { devicePath: string; on: boolean; restoreAt?: { x: number; y: number; w: number; h: number } }[] = [];
  /** Cada reordenamiento que se pidió, en orden. */
  readonly arranged: { devicePath: string; x: number; y: number }[][] = [];
  /** Para simular que Windows deja las cosas en otro lugar después de reordenar. */
  afterArrange: ((raw: RawDisplay[]) => void) | null = null;
  /** Dónde queda una pantalla al prenderla (por defecto 1920×1080 en 0,0). */
  enableAt: Record<string, { x: number; y: number; w: number; h: number }> = {};
  /** Para simular que Windows hace algo raro después de aplicar el cambio. */
  afterSet: ((raw: RawDisplay[]) => void) | null = null;
  /** Se completa cuando se llama a setEnabled; permite pausarlo desde el test. */
  gate: Promise<void> | null = null;
  /** Pausa `list()` DESPUÉS de leer: simula una lectura lenta que devuelve datos viejos. */
  listGate: Promise<void> | null = null;
  private failure: Error | null = null;
  private setFailure: Error | null = null;
  failSetNext(err = new Error("SetDisplayConfig devolvió 87")): void {
    this.setFailure = err;
  }
  async arrange(items: { devicePath: string; x: number; y: number }[]): Promise<void> {
    this.arranged.push(items);
    if (this.gate) await this.gate;
    if (this.setFailure) {
      const err = this.setFailure;
      this.setFailure = null;
      throw err;
    }
    for (const it of items) {
      const d = this.raw.find((r) => r.devicePath === it.devicePath);
      if (d?.bounds) d.bounds = { ...d.bounds, x: it.x, y: it.y };
    }
    this.afterArrange?.(this.raw);
  }
  async setEnabled(devicePath: string, on: boolean, restoreAt?: { x: number; y: number; w: number; h: number }): Promise<void> {
    this.sets.push(restoreAt ? { devicePath, on, restoreAt } : { devicePath, on });
    if (this.gate) await this.gate;
    if (this.setFailure) {
      const err = this.setFailure;
      this.setFailure = null;
      throw err;
    }
    const d = this.raw.find((r) => r.devicePath === devicePath);
    if (!d) throw new Error("pantalla desconocida");
    d.active = on;
    d.bounds = on ? (this.enableAt[devicePath] ?? { x: 0, y: 0, w: 1920, h: 1080 }) : null;
    this.afterSet?.(this.raw);
  }
  failNext(err = new Error("displays boom")): void {
    this.failure = err;
  }
  async list(): Promise<RawDisplay[]> {
    this.calls++;
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
    const snapshot = structuredClone(this.raw);
    if (this.listGate) await this.listGate;
    return snapshot;
  }
}

export class FakeIdentifier implements Identifier {
  readonly shown: IdentifyItem[][] = [];
  private release: (() => void) | null = null;
  private failure: Error | null = null;
  failNext(err = new Error("no se pudo lanzar PowerShell")): void {
    this.failure = err;
  }
  /** Hace que los cuadros "desaparezcan" (se cumple el `done` de la última vez). */
  finish(): void {
    this.release?.();
  }
  async show(items: IdentifyItem[]): Promise<{ done: Promise<void> }> {
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
    this.shown.push(items);
    return { done: new Promise<void>((r) => (this.release = r)) };
  }
}

export class FakeWindows implements Windows {
  win: RawWindow | null = null;
  /** La lista completa (B3). Mover o maximizar acá se refleja en `list()`. */
  all: RawWindowFull[] = [];
  /** Cada movimiento que se pidió, en orden. */
  readonly placed: { handle: string; rect: { x: number; y: number; w: number; h: number }; maximize: boolean }[] = [];
  /** Cada acción de B3, en orden: "focus 0x1", "show 0x1 minimize", "close 0x1", "fullscreen 0x1". */
  readonly calls: string[] = [];
  private failure: Error | null = null;
  private placeFailure: Error | null = null;
  private actionFailure: Error | null = null;
  failPlaceNext(err = new Error("SetWindowPos falló")): void {
    this.placeFailure = err;
  }
  /** La próxima acción de B3 (focus, show, close, fullscreen) rechaza con este error. */
  failActionNext(err = new Error("focus_denied")): void {
    this.actionFailure = err;
  }
  async place(handle: string, rect: { x: number; y: number; w: number; h: number }, maximize: boolean): Promise<void> {
    this.placed.push({ handle, rect, maximize });
    if (this.placeFailure) {
      const err = this.placeFailure;
      this.placeFailure = null;
      throw err;
    }
    if (this.win && this.win.handle === handle) this.win = { ...this.win, rect, state: maximize ? "maximized" : "normal" };
    this.all = this.all.map((w) => (w.handle === handle ? { ...w, rect, state: maximize ? "maximized" : "normal" } : w));
  }
  failNext(err = new Error("windows boom")): void {
    this.failure = err;
  }
  async foreground(): Promise<RawWindow | null> {
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
    return this.win ? structuredClone(this.win) : null;
  }
  async list(): Promise<RawWindowFull[]> {
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
    return structuredClone(this.all);
  }
  private action(call: string): void {
    this.calls.push(call);
    if (this.actionFailure) {
      const err = this.actionFailure;
      this.actionFailure = null;
      throw err;
    }
  }
  async focus(handle: string): Promise<void> {
    this.action(`focus ${handle}`);
    this.all = this.all.map((w) => ({ ...w, focused: w.handle === handle, state: w.handle === handle && w.state === "minimized" ? "normal" : w.state }));
  }
  async show(handle: string, cmd: "minimize" | "maximize" | "restore"): Promise<void> {
    this.action(`show ${handle} ${cmd}`);
    const state = cmd === "minimize" ? "minimized" : cmd === "maximize" ? "maximized" : "normal";
    this.all = this.all.map((w) => (w.handle === handle ? { ...w, state } : w));
  }
  async close(handle: string): Promise<void> {
    this.action(`close ${handle}`);
    this.all = this.all.filter((w) => w.handle !== handle);
  }
  async toggleFullscreen(handle: string, monitor: { x: number; y: number; w: number; h: number }): Promise<void> {
    this.action(`fullscreen ${handle}`);
    this.all = this.all.map((w) => (w.handle === handle ? { ...w, fullscreen: !w.fullscreen, rect: w.fullscreen ? w.rect : monitor } : w));
  }
}

export class FakeCatalog implements AppCatalog {
  apps: { appId: string; name: string }[] = [
    { appId: "Anysphere.Cursor", name: "Cursor" },
    { appId: "C:\Users\Jay\AppData\Local\Discord\Discord.exe", name: "Discord" },
    { appId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", name: "Calculadora" },
    { appId: "C:\Program Files\Stremio\Uninstall.exe", name: "Uninstall Stremio" },
    { appId: "C:\Python\Doc\html\index.html", name: "Python Manuals" },
  ];
  reads = 0;
  private failure: Error | null = null;
  failNext(err = new Error("Get-StartApps falló")): void {
    this.failure = err;
  }
  async list(): Promise<{ appId: string; name: string }[]> {
    this.reads++;
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
    return structuredClone(this.apps);
  }
}

export class FakeIconExtractor implements IconExtractor {
  readonly calls: { key: string; parsing: string }[][] = [];
  /** Claves para las que no sale ícono. */
  missing = new Set<string>();
  /** Si se pasa, escribe `<key>.b64` en este MemFs. */
  constructor(private readonly fs: MemFs, private readonly b64 = "iVBORw0KGgo=") {}
  async extract(items: { key: string; parsing: string }[], outDir: string): Promise<void> {
    this.calls.push(items);
    for (const it of items) if (!this.missing.has(it.key)) await this.fs.writeFileAtomic(`${outDir}/${it.key}.b64`, this.b64);
  }
}

export class FakeLauncher implements AppLauncher {
  readonly opened: string[] = [];
  /** Se llama al abrir algo: los tests lo usan para que "aparezca" una ventana. */
  onOpen: ((what: string) => void) | null = null;
  private failure: Error | null = null;
  failNext(err = new Error("spawn falló")): void {
    this.failure = err;
  }
  private open(what: string): void {
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
    this.opened.push(what);
    this.onOpen?.(what);
  }
  async openApp(appId: string): Promise<void> {
    this.open(`app:${appId}`);
  }
  async openUrl(url: string, opts?: { mode?: "tab" | "window" | "private" }): Promise<void> {
    const mode = opts?.mode ?? "tab";
    this.open(mode === "tab" ? `url:${url}` : `${mode}-url:${url}`);
  }
  async openBrowserWindow(exePath: string, mode: "window" | "private"): Promise<void> {
    if (!/(chrome|msedge|firefox|brave)\.exe$/i.test(exePath)) throw new Error("not_supported: no es un navegador");
    this.open(`${mode}-window:${exePath}`);
  }
}

// ── Audio (B4) ───────────────────────────────────────────────────────────────

/** Audio de Windows en memoria: salidas, sesiones y media editables, y un registro de cada llamada. */
export class FakeAudio implements AudioSystem {
  raw: RawAudio = { outputs: [], sessions: [], defaultWinId: null, media: [] };
  flags: AudioReady = { defaultOutput: true, appRouting: true };
  /** Cada llamada que cambia algo, como texto: "setOutputVolume <id> 0.3". */
  calls: string[] = [];
  arts = new Map<string, string | null>();
  readyFails = false;
  snapshotFails = false;
  /** Rechaza la próxima llamada a esta operación con este mensaje. */
  private failures = new Map<string, string>();
  snapshots = 0;
  artCalls = 0;
  /** Cuánto tarda cada cambio (para probar la cola del último valor). */
  holdChanges: Promise<void> | null = null;

  failNext(op: string, message: string): void {
    this.failures.set(op, message);
  }
  private async change(op: string, args: string, apply: () => void): Promise<void> {
    this.calls.push(`${op} ${args}`);
    if (this.holdChanges) await this.holdChanges;
    const f = this.failures.get(op);
    if (f !== undefined) {
      this.failures.delete(op);
      throw new Error(f);
    }
    apply();
  }
  playSound(file: string, winId: string, volume: number) {
    return this.change("playSound", `${file} ${winId} ${volume}`, () => {
      if (!this.raw.outputs.some((o) => o.winId === winId)) throw new Error("output_unavailable");
    });
  }
  async ready(): Promise<AudioReady> {
    if (this.readyFails) throw new Error("audio host: exited");
    return this.flags;
  }
  async snapshot(): Promise<RawAudio> {
    this.snapshots++;
    if (this.snapshotFails) throw new Error("audio host: exited");
    return structuredClone(this.raw);
  }
  setOutputVolume(winId: string, scalar: number) {
    return this.change("setOutputVolume", `${winId} ${scalar}`, () => {
      const o = this.raw.outputs.find((x) => x.winId === winId);
      if (!o) throw new Error("not_found");
      o.volume = scalar;
    });
  }
  setOutputMute(winId: string, muted: boolean) {
    return this.change("setOutputMute", `${winId} ${muted}`, () => {
      const o = this.raw.outputs.find((x) => x.winId === winId);
      if (!o) throw new Error("not_found");
      o.muted = muted;
    });
  }
  setAppVolume(pids: number[], scalar: number) {
    return this.change("setAppVolume", `${pids.join(",")} ${scalar}`, () => {
      for (const s of this.raw.sessions) if (pids.includes(s.pid)) s.volume = scalar;
    });
  }
  setAppMute(pids: number[], muted: boolean) {
    return this.change("setAppMute", `${pids.join(",")} ${muted}`, () => {
      for (const s of this.raw.sessions) if (pids.includes(s.pid)) s.muted = muted;
    });
  }
  setDefault(winId: string) {
    return this.change("setDefault", winId, () => void (this.raw.defaultWinId = winId));
  }
  route(pids: number[], winId: string | null) {
    return this.change("route", `${pids.join(",")} ${winId ?? "null"}`, () => {
      for (const s of this.raw.sessions) if (pids.includes(s.pid)) s.routedWinId = winId;
    });
  }
  mediaControl(aumid: string, key: "prev" | "playPause" | "next", index: number) {
    return this.change("mediaControl", `${aumid}${index > 0 ? `#${index}` : ""} ${key}`, () => undefined);
  }
  async art(aumid: string, index: number): Promise<string | null> {
    this.artCalls++;
    return this.arts.get(index > 0 ? `${aumid}#${index}` : aumid) ?? null;
  }
}

export class FakeMediaKeys implements MediaKeys {
  readonly pressed: string[] = [];
  fail = false;
  async press(key: "prev" | "playPause" | "next"): Promise<void> {
    if (this.fail) throw new Error("SendInput falló");
    this.pressed.push(key);
  }
}

/** DPAPI falso: "cifra" dándole vuelta a los bytes y poniéndoles una marca. `failUnprotect` imita otro usuario de Windows. */
export class FakeSecret implements Secret {
  failProtect = false;
  failUnprotect = false;
  /** Devuelve basura al proteger (para probar que la verificación de ida y vuelta la agarra). */
  corrupt = false;
  /** Cambia de cuenta de Windows: lo cifrado antes ya no se puede abrir, pero lo nuevo sí. */
  private account = 0;
  switchAccount(): void {
    this.account++;
  }
  protect(plain: Uint8Array): Uint8Array {
    if (this.failProtect) throw new Error("CryptProtectData falló");
    const out = new Uint8Array(plain.length + 4);
    out.set([0xd, 0xa, this.account, 0xa]);
    plain.forEach((b, i) => (out[i + 4] = this.corrupt ? 0 : b ^ 0x5a));
    return out;
  }
  unprotect(cipher: Uint8Array): Uint8Array {
    if (this.failUnprotect) throw new Error("CryptUnprotectData falló (otra cuenta de Windows)");
    if (cipher[0] !== 0xd || cipher[1] !== 0xa || cipher[2] !== this.account) throw new Error("no es un secreto de esta cuenta");
    return Uint8Array.from(cipher.slice(4), (b) => b ^ 0x5a);
  }
}

/** Arranque con Windows falso: `enabled` es "lo que dice el registro". */
export class FakeAutostart implements Autostart {
  enabled = false;
  failSet: Error | null = null;
  reads = 0;
  async read() {
    this.reads++;
    return { enabled: this.enabled };
  }
  async set(on: boolean) {
    if (this.failSet) {
      const err = this.failSet;
      this.failSet = null;
      throw err;
    }
    this.enabled = on;
  }
}

/** Atajos globales falsos: `occupied` son los `vk` que "otro programa" ya tiene; `press(id)` simula apretar uno registrado. */
export class FakeHotkeys implements Hotkeys {
  occupied = new Set<number>();
  registered: HotkeyRegistration[] = [];
  readonly sets: HotkeyRegistration[][] = [];
  stopped = false;
  isAvailable = true;
  failSet: Error | null = null;
  private cb: ((id: number) => void) | null = null;
  available() {
    return this.isAvailable && !this.stopped;
  }
  async set(keys: HotkeyRegistration[]): Promise<HotkeyResult[]> {
    if (this.failSet) throw this.failSet;
    this.sets.push(keys.map((k) => ({ ...k })));
    this.registered = [];
    const out: HotkeyResult[] = [];
    for (const k of keys) {
      if (this.occupied.has(k.vk)) {
        out.push({ id: k.id, ok: false, busy: true, error: "hotkey ya registrada (1409)" });
      } else {
        this.registered.push(k);
        out.push({ id: k.id, ok: true });
      }
    }
    return out;
  }
  onPressed(cb: (id: number) => void) {
    this.cb = cb;
  }
  private restoredCb: (() => void) | null = null;
  onRestored(cb: () => void) {
    this.restoredCb = cb;
  }
  /** Simula que el hijo se cayó y volvió. */
  restore() {
    this.restoredCb?.();
  }
  stop() {
    this.stopped = true;
    this.registered = [];
  }
  /** Aprieta el atajo con ese id si está registrado (si no, no pasa nada, como en Windows). */
  press(id: number) {
    if (this.registered.some((r) => r.id === id)) this.cb?.(id);
  }
}

/** Entrada de Windows falsa: cursor y monitores editables, y un registro de todo lo que se mandó (en orden). */
export type InputCall =
  | { op: "moveAbs"; nx: number; ny: number }
  | { op: "wheel"; dx: number; dy: number }
  | { op: "button"; button: "left" | "right"; action: "click" | "down" | "up" }
  | { op: "keys"; events: InputKeyEvent[] }
  | { op: "text"; units: number[] };

export class FakeInput implements InputSystem {
  readonly calls: InputCall[] = [];
  cursorAt = { x: 100, y: 100 };
  cursorReads = 0;
  monitorReads = 0;
  isElevated = false;
  isAvailable = true;
  /** Si se pone, la próxima llamada de este tipo rechaza. */
  failNext: InputCall["op"] | "cursor" | "monitors" | "elevated" | null = null;
  /** Demora las respuestas (para probar el orden y la cola). */
  gate: Promise<void> | null = null;
  /** Demora solo la lectura del cursor (para probar el orden de mover y hacer clic). */
  cursorGate: Promise<void> | null = null;
  monitorsValue: InputMonitors = {
    list: [{ x: 0, y: 0, w: 1920, h: 1080, scale: 1 }],
    virtual: { x: 0, y: 0, w: 1920, h: 1080 },
  };

  private check(op: InputCall["op"] | "cursor" | "monitors" | "elevated"): void {
    if (this.failNext === op) {
      this.failNext = null;
      throw new Error(`falló ${op}`);
    }
  }
  available = () => this.isAvailable;
  async cursor() {
    this.cursorReads++;
    if (this.cursorGate) await this.cursorGate;
    this.check("cursor");
    return { ...this.cursorAt };
  }
  async monitors() {
    this.monitorReads++;
    this.check("monitors");
    return this.monitorsValue;
  }
  moveAbs(nx: number, ny: number) {
    this.calls.push({ op: "moveAbs", nx, ny });
  }
  wheel(dx: number, dy: number) {
    this.calls.push({ op: "wheel", dx, dy });
  }
  async button(button: "left" | "right", action: "click" | "down" | "up") {
    if (this.gate) await this.gate;
    this.check("button");
    this.calls.push({ op: "button", button, action });
  }
  async keys(events: readonly InputKeyEvent[]) {
    if (this.gate) await this.gate;
    this.check("keys");
    this.calls.push({ op: "keys", events: [...events] });
  }
  async text(units: readonly number[]) {
    if (this.gate) await this.gate;
    this.check("text");
    this.calls.push({ op: "text", units: [...units] });
  }
  async elevated() {
    this.check("elevated");
    return this.isElevated;
  }
  /** Lo apretado ahora según lo que se mandó (botón izquierdo y Alt). */
  heldNow(): { left: boolean; alt: boolean } {
    let left = false;
    let alt = false;
    for (const c of this.calls) {
      if (c.op === "button" && c.button === "left") left = c.action === "down";
      if (c.op === "keys") for (const [vk, up] of c.events) if (vk === 0x12) alt = !up;
    }
    return { left, alt };
  }
  of<T extends InputCall["op"]>(op: T): Extract<InputCall, { op: T }>[] {
    return this.calls.filter((c): c is Extract<InputCall, { op: T }> => c.op === op);
  }
}
