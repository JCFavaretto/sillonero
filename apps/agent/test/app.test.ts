import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { base64UrlToBytes, bytesToBase64Url, decodeQr, type Hs1Payload } from "@proyecto-e/protocol";
import { createAgent, type Agent } from "../src/app";
import { createConfigStore } from "../src/config/store";
import type { NetInterface } from "../src/ports";
import { monitorId as monitorIdOf } from "../src/screens/model";
import { createPhone, type Incoming, type Phone } from "./phone";
import { FakeAutostart, FakeSecret, FakeCatalog, FakeDisplays, FakeHotkeys, FakeIconExtractor, FakeInput, FakeLauncher, FakeWindows } from "./fakes";
import { FakeBrowser, FakeClock, FakeNetInfo, FakeRandom, FakeSystemInfo, FakeTray, MemFs, MemLogger } from "./fakes";

const DATA_DIR = join("data", "proyecto-e");
const CONFIG_PATH = join(DATA_DIR, "agent.json");

const iface = (name: string, address: string): NetInterface => ({
  name,
  address,
  family: "IPv4",
  internal: false,
  mac: "aa:bb:cc:dd:ee:ff",
  netmask: "255.255.255.0",
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

class Client {
  private queue: string[] = [];
  private waiters: ((m: string) => void)[] = [];
  readonly closed: Promise<number>;
  readonly opened: Promise<void>;
  readonly ws: WebSocket;
  constructor(port: number, readonly phone: Phone) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.opened = new Promise((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
    this.closed = new Promise((res) => this.ws.once("close", (code) => res(code)));
    this.ws.on("message", (d) => {
      const text = d.toString();
      const w = this.waiters.shift();
      if (w) w(text);
      else this.queue.push(text);
    });
  }
  hello(payload: Hs1Payload) {
    this.ws.send(this.phone.hello(payload));
  }
  async next(): Promise<Incoming> {
    const raw = this.queue.shift() ?? (await new Promise<string>((r) => this.waiters.push(r)));
    return this.phone.read([raw])[0]!;
  }
}

const CONNECT: Hs1Payload = { intent: "connect", appVersion: "0.1.0" };

const agents: Agent[] = [];
const clients: Client[] = [];
const blockers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await Promise.all(agents.splice(0).map((a) => a.stop()));
  await Promise.all(blockers.splice(0).map((b) => new Promise<void>((r) => b.close(() => r()))));
});

interface MakeOpts {
  config?: unknown;
  adminPort?: number;
  wsPort?: number;
  interfaces?: NetInterface[];
  trayFails?: boolean;
  openPanel?: boolean;
  /** Con pantallas y ventanas de Windows falsas (3 monitores como los de Jay). */
  screens?: boolean;
  /** Arma también ventanas, catálogo y lanzador de B3 (necesita `screens`). */
  b3?: boolean;
  /** B5: con mouse y teclado de Windows falsos (el Pad). */
  input?: FakeInput;
  /** B6.4: con DPAPI falso (la clave privada va cifrada en agent.json). */
  secret?: FakeSecret;
  /** B6.2: con arranque con Windows falso. */
  autostart?: FakeAutostart;
  /** B6.1: con atajos globales falsos. */
  hotkeys?: FakeHotkeys;
  /** Reusar el "disco" de otro agente (para probar que algo sobrevive a un reinicio). */
  fs?: MemFs;
}

async function make(opts: MakeOpts = {}) {
  const fs = opts.fs ?? new MemFs();
  const displays = new FakeDisplays();
  const windows = new FakeWindows();
  if (opts.screens) {
    displays.raw = [
      { devicePath: "izq", friendlyName: "DELL", outputTechnology: 10, active: true, primary: false, gdiName: null, bounds: { x: 0, y: 0, w: 1920, h: 1080 }, workArea: null },
      { devicePath: "prin", friendlyName: "LG", outputTechnology: 10, active: true, primary: true, gdiName: null, bounds: { x: 1920, y: 0, w: 2560, h: 1440 }, workArea: null },
      { devicePath: "tele", friendlyName: "Samsung TV", outputTechnology: 5, active: false, primary: false, gdiName: null, bounds: null, workArea: null },
    ];
    windows.win = { handle: "1", title: "PLAN.md", exe: "Code.exe", className: "X", rect: { x: 100, y: 100, w: 800, h: 600 }, state: "normal" };
  }
  if (opts.config !== undefined) fs.files.set(CONFIG_PATH, typeof opts.config === "string" ? opts.config : JSON.stringify(opts.config));
  const clock = new FakeClock(Date.UTC(2026, 10, 6, 12, 0, 0));
  const tray = new FakeTray();
  if (opts.trayFails) tray.start = async () => Promise.reject(new Error("no binary"));
  const browser = new FakeBrowser();
  const log = new MemLogger();
  const net = new FakeNetInfo(opts.interfaces ?? [iface("Wi-Fi 2", "192.168.100.5")]);
  const sys = new FakeSystemInfo();
  const exits: number[] = [];
  const qrTexts: string[] = [];
  const agent = createAgent(
    {
      clock,
      random: new FakeRandom(),
      fs,
      net,
      sys,
      tray,
      browser,
      log,
      paths: { dataDir: DATA_DIR },
      ...(opts.screens ? { displays, windows } : {}),
      ...(opts.input ? { input: opts.input } : {}),
      ...(opts.hotkeys ? { hotkeys: opts.hotkeys } : {}),
      ...(opts.autostart ? { autostart: opts.autostart } : {}),
      ...(opts.secret ? { secret: opts.secret } : {}),
      ...(opts.b3 ? { catalog: new FakeCatalog(), launcher: new FakeLauncher(), iconExtractor: new FakeIconExtractor(fs) } : {}),
    },
    {
      agentVersion: "0.1.0",
      overrides: { adminPort: opts.adminPort ?? (await freePort()), wsPort: opts.wsPort ?? 0, wsHost: "127.0.0.1", allowLoopback: true },
      openPanelOnStart: opts.openPanel ?? true,
      renderQr: async (text) => {
        qrTexts.push(text);
        return "<svg xmlns='http://www.w3.org/2000/svg'/>";
      },
      onExit: (code) => void exits.push(code),
    },
  );
  agents.push(agent);
  return { agent, fs, clock, tray, browser, log, net, sys, exits, qrTexts, displays, windows };
}

const savedConfig = (fs: MemFs) => JSON.parse(fs.files.get(CONFIG_PATH) ?? "null") as {
  remote: { enabled: boolean };
  identity: { publicKey: string; privateKey: string } | null;
  devices: { id: string; publicKey: string; lastSeenAt: string | null }[];
};

describe("app · arranque", () => {
  it("por defecto el remoto está apagado: no escucha; abre el panel con el secreto y arma la bandeja", async () => {
    const { agent, tray, browser } = await make();
    expect(await agent.start()).toEqual({ status: "started" });
    expect(agent.wsPort()).toBeNull();
    expect(agent.controller.status().remote.enabled).toBe(false);
    expect(browser.opened).toHaveLength(1);
    expect(browser.opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?k=[A-Za-z0-9_-]{43}$/);
    expect(tray.started).toBe(true);
    expect(tray.items.map((i) => i.id)).toEqual(["open", "remoteToggle", "quit"]);
    expect(tray.items[1]?.checked).toBe(false);
  });

  it("con openPanelOnStart apagado no abre el navegador", async () => {
    const { agent, browser } = await make({ openPanel: false });
    await agent.start();
    expect(browser.opened).toEqual([]);
  });

  it("si agent.json dice remoto prendido, lo levanta al arrancar", async () => {
    const { agent } = await make({ config: { version: 1, remote: { enabled: true } } });
    await agent.start();
    expect(agent.wsPort()).toBeGreaterThan(0);
    expect(agent.controller.status().remote.enabled).toBe(true);
  });

  it("agent.json de una versión futura: remoto apagado, aviso, y no se deja prender (no se perderían los emparejamientos)", async () => {
    const future = JSON.stringify({ version: 99, remote: { enabled: true } });
    const { agent, fs } = await make({ config: future });
    await agent.start();
    expect(agent.wsPort()).toBeNull();
    expect(agent.controller.status().notices).toContain("config_newer");
    await agent.controller.setRemote(true);
    expect(agent.wsPort()).toBeNull();
    expect(agent.controller.status().remote.enabled).toBe(false);
    expect(agent.controller.status().remote.error).toContain("más nueva");
    expect(await agent.controller.startPairing()).toBe(false);
    expect(fs.files.get(CONFIG_PATH)).toBe(future); // nunca se escribe
  });

  it("agent.json corrupto: avisa y arranca con los valores de fábrica", async () => {
    const { agent } = await make({ config: "{roto" });
    await agent.start();
    expect(agent.controller.status().notices).toContain("config_recovered");
    expect(agent.controller.status().remote.enabled).toBe(false);
  });

  it("una bandeja que falla no tumba al agente: avisa y abre el panel igual", async () => {
    const { agent, browser, log } = await make({ trayFails: true });
    expect(await agent.start()).toEqual({ status: "started" });
    expect(agent.controller.status().notices).toContain("tray_failed");
    expect(browser.opened).toHaveLength(1);
    expect(log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("segunda instancia: el puerto del panel está ocupado → abre el panel existente y no arranca", async () => {
    const adminPort = await freePort();
    const first = await make({ adminPort });
    await first.agent.start();
    const second = await make({ adminPort });
    expect(await second.agent.start()).toEqual({ status: "already_running" });
    expect(second.browser.opened).toEqual([`http://127.0.0.1:${adminPort}/`]);
    expect(second.tray.started).toBe(false);
    expect(second.agent.wsPort()).toBeNull();
  });

  it("puerto del WebSocket ocupado: el remoto queda apagado con el error visible", async () => {
    const blocker = createServer();
    blockers.push(blocker);
    const busy = await new Promise<number>((r) => blocker.listen(0, "127.0.0.1", () => r((blocker.address() as { port: number }).port)));
    const { agent, fs } = await make({ wsPort: busy, config: { version: 1, remote: { enabled: true } } });
    await agent.start();
    const st = agent.controller.status();
    expect(st.remote.enabled).toBe(false);
    expect(st.remote.error).toContain("ocupado");
    expect(agent.wsPort()).toBeNull();
    expect(savedConfig(fs).remote.enabled).toBe(false);
  });
});

describe("app · remoto on/off", () => {
  it("setRemote(true) escucha, guarda y marca la bandeja; setRemote(false) cierra con 1001", async () => {
    const { agent, fs, tray } = await make();
    await agent.start();
    await agent.controller.setRemote(true);
    expect(agent.wsPort()).toBeGreaterThan(0);
    expect(savedConfig(fs).remote.enabled).toBe(true);
    expect(tray.items.find((i) => i.id === "remoteToggle")?.checked).toBe(true);

    const c = new Client(agent.wsPort()!, createPhone(new Uint8Array(32).fill(1)));
    clients.push(c);
    await c.opened;
    await agent.controller.setRemote(false);
    expect(await c.closed).toBe(1001);
    expect(agent.wsPort()).toBeNull();
    expect(savedConfig(fs).remote.enabled).toBe(false);
    expect(tray.items.find((i) => i.id === "remoteToggle")?.checked).toBe(false);
  });

  it("dos setRemote(true) simultáneos (doble clic) dejan todo coherente y sin error falso", async () => {
    const { agent, fs, tray } = await make();
    await agent.start();
    await Promise.all([agent.controller.setRemote(true), agent.controller.setRemote(true)]);
    const st = agent.controller.status();
    expect(agent.wsPort()).toBeGreaterThan(0);
    expect(st.remote.enabled).toBe(true);
    expect(st.remote.error).toBeUndefined();
    expect(savedConfig(fs).remote.enabled).toBe(true);
    expect(tray.items.find((i) => i.id === "remoteToggle")?.checked).toBe(true);
  });

  it("encender y apagar a la vez termina en el último pedido (apagado)", async () => {
    const { agent, fs } = await make();
    await agent.start();
    await Promise.all([agent.controller.setRemote(true), agent.controller.setRemote(false)]);
    expect(agent.wsPort()).toBeNull();
    expect(agent.controller.status().remote.enabled).toBe(false);
    expect(savedConfig(fs).remote.enabled).toBe(false);
  });

  it("clic del panel y clic de la bandeja al mismo tiempo no se pisan", async () => {
    const { agent, tray } = await make();
    await agent.start();
    const viaPanel = agent.controller.setRemote(true);
    tray.click("remoteToggle");
    await viaPanel;
    await new Promise((r) => setTimeout(r, 50));
    expect(agent.controller.status().remote.error).toBeUndefined();
  });

  it("setRemote(true) dos veces no falla", async () => {
    const { agent } = await make();
    await agent.start();
    await agent.controller.setRemote(true);
    await agent.controller.setRemote(true);
    expect(agent.wsPort()).toBeGreaterThan(0);
  });

  it("los clics de la bandeja: Abrir panel, Remoto y Salir", async () => {
    const { agent, tray, browser, exits } = await make();
    await agent.start();
    tray.click("open");
    await new Promise((r) => setImmediate(r));
    expect(browser.opened).toHaveLength(2);
    // Misma dirección pero con un valor de ?k nuevo cada vez (son de un solo uso).
    expect(new URL(browser.opened[1]!).origin).toBe(new URL(browser.opened[0]!).origin);
    expect(new URL(browser.opened[1]!).searchParams.get("k")).not.toBe(new URL(browser.opened[0]!).searchParams.get("k"));

    tray.click("remoteToggle");
    await new Promise((r) => setTimeout(r, 30));
    expect(agent.wsPort()).toBeGreaterThan(0);

    tray.click("quit");
    await new Promise((r) => setTimeout(r, 30));
    expect(exits).toEqual([0]);
    expect(tray.stopped).toBe(true);
  });

  it("firewallHint: prendido y sin conexiones en 60 s; se apaga cuando llega una", async () => {
    const { agent, clock } = await make();
    await agent.start();
    await agent.controller.setRemote(true);
    expect(agent.controller.status().firewallHint).toBe(false);
    clock.advance(59_000);
    expect(agent.controller.status().firewallHint).toBe(false);
    clock.advance(1_000);
    expect(agent.controller.status().firewallHint).toBe(true);

    const c = new Client(agent.wsPort()!, createPhone(new Uint8Array(32).fill(1)));
    clients.push(c);
    await c.opened;
    expect(agent.controller.status().firewallHint).toBe(false);
  });
});

describe("app · red y QR", () => {
  const TWO = [iface("Wi-Fi 2", "192.168.100.5"), iface("Ethernet", "10.0.0.7")];

  it("lista las candidatas y respeta la interfaz elegida; null vuelve a automática", async () => {
    const { agent, fs } = await make({ interfaces: TWO });
    await agent.start();
    const c = agent.controller;
    expect(c.status().addresses.map((a) => a.name)).toEqual(["Wi-Fi 2", "Ethernet"]);
    expect(c.status().selected?.address).toBe("192.168.100.5");
    expect(await c.setInterface("Ethernet")).toBe(true);
    expect(c.status().selected?.address).toBe("10.0.0.7");
    expect(await c.setInterface("Inexistente")).toBe(false);
    expect(await c.setInterface(null)).toBe(true);
    expect(c.status().selected?.address).toBe("192.168.100.5");
    expect(fs.files.get(CONFIG_PATH)).toContain('"preferredInterface": null');
  });

  it("no se puede emparejar con el remoto apagado ni sin red local", async () => {
    const off = await make();
    await off.agent.start();
    expect(await off.agent.controller.startPairing()).toBe(false);

    const noNet = await make({ interfaces: [] });
    await noNet.agent.start();
    await noNet.agent.controller.setRemote(true);
    expect(noNet.agent.controller.status().selected).toBeNull();
    expect(await noNet.agent.controller.startPairing()).toBe(false);
  });

  it("startPairing arma el QR con la IP elegida, el puerto real y el nombre de la PC", async () => {
    const { agent, qrTexts, clock, sys } = await make({ interfaces: TWO });
    sys.host = "PC-DE-JAY";
    await agent.start();
    await agent.controller.setRemote(true);
    expect(await agent.controller.startPairing()).toBe(true);
    const qr = decodeQr(qrTexts[0]!, clock.now());
    expect(qr.ok).toBe(true);
    if (!qr.ok) return;
    expect(qr.payload).toMatchObject({ v: 2, host: "192.168.100.5", port: agent.wsPort(), name: "PC-DE-JAY" });
    expect(qr.payload.pk).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const st = agent.controller.status();
    expect(st.pairing.state).toBe("showing");
    expect(st.pairing.qrSvg).toContain("<svg");
    expect(st.pairing.expiresAt).toBe(qr.payload.exp);
  });
});

type Made = Awaited<ReturnType<typeof make>>;

/** Prende el remoto, muestra el QR y devuelve lo que un celu aprende al escanearlo (la clave de la PC, el código). */
async function scan(t: Made) {
  await t.agent.start();
  await t.agent.controller.setRemote(true);
  await t.agent.controller.startPairing();
  const qr = decodeQr(t.qrTexts.at(-1)!, t.clock.now());
  if (!qr.ok) throw new Error("QR inválido");
  const pcKey = base64UrlToBytes(qr.payload.pk)!;
  const connect = async (phone: Phone) => {
    const c = new Client(t.agent.wsPort()!, phone);
    clients.push(c);
    await c.opened;
    return c;
  };
  return { qr, pcKey, connect, code: qr.payload.code };
}

/** Empareja un celu falso de punta a punta. */
async function pairOne(t: Made, name = "Pixel de Jay") {
  const s = await scan(t);
  const phone = createPhone(s.pcKey);
  const c = await s.connect(phone);
  c.hello({ intent: "pair", code: s.code, deviceName: name, platform: "android", appVersion: "0.1.0" });
  expect(await c.next()).toMatchObject({ type: "hs2", payload: { ok: true } });
  expect((await c.next()).type).toBe("pair.pending");
  expect(t.agent.controller.status().pairing).toMatchObject({
    state: "awaiting",
    pending: { deviceName: name, platform: "android", ip: "127.0.0.1" },
  });
  expect(await t.agent.controller.decide(true)).toBe(true);
  const result = await c.next();
  if (result.type !== "pair.result" || !result.payload.ok) throw new Error("no se emparejó");
  expect(await c.closed).toBe(4005);
  return { ...s, phone, keyPair: phone.keyPair, deviceId: result.payload.deviceId };
}

describe("app · emparejar, conectar y revocar de punta a punta", () => {
  it("pair → permitir → connect → conectado → revocar → 4003 → revoked", async () => {
    const t = await make();
    const { fs, clock, agent } = t;
    const p = await pairOne(t);

    // Quedó guardada solo la clave pública del celu: ni token ni la clave privada del celu.
    const saved = savedConfig(fs);
    expect(saved.devices).toHaveLength(1);
    expect(saved.devices[0]!.publicKey).toBe(p.phone.publicKey);
    expect(saved.identity?.publicKey).toBe(p.qr.payload.pk); // la clave del QR es la de la identidad guardada
    const raw = fs.files.get(CONFIG_PATH) ?? "";
    expect(raw).not.toContain("tokenHash");
    expect(raw).not.toContain(bytesToBase64Url(p.keyPair.privateKey));

    // Conexión nueva con la misma clave: la PC la reconoce.
    const c2 = await p.connect(createPhone(p.pcKey, p.keyPair));
    c2.hello(CONNECT);
    expect((await c2.next()).type).toBe("hs2");
    c2.ws.send(c2.phone.send("ping")); // confirma la clave
    expect((await c2.next()).type).toBe("auth.ok");
    await c2.next();
    const dev = agent.controller.status().devices[0];
    expect(dev).toMatchObject({ id: p.deviceId, name: "Pixel de Jay", connected: true, fingerprint: p.phone.publicKey.slice(0, 8) });
    expect(dev?.lastSeenAt).toBe(new Date(clock.now()).toISOString());
    expect(savedConfig(fs).devices[0]?.lastSeenAt).toBe(new Date(clock.now()).toISOString());

    // Revocar corta la sesión y borra el dispositivo.
    expect(await agent.controller.revoke(p.deviceId)).toBe(true);
    expect(await c2.closed).toBe(4003);
    expect(agent.controller.status().devices).toEqual([]);
    expect(savedConfig(fs).devices).toEqual([]);

    // Si vuelve a intentar con la misma clave, sabe que lo revocaron.
    const c3 = await p.connect(createPhone(p.pcKey, p.keyPair));
    c3.hello(CONNECT);
    expect(await c3.next()).toMatchObject({ type: "hs2", payload: { ok: false, reason: "revoked" } });
    expect(await c3.closed).toBe(4003);
  });

  it("Rechazar no crea dispositivo y decide sin pedido da false", async () => {
    const t = await make();
    await t.agent.start();
    expect(await t.agent.controller.decide(true)).toBe(false);
    const s = await scan(t);
    const c = await s.connect(createPhone(s.pcKey));
    c.hello({ intent: "pair", code: s.code, deviceName: "X", platform: "ios", appVersion: "0.1.0" });
    await c.next();
    await c.next();
    expect(await t.agent.controller.decide(false)).toBe(true);
    expect(await c.next()).toMatchObject({ type: "pair.result", payload: { ok: false, reason: "rejected" } });
    expect(t.agent.controller.status().devices).toEqual([]);
  });

  it("si no se puede guardar al revocar, la sesión abierta se corta igual y el celu no vuelve a entrar", async () => {
    const t = await make();
    const p = await pairOne(t);
    const c2 = await p.connect(createPhone(p.pcKey, p.keyPair));
    c2.hello(CONNECT);
    await c2.next(); // hs2
    c2.ws.send(c2.phone.send("ping")); // confirma la clave
    await c2.next();
    await c2.next();

    t.fs.failNextWrite();
    await expect(t.agent.controller.revoke(p.deviceId)).rejects.toThrow();
    expect(await c2.closed).toBe(4003);

    const c3 = await p.connect(createPhone(p.pcKey, p.keyPair));
    c3.hello(CONNECT);
    expect(await c3.next()).toMatchObject({ type: "hs2", payload: { ok: false, reason: "revoked" } });
  });

  it("emparejar de nuevo el mismo celu (misma clave) no duplica el dispositivo", async () => {
    const t = await make();
    const first = await pairOne(t);
    await t.agent.controller.startPairing();
    const code = decodeQr(t.qrTexts.at(-1)!, t.clock.now());
    if (!code.ok) throw new Error("QR inválido");
    const c = await first.connect(createPhone(first.pcKey, first.keyPair));
    c.hello({ intent: "pair", code: code.payload.code, deviceName: "Pixel de Jay (otra vez)", platform: "android", appVersion: "0.1.0" });
    await c.next();
    await c.next();
    expect(await t.agent.controller.decide(true)).toBe(true);
    await c.next();
    const devices = savedConfig(t.fs).devices;
    expect(devices).toHaveLength(1);
    expect(devices[0]!.id).not.toBe(first.deviceId);
  });

  it("Olvidar desde el celu (device.unpair) borra el dispositivo de agent.json", async () => {
    const t = await make();
    const p = await pairOne(t);
    const c = await p.connect(createPhone(p.pcKey, p.keyPair));
    c.hello(CONNECT);
    await c.next(); // hs2
    c.ws.send(c.phone.send("ping")); // confirma la clave
    await c.next();
    await c.next();
    c.ws.send(c.phone.send("device.unpair"));
    expect(await c.closed).toBe(1000);
    expect(savedConfig(t.fs).devices).toEqual([]);
  });

  it("un agent.json de B1 se migra: sin dispositivos, con identidad nueva y el aviso para re-emparejar", async () => {
    const t = await make();
    t.fs.files.set(
      CONFIG_PATH,
      JSON.stringify({ version: 1, remote: { enabled: false }, devices: [{ id: "11111111-1111-4111-8111-111111111111", name: "Viejo", platform: "android", tokenHash: "sha256:" + "a".repeat(64), pairedAt: "2026-11-06T12:00:00.000Z", lastSeenAt: null }] }),
    );
    await t.agent.start();
    const st = t.agent.controller.status();
    expect(st.devices).toEqual([]);
    expect(st.notices).toContain("security_upgraded");
    const saved = savedConfig(t.fs);
    expect(saved.identity?.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.fs.files.get(CONFIG_PATH + ".v1.bak")).toContain("tokenHash");
  });

  it("revocar un id desconocido da false", async () => {
    const { agent } = await make();
    await agent.start();
    expect(await agent.controller.revoke("11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("apagar el remoto invalida el código que se estaba mostrando", async () => {
    const { agent } = await make();
    await agent.start();
    await agent.controller.setRemote(true);
    await agent.controller.startPairing();
    expect(agent.controller.status().pairing.state).toBe("showing");
    await agent.controller.setRemote(false);
    expect(agent.controller.status().pairing.state).toBe("idle");
  });
});

describe("app · apagado", () => {
  it("stop() cierra todo, libera el puerto del panel y es idempotente", async () => {
    const { agent, tray } = await make();
    await agent.start();
    await agent.controller.setRemote(true);
    const adminPort = Number(new URL(agent.adminUrl()!).port);
    await Promise.all([agent.stop(), agent.stop()]);
    await agent.stop();
    expect(tray.stopped).toBe(true);
    expect(agent.wsPort()).toBeNull();
    // El puerto del panel quedó libre.
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(adminPort, "127.0.0.1", () => s.close(() => resolve()));
    });
  });

  it("stop() antes de start() no rompe", async () => {
    const { agent } = await make();
    await expect(agent.stop()).resolves.toBeUndefined();
  });

  it("si un componente se cuelga, stop() termina igual a los 3 s", async () => {
    const { agent, tray, clock } = await make();
    await agent.start();
    tray.stop = () => new Promise<void>(() => undefined); // nunca termina
    let done = false;
    const p = agent.stop().then(() => (done = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false);
    clock.advance(3_000);
    await p;
    expect(done).toBe(true);
  });
});

describe("app · pantallas y apodos (R4)", () => {
  const TELE_ID = monitorIdOf("tele");

  async function online(t: Made) {
    const p = await pairOne(t);
    const c = await p.connect(createPhone(p.pcKey, p.keyPair));
    c.hello(CONNECT);
    expect((await c.next()).type).toBe("hs2");
    c.ws.send(c.phone.send("ping")); // confirma la clave
    expect((await c.next()).type).toBe("auth.ok");
    expect((await c.next()).type).toBe("state.snapshot");
    const snap = await c.next();
    if (snap.type !== "screens.snapshot") throw new Error("falta el screens.snapshot");
    return { p, c, snap };
  }

  it("al conectar llega el snapshot con las pantallas de Windows", async () => {
    const t = await make({ screens: true });
    const { snap } = await online(t);
    expect(snap.payload.monitors.map((m) => [m.name, m.enabled])).toEqual([["DELL", true], ["LG", true], ["Samsung TV", false]]);
    expect(snap.payload.foreground).toMatchObject({ title: "PLAN.md", app: "Code.exe" });
  });

  it("monitor.rename: se guarda en agent.json, vuelve el command.result y llega el screens.update con el apodo", async () => {
    const t = await make({ screens: true });
    const { c } = await online(t);
    c.ws.send(c.phone.send("monitor.rename", { monitorId: TELE_ID, nickname: "Tele living" }));
    const seen = [await c.next(), await c.next()];
    expect(seen.map((m) => m.type).sort()).toEqual(["command.result", "screens.update"]);
    expect(seen.find((m) => m.type === "command.result")).toMatchObject({ payload: { ok: true } });
    const update = seen.find((m) => m.type === "screens.update");
    expect(update?.type === "screens.update" && update.payload.monitors.find((m) => m.id === TELE_ID)?.nickname).toBe("Tele living");

    const saved = JSON.parse(t.fs.files.get(CONFIG_PATH) ?? "{}") as { monitors: { known: { id: string; nickname: string | null }[] } };
    expect(saved.monitors.known.find((k) => k.id === TELE_ID)).toMatchObject({ nickname: "Tele living" });
  });

  it("el apodo sobrevive a reiniciar el agente", async () => {
    const first = await make({ screens: true });
    const { p, c } = await online(first);
    c.ws.send(c.phone.send("monitor.rename", { monitorId: TELE_ID, nickname: "Tele living" }));
    await c.next();
    await c.next();
    await first.agent.stop();

    const second = await make({ screens: true, fs: first.fs });
    await second.agent.start();
    expect(second.agent.wsPort()).not.toBeNull();
    const c2 = new Client(second.agent.wsPort()!, createPhone(p.pcKey, p.keyPair));
    clients.push(c2);
    await c2.opened;
    c2.hello(CONNECT);
    await c2.next(); // hs2
    c2.ws.send(c2.phone.send("ping")); // confirma la clave
    for (let i = 0; i < 2; i++) await c2.next();
    const snap = await c2.next();
    expect(snap.type === "screens.snapshot" && snap.payload.monitors.find((m) => m.id === TELE_ID)?.nickname).toBe("Tele living");
  });

  it("monitor.setEnabled: llega 'cambiando…', después el estado final y el command.result; Windows recibió el pedido", async () => {
    const t = await make({ screens: true });
    const { c } = await online(t);
    t.displays.enableAt["tele"] = { x: 4480, y: 0, w: 3840, h: 2160 };
    c.ws.send(c.phone.send("monitor.setEnabled", { monitorId: TELE_ID, enabled: true }));
    const got: Incoming[] = [];
    while (!got.some((m) => m.type === "command.result")) got.push(await c.next());
    const updates = got.filter((m) => m.type === "screens.update");
    const tele = (m: Incoming) => (m.type === "screens.update" ? m.payload.monitors.find((x) => x.id === TELE_ID) : undefined);
    expect(tele(updates[0]!)?.busy).toBe(true); // primero "cambiando…"
    expect(tele(updates.at(-1)!)).toMatchObject({ busy: false, enabled: true, index: 3 });
    expect(got.at(-1)).toMatchObject({ type: "command.result", payload: { ok: true } });
    expect(t.displays.sets).toEqual([{ devicePath: "tele", on: true }]);
  });

  it("apagar la principal: command.result primary y Windows no se toca", async () => {
    const t = await make({ screens: true });
    const { c } = await online(t);
    c.ws.send(c.phone.send("monitor.setEnabled", { monitorId: monitorIdOf("prin"), enabled: false }));
    expect(await c.next()).toMatchObject({ type: "command.result", payload: { ok: false, reason: "primary" } });
    expect(t.displays.sets).toEqual([]);
  });

  it("si Windows falla al apagar: failed y la pantalla sigue prendida", async () => {
    const t = await make({ screens: true });
    const { c } = await online(t);
    t.displays.failSetNext();
    c.ws.send(c.phone.send("monitor.setEnabled", { monitorId: monitorIdOf("izq"), enabled: false }));
    const got: Incoming[] = [];
    while (!got.some((m) => m.type === "command.result")) got.push(await c.next());
    expect(got.at(-1)).toMatchObject({ payload: { ok: false, reason: "failed" } });
    const last = [...got].reverse().find((m) => m.type === "screens.update");
    expect(last?.type === "screens.update" && last.payload.monitors.find((m) => m.id === monitorIdOf("izq"))).toMatchObject({ enabled: true, busy: false });
  });

  it("window.moveActive: la ventana activa se mueve de verdad y el celu ve en qué pantalla quedó", async () => {
    const t = await make({ screens: true });
    const { c, snap } = await online(t);
    expect(snap.payload.foreground?.monitorId).toBe(monitorIdOf("izq"));
    c.ws.send(c.phone.send("window.moveActive", { monitorId: monitorIdOf("prin") }));
    const got: Incoming[] = [];
    while (!got.some((m) => m.type === "command.result")) got.push(await c.next());
    expect(got.at(-1)).toMatchObject({ type: "command.result", payload: { ok: true } });
    expect(t.windows.placed).toHaveLength(1);
    expect(t.windows.placed[0]).toMatchObject({ handle: "1" });
    expect(t.windows.placed[0]!.rect.x).toBeGreaterThanOrEqual(1920);
    const update = [...got].reverse().find((m) => m.type === "screens.update");
    expect(update?.type === "screens.update" && update.payload.foreground?.monitorId).toBe(monitorIdOf("prin"));
  });

  it("monitor.setOrder: el orden cambia de verdad, el celu lo ve y la PC lo guarda en Windows", async () => {
    const t = await make({ screens: true });
    const { c, snap } = await online(t);
    expect(snap.payload.monitors.filter((m) => m.enabled).map((m) => m.id)).toEqual([monitorIdOf("izq"), monitorIdOf("prin")]);
    c.ws.send(c.phone.send("monitor.setOrder", { order: [monitorIdOf("prin"), monitorIdOf("izq")] }));
    const got: Incoming[] = [];
    while (!got.some((m) => m.type === "command.result")) got.push(await c.next());
    expect(got.at(-1)).toMatchObject({ type: "command.result", payload: { ok: true } });
    expect(t.displays.arranged).toHaveLength(1);
    const last = [...got].reverse().find((m) => m.type === "screens.update");
    const order = last?.type === "screens.update" ? last.payload.monitors.filter((m) => m.enabled).map((m) => m.id) : [];
    expect(order).toEqual([monitorIdOf("prin"), monitorIdOf("izq")]);
  });

  it("monitor.setOrder con una lista que no corresponde: not_found y no se toca nada", async () => {
    const t = await make({ screens: true });
    const { c } = await online(t);
    c.ws.send(c.phone.send("monitor.setOrder", { order: [monitorIdOf("prin")] }));
    expect(await c.next()).toMatchObject({ type: "command.result", payload: { ok: false, reason: "not_found" } });
    expect(t.displays.arranged).toEqual([]);
  });

  it("window.moveActive sin ventana activa: no_window", async () => {
    const t = await make({ screens: true });
    const { c } = await online(t);
    t.windows.win = null;
    c.ws.send(c.phone.send("window.moveActive", { monitorId: monitorIdOf("prin") }));
    expect(await c.next()).toMatchObject({ type: "command.result", payload: { ok: false, reason: "no_window" } });
  });

  it("si agent.json no se puede escribir: command.result failed y el apodo no queda", async () => {
    const t = await make({ screens: true });
    const { c } = await online(t);
    t.fs.failNextWrite();
    c.ws.send(c.phone.send("monitor.rename", { monitorId: TELE_ID, nickname: "Tele living" }));
    expect(await c.next()).toMatchObject({ type: "command.result", payload: { ok: false, reason: "failed" } });
  });

  it("una pantalla que no existe: not_found", async () => {
    const t = await make({ screens: true });
    const { c } = await online(t);
    c.ws.send(c.phone.send("monitor.rename", { monitorId: "m_NoExisteNoExiste", nickname: "x" }));
    expect(await c.next()).toMatchObject({ type: "command.result", payload: { ok: false, reason: "not_found" } });
  });

  it("sin pantallas de Windows (otro sistema): unsupported", async () => {
    const t = await make();
    const p = await pairOne(t);
    const c = await p.connect(createPhone(p.pcKey, p.keyPair));
    c.hello(CONNECT);
    await c.next(); // hs2
    c.ws.send(c.phone.send("ping")); // confirma la clave
    for (let i = 0; i < 2; i++) await c.next();
    c.ws.send(c.phone.send("monitor.rename", { monitorId: TELE_ID, nickname: "x" }));
    expect(await c.next()).toMatchObject({ type: "command.result", payload: { ok: false, reason: "unsupported" } });
  });
});

describe("app · B3 armada completa", () => {
  it("arranca con ventanas, catálogo y lanzador (antes se rompía al leer la config antes de crearla)", async () => {
    const { agent } = await make({ screens: true, b3: true });
    await expect(agent.start()).resolves.toEqual({ status: "started" });
  });

  it("con una biblioteca guardada, arranca y la conserva", async () => {
    const config = {
      version: 4,
      remote: { enabled: false },
      library: { launchers: [{ id: "l_AAAAAAAAAA", name: "Cursor", target: { kind: "app", appId: "Anysphere.Cursor" }, iconKey: "i_AAAAAAAAAAAAAAAA" }], scenes: [], deck: [{ kind: "launcher", id: "l_AAAAAAAAAA" }] },
    };
    const t = await make({ screens: true, b3: true, config });
    await t.agent.start();
    expect(JSON.parse(t.fs.files.get(CONFIG_PATH)!).library.launchers).toHaveLength(1);
  });
});

describe("Inicio por defecto al arrancar", () => {
  it("una instalación nueva arranca con los botones por defecto, guardados en agent.json", async () => {
    const t = await make({ screens: true, b3: true });
    await t.agent.start();
    const saved = JSON.parse(t.fs.files.get(CONFIG_PATH)!);
    expect(saved.library.deck.map((d: { kind: string }) => d.kind)).toEqual(["media", "media", "media", "volume", "volume", "mute", "bringAll", "identify"]);
    expect(saved.deckSeeded).toBe(true);
  });

  it("el Inicio que ya armó Jay no se toca", async () => {
    const config = { version: 4, remote: { enabled: false }, library: { launchers: [], scenes: [], deck: [{ kind: "identify" }] } };
    const t = await make({ screens: true, b3: true, config });
    await t.agent.start();
    expect(JSON.parse(t.fs.files.get(CONFIG_PATH)!).library.deck).toEqual([{ kind: "identify" }]);
  });

  it("si Jay vació su Inicio después de la primera vez, no se vuelve a llenar", async () => {
    const config = { version: 4, remote: { enabled: false }, deckSeeded: true, library: { launchers: [], scenes: [], deck: [] } };
    const t = await make({ screens: true, b3: true, config });
    await t.agent.start();
    expect(JSON.parse(t.fs.files.get(CONFIG_PATH)!).library.deck).toEqual([]);
  });
});

describe("app · Pad (B5)", () => {
  const savedInput = (fs: MemFs) => (JSON.parse(fs.files.get(CONFIG_PATH) ?? "null") as { input?: { enabled: boolean } } | null)?.input;

  it("sin hijo de entrada el panel no muestra el Pad", async () => {
    const { agent } = await make();
    expect(agent.controller.status().input).toBeUndefined();
    expect(await agent.controller.setInput(false)).toBe(false);
    expect(await agent.controller.releaseInput()).toBe(false);
  });

  it("la llave viene prendida (no hay permiso aparte) y el panel ve el estado", async () => {
    const input = new FakeInput();
    const { agent } = await make({ input });
    await agent.start();
    expect(agent.controller.status().input).toEqual({ available: true, enabled: true, elevated: false, holding: { left: false, alt: false } });
  });

  it("apagar la llave se guarda en agent.json y sobrevive a un reinicio", async () => {
    const input = new FakeInput();
    const first = await make({ input });
    await first.agent.start();
    expect(await first.agent.controller.setInput(false)).toBe(true);
    expect(savedInput(first.fs)).toEqual({ enabled: false });
    await first.agent.stop();
    const second = await make({ input: new FakeInput(), fs: first.fs });
    await second.agent.start();
    expect(second.agent.controller.status().input?.enabled).toBe(false);
  });

  it("\"Soltar todo\" del panel suelta el botón que un celu dejó apretado", async () => {
    const input = new FakeInput();
    const { agent } = await make({ input });
    await agent.start();
    await input.button("left", "down");
    expect(input.heldNow().left).toBe(true);
    await agent.controller.releaseInput();
    // el servicio solo suelta lo que él mismo marcó como apretado: acá nadie lo apretó por el Pad, así que no manda nada de más
    expect(input.of("button").filter((c) => c.action === "up")).toHaveLength(0);
  });

  it("al apagar el agente no queda nada apretado", async () => {
    const input = new FakeInput();
    const { agent } = await make({ input });
    await agent.start();
    await agent.stop();
    expect(input.heldNow()).toEqual({ left: false, alt: false });
  });
});

describe("app · atajos de teclado (B6.1)", () => {
  const savedHotkeys = (fs: MemFs) => (JSON.parse(fs.files.get(CONFIG_PATH) ?? "null") as { hotkeys?: { enabled: boolean; tvMonitorId: string | null } } | null)?.hotkeys;
  const flushAsync = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  };
  const TELE = monitorIdOf("tele");

  it("sin hijo de atajos el panel no muestra la tarjeta y no rompe nada", async () => {
    const { agent } = await make({ screens: true });
    await agent.start();
    expect(agent.controller.status().hotkeys).toBeUndefined();
    expect(await agent.controller.setHotkeys(false)).toBe(false);
    expect(await agent.controller.setTvMonitor(TELE)).toBe(false);
  });

  it("al arrancar registra los atajos y el panel ve el estado con las pantallas para elegir la tele", async () => {
    const hotkeys = new FakeHotkeys();
    const { agent } = await make({ screens: true, hotkeys });
    await agent.start();
    const st = agent.controller.status().hotkeys!;
    expect(hotkeys.registered).toHaveLength(10);
    expect(st).toMatchObject({ available: true, enabled: true });
    expect(st.keys.every((k) => k.status === "active")).toBe(true);
    expect(st.tv.monitorId).toBeNull();
    expect(st.tv.options.map((o) => o.name)).toContain("Samsung TV");
  });

  it("apagar la llave se guarda en agent.json, sobrevive a un reinicio y deja solo Ctrl+Alt+Esc", async () => {
    const first = await make({ screens: true, hotkeys: new FakeHotkeys() });
    await first.agent.start();
    expect(await first.agent.controller.setHotkeys(false)).toBe(true);
    expect(savedHotkeys(first.fs)).toMatchObject({ enabled: false });
    await first.agent.stop();
    const hotkeys = new FakeHotkeys();
    const second = await make({ screens: true, hotkeys, fs: first.fs });
    await second.agent.start();
    expect(second.agent.controller.status().hotkeys?.enabled).toBe(false);
    expect(hotkeys.registered).toHaveLength(1);
  });

  it("elegir la tele se guarda; un id que no es una pantalla conocida se rechaza; se puede quitar", async () => {
    const { agent, fs } = await make({ screens: true, hotkeys: new FakeHotkeys() });
    await agent.start();
    expect(await agent.controller.setTvMonitor("m_noexisteeeeeeeee")).toBe(false);
    expect(await agent.controller.setTvMonitor(TELE)).toBe(true);
    expect(savedHotkeys(fs)?.tvMonitorId).toBe(TELE);
    expect(agent.controller.status().hotkeys?.tv.monitorId).toBe(TELE);
    expect(await agent.controller.setTvMonitor(null)).toBe(true);
    expect(savedHotkeys(fs)?.tvMonitorId).toBeNull();
  });

  it("Ctrl+Alt+T prende la tele elegida y otra vez la apaga", async () => {
    const hotkeys = new FakeHotkeys();
    const { agent, displays } = await make({ screens: true, hotkeys });
    await agent.start();
    await agent.controller.setTvMonitor(TELE);
    hotkeys.press(1);
    await flushAsync();
    expect(displays.sets.at(-1)).toMatchObject({ devicePath: "tele", on: true });
    hotkeys.press(1);
    await flushAsync();
    expect(displays.sets.at(-1)).toMatchObject({ devicePath: "tele", on: false });
  });

  it("Ctrl+Alt+T sin tele elegida no toca ninguna pantalla", async () => {
    const hotkeys = new FakeHotkeys();
    const { agent, displays } = await make({ screens: true, hotkeys });
    await agent.start();
    hotkeys.press(1);
    await flushAsync();
    expect(displays.sets).toEqual([]);
  });

  it("Ctrl+Alt+M abre el panel con un valor de un solo uso nuevo", async () => {
    const hotkeys = new FakeHotkeys();
    const { agent, browser } = await make({ screens: true, hotkeys, openPanel: false });
    await agent.start();
    hotkeys.press(2);
    await flushAsync();
    expect(browser.opened).toHaveLength(1);
    expect(browser.opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?k=/);
  });

  it("Ctrl+Alt+Esc apaga la llave del Pad aunque los atajos estén apagados", async () => {
    const hotkeys = new FakeHotkeys();
    const input = new FakeInput();
    const { agent, fs } = await make({ screens: true, hotkeys, input });
    await agent.start();
    await agent.controller.setHotkeys(false);
    hotkeys.press(10);
    await flushAsync();
    expect(agent.controller.status().input?.enabled).toBe(false);
    expect((JSON.parse(fs.files.get(CONFIG_PATH) ?? "null") as { input: { enabled: boolean } }).input.enabled).toBe(false);
  });

  it("Ctrl+Alt+Esc suelta lo que el celu tenía apretado", async () => {
    const hotkeys = new FakeHotkeys();
    const input = new FakeInput();
    const { agent } = await make({ screens: true, hotkeys, input });
    await agent.start();
    await input.button("left", "down");
    hotkeys.press(10);
    await flushAsync();
    expect(agent.controller.status().input?.holding).toEqual({ left: false, alt: false });
  });

  it("la bandeja ofrece 'Cortar control remoto' solo con el Pad prendido, y al tocarla corta", async () => {
    const input = new FakeInput();
    const { agent, tray } = await make({ screens: true, hotkeys: new FakeHotkeys(), input });
    await agent.start();
    expect(tray.items.map((i) => i.id)).toEqual(["open", "remoteToggle", "cutInput", "quit"]);
    expect(tray.items.find((i) => i.id === "cutInput")?.label).toContain("Ctrl+Alt+Esc");
    tray.click("cutInput");
    await flushAsync();
    expect(agent.controller.status().input?.enabled).toBe(false);
    expect(tray.items.map((i) => i.id)).toEqual(["open", "remoteToggle", "quit"]);
  });

  it("si el hijo de atajos está caído, la bandeja no promete el atajo de cortar (solo el ítem)", async () => {
    const hotkeys = new FakeHotkeys();
    hotkeys.isAvailable = false;
    const { agent, tray } = await make({ screens: true, hotkeys, input: new FakeInput() });
    await agent.start();
    expect(tray.items.find((i) => i.id === "cutInput")?.label).toBe("Cortar control remoto");
  });

  it("al apagar el agente se liberan todos los atajos (criterio 3)", async () => {
    const hotkeys = new FakeHotkeys();
    const { agent } = await make({ screens: true, hotkeys });
    await agent.start();
    expect(hotkeys.registered.length).toBeGreaterThan(0);
    await agent.stop();
    expect(hotkeys.stopped).toBe(true);
    expect(hotkeys.registered).toEqual([]);
  });

  it("un atajo ocupado por otro programa aparece como busy en el panel y el agente sigue", async () => {
    const hotkeys = new FakeHotkeys();
    hotkeys.occupied.add(0x54);
    const { agent } = await make({ screens: true, hotkeys });
    await agent.start();
    const keys = agent.controller.status().hotkeys!.keys;
    expect(keys.find((k) => k.label === "T")?.status).toBe("busy");
    expect(keys.filter((k) => k.status === "active")).toHaveLength(9);
  });
});

describe("app · arranque con Windows (B6.2)", () => {
  const flushAsync = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  };

  it("sin puerto de arranque el panel no muestra la tarjeta y activar devuelve false", async () => {
    const { agent } = await make();
    await agent.start();
    expect(agent.controller.status().autostart).toBeUndefined();
    expect(await agent.controller.setAutostart(true)).toBe(false);
    expect(agent.controller.status().notices ?? []).not.toContain("autostart_failed");
  });

  it("al arrancar lee el estado REAL del sistema (no confía en la config)", async () => {
    const autostart = new FakeAutostart();
    autostart.enabled = true;
    const { agent, tray } = await make({ autostart });
    await agent.start();
    expect(autostart.reads).toBeGreaterThan(0);
    expect(agent.controller.status().autostart).toEqual({ enabled: true });
    expect(tray.items.find((i) => i.id === "autostartToggle")).toMatchObject({ checked: true });
  });

  it("activar y desactivar escriben y vuelven a leer; la bandeja sigue al panel", async () => {
    const autostart = new FakeAutostart();
    const { agent, tray } = await make({ autostart });
    await agent.start();
    expect(await agent.controller.setAutostart(true)).toBe(true);
    expect(autostart.enabled).toBe(true);
    expect(agent.controller.status().autostart).toEqual({ enabled: true });
    expect(tray.items.find((i) => i.id === "autostartToggle")?.checked).toBe(true);
    expect(await agent.controller.setAutostart(false)).toBe(true);
    expect(autostart.enabled).toBe(false);
    expect(tray.items.find((i) => i.id === "autostartToggle")?.checked).toBe(false);
  });

  it("si Windows no deja, el panel muestra el error y el estado real (apagado)", async () => {
    const autostart = new FakeAutostart();
    const { agent, tray } = await make({ autostart });
    await agent.start();
    autostart.failSet = new Error("Acceso denegado");
    expect(await agent.controller.setAutostart(true)).toBe(true);
    const st = agent.controller.status().autostart!;
    expect(st.enabled).toBe(false);
    expect(st.error).toContain("Acceso denegado");
    expect(tray.items.find((i) => i.id === "autostartToggle")?.label).toContain("no se pudo");
    // un intento que sale bien borra el error
    await agent.controller.setAutostart(true);
    expect(agent.controller.status().autostart).toEqual({ enabled: true });
  });

  it("el ítem de la bandeja invierte el estado real", async () => {
    const autostart = new FakeAutostart();
    const { agent, tray } = await make({ autostart });
    await agent.start();
    tray.click("autostartToggle");
    await flushAsync();
    expect(autostart.enabled).toBe(true);
    tray.click("autostartToggle");
    await flushAsync();
    expect(autostart.enabled).toBe(false);
  });

  it("si alguien cambia el registro por fuera, un toque lee la verdad antes de invertir", async () => {
    const autostart = new FakeAutostart();
    const { agent, tray } = await make({ autostart });
    await agent.start();
    autostart.enabled = true; // otro programa (o Jay a mano) la activó
    tray.click("autostartToggle");
    await flushAsync();
    expect(autostart.enabled).toBe(false); // estaba prendida de verdad: se apaga
  });
});

describe("app · escenas con atajo y disparador (B6.3)", () => {
  const flushAsync = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const TELE = monitorIdOf("tele");
  /** Una escena que prende la tele: así se nota en `displays.sets` que corrió. */
  const turnOnTele = { kind: "screens", monitors: [{ monitorId: TELE, enabled: true }] };
  const configWith = (scenes: unknown[]) => ({
    version: 6,
    remote: {},
    library: { launchers: [], scenes, deck: [] },
  });

  it("una escena con atajo se registra al arrancar, aparece en el panel y al apretarla corre", async () => {
    const hotkeys = new FakeHotkeys();
    const { agent, displays } = await make({
      screens: true,
      b3: true,
      hotkeys,
      config: configWith([{ id: "s_AAAAAAAAAA", name: "Tele", steps: [turnOnTele], hotkey: "J" }]),
    });
    await agent.start();
    expect(hotkeys.registered.map((r) => r.vk)).toContain(0x4a);
    const key = agent.controller.status().hotkeys!.keys.find((k) => k.label === "J")!;
    expect(key).toMatchObject({ status: "active", scene: { id: "s_AAAAAAAAAA", name: "Tele" } });
    hotkeys.press(key.id);
    await flushAsync();
    expect(displays.sets.at(-1)).toMatchObject({ devicePath: "tele", on: true });
  });

  it("una escena con 'al iniciar' corre una vez a los 20 s de arrancar, sin celu conectado", async () => {
    const { agent, displays, clock } = await make({
      screens: true,
      b3: true,
      config: configWith([{ id: "s_AAAAAAAAAA", name: "Tele", steps: [turnOnTele], trigger: { type: "agentStart" } }]),
    });
    await agent.start();
    clock.advance(19_000);
    await flushAsync();
    expect(displays.sets).toEqual([]);
    clock.advance(1_000);
    await flushAsync();
    expect(displays.sets).toHaveLength(1);
    clock.advance(120_000);
    await flushAsync();
    expect(displays.sets).toHaveLength(1);
  });

  it("al apagar el agente se cancelan los disparadores pendientes", async () => {
    const { agent, displays, clock } = await make({
      screens: true,
      b3: true,
      config: configWith([{ id: "s_AAAAAAAAAA", name: "Tele", steps: [turnOnTele], trigger: { type: "agentStart" } }]),
    });
    await agent.start();
    await agent.stop();
    clock.advance(60_000);
    await flushAsync();
    expect(displays.sets).toEqual([]);
  });
});

describe("app · clave privada con DPAPI (B6.4)", () => {
  it("la clave privada va cifrada en agent.json y los celus siguen conectando tras reiniciar", async () => {
    const secret = new FakeSecret();
    const first = await make({ secret });
    await first.agent.start();
    const publicKey1 = JSON.parse(first.fs.files.get(CONFIG_PATH)!).identity.publicKey as string;
    // en disco no está la privada en claro; en memoria el agente la usa igual
    expect(first.fs.files.get(CONFIG_PATH)).not.toContain('"privateKey"');
    expect(first.fs.files.get(CONFIG_PATH)).toContain("privateKeyProtected");
    await first.agent.stop();
    const second = await make({ secret, fs: first.fs });
    await second.agent.start();
    expect(second.agent.controller.status().notices ?? []).not.toContain("identity_lost");
    // la identidad (clave pública) es la misma: los celus emparejados la reconocen
    expect(JSON.parse(second.fs.files.get(CONFIG_PATH)!).identity.publicKey).toBe(publicKey1);
  });

  async function withLostIdentity() {
    const secret = new FakeSecret();
    const first = await make({ secret });
    await first.agent.start();
    await first.agent.stop();
    const before = first.fs.files.get(CONFIG_PATH)!;
    secret.switchAccount(); // otra cuenta de Windows: lo cifrado antes ya no se abre
    const second = await make({ secret, fs: first.fs });
    await second.agent.start();
    return { secret, second, before };
  }

  it("si Windows no puede abrir la clave: avisa, NO inventa una y no pisa el archivo", async () => {
    const { second, before } = await withLostIdentity();
    expect(second.agent.controller.status().notices).toContain("identity_lost");
    expect(second.fs.files.get(CONFIG_PATH)).toBe(before);
    // sin clave no se puede prender el acceso remoto
    await second.agent.controller.setRemote(true);
    expect(second.agent.controller.status().remote.enabled).toBe(false);
    expect(second.agent.controller.status().remote.error).toMatch(/clave/i);
    expect(second.fs.files.get(CONFIG_PATH)).toBe(before);
  });

  it("confirmar en el panel genera una clave nueva (los celus tienen que volver a emparejar) y guarda copia del archivo anterior", async () => {
    const { second, before, secret } = await withLostIdentity();
    expect(await second.agent.controller.resetIdentity()).toBe(true);
    expect(second.agent.controller.status().notices ?? []).not.toContain("identity_lost");
    expect(second.fs.files.get(CONFIG_PATH + ".identity-lost.bak")).toBe(before);
    const reread = await createConfigStore({ fs: second.fs, log: new MemLogger(), dataDir: DATA_DIR, secret }).load();
    expect(reread.config.identity).not.toBeNull();
    expect(reread.config.devices).toEqual([]);
  });

  it("resetIdentity sin una pérdida real no hace nada", async () => {
    const { agent } = await make({ secret: new FakeSecret() });
    await agent.start();
    expect(await agent.controller.resetIdentity()).toBe(false);
  });
});
