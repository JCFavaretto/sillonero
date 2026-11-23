import { base64UrlToBytes, bytesToBase64Url, encodeQr, keyPairFromPrivate, type ScreensState } from "@proyecto-e/protocol";
import { createClient } from "@/connection/client";
import type { ConnState } from "@/connection/machine";
import type { PairedPc } from "@/connection/types";
import { PC_PUBLIC, agentFor, testRandom } from "./fakeAgent";
import { FakeClock, FakeSocket, MemStorage } from "./fakes";

const UUID = "3f2b8c1e-5d4a-4b7e-9c3a-1f2e3d4c5b6a";
const DEVICE_KEY = bytesToBase64Url(testRandom(32));
const DEVICE_PUBLIC = bytesToBase64Url(keyPairFromPrivate(base64UrlToBytes(DEVICE_KEY)!).publicKey);
const pc: PairedPc = {
  v: 2,
  host: "192.168.100.5",
  port: 47800,
  pcName: "DESKTOP-PSB9K0R",
  pcPublicKey: PC_PUBLIC,
  devicePrivateKey: DEVICE_KEY,
  deviceId: UUID,
  pairedAt: "2026-11-06T12:00:00.000Z",
};
const SNAP = {
  hostname: "PC",
  agentVersion: "0.1.0",
  uptimeSec: 10,
  cpuPercent: 5,
  memUsedBytes: 1,
  memTotalBytes: 2,
  sampledAt: 1,
};
let n = 0;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(stored: PairedPc | null = null) {
  FakeSocket.reset();
  const clock = new FakeClock();
  const storage = new MemStorage();
  storage.pc = stored;
  let state!: ConnState;
  const screens: (ScreensState | null)[] = [];
  const extras: unknown[] = [];
  const client = createClient({
    createSocket: (url) => new FakeSocket(url),
    storage,
    clock,
    random: () => 0.5,
    randomBytes: testRandom,
    newId: () => `c${++n}`,
    appVersion: "0.1.0",
    platform: "android",
    onState: (s) => {
      state = s;
    },
    onScreens: (s) => {
      screens.push(s);
    },
    onExtra: (m) => {
      extras.push(m);
    },
  });
  const sock = (i = -1) => FakeSocket.instances.at(i) as FakeSocket;
  return { client, clock, storage, sock, state: () => state, screens, extras };
}

/** Arranca con la PC guardada y deja la conexión en línea. */
async function online() {
  const t = setup(pc);
  await t.client.boot();
  t.sock().open();
  const agent = agentFor(t.sock());
  agent.acceptConnect(SNAP);
  return { ...t, agent };
}

describe("arranque", () => {
  it("sin PC guardada queda en unpaired y no abre sockets", async () => {
    const t = setup(null);
    await t.client.boot();
    expect(t.state().status).toBe("unpaired");
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("si el almacenamiento seguro falla al leer, arranca como sin emparejar (no deja la app en blanco)", async () => {
    const t = setup(pc);
    t.storage.load = async () => {
      throw new Error("keystore inválido");
    };
    await expect(t.client.boot()).resolves.toBeUndefined();
    expect(t.state().status).toBe("unpaired");
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("si había un emparejamiento de B1: arranca sin emparejar y avisa que hay que escanear de nuevo", async () => {
    const t = setup(null);
    t.storage.upgraded = true;
    await t.client.boot();
    expect(t.state()).toMatchObject({ status: "unpaired", lastError: "errors.securityUpgrade" });
  });

  it("un emparejamiento a medias (deviceId null) se descarta", async () => {
    const t = setup({ ...pc, deviceId: null, pairedAt: null });
    await t.client.boot();
    expect(t.state().status).toBe("unpaired");
    expect(t.storage.removes).toBe(1);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("con PC guardada conecta, hace el handshake con su clave y queda en línea con el estado", async () => {
    const t = setup(pc);
    await t.client.boot();
    expect(t.sock().url).toBe("ws://192.168.100.5:47800");
    t.sock().open();
    const agent = agentFor(t.sock());
    expect(agent.readHello()).toEqual({ intent: "connect", appVersion: "0.1.0" });
    expect(bytesToBase64Url(agent.remoteStatic)).toBe(DEVICE_PUBLIC); // la PC identifica al celu por su clave
    agent.replyOk();
    // Apenas termina el handshake manda un primer mensaje cifrado: así la PC sabe que tiene la clave
    // (un hs1 copiado de la red no alcanza para quedar "en línea").
    expect(agent.fromPhone().map((m) => m.type)).toEqual(["ping"]);
    agent.send("auth.ok", { pcName: pc.pcName, agentVersion: "0.1.0" });
    agent.send("state.snapshot", SNAP);
    expect(t.state()).toMatchObject({ status: "online", snapshot: SNAP });
    agent.send("state.update", { ...SNAP, cpuPercent: 80 });
    expect(t.state().snapshot?.cpuPercent).toBe(80);
  });

  it("lo primero que viaja es un marco hs1 v2: ni token ni la clave privada, ni nada legible", async () => {
    const t = setup(pc);
    await t.client.boot();
    t.sock().open();
    const first = t.sock().sent[0]!;
    expect(JSON.parse(first)).toMatchObject({ v: 2, k: "hs1" });
    expect(first).not.toContain("token");
    expect(first).not.toContain(DEVICE_KEY);
    expect(first).not.toContain("connect");
  });

  it("cada reconexión también confirma la clave antes de que la PC le conteste", async () => {
    const t = await online();
    t.sock().serverClose(1001);
    t.clock.advance(1000);
    t.sock().open();
    const agent = agentFor(t.sock());
    agent.readHello();
    agent.replyOk();
    expect(agent.fromPhone().map((m) => m.type)).toEqual(["ping"]);
  });

  it("cada mensaje cifrado lleva v:1 y un id distinto", async () => {
    const t = await online();
    t.clock.advance(10_000);
    t.agent.send("pong");
    t.clock.advance(10_000);
    const msgs = t.agent.fromPhone();
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(msgs.map((m) => m.id)).size).toBe(msgs.length);
    expect(msgs.every((m) => m.v === 1)).toBe(true);
  });
});

describe("latido", () => {
  it("manda ping cada 10 s; con pong sigue en línea", async () => {
    const t = await online();
    t.clock.advance(10_000);
    expect(t.agent.fromPhone().at(-1)?.type).toBe("ping");
    t.agent.send("pong");
    t.clock.advance(5_000);
    expect(t.state().status).toBe("online");
  });

  it("sin pong en 5 s cierra el socket y pasa a reconnecting", async () => {
    const t = await online();
    t.clock.advance(10_000);
    t.clock.advance(5_000);
    expect(t.state().status).toBe("reconnecting");
    expect(t.sock().closedWith).toBe(1000);
    expect(t.state().snapshot).toEqual(SNAP);
  });
});

describe("reconexión", () => {
  it("si la PC se apaga (1001) reintenta al segundo, rehace el handshake y vuelve a estar en línea", async () => {
    const t = await online();
    const first = t.sock();
    first.serverClose(1001);
    expect(t.state().status).toBe("reconnecting");
    expect(FakeSocket.instances).toHaveLength(1);
    t.clock.advance(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    t.sock().open();
    const agent = agentFor(t.sock());
    agent.acceptConnect();
    expect(t.state().status).toBe("online");
    // cada conexión usa claves efímeras nuevas: el hs1 no se repite
    expect(t.sock().sent[0]).not.toBe(first.sent[0]);
  });

  it("los eventos de un socket viejo se ignoran", async () => {
    const t = await online();
    const old = t.sock();
    old.serverClose(1006);
    t.clock.advance(1000);
    t.sock().open();
    agentFor(t.sock()).acceptConnect();
    old.serverClose(1006); // llega tarde
    old.receive("cualquier cosa");
    expect(t.state().status).toBe("online");
  });

  it("revocada (4003) → olvida la PC y vuelve a Conectar con el aviso", async () => {
    const t = await online();
    t.sock().serverClose(4003);
    expect(t.state()).toMatchObject({ status: "unpaired", pc: null, lastError: "errors.revoked" });
    expect(t.storage.pc).toBeNull();
    expect(t.storage.removes).toBe(1);
  });
});

describe("cifrado", () => {
  it("un marco data alterado: se corta la conexión y se reconecta (no se acepta nada de ese marco)", async () => {
    const t = await online();
    t.agent.sendTampered("state.update", { ...SNAP, cpuPercent: 99 });
    expect(t.state().status).toBe("reconnecting");
    expect(t.state().snapshot?.cpuPercent).toBe(5);
    expect(t.sock().closedWith).toBe(1000);
  });

  it("un hs2 que no descifra (la PC del QR no es la que contesta) corta la conexión", async () => {
    const t = setup(pc);
    await t.client.boot();
    t.sock().open();
    // alguien contesta con un hs2 que el celu no puede abrir (no es la PC del QR)
    t.sock().receive(JSON.stringify({ v: 2, k: "hs2", d: bytesToBase64Url(new Uint8Array(80).fill(3)) }));
    expect(t.state().status).not.toBe("online");
    expect(t.sock().closedWith).toBe(1000);
  });

  it("marcos que no son del protocolo, o un marco v:1 en claro, se ignoran", async () => {
    const t = await online();
    t.sock().receive("{no es json");
    t.sock().receive({ v: 1, id: "x", type: "pong", payload: {} });
    t.sock().receive({ v: 2, k: "otro", d: "AA" });
    expect(t.state().status).toBe("online");
  });

  it("un mensaje cifrado de un tipo que no existe se ignora", async () => {
    const t = await online();
    t.agent.send("monitor.toggle", {});
    expect(t.state().status).toBe("online");
  });
});

describe("emparejamiento", () => {
  const qrFor = (clock: FakeClock, over = {}) =>
    encodeQr({ v: 2, host: pc.host, port: pc.port, name: pc.pcName, code: "A".repeat(22), exp: clock.now() + 120_000, pk: PC_PUBLIC, ...over });

  it("flujo completo: QR → se guarda la clave → pedido → Permitir → conecta con la misma clave", async () => {
    const t = setup(null);
    await t.client.boot();
    t.client.pair(qrFor(t.clock), "Pixel de Jay");
    expect(t.state().status).toBe("pairing");
    expect(FakeSocket.instances).toHaveLength(0); // todavía no: primero se guarda la clave
    await flush();
    expect(t.storage.pc).toMatchObject({ v: 2, deviceId: null, pairedAt: null, pcPublicKey: PC_PUBLIC });
    expect(t.storage.pc?.devicePrivateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const generatedKey = t.storage.pc!.devicePrivateKey;

    const pairSock = t.sock();
    expect(pairSock.url).toBe("ws://192.168.100.5:47800");
    pairSock.open();
    const agent = agentFor(pairSock);
    expect(agent.readHello()).toEqual({ intent: "pair", code: "A".repeat(22), deviceName: "Pixel de Jay", platform: "android", appVersion: "0.1.0" });
    const phonePublic = bytesToBase64Url(agent.remoteStatic);
    agent.replyOk();
    expect(agent.fromPhone()).toEqual([]); // emparejando no hace falta: lo confirma el código y la decisión en la PC
    agent.send("pair.pending");
    expect(t.state().pairing).toEqual({ phase: "waitingPc" });

    agent.send("pair.result", { ok: true, deviceId: UUID, pcName: pc.pcName });
    await flush();
    expect(t.storage.pc).toMatchObject({ deviceId: UUID, pcName: pc.pcName, devicePrivateKey: generatedKey });
    expect(t.storage.pc?.pairedAt).toBe(new Date(t.clock.now()).toISOString());
    expect(pairSock.closedWith).toBe(1000);
    expect(FakeSocket.instances).toHaveLength(2);

    pairSock.serverClose(4005); // el cierre del socket viejo no afecta
    expect(t.state().status).toBe("connecting");

    const connSock = t.sock();
    connSock.open();
    const agent2 = agentFor(connSock);
    agent2.readHello();
    expect(bytesToBase64Url(agent2.remoteStatic)).toBe(phonePublic); // la misma identidad que al emparejar
    agent2.replyOk();
    agent2.send("auth.ok", { pcName: pc.pcName, agentVersion: "0.1.0" });
    expect(t.state().status).toBe("online");
  });

  it("si SecureStore falla al guardar la clave: no se empareja nada ni se abre el socket", async () => {
    const t = setup(null);
    await t.client.boot();
    t.storage.failSave = true;
    t.client.pair(qrFor(t.clock), "x");
    await flush();
    expect(t.state()).toMatchObject({ status: "unpaired", lastError: "errors.storage" });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("si la PC rechaza → unpaired con el motivo", async () => {
    const t = setup(null);
    await t.client.boot();
    t.client.pair(qrFor(t.clock), "x");
    await flush();
    t.sock().open();
    const agent = agentFor(t.sock());
    agent.readHello();
    agent.replyOk();
    agent.send("pair.pending");
    agent.send("pair.result", { ok: false, reason: "rejected" });
    expect(t.state()).toMatchObject({ status: "unpaired", lastError: "errors.pair.rejected" });
  });

  it.each(["invalid_code", "busy"] as const)("si el handshake vuelve con %s → unpaired con ese motivo", async (reason) => {
    const t = setup(null);
    await t.client.boot();
    t.client.pair(qrFor(t.clock), "x");
    await flush();
    t.sock().open();
    const agent = agentFor(t.sock());
    agent.readHello();
    agent.reply({ ok: false, reason });
    expect(t.state()).toMatchObject({ status: "unpaired", lastError: `errors.pair.${reason}` });
  });

  it.each([
    ["https://ejemplo.com", "errors.qr.not_ours"],
    ["pe2:!!!", "errors.qr.bad_format"],
    ["pe1:eyJ2IjoxfQ", "errors.qr.old_version"],
  ])("QR inválido %s → %s y no abre socket", async (text, key) => {
    const t = setup(null);
    await t.client.boot();
    t.client.pair(text, "x");
    expect(t.state().lastError).toBe(key);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(t.storage.saves).toBe(0);
  });

  it("QR vencido → errors.qr.expired", async () => {
    const t = setup(null);
    await t.client.boot();
    const text = qrFor(t.clock);
    t.clock.advance(120_000);
    t.client.pair(text, "x");
    expect(t.state().lastError).toBe("errors.qr.expired");
  });

  it("cancelar cierra el socket y vuelve a unpaired", async () => {
    const t = setup(null);
    await t.client.boot();
    t.client.pair(qrFor(t.clock), "x");
    await flush();
    t.client.cancelPair();
    expect(t.state().status).toBe("unpaired");
    expect(t.sock().closedWith).toBe(1000);
  });
});

describe("segundo plano, olvidar y mensajes raros", () => {
  it("en segundo plano cierra el socket y no reintenta; al volver reconecta", async () => {
    const t = await online();
    t.client.appBackground();
    expect(t.sock().closedWith).toBe(1000);
    t.clock.advance(120_000);
    expect(FakeSocket.instances).toHaveLength(1);
    t.client.appForeground();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(t.state().status).toBe("connecting");
  });

  it("olvidar en línea le avisa a la PC (device.unpair cifrado), cierra y borra la PC", async () => {
    const t = await online();
    t.client.forget();
    expect(t.agent.fromPhone().map((m) => m.type)).toContain("device.unpair");
    expect(t.state()).toMatchObject({ status: "unpaired", pc: null });
    expect(t.sock().closedWith).toBe(1000);
    expect(t.storage.pc).toBeNull();
    expect(t.clock.pending).toBe(0);
  });

  it("olvidar sin conexión no manda nada", async () => {
    const t = await online();
    t.sock().serverClose(1006);
    const sentBefore = t.sock().sent.length;
    t.client.forget();
    expect(t.sock().sent.length).toBe(sentBefore);
    expect(t.storage.pc).toBeNull();
  });

  it("dispose limpia timers y cierra el socket", async () => {
    const t = await online();
    t.client.dispose();
    expect(t.clock.pending).toBe(0);
    expect(t.sock().closedWith).toBe(1000);
  });
});

const SCREENS: ScreensState = {
  monitors: [
    {
      id: "m_AbCdEfGhIjKlMnOp",
      index: 1,
      nickname: null,
      name: "DELL",
      connector: "displayport",
      enabled: true,
      primary: true,
      bounds: { x: 0, y: 0, w: 1920, h: 1080 },
      lastBounds: { x: 0, y: 0, w: 1920, h: 1080 },
      resolution: { w: 1920, h: 1080 },
      canDisable: false,
      blockedBy: "primary",
      busy: false,
    },
  ],
  foreground: null,
};

describe("pantallas", () => {
  it("screens.snapshot y screens.update llegan al store de pantallas", async () => {
    const t = await online();
    t.agent.send("screens.snapshot", SCREENS);
    t.agent.send("screens.update", { ...SCREENS, foreground: { title: "x", app: "y.exe", monitorId: null } });
    expect(t.screens).toHaveLength(2);
    expect(t.screens[0]).toEqual(SCREENS);
    expect(t.screens[1]?.foreground?.title).toBe("x");
  });

  it("un mensaje de pantallas inválido se ignora", async () => {
    const t = await online();
    t.agent.send("screens.update", { monitors: "no", foreground: null });
    expect(t.screens).toEqual([]);
  });

  it("al perder la conexión se conserva lo último (se muestra en gris)", async () => {
    const t = await online();
    t.agent.send("screens.snapshot", SCREENS);
    t.sock().serverClose(1001);
    expect(t.state().status).toBe("reconnecting");
    expect(t.screens).toEqual([SCREENS]);
  });

  it("al olvidar la PC o ser revocado se borran las pantallas", async () => {
    const a = await online();
    a.agent.send("screens.snapshot", SCREENS);
    a.client.forget();
    expect(a.screens.at(-1)).toBeNull();

    const b = await online();
    b.agent.send("screens.snapshot", SCREENS);
    b.sock().serverClose(4003);
    expect(b.screens.at(-1)).toBeNull();
  });
});

describe("comandos (sendCommand)", () => {
  const ID = "m_AbCdEfGhIjKlMnOp";

  it("manda el comando cifrado y resuelve con el command.result que trae su mismo id", async () => {
    const t = await online();
    const p = t.client.sendCommand("monitor.rename", { monitorId: ID, nickname: "Tele living" });
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ type: "monitor.rename", payload: { monitorId: ID, nickname: "Tele living" } });
    t.agent.send("command.result", { replyTo: sent!.id, ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it("monitor.setEnabled viaja igual y vuelve con su resultado", async () => {
    const t = await online();
    const p = t.client.sendCommand("monitor.setEnabled", { monitorId: ID, enabled: false });
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ type: "monitor.setEnabled", payload: { monitorId: ID, enabled: false } });
    t.agent.send("command.result", { replyTo: sent!.id, ok: false, reason: "primary" });
    await expect(p).resolves.toEqual({ ok: false, reason: "primary" });
  });

  it("window.moveActive viaja con la pantalla de destino", async () => {
    const t = await online();
    const p = t.client.sendCommand("window.moveActive", { monitorId: ID });
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ type: "window.moveActive", payload: { monitorId: ID } });
    t.agent.send("command.result", { replyTo: sent!.id, ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it("monitor.identify viaja vacío", async () => {
    const t = await online();
    const p = t.client.sendCommand("monitor.identify", {});
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ type: "monitor.identify", payload: {} });
    t.agent.send("command.result", { replyTo: sent!.id, ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it("monitor.setOrder viaja con la lista en orden", async () => {
    const t = await online();
    const order = ["m_AaAaAaAaAaAaAaAa", "m_BbBbBbBbBbBbBbBb"];
    const p = t.client.sendCommand("monitor.setOrder", { order });
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ type: "monitor.setOrder", payload: { order } });
    t.agent.send("command.result", { replyTo: sent!.id, ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it("si la PC no puede, devuelve el motivo", async () => {
    const t = await online();
    const p = t.client.sendCommand("monitor.rename", { monitorId: ID, nickname: null });
    const [sent] = t.agent.fromPhone();
    t.agent.send("command.result", { replyTo: sent!.id, ok: false, reason: "not_found" });
    await expect(p).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("varios comandos a la vez: cada respuesta llega a su pedido, aunque vuelvan en otro orden", async () => {
    const t = await online();
    const a = t.client.sendCommand("monitor.rename", { monitorId: ID, nickname: "A" });
    const b = t.client.sendCommand("monitor.rename", { monitorId: ID, nickname: "B" });
    const [ma, mb] = t.agent.fromPhone();
    expect(ma!.id).not.toBe(mb!.id);
    t.agent.send("command.result", { replyTo: mb!.id, ok: false, reason: "busy" });
    t.agent.send("command.result", { replyTo: ma!.id, ok: true });
    await expect(a).resolves.toEqual({ ok: true });
    await expect(b).resolves.toEqual({ ok: false, reason: "busy" });
  });

  it("sin respuesta en 8 s: timeout, y una respuesta tardía no rompe nada", async () => {
    const t = await online();
    const p = t.client.sendCommand("monitor.rename", { monitorId: ID, nickname: "x" });
    const [sent] = t.agent.fromPhone();
    t.clock.advance(8_000);
    await expect(p).resolves.toEqual({ ok: false, reason: "timeout" });
    t.agent.send("command.result", { replyTo: sent!.id, ok: true });
    expect(t.state().status).toBe("online");
  });

  it("sin conexión (no está en línea): offline, sin mandar nada", async () => {
    const t = setup(pc);
    await t.client.boot(); // todavía conectando
    await expect(t.client.sendCommand("monitor.rename", { monitorId: ID, nickname: "x" })).resolves.toEqual({ ok: false, reason: "offline" });
    expect(FakeSocket.instances.every((s) => s.sent.length === 0)).toBe(true);
  });

  it("si se corta la conexión con comandos pendientes: offline", async () => {
    const t = await online();
    const p = t.client.sendCommand("monitor.rename", { monitorId: ID, nickname: "x" });
    t.sock().serverClose(1006);
    await expect(p).resolves.toEqual({ ok: false, reason: "offline" });
    expect(t.clock.pending).toBeGreaterThan(0); // queda el reintento de conexión
  });

  it("un command.result que nadie esperaba se ignora", async () => {
    const t = await online();
    t.agent.send("command.result", { replyTo: "otro", ok: true });
    expect(t.state().status).toBe("online");
  });

  it("al resolverse, el timer del comando se cancela (no quedan timers colgados)", async () => {
    const t = await online();
    const before = t.clock.pending;
    const p = t.client.sendCommand("monitor.rename", { monitorId: ID, nickname: "x" });
    const [sent] = t.agent.fromPhone();
    t.agent.send("command.result", { replyTo: sent!.id, ok: true });
    await p;
    expect(t.clock.pending).toBe(before);
  });
});

describe("B3: ventanas, biblioteca, preguntas y escenas", () => {
  const KEY = "i_AAAAAAAAAAAAAAAA";

  it("los mensajes de ventanas, biblioteca, resultados, íconos y progreso llegan por onExtra", async () => {
    const t = await online();
    t.agent.send("windows.snapshot", { windows: [] });
    t.agent.send("library.snapshot", { launchers: [], scenes: [], deck: [] });
    t.agent.send("apps.results", { replyTo: "c1", items: [], total: 0 });
    t.agent.send("icon.data", { key: KEY, png: null });
    t.agent.send("scene.progress", { runId: "r", sceneId: "s_AAAAAAAAAA", index: 0, status: "running", reason: null });
    expect((t.extras as { type: string }[]).map((m) => m.type)).toEqual(["windows.snapshot", "library.snapshot", "apps.results", "icon.data", "scene.progress"]);
  });

  it("un mensaje de B3 inválido se ignora", async () => {
    const t = await online();
    t.agent.send("windows.update", { windows: "no" });
    expect(t.extras).toEqual([]);
  });

  it("query() manda la pregunta cifrada y devuelve su id; sin conexión da null", async () => {
    const t = await online();
    const id = t.client.query("apps.search", { query: "disc" });
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ id, type: "apps.search", payload: { query: "disc" } });
    const off = setup(pc);
    await off.client.boot();
    expect(off.client.query("apps.search", { query: "x" })).toBeNull();
  });

  it("sendCommand acepta un plazo propio (una escena puede tardar) y devuelve los pasos", async () => {
    const t = await online();
    const p = t.client.sendCommand("scene.run", { id: "s_AAAAAAAAAA" }, { timeoutMs: 65_000 });
    const [sent] = t.agent.fromPhone();
    t.clock.advance(8_500); // pasó más que los 8 s normales (y todavía no toca el ping) y sigue esperando
    t.agent.send("command.result", { replyTo: sent!.id, ok: true, steps: ["ok", "partial"] });
    await expect(p).resolves.toEqual({ ok: true, steps: ["ok", "partial"] });
  });

  it("sin plazo propio vence a los 8 s", async () => {
    const t = await online();
    const p = t.client.sendCommand("scene.run", { id: "s_AAAAAAAAAA" });
    t.clock.advance(8_001);
    await expect(p).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("al olvidar la PC, onExtra(null) borra todo", async () => {
    const t = await online();
    t.client.forget();
    expect(t.extras.at(-1)).toBeNull();
  });
});

describe("B4: audio y media", () => {
  const OUT = "o_AAAAAAAAAAAA";
  const state = { available: { audio: true, defaultOutput: true, appRouting: true }, outputs: [], apps: [], media: { sessions: [], targetId: null, chosen: false } };

  it("audio.snapshot, audio.update y media.artData llegan por onExtra", async () => {
    const t = await online();
    t.agent.send("audio.snapshot", state);
    t.agent.send("audio.update", state);
    t.agent.send("media.artData", { key: "r_DDDDDDDDDDDD", jpeg: null });
    expect((t.extras as { type: string }[]).map((m) => m.type)).toEqual(["audio.snapshot", "audio.update", "media.artData"]);
  });

  it("un estado de audio inválido se ignora", async () => {
    const t = await online();
    t.agent.send("audio.update", { ...state, outputs: "no" });
    expect(t.extras).toEqual([]);
  });

  it("los comandos de audio y media se mandan cifrados y esperan su command.result", async () => {
    const t = await online();
    const p = t.client.sendCommand("audio.setVolume", { target: { kind: "output", id: OUT }, volume: 30 });
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ type: "audio.setVolume", payload: { target: { kind: "output", id: OUT }, volume: 30 } });
    t.agent.send("command.result", { replyTo: sent!.id, ok: false, reason: "output_unavailable" });
    await expect(p).resolves.toEqual({ ok: false, reason: "output_unavailable" });
    const q = t.client.sendCommand("media.key", { key: "next" });
    const [sent2] = t.agent.fromPhone();
    t.agent.send("command.result", { replyTo: sent2!.id, ok: false, reason: "not_supported" });
    await expect(q).resolves.toEqual({ ok: false, reason: "not_supported" });
  });

  it("media.art es una pregunta (sin command.result)", async () => {
    const t = await online();
    const id = t.client.query("media.art", { keys: ["r_DDDDDDDDDDDD"] });
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ id, type: "media.art", payload: { keys: ["r_DDDDDDDDDDDD"] } });
  });
});

describe("Pad (B5)", () => {
  it("fire manda pad.move cifrado, sin esperar respuesta, y dice si salió", async () => {
    const t = await online();
    expect(t.client.fire("pad.move", { dx: 5, dy: -3 })).toBe(true);
    expect(t.client.fire("pad.scroll", { dx: 0, dy: 120 })).toBe(true);
    const sent = t.agent.fromPhone();
    expect(sent.map((m) => m.type)).toEqual(["pad.move", "pad.scroll"]);
    expect(sent[0]).toMatchObject({ payload: { dx: 5, dy: -3 } });
    expect(new Set(sent.map((m) => m.id)).size).toBe(2);
  });

  it("fire sin conexión devuelve false y no manda nada", async () => {
    const t = setup(pc);
    await t.client.boot();
    expect(t.client.fire("pad.move", { dx: 1, dy: 1 })).toBe(false);
  });

  it("pad.state de la PC llega a onExtra", async () => {
    const t = await online();
    t.agent.send("pad.state", { available: true, enabled: true, elevated: false, holding: { left: false, alt: false } });
    expect(t.extras.at(-1)).toMatchObject({ type: "pad.state", payload: { enabled: true } });
  });

  it("los comandos del Pad llevan command.result como cualquier otro", async () => {
    const t = await online();
    const p = t.client.sendCommand("pad.key", { key: "l", mods: ["ctrl"] });
    const [sent] = t.agent.fromPhone();
    expect(sent).toMatchObject({ type: "pad.key", payload: { key: "l", mods: ["ctrl"] } });
    t.agent.send("command.result", { replyTo: sent!.id, ok: false, reason: "input_blocked" });
    await expect(p).resolves.toEqual({ ok: false, reason: "input_blocked" });
  });

  it("measure manda un ping y avisa la ida y vuelta cuando llega el pong", async () => {
    FakeSocket.reset();
    const clock = new FakeClock();
    const storage = new MemStorage();
    storage.pc = pc;
    const lat: number[] = [];
    const client = createClient({
      createSocket: (url) => new FakeSocket(url),
      storage,
      clock,
      random: () => 0.5,
      randomBytes: testRandom,
      newId: () => `c${++n}`,
      appVersion: "0.1.0",
      platform: "android",
      onState: () => undefined,
      onLatency: (ms) => lat.push(ms),
    });
    await client.boot();
    const sock = FakeSocket.instances.at(-1) as FakeSocket;
    sock.open();
    const agent = agentFor(sock);
    agent.acceptConnect(SNAP);
    client.measure();
    expect(agent.fromPhone().map((m) => m.type)).toEqual(["ping"]);
    clock.advance(23);
    agent.send("pong");
    expect(lat).toEqual([23]);
    agent.send("pong"); // un pong que no pidió el Pad (el del latido) no cuenta
    expect(lat).toEqual([23]);
  });
});

describe("Pad · latencia con plazo", () => {
  it("si el pong de measure se pierde, a los 5 s se deja de esperar y se puede volver a medir", async () => {
    FakeSocket.reset();
    const clock = new FakeClock();
    const storage = new MemStorage();
    storage.pc = pc;
    const lat: number[] = [];
    const client = createClient({
      createSocket: (url) => new FakeSocket(url),
      storage,
      clock,
      random: () => 0.5,
      randomBytes: testRandom,
      newId: () => `c${++n}`,
      appVersion: "0.1.0",
      platform: "android",
      onState: () => undefined,
      onLatency: (ms) => lat.push(ms),
    });
    await client.boot();
    const sock = FakeSocket.instances.at(-1) as FakeSocket;
    sock.open();
    const agent = agentFor(sock);
    agent.acceptConnect(SNAP);
    client.measure();
    expect(agent.fromPhone().map((m) => m.type)).toEqual(["ping"]);
    client.measure(); // todavía esperando: no manda otro
    expect(agent.fromPhone()).toEqual([]);
    clock.advance(5_100); // el pong nunca llegó
    client.measure();
    expect(agent.fromPhone().map((m) => m.type)).toContain("ping");
  });
});
