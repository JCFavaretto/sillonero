import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { MAX_FRAME_BYTES, PING_INTERVAL_MS, STATE_INTERVAL_MS, type Hs1Payload } from "@proyecto-e/protocol";
import type { Device } from "../src/config/schema";
import { createPairing } from "../src/pairing/pairing";
import { createRemoteServer, type RemoteServer } from "../src/remote/server";
import { createRateLimiter } from "../src/security/rateLimit";
import { createScreensService, type ScreensService } from "../src/screens/service";
import type { Extras } from "../src/apps/extras";
import { createSampler } from "../src/state/system";
import { FakeClock, FakeDisplays, FakeRandom, FakeSystemInfo, FakeWindows, MemLogger } from "./fakes";
import { createPhone, newKeyPair, testRandom, type Incoming, type Phone } from "./phone";

// Servidor `ws` real en 127.0.0.1 con puerto 0 y un celu falso que habla Noise de verdad.
// El reloj es falso: los timers (auth, intervalo de 2 s, heartbeat) se disparan con clock.advance().

const PC = newKeyPair();
const CONNECT: Hs1Payload = { intent: "connect", appVersion: "0.1.0" };

class Client {
  readonly queue: string[] = [];
  private waiters: ((m: string) => void)[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly opened: Promise<void>;
  readonly ws: WebSocket;

  constructor(
    url: string,
    readonly phone: Phone,
    opts: { autoPong?: boolean; headers?: Record<string, string> } = {},
  ) {
    this.ws = new WebSocket(url, opts);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
      this.ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    this.opened.catch(() => undefined);
    this.closed = new Promise((resolve) => this.ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
    this.ws.on("message", (data) => {
      const text = data.toString();
      const w = this.waiters.shift();
      if (w) w(text);
      else this.queue.push(text);
    });
  }

  hello(payload: Hs1Payload): void {
    this.ws.send(this.phone.hello(payload));
  }
  send(type: string, payload: Record<string, unknown> = {}): void {
    this.ws.send(this.phone.send(type, payload));
  }
  nextRaw(): Promise<string> {
    const q = this.queue.shift();
    if (q !== undefined) return Promise.resolve(q);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  /** El próximo marco del agente, ya descifrado. */
  async next(): Promise<Incoming> {
    const [m] = this.phone.read([await this.nextRaw()]);
    return m!;
  }
}

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

let servers: RemoteServer[] = [];
let clients: Client[] = [];

async function setup(
  opts: {
    allowLoopback?: boolean;
    maxConnectionsPerIp?: number;
    maxConnections?: number;
    screens?: ScreensService;
    extras?: Extras;
    ownAddresses?: string[];
  } = {},
) {
  const clock = new FakeClock(Date.UTC(2026, 10, 6, 12, 0, 0));
  const log = new MemLogger();
  const sys = new FakeSystemInfo();
  const sampler = createSampler({ sys, clock, agentVersion: "0.1.0" });
  const limiter = createRateLimiter({ clock });
  const devices: Device[] = [];
  const revoked = new Set<string>();
  const unpaired: string[] = [];
  const pairing = createPairing({
    clock,
    random: new FakeRandom(),
    log,
    remoteEnabled: true,
    saveDevice: async (d) => void devices.push(d),
  });
  const seen: string[] = [];
  const server = createRemoteServer({
    clock,
    log,
    sampler,
    screens: opts.screens,
    extras: opts.extras,
    pairing,
    limiter,
    host: "127.0.0.1",
    allowLoopback: opts.allowLoopback ?? true,
    maxConnectionsPerIp: opts.maxConnectionsPerIp,
    maxConnections: opts.maxConnections,
    identity: () => PC,
    random: testRandom,
    ownAddresses: () => opts.ownAddresses ?? [],
    lookupDevice: (key) => {
      if (revoked.has(key)) return { status: "revoked" };
      const device = devices.find((d) => d.publicKey === key);
      return device ? { status: "ok", device } : { status: "unknown" };
    },
    unpair: async (id) => {
      unpaired.push(id);
      const i = devices.findIndex((d) => d.id === id);
      if (i >= 0) devices.splice(i, 1);
    },
    onAuthenticated: (d) => void seen.push(d.id),
  });
  servers.push(server);
  const { port } = await server.start(0);
  const url = `ws://127.0.0.1:${port}`;
  const connect = async (phone: Phone = createPhone(PC.publicKey), o?: { autoPong?: boolean; headers?: Record<string, string> }) => {
    const c = new Client(url, phone, o);
    clients.push(c);
    await c.opened.catch(() => undefined);
    return c;
  };
  return { clock, log, sys, pairing, devices, revoked, unpaired, server, port, url, connect, seen };
}

type T = Awaited<ReturnType<typeof setup>>;

/** Empareja un celu de punta a punta y devuelve su identidad (la clave del celu) y el id que le dio la PC. */
async function pairDevice(t: T) {
  const phone = createPhone(PC.publicKey);
  const c = await t.connect(phone);
  c.hello({ intent: "pair", code: t.pairing.start()!.code, deviceName: "Pixel de Jay", platform: "android", appVersion: "0.1.0" });
  expect(await c.next()).toMatchObject({ type: "hs2", payload: { ok: true } });
  expect((await c.next()).type).toBe("pair.pending");
  await t.pairing.allow();
  const result = await c.next();
  if (result.type !== "pair.result" || !result.payload.ok) throw new Error("no se emparejó");
  expect((await c.closed).code).toBe(4005);
  return { keyPair: phone.keyPair, deviceId: result.payload.deviceId };
}

/** Conecta con la identidad ya emparejada y deja la sesión autenticada (hs2, auth.ok y state.snapshot leídos). */
async function authedClient(t: T, keyPair: Phone["keyPair"], opts?: { autoPong?: boolean }) {
  const c = await t.connect(createPhone(PC.publicKey, keyPair), opts);
  c.hello(CONNECT);
  await c.next(); // hs2
  c.send("ping"); // confirma que tiene la clave: recién ahí la PC lo da por conectado
  await c.next(); // auth.ok
  await c.next(); // state.snapshot
  return c;
}

beforeEach(() => {
  servers = [];
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  await Promise.all(servers.map((s) => s.stop()));
});

describe("servidor WebSocket · punta a punta (cifrado)", () => {
  it("pair → permitir → connect → snapshot → update a los 2 s → ping/pong", async () => {
    const t = await setup();
    t.sys.host = "PC-DE-JAY";
    const { keyPair, deviceId } = await pairDevice(t);
    expect(t.devices).toHaveLength(1);
    expect(t.devices[0]!.publicKey).toBeTruthy();
    expect(Object.keys(t.devices[0]!)).not.toContain("tokenHash");

    const c = await t.connect(createPhone(PC.publicKey, keyPair));
    c.hello(CONNECT);
    expect(await c.next()).toMatchObject({ type: "hs2", payload: { ok: true, pcName: "PC-DE-JAY" } });
    c.send("ping"); // confirma la clave
    expect(await c.next()).toMatchObject({ type: "auth.ok", payload: { pcName: "PC-DE-JAY" } });
    expect(await c.next()).toMatchObject({ type: "state.snapshot", payload: { hostname: "PC-DE-JAY" } });
    expect(t.seen).toEqual([deviceId]);
    expect(t.server.sessionCount()).toBe(1);

    t.sys.freeMem = 1_000;
    t.clock.advance(STATE_INTERVAL_MS);
    const update = await c.next();
    expect(update.type).toBe("state.update");
    if (update.type === "state.update") expect(update.payload.memTotalBytes - update.payload.memUsedBytes).toBe(1_000);

    c.send("ping");
    expect((await c.next()).type).toBe("pong");
  });

  it("lo que viaja por el cable no deja ver el nombre de la PC ni el estado", async () => {
    const t = await setup();
    t.sys.host = "NOMBRE-RECONOCIBLE-PC";
    const { keyPair } = await pairDevice(t);
    const c = await t.connect(createPhone(PC.publicKey, keyPair));
    c.hello(CONNECT);
    const hs2 = await c.nextRaw();
    c.phone.read([hs2]);
    c.send("ping"); // confirma la clave
    const raw: string[] = [hs2];
    for (let i = 0; i < 2; i++) raw.push(await c.nextRaw());
    expect(raw.join("")).not.toContain("NOMBRE-RECONOCIBLE-PC");
    expect(raw.join("")).not.toContain("hostname");
  });

  it("con pantallas: snapshot al conectar y update cuando cambia la ventana activa", async () => {
    const displays = new FakeDisplays();
    const windows = new FakeWindows();
    displays.raw = [
      { devicePath: "izq", friendlyName: "DELL", outputTechnology: 10, active: true, primary: true, gdiName: null, bounds: { x: 0, y: 0, w: 1920, h: 1080 }, workArea: null },
    ];
    windows.win = { handle: "1", title: "PLAN.md", exe: "Code.exe", className: "X", rect: { x: 10, y: 10, w: 500, h: 400 }, state: "normal" };
    const screens = createScreensService({ displays, windows, log: new MemLogger() });
    const t = await setup({ screens });
    const { keyPair } = await pairDevice(t);

    const c = await t.connect(createPhone(PC.publicKey, keyPair));
    c.hello(CONNECT);
    expect((await c.next()).type).toBe("hs2");
    c.send("ping"); // confirma la clave
    expect((await c.next()).type).toBe("auth.ok");
    expect((await c.next()).type).toBe("state.snapshot");
    const snap = await c.next();
    expect(snap).toMatchObject({ type: "screens.snapshot", payload: { foreground: { title: "PLAN.md" } } });
    if (snap.type === "screens.snapshot") expect(snap.payload.monitors).toHaveLength(1);

    windows.win = { ...windows.win, title: "Otra cosa.txt" };
    t.clock.advance(STATE_INTERVAL_MS);
    const kinds: string[] = [];
    let update: Incoming | undefined;
    for (let i = 0; i < 2; i++) {
      const m = await c.next();
      kinds.push(m.type);
      if (m.type === "screens.update") update = m;
    }
    expect(kinds.sort()).toEqual(["screens.update", "state.update"]);
    expect(update).toMatchObject({ payload: { foreground: { title: "Otra cosa.txt" } } });
  });

  it("broadcastScreens: el cambio llega a todos los celus conectados, no solo al que lo pidió", async () => {
    const t = await setup();
    const one = await pairDevice(t);
    const two = await pairDevice(t);
    const a = await authedClient(t, one.keyPair);
    const b = await authedClient(t, two.keyPair);
    const state = { monitors: [], foreground: { title: "Nueva", app: "x.exe", monitorId: null } };
    t.server.broadcastScreens(state);
    expect(await a.next()).toMatchObject({ type: "screens.update", payload: state });
    expect(await b.next()).toMatchObject({ type: "screens.update", payload: state });
  });

  it("un hs1 reenviado (replay) no queda en línea ni anota lastSeenAt, y a los 5 s se lo corta", async () => {
    const t = await setup();
    const { keyPair } = await pairDevice(t);
    const victim = createPhone(PC.publicKey, keyPair);
    const captured = victim.hello(CONNECT); // lo que viaja por el Wi-Fi y cualquiera puede copiar
    const attacker = await t.connect(createPhone(PC.publicKey));
    attacker.ws.send(captured);
    await tick();
    expect(t.seen).toEqual([]);
    expect(t.server.isConnected(t.devices[0]!.id)).toBe(false);
    t.clock.advance(5_000);
    expect((await attacker.closed).code).toBe(4001);
    expect(t.seen).toEqual([]);
  });

  it("un celu desconocido (clave que nunca se emparejó) recibe hs2 unknown_device y 4002", async () => {
    const t = await setup();
    const c = await t.connect();
    c.hello(CONNECT);
    expect(await c.next()).toMatchObject({ type: "hs2", payload: { ok: false, reason: "unknown_device" } });
    expect((await c.closed).code).toBe(4002);
  });

  it("revocar con la sesión abierta la corta con 4003", async () => {
    const t = await setup();
    const { keyPair, deviceId } = await pairDevice(t);
    const c = await authedClient(t, keyPair);
    t.server.revoke(deviceId);
    expect((await c.closed).code).toBe(4003);
    await tick();
    expect(t.server.sessionCount()).toBe(0);
  });

  it("un dispositivo revocado que vuelve a conectar recibe hs2 revoked y 4003", async () => {
    const t = await setup();
    const { keyPair } = await pairDevice(t);
    t.revoked.add(createPhone(PC.publicKey, keyPair).publicKey);
    const c = await t.connect(createPhone(PC.publicKey, keyPair));
    c.hello(CONNECT);
    expect(await c.next()).toMatchObject({ type: "hs2", payload: { ok: false, reason: "revoked" } });
    expect((await c.closed).code).toBe(4003);
  });

  it("Olvidar desde el celu (device.unpair): la PC borra el dispositivo y cierra con 1000", async () => {
    const t = await setup();
    const { keyPair, deviceId } = await pairDevice(t);
    const c = await authedClient(t, keyPair);
    c.send("device.unpair");
    expect((await c.closed).code).toBe(1000);
    expect(t.unpaired).toEqual([deviceId]);
    expect(t.devices).toHaveLength(0);
    const again = await t.connect(createPhone(PC.publicKey, keyPair));
    again.hello(CONNECT);
    expect(await again.next()).toMatchObject({ type: "hs2", payload: { ok: false, reason: "unknown_device" } });
  });

  it("remoto off: stop() cierra las sesiones con 1001 y deja de escuchar", async () => {
    const t = await setup();
    const { keyPair } = await pairDevice(t);
    const c = await authedClient(t, keyPair);

    await t.server.stop();
    expect((await c.closed).code).toBe(1001);
    expect(t.server.sessionCount()).toBe(0);
    expect(t.clock.pendingTimers()).toBe(0);

    const late = new Client(t.url, createPhone(PC.publicKey));
    clients.push(late);
    await expect(late.opened).rejects.toThrow();
  });

  it("stop() es idempotente y se puede volver a arrancar", async () => {
    const t = await setup();
    await t.server.stop();
    await t.server.stop();
    const { port } = await t.server.start(0);
    const c = new Client(`ws://127.0.0.1:${port}`, createPhone(PC.publicKey));
    clients.push(c);
    await c.opened;
  });

  it("IP que no es privada: cierra con 4009 (allowLoopback apagado)", async () => {
    const t = await setup({ allowLoopback: false });
    const c = await t.connect();
    expect((await c.closed).code).toBe(4009);
    await tick();
    expect(t.server.sessionCount()).toBe(0);
  });

  it("marco de más de 24 KB: cierra con 1009", async () => {
    const t = await setup();
    const c = await t.connect();
    c.ws.send("x".repeat(MAX_FRAME_BYTES + 1));
    expect((await c.closed).code).toBe(1009);
  });

  it("mensaje binario: cierra con 4000 sin responder", async () => {
    const t = await setup();
    const c = await t.connect();
    c.ws.send(Buffer.from([1, 2, 3]));
    expect((await c.closed).code).toBe(4000);
    expect(c.queue).toEqual([]);
  });

  it("5 s sin hablar: 4001", async () => {
    const t = await setup();
    const c = await t.connect();
    t.clock.advance(5_000);
    expect((await c.closed).code).toBe(4001);
  });

  it("un celu de B1 (mensaje v:1 en claro) recibe 4004", async () => {
    const t = await setup();
    const c = await t.connect();
    c.ws.send(JSON.stringify({ v: 1, id: "c1", type: "auth.hello", payload: { deviceId: "x", token: "y", appVersion: "0.1.0" } }));
    expect((await c.closed).code).toBe(4004);
  });

  it("un EADDRINUSE sube como error de start()", async () => {
    const t = await setup();
    const other = createRemoteServer({
      clock: t.clock,
      log: t.log,
      sampler: createSampler({ sys: t.sys, clock: t.clock, agentVersion: "0.1.0" }),
      pairing: t.pairing,
      limiter: createRateLimiter({ clock: t.clock }),
      host: "127.0.0.1",
      allowLoopback: true,
      identity: () => PC,
      random: testRandom,
      lookupDevice: () => ({ status: "unknown" }),
      unpair: async () => undefined,
      onAuthenticated: () => undefined,
    });
    servers.push(other);
    await expect(other.start(t.port)).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});

describe("servidor WebSocket · Origin (D14)", () => {
  it("una página web (Origin ajeno) no puede abrir el socket: 403", async () => {
    const t = await setup();
    const c = await t.connect(createPhone(PC.publicKey), { headers: { Origin: "http://evil.com" } });
    await expect(c.opened).rejects.toThrow(/403/);
    expect(t.server.sessionCount()).toBe(0);
    expect(t.log.entries.some((e) => e.msg.includes("origin rejected"))).toBe(true);
  });

  it("sin Origin (la app) pasa", async () => {
    const t = await setup();
    const c = await t.connect();
    await c.opened;
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("con el Origin que arma React Native (http://<IP propia>:<puerto>) pasa", async () => {
    const t = await setup({ ownAddresses: ["192.168.100.5"] });
    const c = await t.connect(createPhone(PC.publicKey), { headers: { Origin: `http://192.168.100.5:${t.port}` } });
    await c.opened;
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("la IP propia pero con otro puerto no pasa", async () => {
    const t = await setup({ ownAddresses: ["192.168.100.5"] });
    const c = await t.connect(createPhone(PC.publicKey), { headers: { Origin: "http://192.168.100.5:47801" } });
    await expect(c.opened).rejects.toThrow(/403/);
  });
});

describe("servidor WebSocket · tope de conexiones", () => {
  it("por IP: las que pasan del tope se cortan enseguida y las anteriores siguen", async () => {
    const t = await setup({ maxConnectionsPerIp: 2 });
    const a = await t.connect();
    const b = await t.connect();
    const c = await t.connect();
    expect((await c.closed).code).toBe(1006);
    expect(t.server.sessionCount()).toBe(2);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("al cerrarse una, entra otra", async () => {
    const t = await setup({ maxConnectionsPerIp: 1 });
    const a = await t.connect();
    a.ws.close();
    await a.closed;
    await tick();
    const b = await t.connect();
    await tick();
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
    expect(t.server.sessionCount()).toBe(1);
  });

  it("total: pasado el tope global no entra nadie más", async () => {
    const t = await setup({ maxConnections: 1, maxConnectionsPerIp: 10 });
    await t.connect();
    const second = await t.connect();
    expect((await second.closed).code).toBe(1006);
    expect(t.server.sessionCount()).toBe(1);
  });
});

describe("servidor WebSocket · heartbeat", () => {
  it("un celu que contesta los ping de ws sigue conectado", async () => {
    const t = await setup();
    const { keyPair } = await pairDevice(t);
    const c = await authedClient(t, keyPair);
    for (let i = 0; i < 4; i++) {
      t.clock.advance(PING_INTERVAL_MS);
      await tick();
    }
    expect(t.server.sessionCount()).toBe(1);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("un celu muerto (no contesta los ping) se corta", async () => {
    const t = await setup();
    const { keyPair } = await pairDevice(t);
    const c = await authedClient(t, keyPair, { autoPong: false });
    t.clock.advance(PING_INTERVAL_MS); // primer ping: queda sin pong
    await tick();
    expect(t.server.sessionCount()).toBe(1);
    t.clock.advance(PING_INTERVAL_MS); // segundo intervalo: se corta
    const closed = await c.closed;
    expect(closed.code).toBe(1006); // corte sin handshake, no un cierre 4xxx de la sesión
    await tick();
    expect(t.server.sessionCount()).toBe(0);
  });
});
