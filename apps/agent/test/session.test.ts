import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_TIMEOUT_MS,
  CloseCode,
  RATE_LIMIT,
  encodeFrame,
  type Hs1Payload,
} from "@proyecto-e/protocol";
import type { Device } from "../src/config/schema";
import { createPairing } from "../src/pairing/pairing";
import { createSession, type Conn, type DeviceLookup, type SessionDeps } from "../src/remote/session";
import { createRateLimiter } from "../src/security/rateLimit";
import { createSampler } from "../src/state/system";
import { FakeClock, FakeRandom, FakeSystemInfo, MemLogger } from "./fakes";
import { createPhone, newKeyPair, testRandom, type Incoming, type Phone } from "./phone";

class FakeConn implements Conn {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  /** Simula un socket que ya no está abierto. */
  failSend = false;
  constructor(readonly remoteIp: string) {}
  send(text: string): void {
    if (this.failSend) throw new Error("socket not open");
    if (this.closed) throw new Error("send after close");
    this.sent.push(text);
  }
  close(code: number, reason: string): void {
    if (!this.closed) this.closed = { code, reason };
  }
}

const PC = newKeyPair();
const CODE_BAD = "x".repeat(22);
const CONNECT: Hs1Payload = { intent: "connect", appVersion: "0.1.0" };
const pairPayload = (code: string): Hs1Payload => ({ intent: "pair", code, deviceName: "Pixel de Jay", platform: "android", appVersion: "0.1.0" });
const tick = () => new Promise<void>((r) => setImmediate(r));

function setup(opts: { ip?: string; allowLoopback?: boolean; known?: boolean; revoked?: boolean; runCommand?: SessionDeps["runCommand"] } = {}) {
  const clock = new FakeClock(Date.UTC(2026, 10, 6, 12, 0, 0));
  const log = new MemLogger();
  const sys = new FakeSystemInfo();
  const sampler = createSampler({ sys, clock, agentVersion: "0.1.0" });
  const limiter = createRateLimiter({ clock });
  const saved: Device[] = [];
  const unpaired: string[] = [];
  const pairing = createPairing({ clock, random: new FakeRandom(), log, remoteEnabled: true, saveDevice: async (d) => void saved.push(d) });
  const phone: Phone = createPhone(PC.publicKey);
  const device: Device = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Pixel de Jay",
    platform: "android",
    publicKey: phone.publicKey,
    pairedAt: "2026-11-06T12:00:00.000Z",
    lastSeenAt: null,
  };
  const conn = new FakeConn(opts.ip ?? "192.168.1.5");
  const authenticated: Device[] = [];
  const lookup = (key: string): DeviceLookup =>
    opts.revoked && key === device.publicKey ? { status: "revoked" } : opts.known !== false && key === device.publicKey ? { status: "ok", device } : { status: "unknown" };
  const session = createSession({
    conn,
    clock,
    log,
    sampler,
    pairing,
    limiter,
    identity: PC,
    random: testRandom,
    allowLoopback: opts.allowLoopback ?? false,
    lookupDevice: lookup,
    unpair: async (id) => void unpaired.push(id),
    runCommand: opts.runCommand,
    onAuthenticated: (d) => authenticated.push(d),
  });
  /** Lo que mandó el agente desde la última vez, ya descifrado. */
  const read = (): Incoming[] => phone.read(conn.sent.splice(0));
  const types = () => read().map((m) => m.type);
  return { clock, log, sys, limiter, pairing, saved, unpaired, conn, session, authenticated, phone, device, read, types };
}

describe("session · conexión entrante", () => {
  it("IP pública: cierra con 4009 sin mandar nada", () => {
    const { conn, session } = setup({ ip: "8.8.8.8" });
    session.start();
    expect(conn.closed?.code).toBe(CloseCode.NOT_PRIVATE);
    expect(conn.sent).toEqual([]);
  });

  it("127.0.0.1 solo entra con allowLoopback", () => {
    const a = setup({ ip: "127.0.0.1", allowLoopback: false });
    a.session.start();
    expect(a.conn.closed?.code).toBe(4009);
    const b = setup({ ip: "127.0.0.1", allowLoopback: true });
    b.session.start();
    expect(b.conn.closed).toBeNull();
  });

  it("acepta la IPv4 mapeada que informa ws", () => {
    const { conn, session } = setup({ ip: "::ffff:192.168.1.5" });
    session.start();
    expect(conn.closed).toBeNull();
  });

  it("IP bloqueada por rate limit: cierre 4008 sin mandar nada", () => {
    const { conn, session, limiter } = setup();
    for (let i = 0; i <= RATE_LIMIT.attempts; i++) limiter.attempt("192.168.1.5");
    session.start();
    expect(conn.closed?.code).toBe(CloseCode.RATE_LIMITED);
    expect(conn.sent).toEqual([]);
  });

  it("5 s sin ningún marco: cierre 4001, sin mandar nada", () => {
    const { clock, conn, session } = setup();
    session.start();
    clock.advance(AUTH_TIMEOUT_MS - 1);
    expect(conn.closed).toBeNull();
    clock.advance(1);
    expect(conn.closed?.code).toBe(CloseCode.AUTH_TIMEOUT);
    expect(conn.sent).toEqual([]);
  });

  it("después de confirmar la clave (primer mensaje cifrado) el timer de 5 s ya no cierra", () => {
    const { clock, conn, session, phone, read } = setup();
    session.start();
    session.receive(phone.hello(CONNECT));
    read();
    session.receive(phone.send("ping"));
    clock.advance(60_000);
    expect(conn.closed).toBeNull();
    expect(clock.pendingTimers()).toBe(0);
  });
});

describe("session · antes del handshake", () => {
  it("basura que no es JSON: 4000 sin responder nada", () => {
    const { conn, session } = setup();
    session.start();
    session.receive("{no json");
    expect(conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
    expect(conn.sent).toEqual([]);
  });

  it("un celu de B1 (marco v:1 en claro): 4004 sin responder nada", () => {
    const { conn, session } = setup();
    session.start();
    session.receive(JSON.stringify({ v: 1, id: "c1", type: "auth.hello", payload: { deviceId: "x", token: "y", appVersion: "0.1.0" } }));
    expect(conn.closed?.code).toBe(CloseCode.INCOMPATIBLE);
    expect(conn.sent).toEqual([]);
  });

  it("un marco data o hs2 antes del handshake: 4000", () => {
    for (const kind of ["data", "hs2"] as const) {
      const { conn, session } = setup();
      session.start();
      session.receive(encodeFrame(kind, new Uint8Array(40)));
      expect(conn.closed?.code, kind).toBe(CloseCode.PROTOCOL_ERROR);
    }
  });

  it("hs1 que no descifra (QR de otra PC o basura): 4000, sin respuesta, y cuenta para el rate limit", () => {
    const { conn, session, limiter } = setup();
    session.start();
    const otherPc = createPhone(newKeyPair().publicKey);
    session.receive(otherPc.hello(CONNECT));
    expect(conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
    expect(conn.sent).toEqual([]);
    for (let i = 0; i < RATE_LIMIT.attempts - 1; i++) limiter.attempt("192.168.1.5");
    expect(limiter.isBlocked("192.168.1.5")).toBe(false); // 1 + 4 = 5: todavía no
    limiter.attempt("192.168.1.5");
    expect(limiter.isBlocked("192.168.1.5")).toBe(true);
  });

  it("hs1 que descifra pero tiene un payload inválido: 4000", () => {
    const { conn, session, phone } = setup();
    session.start();
    const bad = JSON.parse(JSON.stringify(CONNECT)) as Record<string, unknown>;
    bad.extra = 1;
    session.receive(phone.hello(bad as never));
    expect(conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
  });
});

describe("session · connect (celu ya emparejado)", () => {
  it("válido: hs2 ok; con el primer mensaje cifrado del celu llegan auth.ok y state.snapshot y entra como autenticada", () => {
    const { conn, session, authenticated, sys, phone, device, types, read } = setup();
    sys.host = "PC-DE-JAY";
    session.start();
    session.receive(phone.hello(CONNECT));
    expect(read().map((m) => m.type)).toEqual(["hs2"]);
    expect(session.isAuthenticated()).toBe(false); // todavía no demostró que tiene la clave
    expect(authenticated).toEqual([]);
    session.receive(phone.send("ping"));
    const msgs = read();
    msgs.unshift({ type: "hs2", payload: { ok: true, pcName: "PC-DE-JAY", agentVersion: "0.1.0" } });
    expect(msgs.map((m) => m.type)).toEqual(["hs2", "auth.ok", "state.snapshot"]);
    expect(msgs[0]).toMatchObject({ payload: { ok: true, pcName: "PC-DE-JAY", agentVersion: "0.1.0" } });
    expect(msgs[1]).toMatchObject({ payload: { pcName: "PC-DE-JAY" } });
    expect(msgs[2]).toMatchObject({ payload: { hostname: "PC-DE-JAY" } });
    expect(conn.closed).toBeNull();
    expect(session.isAuthenticated()).toBe(true);
    expect(session.deviceId).toBe(device.id);
    expect(authenticated).toEqual([device]);
    void types;
  });

  it("nada de lo que viaja contiene el nombre de la PC en claro", () => {
    const { conn, session, phone, sys } = setup();
    sys.host = "NOMBRE-RECONOCIBLE-PC";
    session.start();
    session.receive(phone.hello(CONNECT));
    const first = [...conn.sent];
    phone.read(conn.sent.splice(0));
    session.receive(phone.send("ping"));
    const all = [...first, ...conn.sent];
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.join("")).not.toContain("NOMBRE-RECONOCIBLE-PC");
  });

  it("clave desconocida: hs2 unknown_device y 4002, y cuenta para el rate limit", () => {
    const { conn, session, phone, read, limiter } = setup({ known: false });
    session.start();
    session.receive(phone.hello(CONNECT));
    expect(read()).toMatchObject([{ type: "hs2", payload: { ok: false, reason: "unknown_device" } }]);
    expect(conn.closed?.code).toBe(CloseCode.AUTH_FAILED);
    expect(session.isAuthenticated()).toBe(false);
    for (let i = 0; i < RATE_LIMIT.attempts - 1; i++) limiter.attempt("192.168.1.5");
    expect(limiter.isBlocked("192.168.1.5")).toBe(false);
    limiter.attempt("192.168.1.5");
    expect(limiter.isBlocked("192.168.1.5")).toBe(true);
  });

  it("clave revocada: hs2 revoked y 4003, sin contar para el rate limit", () => {
    const { conn, session, phone, read, limiter } = setup({ revoked: true });
    session.start();
    session.receive(phone.hello(CONNECT));
    expect(read()).toMatchObject([{ type: "hs2", payload: { ok: false, reason: "revoked" } }]);
    expect(conn.closed?.code).toBe(CloseCode.REVOKED);
    for (let i = 0; i < RATE_LIMIT.attempts; i++) limiter.attempt("192.168.1.5");
    expect(limiter.isBlocked("192.168.1.5")).toBe(false);
  });

  it("la 6.ª clave desconocida seguida de la misma IP recibe rate_limited y 4008", () => {
    const { conn, session, phone, read, limiter } = setup({ known: false });
    for (let i = 0; i < RATE_LIMIT.attempts; i++) limiter.attempt("192.168.1.5");
    // la IP todavía no estaba bloqueada al conectar: el intento nuevo es el que la bloquea
    session.start();
    session.receive(phone.hello(CONNECT));
    expect(read()).toMatchObject([{ type: "hs2", payload: { ok: false, reason: "rate_limited" } }]);
    expect(conn.closed?.code).toBe(CloseCode.RATE_LIMITED);
  });
});

describe("session · pair (emparejar)", () => {
  it("código correcto: hs2 ok + pair.pending; al Permitir llega pair.result y cierre 4005", async () => {
    const { conn, session, pairing, phone, read, saved } = setup({ known: false });
    session.start();
    session.receive(phone.hello(pairPayload(pairing.start()!.code)));
    expect(read().map((m) => m.type)).toEqual(["hs2", "pair.pending"]);
    expect(conn.closed).toBeNull();

    await pairing.allow();
    await tick();
    const [result] = read();
    expect(result).toMatchObject({ type: "pair.result", payload: { ok: true, pcName: expect.any(String) } });
    expect(result).toMatchObject({ payload: { deviceId: saved[0]!.id } });
    expect(JSON.stringify(result)).not.toContain("token");
    expect(saved[0]!.publicKey).toBe(phone.publicKey);
    expect(conn.closed?.code).toBe(CloseCode.PAIR_CLOSED);
  });

  it("código incorrecto: hs2 invalid_code, 4005 y cuenta para el rate limit", () => {
    const { conn, session, pairing, phone, read, limiter } = setup({ known: false });
    pairing.start();
    session.start();
    session.receive(phone.hello(pairPayload(CODE_BAD)));
    expect(read()).toMatchObject([{ type: "hs2", payload: { ok: false, reason: "invalid_code" } }]);
    expect(conn.closed?.code).toBe(CloseCode.PAIR_CLOSED);
    for (let i = 0; i < RATE_LIMIT.attempts - 1; i++) limiter.attempt("192.168.1.5");
    expect(limiter.isBlocked("192.168.1.5")).toBe(false);
    limiter.attempt("192.168.1.5");
    expect(limiter.isBlocked("192.168.1.5")).toBe(true);
  });

  it("sin código mostrado: invalid_code", () => {
    const { session, phone, read } = setup({ known: false });
    session.start();
    session.receive(phone.hello(pairPayload(CODE_BAD)));
    expect(read()).toMatchObject([{ type: "hs2", payload: { ok: false, reason: "invalid_code" } }]);
  });

  it("ya hay un pedido esperando: hs2 busy y 4005, sin contar para el rate limit", () => {
    const a = setup({ known: false });
    const code = a.pairing.start()!.code;
    a.session.start();
    a.session.receive(a.phone.hello(pairPayload(code)));
    a.read();
    // otro celu, misma PC
    const second = createPhone(PC.publicKey);
    const conn2 = new FakeConn("192.168.1.6");
    const s2 = createSession({
      conn: conn2, clock: a.clock, log: a.log, sampler: createSampler({ sys: a.sys, clock: a.clock, agentVersion: "0.1.0" }),
      pairing: a.pairing, limiter: a.limiter, identity: PC, random: testRandom, allowLoopback: false,
      lookupDevice: () => ({ status: "unknown" }), unpair: async () => undefined, onAuthenticated: () => undefined,
    });
    s2.start();
    s2.receive(second.hello(pairPayload(code)));
    expect(second.read(conn2.sent)).toMatchObject([{ type: "hs2", payload: { ok: false, reason: "busy" } }]);
    expect(conn2.closed?.code).toBe(CloseCode.PAIR_CLOSED);
  });

  it("Rechazar: pair.result rejected y 4005", async () => {
    const { conn, session, pairing, phone, read } = setup({ known: false });
    session.start();
    session.receive(phone.hello(pairPayload(pairing.start()!.code)));
    read();
    pairing.reject();
    await tick();
    expect(read()).toMatchObject([{ type: "pair.result", payload: { ok: false, reason: "rejected" } }]);
    expect(conn.closed?.code).toBe(CloseCode.PAIR_CLOSED);
  });

  it("el celu se va con el pedido esperando: se descarta", () => {
    const { session, pairing, phone } = setup({ known: false });
    session.start();
    session.receive(phone.hello(pairPayload(pairing.start()!.code)));
    expect(pairing.status().state).toBe("awaiting");
    session.handleClose();
    expect(pairing.status().state).toBe("idle");
  });

  it("mientras espera la decisión se ignoran los marcos del celu", () => {
    const { conn, session, pairing, phone, read } = setup({ known: false });
    session.start();
    session.receive(phone.hello(pairPayload(pairing.start()!.code)));
    read();
    session.receive(phone.send("ping"));
    expect(conn.closed).toBeNull();
    expect(conn.sent).toEqual([]);
  });
});

describe("session · confirmar la clave (un hs1 reenviado no alcanza)", () => {
  it("quien reenvía un hs1 capturado no puede seguir: no queda autenticado y a los 5 s se lo corta", () => {
    const u = setup();
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT)); // el atacante no puede mandar nada cifrado después
    u.read();
    expect(u.session.isAuthenticated()).toBe(false);
    expect(u.authenticated).toEqual([]); // no se anota lastSeenAt ni se lo muestra "En línea"
    u.clock.advance(5_000);
    expect(u.conn.closed?.code).toBe(CloseCode.AUTH_TIMEOUT);
    expect(u.authenticated).toEqual([]);
  });

  it("mientras no confirma, no recibe el estado de la PC ni las pantallas", () => {
    const u = setup();
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.pushState({ hostname: "PC", agentVersion: "0.1.0", uptimeSec: 1, cpuPercent: 1, memUsedBytes: 1, memTotalBytes: 2, sampledAt: 3 });
    u.session.pushScreens({ monitors: [], foreground: null }, "update");
    expect(u.conn.sent).toEqual([]);
  });

  it("el primer mensaje tiene que ser un ping; otra cosa se corta con 4000", () => {
    const u = setup({ runCommand: async () => ({ ok: true }) });
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(u.phone.send("monitor.setEnabled", { monitorId: "m_AbCdEfGhIjKlMnOp", enabled: false }));
    expect(u.conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
    expect(u.authenticated).toEqual([]);
  });

  it("un marco que no descifra en la confirmación: 4000", () => {
    const u = setup();
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(encodeFrame("data", new Uint8Array(40).fill(7)));
    expect(u.conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
  });

  it("un marco que no es data en la confirmación: 4000", () => {
    const u = setup();
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(encodeFrame("hs1", new Uint8Array(100)));
    expect(u.conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
  });

  it("emparejar no necesita este paso (lo confirma el código y la decisión de Jay)", async () => {
    const u = setup({ known: false });
    u.session.start();
    u.session.receive(u.phone.hello(pairPayload(u.pairing.start()!.code)));
    expect(u.read().map((m) => m.type)).toEqual(["hs2", "pair.pending"]);
  });
});

describe("session · autenticada", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.session.start();
    t.session.receive(t.phone.hello(CONNECT));
    t.read();
    t.session.receive(t.phone.send("ping")); // confirma la clave y entra
    t.read();
  });

  it("ping → pong cifrado", () => {
    t.session.receive(t.phone.send("ping"));
    expect(t.types()).toEqual(["pong"]);
  });

  it("un marco data alterado: se corta con 4000 sin responder (el canal ya no es confiable)", () => {
    const frame = JSON.parse(t.phone.send("ping")) as { d: string };
    frame.d = (frame.d[0] === "A" ? "B" : "A") + frame.d.slice(1);
    t.session.receive(JSON.stringify({ v: 2, k: "data", ...{ d: frame.d } }));
    expect(t.conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
    expect(t.conn.sent).toEqual([]);
  });

  it("un marco repetido (replay) se rechaza", () => {
    const frame = t.phone.send("ping");
    t.session.receive(frame);
    t.read();
    t.session.receive(frame);
    expect(t.conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
  });

  it("un hs1 en plena sesión: 4000", () => {
    t.session.receive(encodeFrame("hs1", new Uint8Array(100)));
    expect(t.conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
  });

  it("mensajes inválidos (ya descifrados): responde error y corta con 4000 al pasar de 3", () => {
    for (let i = 0; i < 3; i++) t.session.receive(t.phone.sendRaw("{no json"));
    expect(t.conn.closed).toBeNull();
    expect(t.types()).toEqual(["error", "error", "error"]);
    t.session.receive(t.phone.sendRaw("{no json"));
    expect(t.conn.closed?.code).toBe(CloseCode.PROTOCOL_ERROR);
  });

  it("un mensaje con otra versión interna: error incompatible y 4004", () => {
    t.session.receive(t.phone.sendRaw(JSON.stringify({ v: 9, id: "x", type: "ping", payload: {} })));
    expect(t.read()).toMatchObject([{ type: "error", payload: { code: "incompatible" } }]);
    expect(t.conn.closed?.code).toBe(CloseCode.INCOMPATIBLE);
  });

  it("device.unpair (Olvidar en el celu): borra el dispositivo y cierra con 1000", async () => {
    t.session.receive(t.phone.send("device.unpair"));
    await tick();
    expect(t.unpaired).toEqual([t.device.id]);
    expect(t.conn.closed?.code).toBe(CloseCode.NORMAL);
  });

  it("monitor.rename: se lo pasa al ejecutor y contesta command.result con el id del pedido", async () => {
    const calls: unknown[] = [];
    const u = setup({ runCommand: async (msg) => (calls.push(msg), { ok: true }) });
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(u.phone.send("ping"));
    u.read();
    u.session.receive(u.phone.send("monitor.rename", { monitorId: "m_AbCdEfGhIjKlMnOp", nickname: "Tele living" }));
    await tick();
    expect(calls).toMatchObject([{ type: "monitor.rename", payload: { monitorId: "m_AbCdEfGhIjKlMnOp", nickname: "Tele living" } }]);
    expect(u.read()).toMatchObject([{ type: "command.result", payload: { replyTo: "p2", ok: true } }]);
  });

  it("monitor.setEnabled también va al ejecutor y vuelve como command.result", async () => {
    const calls: unknown[] = [];
    const u = setup({ runCommand: async (msg) => (calls.push(msg), { ok: false, reason: "primary" }) });
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(u.phone.send("ping"));
    u.read();
    u.session.receive(u.phone.send("monitor.setEnabled", { monitorId: "m_AbCdEfGhIjKlMnOp", enabled: false }));
    await tick();
    expect(calls).toMatchObject([{ type: "monitor.setEnabled", payload: { enabled: false } }]);
    expect(u.read()).toMatchObject([{ type: "command.result", payload: { replyTo: "p2", ok: false, reason: "primary" } }]);
  });

  it("window.moveActive también va al ejecutor y vuelve como command.result", async () => {
    const calls: unknown[] = [];
    const u = setup({ runCommand: async (msg) => (calls.push(msg), { ok: false, reason: "no_window" }) });
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(u.phone.send("ping"));
    u.read();
    u.session.receive(u.phone.send("window.moveActive", { monitorId: "m_AbCdEfGhIjKlMnOp" }));
    await tick();
    expect(calls).toMatchObject([{ type: "window.moveActive", payload: { monitorId: "m_AbCdEfGhIjKlMnOp" } }]);
    expect(u.read()).toMatchObject([{ type: "command.result", payload: { replyTo: "p2", ok: false, reason: "no_window" } }]);
  });

  it("monitor.setOrder también va al ejecutor y vuelve como command.result", async () => {
    const calls: unknown[] = [];
    const u = setup({ runCommand: async (msg) => (calls.push(msg), { ok: true }) });
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(u.phone.send("ping"));
    u.read();
    u.session.receive(u.phone.send("monitor.setOrder", { order: ["m_AaAaAaAaAaAaAaAa", "m_BbBbBbBbBbBbBbBb"] }));
    await tick();
    expect(calls).toMatchObject([{ type: "monitor.setOrder", payload: { order: ["m_AaAaAaAaAaAaAaAa", "m_BbBbBbBbBbBbBbBb"] } }]);
    expect(u.read()).toMatchObject([{ type: "command.result", payload: { replyTo: "p2", ok: true } }]);
  });

  it("si el comando falla, el motivo llega al celu", async () => {
    const u = setup({ runCommand: async () => ({ ok: false, reason: "not_found" }) });
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(u.phone.send("ping"));
    u.read();
    u.session.receive(u.phone.send("monitor.rename", { monitorId: "m_AbCdEfGhIjKlMnOp", nickname: null }));
    await tick();
    expect(u.read()).toMatchObject([{ type: "command.result", payload: { replyTo: "p2", ok: false, reason: "not_found" } }]);
  });

  it("si el ejecutor revienta: failed, y la sesión sigue viva", async () => {
    const u = setup({ runCommand: async () => { throw new Error("boom"); } });
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(u.phone.send("ping"));
    u.read();
    u.session.receive(u.phone.send("monitor.rename", { monitorId: "m_AbCdEfGhIjKlMnOp", nickname: "x" }));
    await tick();
    expect(u.read()).toMatchObject([{ type: "command.result", payload: { ok: false, reason: "failed" } }]);
    expect(u.conn.closed).toBeNull();
  });

  it("sin ejecutor de comandos (pantallas no disponibles): unsupported", async () => {
    t.session.receive(t.phone.send("monitor.rename", { monitorId: "m_AbCdEfGhIjKlMnOp", nickname: "x" }));
    await tick();
    expect(t.read()).toMatchObject([{ type: "command.result", payload: { ok: false, reason: "unsupported" } }]);
  });

  it("varios comandos seguidos: cada resultado vuelve con su propio replyTo", async () => {
    const u = setup({ runCommand: async () => ({ ok: true }) });
    u.session.start();
    u.session.receive(u.phone.hello(CONNECT));
    u.read();
    u.session.receive(u.phone.send("ping"));
    u.read();
    for (const n of ["a", "b", "c"]) u.session.receive(u.phone.send("monitor.rename", { monitorId: "m_AbCdEfGhIjKlMnOp", nickname: n }));
    await tick();
    const ids = u.read().map((m) => (m.type === "command.result" ? m.payload.replyTo : null));
    expect(ids).toEqual(["p2", "p3", "p4"]);
  });

  it("pushState y pushScreens mandan los mensajes cifrados", () => {
    const state = { hostname: "PC", agentVersion: "0.1.0", uptimeSec: 1, cpuPercent: 12.5, memUsedBytes: 1, memTotalBytes: 2, sampledAt: 3 };
    t.session.pushState(state);
    t.session.pushScreens({ monitors: [], foreground: null }, "snapshot");
    t.session.pushScreens({ monitors: [], foreground: null }, "update");
    expect(t.read()).toMatchObject([
      { type: "state.update", payload: state },
      { type: "screens.snapshot" },
      { type: "screens.update" },
    ]);
  });

  it("si falla un envío (el socket ya no está abierto) la sesión cierra la conexión, no la deja zombi", () => {
    t.conn.failSend = true;
    t.session.pushScreens({ monitors: [], foreground: null }, "update");
    expect(t.conn.closed).not.toBeNull();
    expect(t.session.isAuthenticated()).toBe(false);
  });

  it("revoke: cierre 4003", () => {
    t.session.revoke();
    expect(t.conn.closed?.code).toBe(CloseCode.REVOKED);
  });

  it("shutdown: cierre 1001", () => {
    t.session.shutdown("agent_stopping");
    expect(t.conn.closed).toEqual({ code: CloseCode.GOING_AWAY, reason: "agent_stopping" });
  });

  it("después de cerrada no manda ni procesa nada", () => {
    t.session.handleClose();
    t.session.pushState({ hostname: "PC", agentVersion: "0.1.0", uptimeSec: 1, cpuPercent: 0, memUsedBytes: 1, memTotalBytes: 2, sampledAt: 3 });
    t.session.pushScreens({ monitors: [], foreground: null }, "update");
    t.session.receive(t.phone.send("ping"));
    expect(t.conn.sent).toEqual([]);
    expect(t.session.isAuthenticated()).toBe(false);
  });
});
