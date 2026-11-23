import { fork } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostChild, HostReply, HostRequest } from "./nativeClient";

/** Lanza el proceso hijo real (`host.ts`, o `host.js` si algún día se compila). Hereda el loader de tsx. */
export function spawnNativeHost(): HostChild {
  const ext = extname(fileURLToPath(import.meta.url));
  const cp = fork(fileURLToPath(new URL(`./host${ext}`, import.meta.url)), [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  return {
    send: (msg: HostRequest) => void cp.send(msg),
    kill: () => void cp.kill(),
    onMessage: (cb) => void cp.on("message", (m) => cb(m as HostReply)),
    onExit: (cb) => {
      cp.on("exit", (code, signal) => cb(`code ${code ?? "?"} signal ${signal ?? "-"}`));
      cp.on("error", (err) => cb(String(err)));
    },
  };
}
