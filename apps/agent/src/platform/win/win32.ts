import koffi from "koffi";
import type { RawDisplay, RawWindow, RawWindowFull } from "../../ports";
import {
  MODE_SIZE,
  PATH_SIZE,
  TARGET_NAME_SIZE,
  buildArrangeConfig,
  buildDisableConfig,
  buildEnableConfig,
  buildRawDisplays,
  encodeTargetNameRequest,
  invalidateModes,
  parsePaths,
  parseTargetName,
  type CcdConfig,
  type CcdPath,
  type CcdSnapshot,
  type CcdTarget,
  type TargetName,
} from "./ccd";

// Bindings reales a user32/kernel32 con koffi. SOLO se importa desde el proceso hijo (host.ts):
// si un struct está mal declarado, mata ese proceso y no al agente. Todo pasa por Buffers (sin
// structs de koffi) y las funciones puras de ccd.ts hacen el parseo. R2 solo lee; los comandos
// (SetDisplayConfig, SetWindowPos) llegan en R5 y R6.

const QDC_ALL_PATHS = 0x1;
const QDC_ONLY_ACTIVE_PATHS = 0x2;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
const ERROR_INSUFFICIENT_BUFFER = 122;
// Flags de SetDisplayConfig (learn.microsoft.com, verificadas el 07/11/2026).
const SW_MAXIMIZE = 3;
const SW_RESTORE = 9;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const MONITOR_DEFAULTTONEAREST = 2;
const ERROR_ACCESS_DENIED = 5;
const SDC_TOPOLOGY_SUPPLIED = 0x10;
const SDC_USE_SUPPLIED_DISPLAY_CONFIG = 0x20;
const SDC_VALIDATE = 0x40;
const SDC_APPLY = 0x80;
const SDC_SAVE_TO_DATABASE = 0x200;
const SDC_ALLOW_CHANGES = 0x400;

export interface Win32 {
  listDisplays(): RawDisplay[];
  /**
   * Prende o apaga una pantalla con la API CCD. Primero valida con `SDC_VALIDATE` (que no cambia nada) y recién
   * después aplica. Con `dryRun` solo valida. Tira si Windows no lo acepta.
   */
  setDisplayEnabled(devicePath: string, on: boolean, opts?: { dryRun?: boolean; restoreAt?: { x: number; y: number; w: number; h: number } }): void;
  /** Cambia de lugar a las pantallas prendidas. Valida antes de aplicar; todo o nada. */
  arrangeDisplays(items: { devicePath: string; x: number; y: number }[], opts?: { dryRun?: boolean }): void;
  foreground(): RawWindow | null;
  /** Las ventanas de usuario, de arriba hacia abajo (EnumWindows + el filtro del .ahk). */
  listWindows(): RawWindowFull[];
  /** La trae al frente. Tira "focus_denied" si Windows no lo deja. */
  focusWindow(handle: string): void;
  /** Aprieta y suelta una tecla de Media (solo VK_MEDIA_PREV/PLAY_PAUSE/NEXT; cualquier otra tira). */
  pressMediaKey(vk: number): void;
  showWindow(handle: string, cmd: "minimize" | "maximize" | "restore"): void;
  /** WM_CLOSE: le pide a la app que se cierre. */
  closeWindow(handle: string): void;
  /** Pantalla completa sin bordes sobre `monitor`; otra vez = vuelve como estaba. */
  toggleFullscreen(handle: string, monitor: { x: number; y: number; w: number; h: number }): void;
  /** Mueve una ventana (restaurándola antes si hace falta) y opcionalmente la vuelve a maximizar. */
  placeWindow(handle: string, rect: { x: number; y: number; w: number; h: number }, maximize: boolean): void;
}

export function createWin32(): Win32 {
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");

  const GetDisplayConfigBufferSizes = user32.func("long __stdcall GetDisplayConfigBufferSizes(uint32 flags, _Out_ uint32_t *numPaths, _Out_ uint32_t *numModes)");
  const QueryDisplayConfig = user32.func("long __stdcall QueryDisplayConfig(uint32 flags, _Inout_ uint32_t *numPaths, _Out_ uint8_t *paths, _Inout_ uint32_t *numModes, _Out_ uint8_t *modes, void *topology)");
  const SetDisplayConfig = user32.func("long __stdcall SetDisplayConfig(uint32 numPaths, uint8_t *paths, uint32 numModes, uint8_t *modes, uint32 flags)");
  const DisplayConfigGetDeviceInfo = user32.func("long __stdcall DisplayConfigGetDeviceInfo(_Inout_ uint8_t *packet)");
  const SetThreadDpiAwarenessContext = user32.func("intptr __stdcall SetThreadDpiAwarenessContext(intptr context)");
  const GetForegroundWindow = user32.func("intptr __stdcall GetForegroundWindow()");
  const GetWindowTextW = user32.func("int __stdcall GetWindowTextW(intptr hwnd, _Out_ uint8_t *buf, int max)");
  const GetClassNameW = user32.func("int __stdcall GetClassNameW(intptr hwnd, _Out_ uint8_t *buf, int max)");
  const GetWindowRect = user32.func("int __stdcall GetWindowRect(intptr hwnd, _Out_ int32_t *rect)");
  const IsIconic = user32.func("int __stdcall IsIconic(intptr hwnd)");
  const IsZoomed = user32.func("int __stdcall IsZoomed(intptr hwnd)");
  const IsWindow = user32.func("int __stdcall IsWindow(intptr hwnd)");
  const ShowWindow = user32.func("int __stdcall ShowWindow(intptr hwnd, int cmd)");
  const SetWindowPos = user32.func("int __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint32 flags)");
  const MonitorFromRect = user32.func("intptr __stdcall MonitorFromRect(int32_t *rect, uint32 flags)");
  const GetMonitorInfoW = user32.func("int __stdcall GetMonitorInfoW(intptr monitor, _Inout_ uint8_t *info)");
  const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32_t *pid)");
  const OpenProcess = kernel32.func("intptr __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)");
  const QueryFullProcessImageNameW = kernel32.func("int __stdcall QueryFullProcessImageNameW(intptr process, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32_t *size)");
  const CloseHandle = kernel32.func("int __stdcall CloseHandle(intptr handle)");
  const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");
  // B3: lista, foco, cierre y pantalla completa (docs/PLAN.md 8.3.4).
  const dwmapi = koffi.load("dwmapi.dll");
  // el proto se registra en koffi al declararlo; EnumWindows lo usa por nombre
  void koffi.proto("int __stdcall EnumWindowsProc(intptr hwnd, intptr lParam)");
  const EnumWindows = user32.func("int __stdcall EnumWindows(EnumWindowsProc *cb, intptr lParam)");
  const IsWindowVisible = user32.func("int __stdcall IsWindowVisible(intptr hwnd)");
  const GetWindowLongPtrW = user32.func("intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)");
  const SetWindowLongPtrW = user32.func("intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr value)");
  const GetWindow = user32.func("intptr __stdcall GetWindow(intptr hwnd, uint32 cmd)");
  const SetForegroundWindow = user32.func("int __stdcall SetForegroundWindow(intptr hwnd)");
  const PostMessageW = user32.func("int __stdcall PostMessageW(intptr hwnd, uint32 msg, intptr wParam, intptr lParam)");
  const SendInput = user32.func("uint32 __stdcall SendInput(uint32 count, uint8_t *inputs, int size)");
  const DwmGetWindowAttribute = dwmapi.func("long __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ uint32_t *value, uint32 size)");
  const GWL_STYLE = -16;
  const GWL_EXSTYLE = -20;
  const WS_EX_TOOLWINDOW = 0x80;
  const WS_EX_APPWINDOW = 0x40000;
  const WS_CAPTION_AND_FRAME = 0xc40000; // WS_CAPTION | WS_THICKFRAME
  const SW_MINIMIZE = 6;
  const SWP_FRAMECHANGED_NOMOVE_NOSIZE_NOZORDER = 0x27;
  const DWMWA_CLOAKED = 14;
  const WM_CLOSE = 0x0010;
  const VK_F24 = 0x87; // una tecla que ninguna app usa: cuenta como "el último evento de entrada" sin efecto visible
  /** Lo que había antes de la pantalla completa (por ventana): estilo, rectángulo y si estaba maximizada. */
  const fullscreened = new Map<bigint, { style: bigint; rect: Int32Array; maximized: boolean }>();

  // Con el contexto por monitor, GetWindowRect devuelve píxeles físicos, igual que CCD.
  SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  function queryPaths(flags: number): { paths: CcdPath[]; modes: Buffer; config: CcdConfig } {
    for (let attempt = 0; attempt < 3; attempt++) {
      const nPaths = new Uint32Array(1);
      const nModes = new Uint32Array(1);
      const sizes = GetDisplayConfigBufferSizes(flags, nPaths, nModes) as number;
      if (sizes !== 0) throw new Error(`GetDisplayConfigBufferSizes devolvió ${sizes}`);
      const paths = Buffer.alloc(nPaths[0]! * PATH_SIZE);
      const modes = Buffer.alloc(nModes[0]! * MODE_SIZE);
      const r = QueryDisplayConfig(flags, nPaths, paths, nModes, modes, null) as number;
      if (r === ERROR_INSUFFICIENT_BUFFER) continue; // la configuración cambió entre las dos llamadas
      if (r !== 0) throw new Error(`QueryDisplayConfig devolvió ${r}`);
      return {
        paths: parsePaths(paths, nPaths[0]!),
        modes,
        config: { paths, pathCount: nPaths[0]!, modes, modeCount: nModes[0]! },
      };
    }
    throw new Error("QueryDisplayConfig: el buffer quedó chico tres veces seguidas");
  }

  function targetName(p: CcdPath): TargetName | null {
    const packet: Buffer = encodeTargetNameRequest(p);
    if ((DisplayConfigGetDeviceInfo(packet) as number) !== 0) return null;
    return parseTargetName(packet.subarray(0, TARGET_NAME_SIZE));
  }

  /** La pantalla (destino de CCD) que corresponde a esa ruta de dispositivo, de entre todas las conectadas. */
  function findTarget(devicePath: string): CcdTarget | null {
    for (const p of queryPaths(QDC_ALL_PATHS).paths) {
      if (!p.available && !p.active) continue;
      const key = `ccd:${p.adapterLow}:${p.adapterHigh}:${p.targetId}`;
      if ((targetName(p)?.devicePath || key) === devicePath) return p;
    }
    return null;
  }

  const setConfig = (c: CcdConfig, flags: number): number =>
    SetDisplayConfig(c.pathCount, c.paths, c.modeCount, c.modeCount > 0 ? c.modes : null, flags) as number;

  /** Valida y, si corresponde, aplica. Tira con el código de Windows si no lo acepta. */
  function validateThenApply(cfg: CcdConfig, flags: number, dryRun: boolean): void {
    const v = setConfig(cfg, flags | SDC_VALIDATE);
    if (v !== 0) throw new Error(`SetDisplayConfig (validar) devolvió ${v}`);
    if (dryRun) return;
    const r = setConfig(cfg, flags | SDC_APPLY);
    if (r !== 0) throw new Error(`SetDisplayConfig devolvió ${r}`);
  }

  /** El área de trabajo (sin la barra de tareas) de la pantalla que contiene ese rectángulo, en píxeles físicos. */
  function workAreaOf(bounds: { x: number; y: number; w: number; h: number }): RawDisplay["workArea"] {
    const rect = new Int32Array([bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h]);
    const monitor = MonitorFromRect(rect, MONITOR_DEFAULTTONEAREST) as number | bigint;
    if (!monitor) return null;
    const info = Buffer.alloc(40); // MONITORINFO: cbSize, rcMonitor, rcWork, dwFlags
    info.writeUInt32LE(40, 0);
    if (!GetMonitorInfoW(monitor, info)) return null;
    const left = info.readInt32LE(20);
    const top = info.readInt32LE(24);
    return { x: left, y: top, w: info.readInt32LE(28) - left, h: info.readInt32LE(32) - top };
  }

  function exePathOf(pid: number): string {
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) as number | bigint;
    if (!handle) return "";
    try {
      const buf = Buffer.alloc(1040);
      const size = new Uint32Array([520]);
      if (!QueryFullProcessImageNameW(handle, 0, buf, size)) return "";
      return buf.toString("utf16le", 0, size[0]! * 2);
    } finally {
      CloseHandle(handle);
    }
  }
  const exeOf = (pid: number): string => {
    const path = exePathOf(pid);
    return path.slice(path.lastIndexOf("\\") + 1);
  };

  /** Lee una ventana; `null` si no es una ventana de usuario (invisible, de herramientas, con dueño, "fantasma" o sin título). */
  function readUserWindow(hwnd: bigint | number, foregroundHwnd: bigint | number): RawWindowFull | null {
    if (!IsWindowVisible(hwnd)) return null;
    const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as number | bigint);
    const appWindow = (ex & WS_EX_APPWINDOW) !== 0;
    if ((ex & WS_EX_TOOLWINDOW) !== 0 && !appWindow) return null;
    if (GetWindow(hwnd, 4) && !appWindow) return null; // GW_OWNER: ventana secundaria de otra
    const cloaked = new Uint32Array(1);
    if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return null;
    const titleBuf = Buffer.alloc(512);
    const titleLen = GetWindowTextW(hwnd, titleBuf, 256) as number;
    if (titleLen <= 0) return null;
    const classBuf = Buffer.alloc(512);
    const classLen = GetClassNameW(hwnd, classBuf, 256) as number;
    const rect = new Int32Array(4);
    if (!GetWindowRect(hwnd, rect)) return null;
    const pid = new Uint32Array(1);
    GetWindowThreadProcessId(hwnd, pid);
    const [l, t, r, b] = rect as unknown as [number, number, number, number];
    const exePath = exePathOf(pid[0]!);
    return {
      handle: "0x" + hwnd.toString(16),
      title: titleBuf.toString("utf16le", 0, titleLen * 2),
      exe: exePath.slice(exePath.lastIndexOf("\\") + 1),
      className: classBuf.toString("utf16le", 0, Math.max(0, classLen) * 2),
      rect: { x: l, y: t, w: r - l, h: b - t },
      state: IsIconic(hwnd) ? "minimized" : IsZoomed(hwnd) ? "maximized" : "normal",
      pid: pid[0]!,
      exePath,
      focused: BigInt(hwnd) === BigInt(foregroundHwnd),
      fullscreen: fullscreened.has(BigInt(hwnd)),
    };
  }

  const liveWindow = (handle: string): bigint => {
    const hwnd = BigInt(handle);
    if (!IsWindow(hwnd)) throw new Error("la ventana ya no existe");
    return hwnd;
  };

  return {
    listDisplays() {
      const all = queryPaths(QDC_ALL_PATHS);
      const active = queryPaths(QDC_ONLY_ACTIVE_PATHS);
      const snapshot: CcdSnapshot = { all: all.paths, active: active.paths, modes: active.modes };
      return buildRawDisplays(snapshot, targetName).map((d) => (d.bounds ? { ...d, workArea: workAreaOf(d.bounds) } : d));
    },

    setDisplayEnabled(devicePath, on, opts = {}) {
      const dryRun = opts.dryRun === true;
      const target = findTarget(devicePath);
      if (!target) throw new Error("Windows no encuentra esa pantalla");
      const active = queryPaths(QDC_ONLY_ACTIVE_PATHS).config;

      if (!on) {
        const cfg = buildDisableConfig(active, target);
        if (!cfg) throw new Error("esa pantalla no está prendida, o es la única que queda");
        return validateThenApply(cfg, SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE, dryRun);
      }

      const all = queryPaths(QDC_ALL_PATHS).config;
      const cfg = buildEnableConfig(active, all, target);
      if (!cfg) throw new Error("no se puede prender: ya está prendida, no está conectada o no hay una salida libre");
      // 1.º con la posición y el tamaño de antes (si se saben): así vuelve a su lugar. 2.º que Windows la ponga donde
      // recordaba (base de datos de topologías). 3.º que elija el mejor modo. El servicio la reubica si igual queda mal.
      const attempts: [CcdConfig, number][] = [];
      const placed = opts.restoreAt ? buildEnableConfig(active, all, target, opts.restoreAt) : null;
      if (placed) attempts.push([placed, SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE]);
      attempts.push([invalidateModes(cfg), SDC_TOPOLOGY_SUPPLIED | SDC_ALLOW_CHANGES]);
      attempts.push([cfg, SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE]);
      const errors: string[] = [];
      for (const [c, flags] of attempts) {
        try {
          return validateThenApply(c, flags, dryRun);
        } catch (err) {
          errors.push(String(err));
        }
      }
      throw new Error(`no se pudo prender: ${errors.join(" / ")}`);
    },

    arrangeDisplays(items, opts = {}) {
      const positions = new Map<string, { x: number; y: number }>();
      for (const it of items) {
        const target = findTarget(it.devicePath);
        if (!target) throw new Error("Windows no encuentra una de las pantallas");
        positions.set(`${target.adapterLow}:${target.adapterHigh}:${target.targetId}`, { x: it.x, y: it.y });
      }
      const cfg = buildArrangeConfig(queryPaths(QDC_ONLY_ACTIVE_PATHS).config, positions);
      if (!cfg) throw new Error("no se pueden reordenar: alguna no está prendida o no hay nada que mover");
      validateThenApply(cfg, SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE, opts.dryRun === true);
    },

    placeWindow(handle, rect, maximize) {
      const hwnd = BigInt(handle);
      if (!IsWindow(hwnd)) throw new Error("la ventana ya no existe");
      // Una maximizada o minimizada no se deja mover: primero se la restaura.
      if (IsIconic(hwnd) || IsZoomed(hwnd)) ShowWindow(hwnd, SW_RESTORE);
      if (!SetWindowPos(hwnd, 0, rect.x, rect.y, rect.w, rect.h, SWP_NOZORDER | SWP_NOACTIVATE)) {
        const code = GetLastError() as number;
        // Windows no deja que un programa común mueva una ventana que corre como administrador (UIPI).
        if (code === ERROR_ACCESS_DENIED) throw new Error("elevated: acceso denegado (la ventana corre como administrador)");
        throw new Error(`SetWindowPos falló (${code})`);
      }
      if (maximize) ShowWindow(hwnd, SW_MAXIMIZE);
    },

    listWindows() {
      const fg = GetForegroundWindow() as number | bigint;
      const out: RawWindowFull[] = [];
      // Callback transitorio: solo se llama mientras EnumWindows corre (verificado en la PC de Jay: 366 ventanas, ~3 ms).
      EnumWindows((hwnd: number | bigint) => {
        try {
          const w = readUserWindow(hwnd, fg);
          if (w) out.push(w);
        } catch {
          // una ventana que desaparece a mitad del recorrido no corta la lista
        }
        return 1;
      }, 0);
      for (const h of [...fullscreened.keys()]) if (!IsWindow(h)) fullscreened.delete(h);
      return out;
    },

    pressMediaKey(vk) {
      if (vk !== 0xb0 && vk !== 0xb1 && vk !== 0xb3) throw new Error(`tecla de media inválida: ${vk}`);
      const input = Buffer.alloc(80);
      for (let i = 0; i < 2; i++) {
        input.writeUInt32LE(1, i * 40); // INPUT_KEYBOARD
        input.writeUInt16LE(vk, i * 40 + 8);
        input.writeUInt32LE(i === 0 ? 0 : 2, i * 40 + 12); // KEYEVENTF_KEYUP en la segunda
      }
      SendInput(2, input, 40);
    },

    focusWindow(handle) {
      const hwnd = liveWindow(handle);
      if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
      // Windows solo deja traer al frente si "el proceso recibió el último evento de entrada" (doc de SetForegroundWindow):
      // un F24 suelto cuenta como entrada y no hace nada visible.
      const input = Buffer.alloc(80); // 2 INPUT de 40 bytes (x64): tecla abajo y arriba
      for (let i = 0; i < 2; i++) {
        input.writeUInt32LE(1, i * 40); // INPUT_KEYBOARD
        input.writeUInt16LE(VK_F24, i * 40 + 8);
        input.writeUInt32LE(i === 0 ? 0 : 2, i * 40 + 12); // KEYEVENTF_KEYUP en la segunda
      }
      SendInput(2, input, 40);
      let ok = SetForegroundWindow(hwnd) !== 0;
      if (!ok) {
        // Respaldo: minimizar y restaurar suele destrabarla.
        ShowWindow(hwnd, SW_MINIMIZE);
        ShowWindow(hwnd, SW_RESTORE);
        ok = SetForegroundWindow(hwnd) !== 0;
      }
      if (!ok || BigInt(GetForegroundWindow() as number | bigint) !== hwnd) throw new Error("focus_denied: Windows no dejó traerla al frente");
    },

    showWindow(handle, cmd) {
      const hwnd = liveWindow(handle);
      ShowWindow(hwnd, cmd === "minimize" ? SW_MINIMIZE : cmd === "maximize" ? SW_MAXIMIZE : SW_RESTORE);
    },

    closeWindow(handle) {
      const hwnd = liveWindow(handle);
      if (!PostMessageW(hwnd, WM_CLOSE, 0, 0)) throw new Error(`PostMessage falló (${GetLastError() as number})`);
    },

    toggleFullscreen(handle, monitor) {
      const hwnd = liveWindow(handle);
      const before = fullscreened.get(hwnd);
      if (before) {
        SetWindowLongPtrW(hwnd, GWL_STYLE, before.style);
        SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_FRAMECHANGED_NOMOVE_NOSIZE_NOZORDER);
        const [l, t, r, b] = before.rect as unknown as [number, number, number, number];
        SetWindowPos(hwnd, 0, l, t, r - l, b - t, SWP_NOZORDER);
        if (before.maximized) ShowWindow(hwnd, SW_MAXIMIZE);
        fullscreened.delete(hwnd);
        return;
      }
      const maximized = IsZoomed(hwnd) !== 0;
      if (IsIconic(hwnd) || maximized) ShowWindow(hwnd, SW_RESTORE);
      const rect = new Int32Array(4);
      GetWindowRect(hwnd, rect);
      const style = BigInt(GetWindowLongPtrW(hwnd, GWL_STYLE) as number | bigint);
      fullscreened.set(hwnd, { style, rect, maximized });
      SetWindowLongPtrW(hwnd, GWL_STYLE, style & ~BigInt(WS_CAPTION_AND_FRAME));
      SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_FRAMECHANGED_NOMOVE_NOSIZE_NOZORDER);
      SetWindowPos(hwnd, 0, monitor.x, monitor.y, monitor.w, monitor.h, SWP_NOZORDER);
    },

    foreground() {
      const hwnd = GetForegroundWindow() as number | bigint;
      if (!hwnd) return null;
      const titleBuf = Buffer.alloc(512);
      const classBuf = Buffer.alloc(512);
      const rect = new Int32Array(4);
      const pid = new Uint32Array(1);
      const titleLen = GetWindowTextW(hwnd, titleBuf, 256) as number;
      const classLen = GetClassNameW(hwnd, classBuf, 256) as number;
      if (!GetWindowRect(hwnd, rect)) return null;
      GetWindowThreadProcessId(hwnd, pid);
      const [l, t, r, b] = rect as unknown as [number, number, number, number];
      return {
        handle: "0x" + hwnd.toString(16),
        title: titleBuf.toString("utf16le", 0, Math.max(0, titleLen) * 2),
        exe: exeOf(pid[0]!),
        className: classBuf.toString("utf16le", 0, Math.max(0, classLen) * 2),
        rect: { x: l, y: t, w: r - l, h: b - t },
        state: IsIconic(hwnd) ? "minimized" : IsZoomed(hwnd) ? "maximized" : "normal",
      };
    },
  };
}
