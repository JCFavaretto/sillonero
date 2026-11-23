import koffi from "koffi";
import type { HotkeyRegistration, HotkeyResult } from "../../ports";

// Bindings reales de atajos globales (RegisterHotKey y PeekMessageW) con koffi. SOLO se importa desde el proceso hijo
// `hotkeyHost.ts` (docs/PLAN.md D67). Verificado en el spike S1 (09/11/2026, docs/PLAN.md 8.6.10): `RegisterHotKey(NULL, …)`
// manda `WM_HOTKEY` a la cola del hilo que llama, así que se registra y se consulta desde el mismo hilo.

const MOD_ALT = 0x1;
const MOD_CONTROL = 0x2;
const MOD_NOREPEAT = 0x4000;
const WM_HOTKEY = 0x0312;
const PM_REMOVE = 1;
const ERROR_HOTKEY_ALREADY_REGISTERED = 1409;
/** MSG en x64 son 48 bytes: `message` en el 8 y `wParam` en el 16. */
const MSG_SIZE = 48;

export interface HotkeyNative {
  /** Suelta lo registrado antes y registra `Ctrl+Alt+<vk>` para cada una. */
  set(keys: readonly HotkeyRegistration[]): HotkeyResult[];
  /** Los ids que se apretaron desde la última vez. */
  poll(): number[];
  unregisterAll(): void;
}

export function createHotkeyNative(): HotkeyNative {
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const RegisterHotKey = user32.func("int __stdcall RegisterHotKey(intptr hwnd, int id, uint32 mods, uint32 vk)");
  const UnregisterHotKey = user32.func("int __stdcall UnregisterHotKey(intptr hwnd, int id)");
  const PeekMessageW = user32.func("int __stdcall PeekMessageW(_Out_ uint8_t *msg, intptr hwnd, uint32 min, uint32 max, uint32 remove)");
  const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");

  let registered: number[] = [];
  const msg = Buffer.alloc(MSG_SIZE);

  function unregisterAll(): void {
    for (const id of registered) UnregisterHotKey(0, id);
    registered = [];
  }

  return {
    set(keys) {
      unregisterAll();
      const out: HotkeyResult[] = [];
      for (const k of keys) {
        if (!Number.isInteger(k.id) || k.id < 1 || k.id > 0xbfff || !Number.isInteger(k.vk) || k.vk < 1 || k.vk > 254) {
          out.push({ id: k.id, ok: false, busy: false, error: "id o tecla fuera de rango" });
          continue;
        }
        const ok = RegisterHotKey(0, k.id, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, k.vk) as number;
        if (ok) {
          registered.push(k.id);
          out.push({ id: k.id, ok: true });
        } else {
          const code = GetLastError() as number;
          out.push({ id: k.id, ok: false, busy: code === ERROR_HOTKEY_ALREADY_REGISTERED, error: `RegisterHotKey falló (error ${code})` });
        }
      }
      return out;
    },

    poll() {
      const pressed: number[] = [];
      while (PeekMessageW(msg, 0, 0, 0, PM_REMOVE)) {
        if (msg.readUInt32LE(8) === WM_HOTKEY) pressed.push(Number(msg.readBigUInt64LE(16)));
      }
      return pressed;
    },

    unregisterAll,
  };
}
