import koffi from "koffi";
import type { InputKeyEvent, InputMonitors } from "../../ports";
import { buttonBuffer, INPUT_SIZE, keysBuffer, moveAbsBuffer, textBuffer, wheelBuffer } from "./inputBuffers";

// Bindings reales de entrada (SendInput y compañía) con koffi. SOLO se importa desde el proceso hijo `inputHost.ts`:
// un struct mal declarado mata ese proceso y no al agente (docs/PLAN.md D10 y D56).

const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x8;
const TOKEN_ELEVATION = 20; // TOKEN_INFORMATION_CLASS: TokenElevation
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;
const MDT_EFFECTIVE_DPI = 0;
/** Texto: tandas de 32 caracteres (64 eventos) con una pausa corta, para que las apps no pierdan letras. */
const TEXT_CHUNK = 32;
const TEXT_PAUSE_MS = 4;

export interface InputNative {
  cursor(): { x: number; y: number };
  monitors(): InputMonitors;
  moveAbs(nx: number, ny: number): void;
  wheel(dx: number, dy: number): void;
  button(button: "left" | "middle" | "right", action: "click" | "down" | "up"): void;
  keys(events: readonly InputKeyEvent[]): void;
  text(units: readonly number[]): void;
  elevated(): boolean;
}

const sleepSync = (ms: number) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function createInputNative(): InputNative {
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const shcore = koffi.load("shcore.dll");

  const SetThreadDpiAwarenessContext = user32.func("intptr __stdcall SetThreadDpiAwarenessContext(intptr context)");
  const SendInput = user32.func("uint32 __stdcall SendInput(uint32 count, uint8_t *inputs, int size)");
  const GetCursorPos = user32.func("int __stdcall GetCursorPos(_Out_ int32_t *pt)");
  const GetSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int index)");
  void koffi.proto("int __stdcall InputMonitorEnumProc(intptr hmon, intptr hdc, intptr rect, intptr lParam)");
  const EnumDisplayMonitors = user32.func("int __stdcall EnumDisplayMonitors(intptr hdc, intptr clip, InputMonitorEnumProc *cb, intptr lParam)");
  const GetMonitorInfoW = user32.func("int __stdcall GetMonitorInfoW(intptr monitor, _Inout_ uint8_t *info)");
  const GetDpiForMonitor = shcore.func("long __stdcall GetDpiForMonitor(intptr monitor, int type, _Out_ uint32_t *dpiX, _Out_ uint32_t *dpiY)");
  const GetForegroundWindow = user32.func("intptr __stdcall GetForegroundWindow()");
  const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32_t *pid)");
  const OpenProcess = kernel32.func("intptr __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)");
  const GetCurrentProcessId = kernel32.func("uint32 __stdcall GetCurrentProcessId()");
  const CloseHandle = kernel32.func("int __stdcall CloseHandle(intptr handle)");
  const OpenProcessToken = advapi32.func("int __stdcall OpenProcessToken(intptr process, uint32 access, _Out_ intptr *token)");
  const GetTokenInformation = advapi32.func("int __stdcall GetTokenInformation(intptr token, int cls, _Out_ uint32_t *info, uint32 length, _Out_ uint32_t *returned)");

  // Con el contexto por monitor, las coordenadas son píxeles físicos (igual que CCD y GetWindowRect en win32.ts).
  SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  function send(buf: Buffer): void {
    const count = buf.length / INPUT_SIZE;
    if (count === 0) return;
    const sent = SendInput(count, buf, INPUT_SIZE) as number;
    // SendInput no avisa cuándo lo bloquea UIPI: devuelve menos eventos de los pedidos (docs/PLAN.md D55).
    if (sent !== count) throw new Error(`SendInput mandó ${sent} de ${count} eventos (¿ventana de administrador?)`);
  }

  function isElevatedPid(pid: number): boolean {
    const proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) as number | bigint;
    if (!proc) return true; // sin acceso al proceso: casi seguro es de administrador (o protegido): no se le puede escribir
    try {
      const token = [0] as number[];
      if (!OpenProcessToken(proc, TOKEN_QUERY, token)) return true;
      try {
        const info = new Uint32Array(1);
        const ret = new Uint32Array(1);
        if (!GetTokenInformation(token[0]!, TOKEN_ELEVATION, info, 4, ret)) return true;
        return info[0] !== 0;
      } finally {
        CloseHandle(token[0]!);
      }
    } finally {
      CloseHandle(proc);
    }
  }

  // Si el agente mismo corre como administrador, UIPI no bloquea nada.
  let selfElevated: boolean | null = null;

  return {
    cursor() {
      const pt = new Int32Array(2);
      if (!GetCursorPos(pt)) throw new Error("GetCursorPos falló");
      return { x: pt[0]!, y: pt[1]! };
    },

    monitors() {
      const list: InputMonitors["list"] = [];
      const handles: Array<number | bigint> = [];
      EnumDisplayMonitors(0, 0, (hmon: number | bigint) => {
        handles.push(hmon);
        return 1;
      }, 0);
      for (const h of handles) {
        const info = Buffer.alloc(40); // MONITORINFO: cbSize, rcMonitor, rcWork, dwFlags
        info.writeUInt32LE(40, 0);
        if (!GetMonitorInfoW(h, info)) continue;
        const left = info.readInt32LE(4);
        const top = info.readInt32LE(8);
        const right = info.readInt32LE(12);
        const bottom = info.readInt32LE(16);
        const dx = new Uint32Array(1);
        const dy = new Uint32Array(1);
        const hr = GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, dx, dy) as number;
        const dpi = hr === 0 && dx[0]! > 0 ? dx[0]! : 96;
        list.push({ x: left, y: top, w: right - left, h: bottom - top, scale: dpi / 96 });
      }
      if (list.length === 0) throw new Error("no hay pantallas");
      const virtual = {
        x: GetSystemMetrics(SM_XVIRTUALSCREEN) as number,
        y: GetSystemMetrics(SM_YVIRTUALSCREEN) as number,
        w: GetSystemMetrics(SM_CXVIRTUALSCREEN) as number,
        h: GetSystemMetrics(SM_CYVIRTUALSCREEN) as number,
      };
      return { list, virtual };
    },

    moveAbs: (nx, ny) => send(moveAbsBuffer(nx, ny)),
    wheel: (dx, dy) => send(wheelBuffer(dx, dy)),
    button: (button, action) => send(buttonBuffer(button, action)),
    keys: (events) => send(keysBuffer(events)),

    text(units) {
      for (let i = 0; i < units.length; i += TEXT_CHUNK) {
        if (i > 0) sleepSync(TEXT_PAUSE_MS);
        send(textBuffer(units.slice(i, i + TEXT_CHUNK)));
      }
    },

    elevated() {
      if (selfElevated === null) selfElevated = isElevatedPid(GetCurrentProcessId() as number);
      if (selfElevated) return false;
      const hwnd = GetForegroundWindow() as number | bigint;
      if (!hwnd) return false;
      const pid = new Uint32Array(1);
      GetWindowThreadProcessId(hwnd, pid);
      if (!pid[0]) return false;
      return isElevatedPid(pid[0]);
    },
  };
}
