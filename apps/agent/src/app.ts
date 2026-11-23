import { join } from "node:path";
import * as QRCode from "qrcode";
import { encodeQr } from "@proyecto-e/protocol";
import { PAGE_CSS, PAGE_HTML, PAGE_JS } from "./admin/page";
import type { AdminController, AdminStatus } from "./admin/routes";
import { createAdminServer, type AdminServer } from "./admin/server";
import { generateIdentity, identityToKeyPair } from "./config/identity";
import { defaultConfig, type AgentConfig, type Device } from "./config/schema";
import { ConfigReadOnlyError, createConfigStore, type LoadStatus } from "./config/store";
import { listCandidates, pickAddress } from "./net/pickAddress";
import { createPairing } from "./pairing/pairing";
import type { Deps, TrayMenuItem } from "./ports";
import { createCatalog } from "./apps/catalog";
import { createExtras } from "./apps/extras";
import { createAudioService } from "./audio/service";
import { createSoundStore } from "./sounds/store";
import { createPadService } from "./input/service";
import { createCommands } from "./commands";
import { createHotkeyService } from "./hotkeys/service";
import { createTriggers } from "./scenes/triggers";
import { seedDeck } from "./config/defaultDeck";
import { createIcons } from "./apps/icons";
import { createLaunchService } from "./apps/launch";
import { createLibraryService } from "./apps/library";
import { createWindowsService } from "./apps/windowsService";
import { createRemoteServer } from "./remote/server";
import { createRateLimiter } from "./security/rateLimit";
import { createScreensService } from "./screens/service";
import { createSampler } from "./state/system";

// Orquestación del agente (docs/PLAN.md 5.4): arma los módulos, expone el controller del
// panel y maneja el arranque y el apagado.

export interface AgentOptions {
  agentVersion: string;
  /** Solo para tests y pruebas: puertos y host distintos de los de la config. */
  overrides?: { adminPort?: number; wsPort?: number; wsHost?: string; allowLoopback?: boolean };
  /** Abrir el panel en el navegador al arrancar (por defecto sí). */
  openPanelOnStart?: boolean;
  /** QR como SVG. Por defecto `qrcode`; los tests lo reemplazan para leer el texto. */
  renderQr?: (text: string) => Promise<string>;
  /** Vacía el log pendiente al apagar. */
  flushLog?: () => Promise<void>;
  /** Se llama cuando el agente terminó de apagarse por pedido del usuario (Salir). */
  onExit?: (code: number) => void;
}

export type StartResult = { status: "started" } | { status: "already_running" };

export interface Agent {
  /** `already_running`: ya había otra instancia (el puerto del panel estaba ocupado). */
  start(): Promise<StartResult>;
  /** Idempotente, con tope de 3 s. */
  stop(): Promise<void>;
  controller: AdminController;
  /** Puerto del WebSocket si está escuchando. */
  wsPort(): number | null;
  /** URL para abrir el panel (con un valor de un solo uso), o `null` si no arrancó. Cada llamada emite uno nuevo. */
  adminUrl(): string | null;
}

const STOP_TIMEOUT_MS = 3_000;
const FIREWALL_HINT_AFTER_MS = 60_000;
const TRAY_TOOLTIP = "Sillonero";

const isAddrInUse = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code === "EADDRINUSE";

export function createAgent(deps: Deps, options: AgentOptions): Agent {
  const { clock, random, fs, net, sys, tray, browser, log } = deps;
  const overrides = options.overrides ?? {};
  const renderQr = options.renderQr ?? ((text: string) => QRCode.toString(text, { type: "svg", margin: 1 }));

  const store = createConfigStore({ fs, log, dataDir: deps.paths.dataDir, secret: deps.secret });
  const sampler = createSampler({ sys, clock, agentVersion: options.agentVersion });
  // Las pantallas conocidas (apodos y última posición) viven en agent.json, en `monitors.known`.
  const screens =
    deps.displays && deps.windows
      ? createScreensService({
          displays: deps.displays,
          windows: deps.windows,
          identifier: deps.identifier,
          log,
          clock,
          known: {
            get: () => config.monitors.known,
            save: (list) => commit({ ...config, monitors: { known: list } }),
          },
        })
      : undefined;
  let config: AgentConfig = defaultConfig();
  let configStatus: LoadStatus = "missing";

  // B3: ventanas, lanzadores, escenas e Inicio. Necesitan pantallas, ventanas, catálogo y lanzador reales.
  let audioService: ReturnType<typeof createAudioService> | undefined;
  const extras = (() => {
    if (!screens || !deps.windows || !deps.catalog || !deps.launcher) return undefined;
    const icons = createIcons({ extractor: deps.iconExtractor, fs, dir: join(deps.paths.dataDir, "icons") });
    const catalog = createCatalog({ source: deps.catalog, clock });
    const windows = createWindowsService({ windows: deps.windows, screens, log, launcher: deps.launcher, onIcon: (k, p) => icons.register(k, p) });
    const audio = createAudioService({
      audio: deps.audio,
      mediaKeys: deps.mediaKeys ?? { press: () => Promise.reject(new Error("sin teclas de media")) },
      config: {
        get: () => config.audio,
        async save(next) {
          // Igual que la biblioteca: si el disco falla, memoria y disco no se desincronizan.
          const previous = config.audio;
          try {
            await commit({ ...config, audio: next });
          } catch (err) {
            if (config.audio === next) config = { ...config, audio: previous };
            throw err;
          }
        },
      },
      clock,
      log,
    });
    const library = createLibraryService({
      audio,
      store: {
        get: () => config.library,
        async save(next) {
          // Si el disco falla, memoria y disco no se desincronizan (a diferencia de revocar, que falla cerrado a propósito).
          const previous = config.library;
          try {
            await commit({ ...config, library: next });
          } catch (err) {
            if (config.library === next) config = { ...config, library: previous };
            throw err;
          }
        },
      },
      catalog,
      icons,
      random,
      log,
    });
    const launch = createLaunchService({ windows, port: deps.windows, launcher: deps.launcher, screens, clock, log });
    audioService = audio;
    const sounds = createSoundStore({ fs, dir: join(deps.paths.dataDir, "sounds"), clock });
    void sounds.load().catch((err) => log.warn("sounds: cannot read index", { error: String(err) }));
    return createExtras({ audio, sounds, browser: deps.browserBridge, windows, screens, library, launch, catalog, icons, clock, random, log });
  })();
  const limiter = createRateLimiter({ clock });

  // B5: mouse y teclado remotos. Sin permiso por celu (emparejado = usa todo); una sola llave global, prendida por defecto.
  const pad = deps.input
    ? createPadService({
        input: deps.input,
        clock,
        log,
        config: {
          enabled: () => config.input.enabled,
          async setEnabled(on) {
            const previous = config.input;
            try {
              await commit({ ...config, input: { enabled: on } });
            } catch (err) {
              if (config.input.enabled === on) config = { ...config, input: previous };
              throw err;
            }
          },
        },
      })
    : undefined;

  // B6.1: atajos globales de teclado. Los registra un hijo propio; lo que hacen lo corre `commands.ts` con los servicios de arriba.
  const hotkeyService =
    deps.hotkeys && screens && deps.windows
      ? createHotkeyService({
          hotkeys: deps.hotkeys,
          log,
          run: createCommands({
            screens,
            windows: deps.windows,
            pad: pad ? { setEnabled: (on) => pad.setEnabled(on) } : undefined,
            async media(key) {
              if (audioService) return audioService.pressKey(key);
              if (deps.mediaKeys) return deps.mediaKeys.press(key);
              throw new Error("sin teclas de media");
            },
            runScene: extras ? (id) => extras.runScene(id) : undefined,
            async openPanel() {
              const url = agent.adminUrl();
              if (url) await browser.open(url);
            },
            tvMonitorId: () => config.hotkeys.tvMonitorId,
            log,
          }).run,
          config: {
            enabled: () => config.hotkeys.enabled,
            async setEnabled(on) {
              const previous = config.hotkeys;
              try {
                await commit({ ...config, hotkeys: { ...config.hotkeys, enabled: on } });
              } catch (err) {
                if (config.hotkeys.enabled === on) config = { ...config, hotkeys: previous };
                throw err;
              }
            },
          },
        })
      : undefined;
  // B6.3: las escenas con atajo se registran junto con los fijos, y siguen a la biblioteca cuando cambia.
  extras?.onLibrary((lib) => void hotkeyService?.setScenes(lib.scenes));
  // B6.3: escenas que corren solas (al iniciar el agente o al prender una pantalla). Funcionan sin celu conectado.
  const triggers = extras && screens ? createTriggers({ library: { state: () => extras.library() }, runScene: (id) => extras.runScene(id), running: () => extras.runningScene(), screens, clock, log }) : undefined;
  // "Cortar control remoto" de la bandeja aparece mientras la llave del Pad está prendida; al cortar desaparece.
  pad?.subscribe(() => tray.setItems(trayItems()));

  // B6.2: estado REAL de "Iniciar con Windows" (se lee del sistema, no de la config; D72).
  let autostartState: { enabled: boolean; error?: string } | null = null;
  async function readAutostart(error?: string): Promise<void> {
    if (!deps.autostart) return;
    try {
      const { enabled } = await deps.autostart.read();
      autostartState = error ? { enabled, error } : { enabled };
    } catch (err) {
      log.warn("autostart: could not read", { error: String(err) });
      autostartState = { enabled: autostartState?.enabled ?? false, error: "No se pudo leer el estado de inicio con Windows." };
    }
    tray.setItems(trayItems());
  }

  let trayFailed = false;
  let wsError: string | undefined;
  let wsActivePort: number | null = null;
  let remoteSince: number | null = null;
  let connectionSeen = false;
  let currentQr: { code: string; svg: string } | null = null;
  let migratedFromV1 = false;
  /** La clave privada cifrada no se pudo abrir (otra cuenta de Windows): no se inventa otra hasta que Jay lo confirme (D73). */
  let identityLost = false;
  const revoked = new Set<string>(); // claves públicas revocadas en esta corrida (agent.json no guarda marca de revocado)

  let admin: AdminServer | null = null;
  let stopPromise: Promise<void> | null = null;

  /** Cambia la config en memoria y la guarda. Si el archivo es de una versión futura, solo vive en memoria. */
  async function commit(next: AgentConfig): Promise<void> {
    config = next;
    try {
      await store.save(next);
    } catch (err) {
      if (err instanceof ConfigReadOnlyError) log.warn("config no se guarda: el archivo es de una versión más nueva");
      else throw err;
    }
  }

  const pairing = createPairing({
    clock,
    random,
    log,
    remoteEnabled: false,
    async saveDevice(device: Device) {
      try {
        // Un celu que se empareja de nuevo (misma clave) reemplaza al registro anterior: no queda duplicado.
        await commit({ ...config, devices: [...config.devices.filter((d) => d.publicKey !== device.publicKey), device] });
      } catch (err) {
        config = { ...config, devices: config.devices.filter((d) => d.id !== device.id) };
        throw err;
      }
    },
    async removeDevice(deviceId: string) {
      await commit({ ...config, devices: config.devices.filter((d) => d.id !== deviceId) });
    },
  });

  const server = createRemoteServer({
    screens,
    extras,
    pad,
    async runCommand(msg) {
      if (!screens) return { ok: false, reason: "unsupported" };
      if (msg.type === "window.moveActive") return screens.moveActive(msg.payload.monitorId);
      if (msg.type === "monitor.identify") return screens.identify();
      if (msg.type === "monitor.setOrder") return screens.setOrder(msg.payload.order);
      if (msg.type === "monitor.setEnabled") {
        // El servicio avisa solo (por subscribe) cuando empieza y cuando termina el cambio.
        return screens.setEnabled(msg.payload.monitorId, msg.payload.enabled);
      }
      const outcome = await screens.rename(msg.payload.monitorId, msg.payload.nickname);
      if (outcome.ok) {
        // Los demás celus conectados ven el cambio enseguida, sin esperar al próximo muestreo.
        const state = screens.current();
        if (state) server.broadcastScreens(state);
      }
      return outcome;
    },
    clock,
    log,
    sampler,
    pairing,
    limiter,
    host: overrides.wsHost,
    allowLoopback: overrides.allowLoopback,
    identity() {
      if (!config.identity) throw new Error("la identidad de la PC todavía no se generó");
      return identityToKeyPair(config.identity);
    },
    random: (n) => random.bytes(n),
    lookupDevice(publicKey) {
      const device = config.devices.find((d) => d.publicKey === publicKey);
      if (device) return { status: "ok", device };
      return revoked.has(publicKey) ? { status: "revoked" } : { status: "unknown" };
    },
    async unpair(deviceId) {
      // "Olvidar" desde el celu: se borra el dispositivo; si vuelve, tiene que emparejar de nuevo.
      await commit({ ...config, devices: config.devices.filter((d) => d.id !== deviceId) });
    },
    ownAddresses: () => listCandidates(net.list()).map((c) => c.address),
    onConnection() {
      connectionSeen = true;
    },
    onAuthenticated(device) {
      connectionSeen = true;
      const lastSeenAt = new Date(clock.now()).toISOString();
      commit({ ...config, devices: config.devices.map((d) => (d.id === device.id ? { ...d, lastSeenAt } : d)) }).catch(
        (err: unknown) => log.warn("no se pudo guardar lastSeenAt", { error: String(err) }),
      );
    },
  });

  // Los cambios de pantallas (empieza "cambiando…", termina) llegan a todos los celus conectados.
  screens?.subscribe((state) => server.broadcastScreens(state));

  function trayItems(): TrayMenuItem[] {
    const items: TrayMenuItem[] = [
      { id: "open", label: "Abrir panel" },
      { id: "remoteToggle", label: "Remoto", checked: config.remote.enabled },
    ];
    if (pad && config.input.enabled) {
      items.push({ id: "cutInput", label: hotkeyService?.state().available ? "Cortar control remoto · Ctrl+Alt+Esc" : "Cortar control remoto" });
    }
    if (deps.autostart && autostartState) {
      items.splice(2, 0, {
        id: "autostartToggle",
        label: autostartState.error ? "Iniciar con Windows (no se pudo)" : "Iniciar con Windows",
        checked: autostartState.enabled,
      });
    }
    items.push({ id: "quit", label: "Salir" });
    return items;
  }

  // Las operaciones de prender/apagar van de a una: un doble clic o el panel + la bandeja al mismo
  // tiempo no pueden arrancar dos servidores ni dejar el estado a medias.
  let remoteQueue: Promise<unknown> = Promise.resolve();
  function applyRemote(enabled: boolean): Promise<void> {
    const run = remoteQueue.then(() => doApplyRemote(enabled));
    remoteQueue = run.catch(() => undefined);
    return run;
  }

  /** Prende o apaga el WebSocket y deja la config, el pairing y la bandeja de acuerdo. */
  async function doApplyRemote(enabled: boolean): Promise<void> {
    if (enabled && !config.identity) {
      wsError = "Falta la clave de la PC (no se pudo abrir con esta cuenta de Windows). Generá una clave nueva desde el aviso del panel para usar el acceso remoto.";
      tray.setItems(trayItems());
      return;
    }
    if (enabled && configStatus === "newer_version") {
      // agent.json es de una versión más nueva y no se puede guardar: un celu emparejado ahora se perdería al reiniciar.
      wsError = "La configuración es de una versión más nueva del agente. Actualizá el agente para usar el acceso remoto.";
      tray.setItems(trayItems());
      return;
    }
    let effective = enabled;
    if (enabled && wsActivePort === null) {
      const port = overrides.wsPort ?? config.remote.port;
      try {
        const started = await server.start(port);
        wsActivePort = started.port;
        wsError = undefined;
        remoteSince = clock.now();
        connectionSeen = false;
        pairing.setRemoteEnabled(true);
      } catch (err) {
        effective = false;
        wsError = isAddrInUse(err)
          ? `El puerto ${port} está ocupado por otro programa. El acceso remoto sigue apagado.`
          : `No se pudo abrir el puerto ${port}. El acceso remoto sigue apagado.`;
        log.error("remote server failed to start", { port, error: String(err) });
      }
    } else if (!enabled) {
      pairing.setRemoteEnabled(false);
      await server.stop();
      wsActivePort = null;
      remoteSince = null;
      currentQr = null;
      wsError = undefined;
    }
    if (config.remote.enabled !== effective) {
      await commit({ ...config, remote: { ...config.remote, enabled: effective } });
    }
    tray.setItems(trayItems());
  }

  function selectedAddress() {
    return pickAddress(net.list(), config.remote.preferredInterface);
  }

  /** Las pantallas entre las que Jay elige "la tele": las que ve Windows ahora, más las conocidas de antes (la tele apagada o desenchufada). */
  function tvChoice(): { monitorId: string | null; options: { id: string; name: string }[] } {
    const options = new Map<string, string>();
    for (const k of config.monitors.known) options.set(k.id, k.nickname ?? k.lastName);
    for (const m of screens?.current()?.monitors ?? []) options.set(m.id, m.nickname ?? m.name);
    return { monitorId: config.hotkeys.tvMonitorId, options: [...options].map(([id, name]) => ({ id, name })) };
  }

  const controller: AdminController = {
    status(): AdminStatus {
      const p = pairing.status();
      const pairingView: AdminStatus["pairing"] =
        p.state === "idle"
          ? { state: "idle" }
          : p.state === "showing"
            ? {
                state: "showing",
                expiresAt: p.expiresAt,
                ...(currentQr?.code === p.code ? { qrSvg: currentQr.svg } : {}),
              }
            : {
                state: "awaiting",
                expiresAt: p.expiresAt,
                pending: { deviceName: p.deviceName, platform: p.platform, ip: p.ip ?? "" },
              };

      const notices: NonNullable<AdminStatus["notices"]> = [];
      if (configStatus === "recovered") notices.push("config_recovered");
      if (configStatus === "newer_version") notices.push("config_newer");
      if (trayFailed) notices.push("tray_failed");
      if (migratedFromV1) notices.push("security_upgraded");
      if (identityLost) notices.push("identity_lost");

      const audioNow = audioService?.current() ?? null;
      return {
        ...(pad ? { input: pad.state() } : {}),
        ...(autostartState ? { autostart: { ...autostartState } } : {}),
        ...(hotkeyService ? { hotkeys: { ...hotkeyService.state(), tv: tvChoice() } } : {}),
        audio: {
          available: audioNow?.available.audio === true,
          defaultOutput: audioNow?.available.defaultOutput === true,
          appRouting: audioNow?.available.appRouting === true,
          disabled: { ...config.audio.disable },
        },
        remote: {
          enabled: config.remote.enabled,
          port: wsActivePort ?? overrides.wsPort ?? config.remote.port,
          ...(wsError !== undefined ? { error: wsError } : {}),
        },
        addresses: listCandidates(net.list()),
        selected: selectedAddress(),
        pairing: pairingView,
        devices: config.devices.map((d) => ({
          id: d.id,
          name: d.name,
          platform: d.platform,
          pairedAt: d.pairedAt,
          lastSeenAt: d.lastSeenAt,
          connected: server.isConnected(d.id),
          fingerprint: d.publicKey.slice(0, 8),
        })),
        firewallHint:
          wsActivePort !== null &&
          !connectionSeen &&
          remoteSince !== null &&
          clock.now() - remoteSince >= FIREWALL_HINT_AFTER_MS,
        notices,
      };
    },

    async setRemote(enabled) {
      await applyRemote(enabled);
    },

    async startPairing() {
      const address = selectedAddress();
      if (wsActivePort === null || !address) return false;
      const shown = pairing.start();
      if (!shown) return false;
      if (!config.identity) return false;
      const text = encodeQr({
        v: 2,
        host: address.address,
        port: wsActivePort,
        name: sys.hostname().slice(0, 64) || "PC",
        code: shown.code,
        exp: shown.expiresAt,
        pk: config.identity.publicKey,
      });
      currentQr = { code: shown.code, svg: await renderQr(text) };
      return true;
    },

    async decide(allow) {
      if (allow) return (await pairing.allow()) !== null;
      return pairing.reject();
    },

    async revoke(deviceId) {
      const target = config.devices.find((d) => d.id === deviceId);
      if (!target) return false;
      // Primero se corta el acceso y recién después se guarda: si el disco falla, igual queda revocado.
      revoked.add(target.publicKey);
      server.revoke(deviceId);
      log.info("device revoked", { deviceId });
      await commit({ ...config, devices: config.devices.filter((d) => d.id !== deviceId) });
      return true;
    },

    async setInput(enabled) {
      if (!pad) return false;
      await pad.setEnabled(enabled);
      return true;
    },

    async releaseInput() {
      if (!pad) return false;
      await pad.release();
      return true;
    },

    async setHotkeys(enabled) {
      if (!hotkeyService) return false;
      await hotkeyService.setEnabled(enabled);
      return true;
    },

    async resetIdentity() {
      if (!identityLost) return false;
      await store.acknowledgeLostIdentity(); // guarda copia del archivo y vuelve a permitir escribir
      // Los celus emparejados conocen la clave vieja: con la nueva ya no sirven, así que se vacía la lista (nadie queda "emparejado" sin poder conectar).
      await commit({ ...config, identity: generateIdentity(random), devices: [], remote: { ...config.remote, enabled: false } });
      identityLost = false;
      configStatus = "ok";
      log.warn("identity regenerated after the old private key could not be opened");
      return true;
    },

    async setAutostart(enabled) {
      if (!deps.autostart) return false;
      let failure: string | undefined;
      try {
        await deps.autostart.set(enabled);
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        log.warn("autostart: could not change", { error: failure });
      }
      await readAutostart(failure); // se vuelve a leer lo que de verdad quedó
      return true;
    },

    async setTvMonitor(monitorId) {
      if (!hotkeyService || !screens) return false;
      if (monitorId !== null) {
        if (!screens.current()) await screens.refresh();
        const known = screens.current()?.monitors.some((m) => m.id === monitorId) || config.monitors.known.some((k) => k.id === monitorId);
        if (!known) return false;
      }
      const previous = config.hotkeys;
      try {
        await commit({ ...config, hotkeys: { ...config.hotkeys, tvMonitorId: monitorId } });
      } catch (err) {
        if (config.hotkeys.tvMonitorId === monitorId) config = { ...config, hotkeys: previous };
        throw err;
      }
      return true;
    },

    async setAudioSwitch(which, disabled) {
      await commit({ ...config, audio: { ...config.audio, disable: { ...config.audio.disable, [which]: disabled } } });
      await audioService?.refresh(); // el celu se entera enseguida (audio.update)
      return true;
    },

    async setInterface(name) {
      if (name !== null && !listCandidates(net.list()).some((c) => c.name === name)) return false;
      await commit({ ...config, remote: { ...config.remote, preferredInterface: name } });
      return true;
    },

    quit() {
      void agent.stop().then(() => options.onExit?.(0));
    },
  };

  function onTrayClick(id: TrayMenuItem["id"]): void {
    if (id === "open") {
      const url = agent.adminUrl();
      if (url) browser.open(url).catch((err: unknown) => log.warn("no se pudo abrir el navegador", { error: String(err) }));
    } else if (id === "autostartToggle") {
      // Un toque lee de nuevo el estado real (pudo cambiar por fuera) y recién después lo invierte.
      void readAutostart()
        .then(() => controller.setAutostart(!(autostartState?.enabled ?? false)))
        .catch((err: unknown) => log.warn("autostart toggle failed", { error: String(err) }));
    } else if (id === "cutInput") {
      pad?.setEnabled(false).catch((err: unknown) => log.warn("no se pudo cortar el control remoto", { error: String(err) }));
    } else if (id === "remoteToggle") {
      applyRemote(!config.remote.enabled).catch((err: unknown) => log.error("remote toggle failed", { error: String(err) }));
    } else {
      controller.quit();
    }
  }

  async function doStop(): Promise<void> {
    log.info("agent stopping");
    const work = (async () => {
      const step = async (name: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (err) {
          log.warn(`stop: ${name} failed`, { error: String(err) });
        }
      };
      triggers?.stop();
      if (hotkeyService) await step("hotkeys", () => hotkeyService.stop()); // ningún atajo queda suelto
      pairing.setRemoteEnabled(false);
      await step("remote operation", () => remoteQueue);
      await step("remote server", () => server.stop());
      if (pad) await step("pad", async () => {
        await pad.release(); // nada queda apretado al apagar el agente (D53)
        pad.stop();
      });
      wsActivePort = null;
      if (admin) await step("admin server", () => admin!.stop());
      await step("tray", () => tray.stop());
      if (options.flushLog) await step("log", options.flushLog);
    })();

    let timer: ReturnType<typeof clock.setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = clock.setTimeout(() => {
        log.warn("stop timed out");
        resolve();
      }, STOP_TIMEOUT_MS);
    });
    await Promise.race([work, timeout]);
    if (timer !== undefined) clock.clear(timer);
  }

  const agent: Agent = {
    async start() {
      const loaded = await store.load();
      config = loaded.config;
      extras?.reload(); // los íconos de lo guardado se registran recién cuando la config ya se leyó
      configStatus = loaded.status;
      identityLost = loaded.status === "identity_unreadable";
      migratedFromV1 = loaded.migratedFrom === 1;
      if (!config.identity && !identityLost) {
        // Primera vez (o recién migrado): la PC se da una identidad. Si el archivo es de una versión futura
        // no se puede guardar, y entonces tampoco se prende el remoto.
        config = { ...config, identity: generateIdentity(random) };
        if (configStatus !== "newer_version") await commit(config);
      }
      // El Inicio de una instalación nueva trae los botones por defecto (una sola vez). Si el archivo es de una versión futura no se toca.
      if (configStatus !== "newer_version") {
        const seeded = seedDeck(config);
        if (seeded) await commit(seeded);
      }
      log.info("agent starting", { configStatus, version: options.agentVersion });

      const adminServer = createAdminServer({
        clock,
        random,
        controller,
        assets: { html: PAGE_HTML, js: PAGE_JS, css: PAGE_CSS },
        log,
      });
      const wantedPort = overrides.adminPort ?? config.remote.adminPort;
      try {
        await adminServer.start(wantedPort);
      } catch (err) {
        if (!isAddrInUse(err)) throw err;
        // Ya hay otra instancia: se abre su panel (sin acceso: solo ella puede emitir el valor de ?k) y se sale.
        log.warn("admin port in use: another instance is running", { port: wantedPort });
        await browser.open(`http://127.0.0.1:${wantedPort}/`).catch(() => undefined);
        return { status: "already_running" };
      }
      admin = adminServer;

      await readAutostart();
      tray.onClick(onTrayClick);
      try {
        await tray.start({ tooltip: TRAY_TOOLTIP, items: trayItems() });
      } catch (err) {
        trayFailed = true;
        log.warn("tray failed to start: the agent continues without icon", { error: String(err) });
      }

      if (hotkeyService) {
        await screens?.refresh(); // para que el panel ofrezca las pantallas desde el primer momento
        await hotkeyService.setScenes(extras?.library().scenes ?? []);
        await hotkeyService.start();
      }
      triggers?.start();

      if (options.openPanelOnStart ?? true) {
        await browser.open(agent.adminUrl()!).catch((err: unknown) => log.warn("no se pudo abrir el navegador", { error: String(err) }));
      }

      if (config.remote.enabled) await applyRemote(true);
      return { status: "started" };
    },

    stop() {
      stopPromise ??= doStop();
      return stopPromise;
    },

    controller,
    wsPort: () => wsActivePort,
    adminUrl: () => (admin ? admin.launchUrl() : null),
  };

  return agent;
}
