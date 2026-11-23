import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Hs1Payload } from "@proyecto-e/protocol";
import { createPadService } from "../src/input/service";
import { createPairing } from "../src/pairing/pairing";
import { createRemoteServer, type RemoteServer } from "../src/remote/server";
import { createRateLimiter } from "../src/security/rateLimit";
import { createSampler } from "../src/state/system";
import type { Device } from "../src/config/schema";
import { FakeClock, FakeInput, FakeRandom, FakeSystemInfo, MemLogger } from "./fakes";
import { createPhone, newKeyPair, testRandom, type Incoming } from "./phone";

// B5 de punta a punta: `ws` real, canal cifrado real y el servicio del Pad con un Windows falso.

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

async function boot(opts: { withPad?: boolean } = {}) {
  const clock = new FakeClock();
  const log = new MemLogger();
  const input = new FakeInput();
  let enabled = true;
  const pad = createPadService({ input, clock, log, config: { enabled: () => enabled, setEnabled: async (v) => void (enabled = v) } });
  const devices: Device[] = [];
  const pairing = createPairing({ clock, random: new FakeRandom(), log, remoteEnabled: true, saveDevice: async (d) => void devices.push(d) });
  const server = createRemoteServer({
    clock,
    log,
    sampler: createSampler({ sys: new FakeSystemInfo(), clock, agentVersion: "0.1.0" }),
    pad: opts.withPad === false ? undefined : pad,
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
  return { port, pairing, pad, input, clock };
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
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("B5 por el cable cifrado", () => {
  it("al conectar llega pad.state (llave prendida, sin nada apretado)", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const s = await until(c, "pad.state");
    expect(s.payload).toEqual({ available: true, enabled: true, elevated: false, holding: { left: false, alt: false } });
  });

  it("emparejado = usa todo: un click llega a Windows y se contesta command.result ok", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    c.send("pad.button", { button: "left", action: "click" });
    const r = await until(c, "command.result");
    expect(r.payload).toMatchObject({ ok: true });
    expect(t.input.of("button")).toEqual([{ op: "button", button: "left", action: "click" }]);
  });

  it("pad.move y pad.scroll mueven pero NO reciben respuesta", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    c.send("pad.move", { dx: 10, dy: 5 });
    c.send("pad.scroll", { dx: 0, dy: 120 });
    c.send("pad.key", { key: "a", mods: [] });
    const r = await until(c, "command.result"); // la primera respuesta es la de la tecla, no la de move o scroll
    expect(r.payload).toMatchObject({ ok: true });
    await tick();
    expect(t.input.of("moveAbs")).toHaveLength(1);
    expect(t.input.of("wheel")).toEqual([{ op: "wheel", dx: 0, dy: 120 }]);
  });

  it("el texto en vivo borra y escribe", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    c.send("pad.type", { backspaces: 1, text: "ñ😀" });
    expect((await until(c, "command.result")).payload).toMatchObject({ ok: true });
    expect(t.input.of("text")[0]!.units).toEqual([0xf1, 0xd83d, 0xde00]);
  });

  it("con la llave apagada contesta input_disabled y avisa el estado a todos", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "pad.state");
    await t.pad.setEnabled(false);
    const s = await until(c, "pad.state");
    expect(s.payload.enabled).toBe(false);
    c.send("pad.key", { key: "a", mods: [] });
    const r = await until(c, "command.result");
    expect(r.payload).toEqual({ replyTo: expect.any(String), ok: false, reason: "input_disabled" });
    expect(t.input.calls).toEqual([]);
  });

  it("si el celu se desconecta con el botón apretado, la PC lo suelta", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    c.send("pad.button", { button: "left", action: "down" });
    await until(c, "command.result");
    expect(t.input.heldNow().left).toBe(true);
    c.ws.terminate();
    for (let i = 0; i < 50 && t.input.heldNow().left; i++) await tick();
    expect(t.input.heldNow().left).toBe(false);
    expect(t.pad.state().holding.left).toBe(false);
  });

  it("un mensaje inválido (tecla fuera de la lista) no llega a Windows", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    c.send("pad.key", { key: "powershell -c calc", mods: [] });
    const e = await until(c, "error");
    expect(e.payload.code).toBe("bad_message");
    expect(t.input.calls).toEqual([]);
  });

  it("sin servicio de Pad en el agente: contesta input_unavailable", async () => {
    const t = await boot({ withPad: false });
    const c = await connectPaired(t);
    c.send("pad.key", { key: "a", mods: [] });
    const r = await until(c, "command.result");
    expect(r.payload).toMatchObject({ ok: false, reason: "input_unavailable" });
  });

  it("nada de lo que viaja trae rutas ni ids de Windows", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    const s = await until(c, "pad.state");
    expect(JSON.stringify(s)).not.toMatch(/[A-Z]:\\|\{0\.0/);
  });
});

describe("B5 · el Pad no se traba con las actualizaciones pesadas", () => {
  const collect = (c: { next(): Promise<Incoming> }) => {
    const seen: string[] = [];
    void (async () => {
      for (;;) seen.push((await c.next()).type);
    })().catch(() => undefined);
    return seen;
  };
  const settle = () => new Promise((r) => setTimeout(r, 80));

  it("pad.move recibe un pad.ack chiquito (destraba el TCP del celu) y no más de uno por ráfaga", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "pad.state");
    const seen = collect(c);
    for (let i = 0; i < 20; i++) c.send("pad.move", { dx: 1, dy: 0 });
    await settle();
    const acks = seen.filter((x) => x === "pad.ack").length;
    expect(acks).toBeGreaterThanOrEqual(1);
    expect(acks).toBeLessThan(20); // se acusa como mucho cada 12 ms, no cada mensaje
    t.clock.advance(50);
    c.send("pad.move", { dx: 1, dy: 0 });
    await settle();
    expect(seen.filter((x) => x === "pad.ack").length).toBeGreaterThan(acks);
  });

  it("mientras se usa el Pad no llegan actualizaciones pesadas; a los 1,5 s sin usarlo vuelve todo", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "pad.state");
    const seen = collect(c);
    await settle();
    seen.length = 0;
    t.clock.advance(1_900); // todavía no toca el latido de 2 s
    c.send("pad.move", { dx: 1, dy: 0 });
    await settle();
    t.clock.advance(200); // acá toca state.update, pero se está usando el Pad
    await settle();
    expect(seen).not.toContain("state.update");
    t.clock.advance(1_600); // 1,5 s sin mensajes del Pad
    await settle();
    expect(seen).toContain("state.update"); // se resincroniza
  });

  it("los comandos del Pad y pad.state siguen pasando mientras se usa", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "pad.state");
    const seen = collect(c);
    c.send("pad.button", { button: "left", action: "down" });
    await settle();
    expect(seen).toContain("command.result");
    expect(seen).toContain("pad.state");
  });

  it("sin usar el Pad, las actualizaciones siguen llegando como siempre", async () => {
    const t = await boot();
    const c = await connectPaired(t);
    await until(c, "pad.state");
    const seen = collect(c);
    await settle();
    seen.length = 0;
    t.clock.advance(2_100);
    await settle();
    expect(seen).toContain("state.update");
  });
});
