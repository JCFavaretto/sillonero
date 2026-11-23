import {
  initialState,
  reduce,
  type ConnState,
  type Effect,
  type MachineContext,
  type MachineEvent,
} from "@/connection/machine";
import type { PairedPc } from "@/connection/types";

const ctx: MachineContext = { backoff: (n) => (n + 1) * 1000, appVersion: "0.1.0", platform: "android" };
const PC_KEY = "P".repeat(43);
const DEVICE_KEY = "K".repeat(43);
const pc: PairedPc = {
  v: 2,
  host: "192.168.100.5",
  port: 47800,
  pcName: "DESKTOP-PSB9K0R",
  pcPublicKey: PC_KEY,
  devicePrivateKey: DEVICE_KEY,
  deviceId: "3f2b8c1e-5d4a-4b7e-9c3a-1f2e3d4c5b6a",
  pairedAt: "2026-11-06T12:00:00.000Z",
};
const qr = { host: pc.host, port: pc.port, name: pc.pcName, code: "A".repeat(22), pcPublicKey: PC_KEY };
/** El celu escanea el QR (la clave del celu la genera el cliente y entra como dato). */
const scan = (deviceName = "x"): MachineEvent => ({ type: "QR_SCANNED", qr, deviceName, devicePrivateKey: DEVICE_KEY });
const pendingPc: PairedPc = { ...pc, deviceId: null, pairedAt: null };
const SNAP = {
  hostname: "PC",
  agentVersion: "0.1.0",
  uptimeSec: 10,
  cpuPercent: 5,
  memUsedBytes: 1,
  memTotalBytes: 2,
  sampledAt: 1,
};

/** Aplica eventos en orden y junta todos los efectos. */
function run(events: MachineEvent[], from: ConnState = initialState) {
  let state = from;
  const effects: Effect[] = [];
  for (const e of events) {
    const r = reduce(state, e, ctx);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}
const online = () => run([{ type: "BOOT", pc }, { type: "SOCKET_OPEN" }, { type: "AUTH_OK" }]).state;
const has = (effects: Effect[], e: Effect) => expect(effects).toContainEqual(e);

describe("arranque", () => {
  it("empieza sin PC", () => {
    expect(initialState.status).toBe("unpaired");
    expect(initialState.pc).toBeNull();
  });

  it("BOOT sin PC guardada → unpaired, sin efectos", () => {
    const r = run([{ type: "BOOT", pc: null }]);
    expect(r.state.status).toBe("unpaired");
    expect(r.effects).toEqual([]);
  });

  it("BOOT con PC guardada → connecting y abre el socket", () => {
    const r = run([{ type: "BOOT", pc }]);
    expect(r.state.status).toBe("connecting");
    expect(r.state.pc).toEqual(pc);
    has(r.effects, { kind: "openSocket", url: "ws://192.168.100.5:47800" });
  });

  it("al abrir el socket hace el handshake `connect` con sus claves (sin ningún token)", () => {
    const r = run([{ type: "BOOT", pc }, { type: "SOCKET_OPEN" }]);
    has(r.effects, {
      kind: "handshake",
      payload: { intent: "connect", appVersion: "0.1.0" },
      pcPublicKey: PC_KEY,
      devicePrivateKey: DEVICE_KEY,
    });
    expect(r.effects.some((e) => e.kind === "send")).toBe(false);
  });

  it("BOOT con un emparejamiento a medias (deviceId null) lo descarta: no hay PC", () => {
    const r = run([{ type: "BOOT", pc: pendingPc }]);
    expect(r.state.status).toBe("unpaired");
    expect(r.state.pc).toBeNull();
    has(r.effects, { kind: "deletePc" });
    expect(r.effects.some((e) => e.kind === "openSocket")).toBe(false);
  });

  it("BOOT avisando que había un emparejamiento de B1 → unpaired con el aviso de seguridad", () => {
    const r = run([{ type: "BOOT", pc: null, upgraded: true }]);
    expect(r.state.status).toBe("unpaired");
    expect(r.state.lastError).toBe("errors.securityUpgrade");
  });
});

describe("emparejamiento", () => {
  it("QR inválido guarda el error y sigue sin PC", () => {
    const r = run([{ type: "QR_INVALID", reason: "expired" }]);
    expect(r.state.status).toBe("unpaired");
    expect(r.state.lastError).toBe("errors.qr.expired");
  });

  it("QR válido → pairing/sent y se guarda la clave del celu ANTES de abrir el socket", () => {
    const r = run([scan("Pixel de Jay")]);
    expect(r.state.status).toBe("pairing");
    expect(r.state.pairing).toEqual({ phase: "sent" });
    expect(r.state.lastError).toBeNull();
    expect(r.effects).toEqual([{ kind: "savePendingPc", pc: pendingPc }]);
  });

  it("recién cuando se guardó (PENDING_SAVED) abre el socket, y al abrir pide emparejar con el código", () => {
    const r = run([scan("Pixel de Jay"), { type: "PENDING_SAVED" }, { type: "SOCKET_OPEN" }]);
    has(r.effects, { kind: "openSocket", url: "ws://192.168.100.5:47800" });
    has(r.effects, {
      kind: "handshake",
      payload: { intent: "pair", code: qr.code, deviceName: "Pixel de Jay", platform: "android", appVersion: "0.1.0" },
      pcPublicKey: PC_KEY,
      devicePrivateKey: DEVICE_KEY,
    });
  });

  it("si no se pudo guardar la clave: no se empareja nada y se avisa", () => {
    const r = run([scan(), { type: "PENDING_SAVE_FAILED" }]);
    expect(r.state.status).toBe("unpaired");
    expect(r.state.lastError).toBe("errors.storage");
    expect(r.state.pairing).toBeNull();
    expect(r.state.pendingPair).toBeNull();
    expect(r.effects.some((e) => e.kind === "openSocket")).toBe(false);
  });

  it("PENDING_SAVED fuera de un emparejamiento no hace nada", () => {
    expect(run([{ type: "PENDING_SAVED" }]).effects).toEqual([]);
  });

  it("un QR nuevo limpia el error anterior", () => {
    const r = run([{ type: "QR_INVALID", reason: "bad_format" }, scan("x")]);
    expect(r.state.lastError).toBeNull();
  });

  it("pair.pending → esperando a la PC", () => {
    const r = run([scan("x"), { type: "PAIR_PENDING" }]);
    expect(r.state.pairing).toEqual({ phase: "waitingPc" });
  });

  it("PAIR_OK → guarda la PC y abre un socket nuevo (en ese orden), pasa a connecting", () => {
    const r = run([
      scan("x"),
      { type: "PAIR_OK", deviceId: pc.deviceId!, pcName: pc.pcName, pairedAt: pc.pairedAt! },
    ]);
    expect(r.state.status).toBe("connecting");
    expect(r.state.pc).toEqual(pc); // con las claves que se generaron al escanear
    expect(r.state.pairing).toBeNull();
    const kinds = r.effects.map((e) => e.kind);
    expect(kinds.indexOf("savePc")).toBeGreaterThan(-1);
    expect(kinds.lastIndexOf("openSocket")).toBeGreaterThan(kinds.indexOf("savePc"));
    has(r.effects, { kind: "savePc", pc });
  });

  it.each(["rejected", "timeout", "invalid_code", "busy"] as const)("PAIR_FAIL %s → vuelve a unpaired con su mensaje", (reason) => {
    const r = run([scan("x"), { type: "PAIR_FAIL", reason }]);
    expect(r.state.status).toBe("unpaired");
    expect(r.state.lastError).toBe(`errors.pair.${reason}`);
    expect(r.state.pairing).toBeNull();
  });

  it("cancelar el emparejamiento cierra el socket y vuelve a unpaired", () => {
    const r = run([scan("x"), { type: "PAIR_CANCEL" }]);
    expect(r.state.status).toBe("unpaired");
    has(r.effects, { kind: "closeSocket", code: 1000 });
  });

  it.each([
    [1006, "errors.unreachable"],
    [4008, "errors.rateLimited"],
    [4009, "errors.notPrivate"],
    [4004, "errors.incompatible"],
  ])("si el socket se cae emparejando (código %i) → unpaired con %s", (code, key) => {
    const r = run([scan("x"), { type: "CLOSED", code }]);
    expect(r.state.status).toBe("unpaired");
    expect(r.state.lastError).toBe(key);
  });

  it("el cierre 4005 del socket de emparejamiento no molesta a la conexión nueva", () => {
    const r = run([
      scan("x"),
      { type: "PAIR_OK", deviceId: pc.deviceId!, pcName: pc.pcName, pairedAt: pc.pairedAt! },
      { type: "CLOSED", code: 4005 },
    ]);
    expect(r.state.status).toBe("connecting");
  });
});

describe("sesión en línea", () => {
  it("AUTH_OK → online, intentos en 0 y arranca el ping", () => {
    const r = run([{ type: "BOOT", pc }, { type: "SOCKET_OPEN" }, { type: "AUTH_OK" }]);
    expect(r.state.status).toBe("online");
    expect(r.state.attempt).toBe(0);
    has(r.effects, { kind: "startTimer", name: "ping", ms: 10_000 });
  });

  it("STATE guarda el snapshot solo si está en línea", () => {
    expect(reduce(online(), { type: "STATE", snapshot: SNAP }, ctx).state.snapshot).toEqual(SNAP);
    expect(run([{ type: "STATE", snapshot: SNAP }]).state.snapshot).toBeNull();
  });

  it("PING_TIMER manda ping y espera el pong; PONG cancela la espera", () => {
    const a = reduce(online(), { type: "PING_TIMER" }, ctx);
    has(a.effects, { kind: "send", type: "ping", payload: {} });
    has(a.effects, { kind: "startTimer", name: "pongTimeout", ms: 5_000 });
    has(a.effects, { kind: "startTimer", name: "ping", ms: 10_000 });
    const b = reduce(a.state, { type: "PONG" }, ctx);
    has(b.effects, { kind: "cancelTimer", name: "pongTimeout" });
  });

  it("PONG_TIMEOUT → cierra el socket y pasa a reconnecting conservando el último snapshot", () => {
    const withSnap = reduce(online(), { type: "STATE", snapshot: SNAP }, ctx).state;
    const r = reduce(withSnap, { type: "PONG_TIMEOUT" }, ctx);
    expect(r.state.status).toBe("reconnecting");
    expect(r.state.snapshot).toEqual(SNAP);
    has(r.effects, { kind: "closeSocket", code: 1000 });
    has(r.effects, { kind: "startTimer", name: "retry", ms: 1000 });
  });

  it("se cae el socket estando en línea → reconnecting, cancela el ping y programa el reintento", () => {
    const r = reduce(online(), { type: "CLOSED", code: 1006 }, ctx);
    expect(r.state.status).toBe("reconnecting");
    expect(r.state.attempt).toBe(0);
    has(r.effects, { kind: "cancelTimer", name: "ping" });
    has(r.effects, { kind: "cancelTimer", name: "pongTimeout" });
    has(r.effects, { kind: "startTimer", name: "retry", ms: 1000 });
  });

  it("el agente se apaga (1001) → también reconecta", () => {
    expect(reduce(online(), { type: "CLOSED", code: 1001 }, ctx).state.status).toBe("reconnecting");
  });

  it("eventos que no corresponden al estado se ignoran", () => {
    expect(reduce(initialState, { type: "AUTH_OK" }, ctx).state).toEqual(initialState);
    expect(reduce(online(), { type: "RETRY_TIMER" }, ctx).effects).toEqual([]);
    const off = run([{ type: "BOOT", pc }, { type: "SOCKET_OPEN" }, { type: "AUTH_OK" }, { type: "APP_BACKGROUND" }]).state;
    expect(reduce(off, { type: "PING_TIMER" }, ctx).effects).toEqual([]);
  });
});

describe("reconexión", () => {
  const lost = () => reduce(online(), { type: "CLOSED", code: 1006 }, ctx).state;

  it("RETRY_TIMER reabre el socket y manda auth.hello", () => {
    const a = reduce(lost(), { type: "RETRY_TIMER" }, ctx);
    has(a.effects, { kind: "openSocket", url: "ws://192.168.100.5:47800" });
    const b = reduce(a.state, { type: "SOCKET_OPEN" }, ctx);
    expect(b.effects.some((e) => e.kind === "handshake" && e.payload.intent === "connect")).toBe(true);
  });

  it("cada fallo suma un intento y espera más; a los 6 fallos pasa a offline", () => {
    let s = lost();
    const waits: number[] = [];
    for (let i = 1; i <= 5; i++) {
      s = reduce(s, { type: "RETRY_TIMER" }, ctx).state;
      const r = reduce(s, { type: "CLOSED", code: 1006 }, ctx);
      s = r.state;
      expect(s.status).toBe("reconnecting");
      expect(s.attempt).toBe(i);
      const t = r.effects.find((e) => e.kind === "startTimer" && e.name === "retry");
      waits.push(t && t.kind === "startTimer" ? t.ms : -1);
    }
    expect(waits).toEqual([2000, 3000, 4000, 5000, 6000]);

    s = reduce(s, { type: "RETRY_TIMER" }, ctx).state;
    const last = reduce(s, { type: "CLOSED", code: 1006 }, ctx);
    expect(last.state.status).toBe("offline");
    expect(last.state.autoRetry).toBe(true);
    has(last.effects, { kind: "startTimer", name: "retry", ms: 30_000 });
  });

  it("estando offline con reintento automático, sigue probando cada 30 s", () => {
    let s = lost();
    for (let i = 0; i < 6; i++) {
      s = reduce(s, { type: "RETRY_TIMER" }, ctx).state;
      s = reduce(s, { type: "CLOSED", code: 1006 }, ctx).state;
    }
    expect(s.status).toBe("offline");
    const a = reduce(s, { type: "RETRY_TIMER" }, ctx);
    has(a.effects, { kind: "openSocket", url: "ws://192.168.100.5:47800" });
    expect(a.state.status).toBe("offline");
    const b = reduce(a.state, { type: "CLOSED", code: 1006 }, ctx);
    has(b.effects, { kind: "startTimer", name: "retry", ms: 30_000 });
    const c = reduce(a.state, { type: "AUTH_OK" }, ctx);
    expect(c.state.status).toBe("online");
    expect(c.state.autoRetry).toBe(false);
  });

  it("volver a estar en línea deja el contador en cero y borra el error", () => {
    let s = lost();
    s = reduce(s, { type: "RETRY_TIMER" }, ctx).state;
    s = reduce(s, { type: "CLOSED", code: 1006 }, ctx).state;
    const r = reduce(s, { type: "AUTH_OK" }, ctx);
    expect(r.state).toMatchObject({ status: "online", attempt: 0, lastError: null });
    has(r.effects, { kind: "cancelTimer", name: "retry" });
  });

  it("Reintentar desde offline → connecting ya mismo", () => {
    let s = lost();
    for (let i = 0; i < 6; i++) {
      s = reduce(s, { type: "RETRY_TIMER" }, ctx).state;
      s = reduce(s, { type: "CLOSED", code: 1006 }, ctx).state;
    }
    const r = reduce(s, { type: "RETRY_PRESSED" }, ctx);
    expect(r.state).toMatchObject({ status: "connecting", attempt: 0 });
    has(r.effects, { kind: "cancelTimer", name: "retry" });
    has(r.effects, { kind: "openSocket", url: "ws://192.168.100.5:47800" });
  });
});

describe("cierres con significado", () => {
  it.each([
    [4003, "errors.revoked"],
    [4002, "errors.authFailed"],
  ])("cierre %i → olvida la PC y vuelve a Conectar con %s", (code, key) => {
    const r = reduce(online(), { type: "CLOSED", code }, ctx);
    expect(r.state.status).toBe("unpaired");
    expect(r.state.pc).toBeNull();
    expect(r.state.lastError).toBe(key);
    has(r.effects, { kind: "deletePc" });
  });

  it.each([
    [4004, "errors.incompatible"],
    [4009, "errors.notPrivate"],
    [4000, "errors.protocol"],
  ])("cierre %i → offline con %s y sin reintento automático", (code, key) => {
    const r = reduce(online(), { type: "CLOSED", code }, ctx);
    expect(r.state).toMatchObject({ status: "offline", lastError: key, autoRetry: false });
    expect(r.effects.some((e) => e.kind === "startTimer" && e.name === "retry")).toBe(false);
    // y si el socket vuelve a cerrarse, tampoco programa nada
    expect(reduce(r.state, { type: "CLOSED", code: 1006 }, ctx).effects).toEqual([]);
  });

  it("rate limit (4008) → reconnecting con espera de 5 minutos", () => {
    const r = reduce(online(), { type: "CLOSED", code: 4008 }, ctx);
    expect(r.state).toMatchObject({ status: "reconnecting", lastError: "errors.rateLimited" });
    has(r.effects, { kind: "startTimer", name: "retry", ms: 300_000 });
  });
});

describe("segundo plano", () => {
  it("al pasar a segundo plano cierra el socket y no reintenta", () => {
    const r = reduce(online(), { type: "APP_BACKGROUND" }, ctx);
    expect(r.state).toMatchObject({ status: "offline", autoRetry: false, foreground: false });
    has(r.effects, { kind: "closeSocket", code: 1000 });
    has(r.effects, { kind: "cancelTimer", name: "retry" });
    has(r.effects, { kind: "cancelTimer", name: "ping" });
    expect(reduce(r.state, { type: "CLOSED", code: 1000 }, ctx).effects).toEqual([]);
  });

  it("también corta una reconexión en curso", () => {
    const lost = reduce(online(), { type: "CLOSED", code: 1006 }, ctx).state;
    const r = reduce(lost, { type: "APP_BACKGROUND" }, ctx);
    expect(r.state.status).toBe("offline");
    has(r.effects, { kind: "cancelTimer", name: "retry" });
  });

  it("al volver al frente se reconecta de inmediato", () => {
    const bg = reduce(online(), { type: "APP_BACKGROUND" }, ctx).state;
    const r = reduce(bg, { type: "APP_FOREGROUND" }, ctx);
    expect(r.state).toMatchObject({ status: "connecting", foreground: true, attempt: 0 });
    has(r.effects, { kind: "openSocket", url: "ws://192.168.100.5:47800" });
  });

  it("sin PC guardada no hace nada al volver al frente", () => {
    const r = run([{ type: "APP_BACKGROUND" }, { type: "APP_FOREGROUND" }]);
    expect(r.state.status).toBe("unpaired");
    expect(r.effects).toEqual([]);
  });
});

describe("olvidar", () => {
  it("FORGET en línea le avisa a la PC (device.unpair) antes de cerrar", () => {
    const r = reduce(online(), { type: "FORGET" }, ctx);
    const kinds = r.effects.map((e) => (e.kind === "send" ? `send:${e.type}` : e.kind));
    expect(kinds.indexOf("send:device.unpair")).toBeGreaterThan(-1);
    expect(kinds.indexOf("send:device.unpair")).toBeLessThan(kinds.indexOf("closeSocket"));
  });

  it("FORGET sin conexión no manda nada (la PC se entera cuando se revoque a mano)", () => {
    const lost = reduce(online(), { type: "CLOSED", code: 1006 }, ctx).state;
    const r = reduce(lost, { type: "FORGET" }, ctx);
    expect(r.effects.some((e) => e.kind === "send")).toBe(false);
    has(r.effects, { kind: "deletePc" });
  });

  it("FORGET borra todo: PC, timers y socket", () => {
    const r = reduce(online(), { type: "FORGET" }, ctx);
    expect(r.state).toMatchObject({ status: "unpaired", pc: null, snapshot: null, lastError: null });
    has(r.effects, { kind: "deletePc" });
    has(r.effects, { kind: "closeSocket", code: 1000 });
    for (const name of ["ping", "pongTimeout", "retry"] as const) has(r.effects, { kind: "cancelTimer", name });
  });
});
