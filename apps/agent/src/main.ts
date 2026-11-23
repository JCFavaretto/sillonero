import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "./app";
import { DEFAULT_EXTENSION_PORT } from "@proyecto-e/protocol";
import { EXTENSION_ORIGIN, loadOrCreateToken, prepareExtension } from "./browser/install";
import { createBrowserService } from "./browser/service";
import { createLogger } from "./log";
import { createBrowser } from "./platform/browser";
import { systemClock } from "./platform/clock";
import { createFileSystem } from "./platform/fs";
import { createNetInfo } from "./platform/netinfo";
import { cryptoRandom } from "./platform/random";
import { createSystemInfo } from "./platform/sysinfo";
import { createTrayHook } from "./platform/tray";
import { createWindowsIdentifier } from "./platform/win/identify";
import { createWindowsCatalog, createWindowsIconExtractor, createWindowsLauncher } from "./platform/win/appsNative";
import { createNativeClient } from "./platform/win/nativeClient";
import { createAudioClient } from "./platform/win/audioClient";
import { AUDIO_HOST_SCRIPT, spawnAudioHost } from "./platform/win/audioSpawn";
import { windowsPowerShell } from "./platform/win/identify";
import { spawnNativeHost } from "./platform/win/spawn";
import { createInputClient } from "./platform/win/inputClient";
import { spawnInputHost } from "./platform/win/inputSpawn";
import { createHotkeyClient } from "./platform/win/hotkeyClient";
import { spawnHotkeyHost } from "./platform/win/hotkeySpawn";
import { buildLauncherCommand, buildRunCommand, createAutostart } from "./platform/autostart";
import { parseArgs } from "./cli";
import { existsSync } from "node:fs";
import { createDpapiSecret } from "./platform/win/dpapi";

// Punto de entrada real: arma las dependencias de verdad y arranca el agente.

const fs = createFileSystem();
const dataDir = join(process.env.APPDATA ?? join(homedir(), ".config"), "proyecto-e");
const log = createLogger({ fs, clock: systemClock, path: join(dataDir, "logs", "agent.log") });

async function readVersion(): Promise<string> {
  try {
    const text = await fs.readFile(fileURLToPath(new URL("../package.json", import.meta.url)));
    const version = (JSON.parse(text ?? "{}") as { version?: unknown }).version;
    return typeof version === "string" ? version.slice(0, 20) : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Si la ruta del programa tiene un carácter que rompería el comando de inicio, el agente arranca igual, sin esa tarjeta. */
function safeAutostart() {
  try {
    // Carpeta portable: junto a `app/` está el lanzador sin consola; si está, la entrada de inicio apunta a él.
    const launcher = fileURLToPath(new URL("../Iniciar Sillonero.vbs", import.meta.url));
    if (existsSync(launcher)) return createAutostart({ command: buildLauncherCommand(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe"), launcher) });
    return createAutostart({ command: buildRunCommand(process.execPath, [...process.execArgv, process.argv[1] ?? ""]) });
  } catch (err) {
    log.warn("autostart disabled", { error: String(err) });
    return null;
  }
}

async function main(): Promise<void> {
  if (parseArgs(process.argv).smoke) {
    // Prueba de humo de la carpeta portable: si llegamos hasta acá, se cargaron la bandeja, ws, qrcode y zod.
    console.log(`Sillonero ${await readVersion()} (carpeta portable)`);
    process.exit(0);
  }
  // Pantallas y ventanas de Windows, en un proceso hijo (se lanza recién al primer pedido).
  const native = process.platform === "win32" ? createNativeClient({ spawn: spawnNativeHost, clock: systemClock, log }) : null;
  // Audio de Windows: un PowerShell de vida larga (se lanza recién al primer pedido).
  const audio = native ? createAudioClient({ spawn: () => spawnAudioHost(windowsPowerShell(), AUDIO_HOST_SCRIPT), clock: systemClock, log }) : null;
  // Mouse y teclado del Pad: otro proceso hijo aparte, así una lectura lenta de ventanas no frena el mouse (D56).
  const input = native ? createInputClient({ spawn: spawnInputHost, clock: systemClock, log }) : null;
  // Atajos globales (Ctrl+Alt+…): otro proceso hijo, con su propio bucle de mensajes (D67).
  const hotkeys = native ? createHotkeyClient({ spawn: spawnHotkeyHost, clock: systemClock, log }) : null;
  // Arranque con Windows: la entrada de Run vuelve a lanzar exactamente este mismo programa con `--background`.
  const autostart = native ? safeAutostart() : null;
  const { background } = parseArgs(process.argv);
  // Extensión del navegador (opcional, fase C): el agente escucha en 127.0.0.1 y deja lista la carpeta que se carga en el navegador.
  const extToken = await loadOrCreateToken(fs, dataDir, cryptoRandom);
  const browserBridge = createBrowserService({ clock: systemClock, log, port: DEFAULT_EXTENSION_PORT, token: extToken, origin: EXTENSION_ORIGIN });
  const extDir = join(dataDir, "extension");
  try {
    const ready = prepareExtension({
      sourceDirs: [fileURLToPath(new URL("../extension-src/", import.meta.url)), fileURLToPath(new URL("../../extension/", import.meta.url))],
      targetDir: extDir,
      port: DEFAULT_EXTENSION_PORT,
      token: extToken,
    });
    if (!ready) log.warn("browser extension files not found; skipping", {});
  } catch (err) {
    log.warn("cannot prepare the browser extension folder", { error: String(err) });
  }
  void browserBridge.start().catch((err: unknown) => log.warn("browser extension port unavailable", { error: String(err) }));
  const agent = createAgent(
    {
      clock: systemClock,
      random: cryptoRandom,
      fs,
      net: createNetInfo(),
      sys: createSystemInfo(),
      tray: createTrayHook({ iconPath: fileURLToPath(new URL("../assets/tray.png", import.meta.url)), log }),
      browser: createBrowser(),
      log,
      paths: { dataDir },
      displays: native?.displays,
      windows: native?.windows,
      identifier: native ? createWindowsIdentifier({ clock: systemClock, log }) : undefined,
      catalog: native ? createWindowsCatalog() : undefined,
      iconExtractor: native ? createWindowsIconExtractor() : undefined,
      launcher: native ? createWindowsLauncher() : undefined,
      browserBridge,
      audio: audio ?? undefined,
      mediaKeys: native?.mediaKeys,
      input: input ?? undefined,
      hotkeys: hotkeys ?? undefined,
      autostart: autostart ?? undefined,
      // La clave privada de la PC va cifrada con la cuenta de Windows (DPAPI, D73).
      secret: native ? createDpapiSecret() : undefined,
    },
    {
      agentVersion: await readVersion(),
      openPanelOnStart: !background, // arrancado por Windows: solo la bandeja, el panel no se abre solo
      flushLog: () => log.flush(),
      onExit: (code) => process.exit(code),
    },
  );

  let shuttingDown = false;
  const shutdown = (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    agent
      .stop()
      .then(() => {
        native?.stop();
        void browserBridge.stop();
        audio?.stop();
        input?.stop();
        hotkeys?.stop();
      })
      .then(() => log.flush())
      .finally(() => process.exit(code));
  };

  // En Windows cerrar la consola llega como SIGHUP/SIGBREAK, no siempre como SIGINT (se prueba a mano).
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) process.on(signal, () => shutdown(0));
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException", { error: String(err), stack: err.stack });
    shutdown(1);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", { error: String(reason) });
    shutdown(1);
  });

  const result = await agent.start();
  if (result.status === "already_running") {
    console.log("Sillonero ya está corriendo: se abrió su panel en el navegador.");
    await log.flush();
    process.exit(1);
  }
  console.log("Sillonero · agente corriendo. Salí desde el ícono de la bandeja o con Ctrl+C.");
}

main().catch(async (err: unknown) => {
  log.error("fatal", { error: String(err) });
  await log.flush();
  console.error("No se pudo arrancar el agente:", err);
  process.exit(1);
});
