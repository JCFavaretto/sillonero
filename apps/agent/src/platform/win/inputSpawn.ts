import { fork } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { InputChild, InputReply, InputRequest } from "./inputClient";

/** Lanza el proceso hijo de entrada real (`inputHost.ts`, o `.js` si algún día se compila). Hereda el loader de tsx. */
export function spawnInputHost(): InputChild {
  const ext = extname(fileURLToPath(import.meta.url));
  const cp = fork(fileURLToPath(new URL(`./inputHost${ext}`, import.meta.url)), [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  return {
    send: (msg: InputRequest) => void cp.send(msg),
    kill: () => void cp.kill(),
    onMessage: (cb) => void cp.on("message", (m) => cb(m as InputReply)),
    onExit: (cb) => {
      cp.on("exit", (code, signal) => cb(`code ${code ?? "?"} signal ${signal ?? "-"}`));
      cp.on("error", (err) => cb(String(err)));
    },
  };
}
