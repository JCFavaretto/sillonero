import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Hs1Payload } from "@proyecto-e/protocol";
import { createCatalog } from "../src/apps/catalog";
import { createExtras } from "../src/apps/extras";
import { createIcons } from "../src/apps/icons";
import { createLaunchService } from "../src/apps/launch";
import { createLibraryService } from "../src/apps/library";
import { createWindowsService } from "../src/apps/windowsService";
import { createPairing } from "../src/pairing/pairing";
import { createRemoteServer, type RemoteServer } from "../src/remote/server";
import { createRateLimiter } from "../src/security/rateLimit";
import { createScreensService } from "../src/screens/service";
import { createSampler } from "../src/state/system";
import type { Device } from "../src/config/schema";
import { FakeCatalog, FakeClock, FakeDisplays, FakeIconExtractor, FakeLauncher, FakeRandom, FakeSystemInfo, FakeWindows, MemFs, MemLogger } from "./fakes";
import { createPhone, newKeyPair, testRandom, type Incoming } from "./phone";

// B3 de punta a punta: `ws` real, canal cifrado real y los servicios de ventanas, lanzadores y escenas con fakes de Windows.

const PC = newKeyPair();
const CONNECT: Hs1Payload = { intent: "connect", appVersion: "0.1.0" };
let servers: RemoteServer[] = [];
let sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets) s.terminate();
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
  sockets = [];
});

async function boot() {
  const clock = new FakeClock();
  const log = new MemLogger();
  const displays = new FakeDisplays();
  const fw = new FakeWindows();
  fw.all = [
    { handle: "0x1", title: "PLAN.md", exe: "Code.exe", className: "C", rect: { x: 10, y: 10, w: 800, h: 600 }, state: "normal", pid: 1, exePath: "C:\\Code.exe", focused: true, fullscreen: false },
  ];
  const screens = createScreensService({ displays, windows: fw, log });
  const fs = new MemFs();
  const icons = createIcons({ extractor: new FakeIconExtractor(fs), fs, dir: "icons" });
  const catalog = createCatalog({ source: new FakeCatalog(), clock });
  const windows = createWindowsService({ windows: fw, screens, log, onIcon: (k, p) => icons.register(k, p) });
  let lib: ReturnType<typeof library.state> = { launchers: [], scenes: [], deck: [] };
  const library = createLibraryService({ store: { get: () => lib, save: async (n) => void (lib = n) }, catalog, icons, random: new FakeRandom(), log });
  const extras = createExtras({
    windows,
    screens,
    library,
    catalog,
    icons,
    clock,
    random: new FakeRandom(),
    log,
    launch: createLaunchService({ windows, port: fw, launcher: new FakeLauncher(), screens, clock, log }),
  });
  const devices: Device[] = [];
  const pairing = createPairing({ clock, random: new FakeRandom(), log, remoteEnabled: true, saveDevice: async (d) => void devices.push(d) });
  const server = createRemoteServer({
    clock,
    log,
    sampler: createSampler({ sys: new FakeSystemInfo(), clock, agentVersion: "0.1.0" }),
    screens,
    extras,
    pairing,
    limiter: createRateLimiter({ clock }),
    host: "127.0.0.1",
    allowLoopback: true,
    identity: () => PC,
    random: testRandom,
    lookupDevice: (k) => {
      const d = devices.find((x) => x.publicKey === k);
      return d ? { status: "ok", device: d } : { status: "unknown" };
    },
    unpair: async () => undefined,
    onAuthenticated: () => undefined,
  });
  servers.push(server);
  const { port } = await server.start(0);
  return { port, pairing, library };
}

function open(port: number, phone: ReturnType<typeof createPhone>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  const queue: string[] = [];
  const waiters: ((m: string) => void)[] = [];
  ws.on("message", (d) => {
    const text = d.toString();
    const w = waiters.shift();
    if (w) w(text);
    else queue.push(text);
  });
  const raw = () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise<string>((r) => waiters.push(r)));
  const next = async (): Promise<Incoming> => phone.read([await raw()])[0]!;
  return { ws, next, opened: new Promise<void>((r) => ws.once("open", () => r())) };
}

async function connectPaired(t: Awaited<ReturnType<typeof boot>>) {
  const kp = newKeyPair();
  const p1 = createPhone(PC.publicKey, kp);
  const a = open(t.port, p1);
  await a.opened;
  a.ws.send(p1.hello({ intent: "pair", code: t.pairing.start()!.code, deviceName: "Pixel", platform: "android", appVersion: "0.1.0" }));
  await a.next();
  await a.next();
  await t.pairing.allow();
  await a.next();
  const p2 = createPhone(PC.publicKey, kp);
  const b = open(t.port, p2);
  await b.opened;
  b.ws.send(p2.hello(CONNECT));
  await b.next();
  b.ws.send(p2.send("ping", {}));
  return { ...b, send: (type: string, payload: Record<string, unknown>) => b.ws.send(p2.send(type, payload)) };
}

/** Lee mensajes hasta encontrar uno del tipo pedido (los snapshots llegan en orden no fijo). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function until(c: { next(): Promise<Incoming> }, type: string): Promise<any> {
  for (let i = 0; i < 30; i++) {
    const m = await c.next();
    if (m.type === type) return m;
  }
  throw new Error("no llegó " + type);
}

describe("B3 por el cable cifrado", () => {
  it("tras conectar llegan windows.snapshot y library.snapshot", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const w = await until(c, "windows.snapshot");
    expect(w.payload.windows).toMatchObject([{ title: "PLAN.md", app: "Code", focused: true }]);
    expect((await until(c, "library.snapshot")).payload).toEqual({ launchers: [], scenes: [], deck: [] });
  });

  it("apps.search → apps.results; lanzador → library.update; command.result", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "library.snapshot");
    c.send("apps.search", { query: "disc" });
    const r = await until(c, "apps.results");
    expect(r.payload).toMatchObject({ total: 1, items: [{ name: "Discord" }] });
    c.send("launcher.add", { target: { kind: "app", appId: r.payload.items[0].appId }, name: null });
    expect((await until(c, "library.update")).payload.launchers).toHaveLength(1);
    expect((await until(c, "command.result")).payload).toMatchObject({ ok: true });
  });

  it("un appId inventado: not_allowed por el cable", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    c.send("launcher.add", { target: { kind: "app", appId: "C:\\Windows\\System32\\cmd.exe" }, name: null });
    expect((await until(c, "command.result")).payload).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(t.library.state().launchers).toEqual([]);
  });

  it("una biblioteca de más de 16 KB llega entera al celu (el agente puede mandar hasta 60 KB)", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "library.snapshot");
    let last: { payload: { scenes: unknown[] } } | null = null;
    for (let i = 0; i < 24; i++) {
      const steps = Array.from({ length: 6 }, () => ({
        kind: "open",
        target: { kind: "url", url: "https://www.example.com/" + "a".repeat(60) },
        name: "Una pagina larga",
        iconKey: null,
        place: null,
      }));
      c.send("scene.save", { scene: { name: "Escena " + i, steps } });
      last = await until(c, "library.update");
      expect((await until(c, "command.result")).payload).toMatchObject({ ok: true });
    }
    expect(JSON.stringify(t.library.state()).length).toBeGreaterThan(16_384);
    expect(last!.payload.scenes).toHaveLength(24);
    expect(JSON.stringify(last!.payload).length).toBeLessThan(61_440);
  });

  it("un mensaje del celu de más de 16 KB corta la conexión", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const closed = new Promise<number>((r) => c.ws.once("close", (code) => r(code)));
    c.send("apps.search", { query: "x".repeat(20_000) });
    // ws corta el marco enorme (1009) antes de que la sesión lo mire (4000): en los dos casos la conexión se corta.
    expect([1009, 4000]).toContain(await closed);
  });
});

describe("B3: límite por sesión", () => {
  it("más de 30 mensajes de B3 por segundo: los que sobran reciben busy y no se ejecutan", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "library.snapshot");
    for (let i = 0; i < 40; i++) c.send("apps.search", { query: "a" });
    let busy = 0;
    for (let i = 0; i < 60 && busy < 10; i++) {
      const m = await c.next();
      if (m.type === "command.result" && !m.payload.ok && m.payload.reason === "busy") busy++;
    }
    expect(busy).toBe(10);
  });
});
