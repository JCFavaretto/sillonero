import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Hs1Payload } from "@proyecto-e/protocol";
import { createCatalog } from "../src/apps/catalog";
import { createExtras } from "../src/apps/extras";
import { createIcons } from "../src/apps/icons";
import { createLaunchService } from "../src/apps/launch";
import { createLibraryService } from "../src/apps/library";
import { createWindowsService } from "../src/apps/windowsService";
import { createAudioService } from "../src/audio/service";
import { emptyAudioConfig, type AudioConfig } from "../src/config/schema";
import { createPairing } from "../src/pairing/pairing";
import { createRemoteServer, type RemoteServer } from "../src/remote/server";
import { createRateLimiter } from "../src/security/rateLimit";
import { createScreensService } from "../src/screens/service";
import { createSampler } from "../src/state/system";
import type { Device } from "../src/config/schema";
import { FakeAudio, FakeCatalog, FakeClock, FakeMediaKeys, FakeDisplays, FakeIconExtractor, FakeLauncher, FakeRandom, FakeSystemInfo, FakeWindows, MemFs, MemLogger } from "./fakes";
import { createPhone, newKeyPair, testRandom, type Incoming } from "./phone";

// B4 de punta a punta: `ws` real, canal cifrado real y el servicio de audio con un Windows falso.

const HYPER = "{0.0.0.00000000}.{ac5e7cd6-f17f-412f-9e42-9c3a070138e5}";
const REALTEK = "{0.0.0.00000000}.{a5e5c614-b9b1-45f4-81fa-f75f82fccb0a}";
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
  const audio = new FakeAudio();
  audio.raw = {
    outputs: [
      { winId: HYPER, name: "HyperX", formFactor: 1, volume: 0.46, muted: false },
      { winId: REALTEK, name: "Realtek", formFactor: 1, volume: 0.3, muted: false },
    ],
    sessions: [{ pid: 100, exePath: "C:\\Chrome\\chrome.exe", winOutputId: HYPER, volume: 1, muted: false, peak: 0.4, routedWinId: null }],
    defaultWinId: HYPER,
    media: [{ aumid: "chrome.exe", index: 0, title: "Un video", artist: "Canal", status: "playing", controls: { prev: false, playPause: true, next: false }, hasArt: true, isCurrent: true }],
  };
  audio.arts.set("chrome.exe", "/9j/AAA=");
  const keys = new FakeMediaKeys();
  let cfg: AudioConfig = emptyAudioConfig();
  const audioService = createAudioService({ audio, mediaKeys: keys, config: { get: () => cfg, save: async (n) => void (cfg = n) }, clock, log });
  const extras = createExtras({
    audio: audioService,
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
  return { port, pairing, library, audio, keys, audioService };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function until(c: { next(): Promise<Incoming> }, type: string): Promise<any> {
  for (let i = 0; i < 30; i++) {
    const m = await c.next();
    if (m.type === type) return m;
  }
  throw new Error("no llegó " + type);
}


/** Lee hasta haber visto un mensaje de cada tipo pedido (en cualquier orden) y los devuelve por tipo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function untilAll(c: { next(): Promise<Incoming> }, types: string[]): Promise<Record<string, any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const got: Record<string, any> = {};
  for (let i = 0; i < 40 && types.some((x) => !(x in got)); i++) {
    const m = await c.next();
    if (types.includes(m.type) && !(m.type in got)) got[m.type] = m;
  }
  if (types.some((x) => !(x in got))) throw new Error("faltó " + types.filter((x) => !(x in got)).join(", "));
  return got;
}

describe("B4 por el cable cifrado", () => {
  it("tras conectar llega audio.snapshot con ids opacos: ni ids de Windows, ni rutas, ni PID", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const a = await until(c, "audio.snapshot");
    expect(a.payload.available).toEqual({ audio: true, defaultOutput: true, appRouting: true });
    expect(a.payload.outputs).toHaveLength(2);
    expect(a.payload.apps).toMatchObject([{ name: "chrome", sounding: true }]);
    expect(a.payload.media.sessions).toMatchObject([{ title: "Un video", controls: { prev: false, playPause: true, next: false } }]);
    const json = JSON.stringify(a.payload);
    expect(json).not.toContain("{0.0.0");
    expect(json).not.toContain("Chrome\\chrome.exe");
    expect(json).not.toContain('"pid"');
    expect(json).not.toContain("exePath");
  });

  it("audio.setVolume → command.result ok y audio.update con el volumen nuevo", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const snap = await until(c, "audio.snapshot");
    const realtek = snap.payload.outputs.find((o: { name: string }) => o.name === "Realtek");
    c.send("audio.setVolume", { target: { kind: "output", id: realtek.id }, volume: 55 });
    const r = await untilAll(c, ["command.result", "audio.update"]);
    expect(r["command.result"].payload).toMatchObject({ ok: true });
    const up = r["audio.update"];
    expect(up.payload.outputs.find((o: { name: string }) => o.name === "Realtek").volume).toBe(55);
    expect(t.audio.calls).toEqual([`setOutputVolume ${REALTEK} 0.55`]);
  });

  it("un id de Windows en lugar de un id opaco se rechaza antes de llegar al servicio", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "audio.snapshot");
    c.send("audio.setVolume", { target: { kind: "output", id: HYPER }, volume: 10 });
    expect((await until(c, "error")).payload).toMatchObject({ code: "bad_message" });
    expect(t.audio.calls).toEqual([]);
  });

  it("audio.setDefault cambia la predeterminada y avisa", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const snap = await until(c, "audio.snapshot");
    const realtek = snap.payload.outputs.find((o: { name: string }) => o.name === "Realtek");
    c.send("audio.setDefault", { outputId: realtek.id });
    const r = await untilAll(c, ["command.result", "audio.update"]);
    expect(r["command.result"].payload).toMatchObject({ ok: true });
    expect(r["audio.update"].payload.outputs[0].name).toBe("Realtek");
  });

  it("media.art → media.artData con la carátula; media.key → ok", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const snap = await until(c, "audio.snapshot");
    const key = snap.payload.media.sessions[0].artKey;
    c.send("media.art", { keys: [key] });
    expect((await until(c, "media.artData")).payload).toEqual({ key, jpeg: "/9j/AAA=" });
    c.send("media.key", { key: "playPause" });
    expect((await until(c, "command.result")).payload).toMatchObject({ ok: true });
    expect(t.audio.calls).toContain("mediaControl chrome.exe playPause");
  });

  it("un deslizador desbocado: pasan 30 mensajes por segundo y el resto recibe busy; Windows recibe poquísimos", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const snap = await until(c, "audio.snapshot");
    const id = snap.payload.outputs[0].id;
    for (let i = 0; i < 40; i++) c.send("audio.setVolume", { target: { kind: "output", id }, volume: i });
    const results: { ok: boolean; reason?: string }[] = [];
    while (results.length < 40) results.push((await until(c, "command.result")).payload);
    expect(results.filter((r) => r.ok)).toHaveLength(30);
    expect(results.filter((r) => r.reason === "busy")).toHaveLength(10);
    expect(t.audio.calls.length).toBeLessThanOrEqual(30);
  });
});
