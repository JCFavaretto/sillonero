import { spawn } from "node:child_process";
import type { Browser } from "../ports";

export type RunCommand = (cmd: string, args: string[]) => Promise<void>;

const runDetached: RunCommand = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

// `cmd /c start` interpreta estos caracteres como sintaxis de la consola.
const UNSAFE_FOR_CMD = /[\s&|<>^"%]/;

/** Abre una URL http(s) en el navegador predeterminado de Windows (`cmd /c start`). */
export function createBrowser(run: RunCommand = runDetached, opts: { comspec?: string } = {}): Browser {
  // Ruta absoluta de cmd.exe: con "cmd" a secas Windows busca primero en el directorio actual.
  const comspec = opts.comspec ?? process.env.ComSpec ?? "cmd.exe";
  return {
    async open(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("Browser.open: URL inválida");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Browser.open: solo http(s)");
      }
      if (UNSAFE_FOR_CMD.test(url)) {
        throw new Error("Browser.open: la URL tiene caracteres no permitidos");
      }
      // El "" es el título de la ventana: sin él, `start` toma la URL como título.
      await run(comspec, ["/c", "start", "", url]);
    },
  };
}
