import { fork } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { HotkeyChild, HotkeyMessage, HotkeyRequest } from "./hotkeyClient";

/** Lanza el proceso hijo de atajos real (`hotkeyHost.ts`, o `.js` si algún día se compila). Hereda el loader de tsx. */
export function spawnHotkeyHost(): HotkeyChild {
  const ext = extname(fileURLToPath(import.meta.url));
  const cp = fork(fileURLToPath(new URL(`./hotkeyHost${ext}`, import.meta.url)), [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  return {
    send: (msg: HotkeyRequest) => void cp.send(msg),
    kill: () => void cp.kill(),
    onMessage: (cb) => void cp.on("message", (m) => cb(m as HotkeyMessage)),
    onExit: (cb) => {
      cp.on("exit", (code, signal) => cb(`code ${code ?? "?"} signal ${signal ?? "-"}`));
      cp.on("error", (err) => cb(String(err)));
    },
  };
}
