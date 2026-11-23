import { describe, expect, it } from "vitest";
import type { RawAudio } from "../src/ports";
import { createAudioClient, type AudioChild } from "../src/platform/win/audioClient";
import { audioHostArgs, createLineSplitter } from "../src/platform/win/audioSpawn";
import { FakeClock, MemLogger } from "./fakes";

class FakeChild implements AudioChild {
  readonly written: string[] = [];
  killed = false;
  private line: ((l: string) => void) | null = null;
  private exit: ((r: string) => void) | null = null;
  write(l: string) {
    this.written.push(l);
  }
  kill() {
    this.killed = true;
  }
  onLine(cb: (l: string) => void) {
    this.line = cb;
  }
  onExit(cb: (r: string) => void) {
    this.exit = cb;
  }
  // — lado "hijo" —
  emit(l: string) {
    this.line?.(l);
  }
  ready(over: { defaultOutput?: boolean; appRouting?: boolean } = {}) {
    this.emit(JSON.stringify({ ready: true, defaultOutput: true, appRouting: true, ...over }));
  }
  reply(id: number, result: unknown) {
    this.emit(JSON.stringify({ id, ok: true, result }));
  }
  fail(id: number, error: string) {
    this.emit(JSON.stringify({ id, ok: false, error }));
  }
  die(reason = "exit 1") {
    this.exit?.(reason);
  }
  requests() {
    return this.written.map((w) => JSON.parse(w) as { id: number; op: string; args?: Record<string, unknown> });
  }
}

function setup() {
  const clock = new FakeClock(0);
  const log = new MemLogger();
  const children: FakeChild[] = [];
  const spawnArgs: unknown[][] = [];
  let failSpawn = false;
  const client = createAudioClient({
    clock,
    log,
    spawn: (...a: unknown[]) => {
      spawnArgs.push(a);
      if (failSpawn) throw new Error("no se pudo lanzar");
      const c = new FakeChild();
      children.push(c);
      return c;
    },
  });
  return { clock, log, children, client, spawnArgs, setSpawnFails: (v: boolean) => (failSpawn = v) };
}
const flush = () => new Promise<void>((r) => setImmediate(r));
const RAW: RawAudio = { outputs: [], sessions: [], defaultWinId: null, media: [] };

describe("audioClient · arranque", () => {
  it("ready() lanza el hijo, espera su aviso y devuelve qué funciones andan en esta PC", async () => {
    const t = setup();
    const p = t.client.ready();
    expect(t.children).toHaveLength(1);
    t.children[0]!.ready({ appRouting: false });
    await expect(p).resolves.toEqual({ defaultOutput: true, appRouting: false });
  });

  it("no manda nada hasta que el hijo avisa que está listo (compilando el C# no atiende)", async () => {
    const t = setup();
    const p = t.client.snapshot();
    await flush();
    expect(t.children[0]!.written).toEqual([]);
    t.children[0]!.ready();
    await flush();
    expect(t.children[0]!.requests()).toEqual([{ id: 1, op: "snapshot" }]);
    t.children[0]!.reply(1, RAW);
    await expect(p).resolves.toEqual(RAW);
  });

  it("si nunca avisa que está listo, a los 20 s se descarta y se rechaza", async () => {
    const t = setup();
    const p = t.client.ready();
    const caught = p.catch((e: Error) => e);
    t.clock.advance(20_000);
    expect(((await caught) as Error).message).toMatch(/listo|ready/i);
    expect(t.children[0]!.killed).toBe(true);
  });

  it("S3: deja en el log el build, y avisa si no es uno de los verificados para mandar apps a otra salida", async () => {
    const t = setup();
    const p = t.client.ready();
    t.children[0]!.emit(JSON.stringify({ ready: true, build: 26100, factory: "21H2", media: true, defaultOutput: true, appRouting: true }));
    await p;
    expect(t.log.entries.some((e) => e.level === "info" && e.msg === "audio host ready" && e.fields?.build === 26100)).toBe(true);
    expect(t.log.entries.some((e) => e.level === "warn" && /sin verificar/.test(e.msg))).toBe(true);
    const ok = setup();
    const q = ok.client.ready();
    ok.children[0]!.emit(JSON.stringify({ ready: true, build: 19045, factory: "Downlevel", media: true, defaultOutput: true, appRouting: true }));
    await q;
    expect(ok.log.entries.some((e) => e.level === "warn")).toBe(false);
  });

  it("lanza el hijo SIN argumentos: nada de lo que se le pide va por la línea de comandos", async () => {
    const t = setup();
    void t.client.ready();
    expect(t.spawnArgs).toEqual([[]]);
  });

  it("audioHostArgs son fijos y solo llevan la ruta del script", () => {
    expect(audioHostArgs("C:\\app\\audioHost.ps1")).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\app\\audioHost.ps1"]);
  });
});

describe("audioClient · pedidos", () => {
  async function ready() {
    const t = setup();
    const p = t.client.ready();
    t.children[0]!.ready();
    await p;
    return { ...t, child: t.children[0]! };
  }

  it("cada operación manda una línea JSON con sus argumentos (por stdin), de a una", async () => {
    const t = await ready();
    const calls = [
      t.client.setOutputVolume("{0.0.0.00000000}.{abc}", 0.4),
      t.client.setOutputMute("{0.0.0.00000000}.{abc}", true),
      t.client.setAppVolume([10, 11], 0.25),
      t.client.setAppMute([10], false),
      t.client.setDefault("{0.0.0.00000000}.{abc}"),
      t.client.route([10, 11], "{0.0.0.00000000}.{abc}"),
      t.client.route([10], null),
      t.client.mediaControl("chrome.exe", "playPause", 1),
      t.client.art("chrome.exe", 1),
    ];
    // el hijo atiende de a un pedido: se contesta cada uno y recién ahí se escribe el siguiente
    for (let i = 0; i < 9; i++) {
      await flush();
      expect(t.child.requests()).toHaveLength(i + 1);
      t.child.reply(i + 1, i === 8 ? "/9j/AA==" : null);
    }
    const results = await Promise.all(calls);
    expect(results[8]).toBe("/9j/AA==");
    expect(t.child.requests().map((r) => [r.op, r.args])).toEqual([
      ["setOutputVolume", { winId: "{0.0.0.00000000}.{abc}", scalar: 0.4 }],
      ["setOutputMute", { winId: "{0.0.0.00000000}.{abc}", muted: true }],
      ["setAppVolume", { pids: [10, 11], scalar: 0.25 }],
      ["setAppMute", { pids: [10], muted: false }],
      ["setDefault", { winId: "{0.0.0.00000000}.{abc}" }],
      ["route", { pids: [10, 11], winId: "{0.0.0.00000000}.{abc}" }],
      ["route", { pids: [10], winId: null }],
      ["mediaControl", { aumid: "chrome.exe", key: "playPause", index: 1 }],
      ["art", { aumid: "chrome.exe", index: 1 }],
    ]);
  });

  it("D38/S1: el segundo pedido no se escribe hasta que el primero contesta", async () => {
    const t = await ready();
    const a = t.client.mediaControl("a.exe", "next", 0);
    const b = t.client.snapshot();
    await flush();
    expect(t.child.written).toHaveLength(1);
    t.child.reply(1, null);
    await a;
    await flush();
    expect(t.child.written).toHaveLength(2);
    t.child.reply(2, RAW);
    await expect(b).resolves.toEqual(RAW);
  });

  it("el plazo de 5 s corre desde que se escribe, no desde que se encola (los de atrás no vencen por esperar)", async () => {
    const t = await ready();
    const a = t.client.snapshot();
    const b = t.client.snapshot();
    await flush();
    t.clock.advance(4_000);
    t.child.reply(1, RAW);
    await a;
    await flush();
    t.clock.advance(4_000); // 8 s desde que se encoló el segundo, pero solo 4 s desde que se escribió
    expect(t.child.killed).toBe(false);
    t.child.reply(2, RAW);
    await expect(b).resolves.toEqual(RAW);
  });

  it("con 32 pedidos esperando, el siguiente se rechaza con 'busy' sin tocar al hijo", async () => {
    const t = await ready();
    const first = t.client.snapshot();
    const queued = Array.from({ length: 32 }, () => t.client.snapshot().catch((e: Error) => e));
    await flush();
    const extra = await t.client.snapshot().catch((e: Error) => e);
    expect((extra as Error).message).toMatch(/busy/);
    expect(t.child.written).toHaveLength(1);
    t.client.stop();
    await Promise.allSettled([first, ...queued]);
  });

  it("si el hijo se cae, los que esperaban turno también se rechazan", async () => {
    const t = await ready();
    const a = t.client.snapshot().catch((e: Error) => e);
    const b = t.client.snapshot().catch((e: Error) => e);
    await flush();
    t.child.die("exit 1");
    expect(((await a) as Error).message).toMatch(/exited/);
    expect(((await b) as Error).message).toMatch(/exited/);
  });

  it("un id con comillas, saltos de línea o '&' viaja como dato JSON, sin partir la línea", async () => {
    const t = await ready();
    const evil = 'x"\n& calc.exe "\\';
    const p = t.client.setDefault(evil);
    await flush();
    expect(t.child.written).toHaveLength(1);
    expect(t.child.written[0]).not.toContain("\n");
    expect(t.child.requests()[0]!.args).toEqual({ winId: evil });
    t.child.reply(1, null);
    await p;
  });

  it("una respuesta de otro id (ya vencido) no cierra el pedido en curso", async () => {
    const t = await ready();
    const p = t.client.snapshot();
    await flush();
    t.child.reply(99, { fantasma: true });
    t.child.reply(1, RAW);
    await expect(p).resolves.toEqual(RAW);
  });

  it("ignora las líneas que no son JSON o no son respuestas (y lo deja en el log)", async () => {
    const t = await ready();
    const p = t.client.snapshot();
    await flush();
    t.child.emit("Advertencia: algo de PowerShell");
    t.child.emit("");
    t.child.emit('{"nada":1}');
    t.child.reply(1, RAW);
    await expect(p).resolves.toEqual(RAW);
    expect(t.log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("un error del hijo rechaza solo ese pedido y conserva el mensaje", async () => {
    const t = await ready();
    const a = t.client.mediaControl("a.exe", "next", 0);
    const b = t.client.snapshot();
    const caught = a.catch((e: Error) => e);
    await flush();
    t.child.fail(1, "not_supported");
    await flush();
    t.child.reply(2, RAW);
    expect(((await caught) as Error).message).toBe("not_supported");
    await expect(b).resolves.toEqual(RAW);
    expect(t.child.killed).toBe(false);
  });

  it("rechaza argumentos fuera de rango SIN mandarlos al hijo", async () => {
    const t = await ready();
    await expect(t.client.setOutputVolume("x", 1.5)).rejects.toThrow(/inválid/i);
    await expect(t.client.setOutputVolume("x", -0.1)).rejects.toThrow(/inválid/i);
    await expect(t.client.setOutputVolume("x", NaN)).rejects.toThrow(/inválid/i);
    await expect(t.client.setAppVolume([], 0.5)).rejects.toThrow(/inválid/i);
    await expect(t.client.setAppVolume([0], 0.5)).rejects.toThrow(/inválid/i);
    await expect(t.client.setAppVolume([1.5], 0.5)).rejects.toThrow(/inválid/i);
    await expect(t.client.setAppMute(Array.from({ length: 65 }, (_, i) => i + 1), true)).rejects.toThrow(/inválid/i);
    await expect(t.client.mediaControl("a.exe", "stop" as never, 0)).rejects.toThrow(/inválid/i);
    await expect(t.client.mediaControl("a.exe", "next", -1)).rejects.toThrow(/inválid/i);
    await expect(t.client.art("a.exe", 99)).rejects.toThrow(/inválid/i);
    await expect(t.client.setDefault("")).rejects.toThrow(/inválid/i);
    await expect(t.client.setDefault("x".repeat(301))).rejects.toThrow(/inválid/i);
    expect(t.child.written).toEqual([]);
  });
});

describe("audioClient · fallas", () => {
  async function ready() {
    const t = setup();
    const p = t.client.ready();
    t.children[0]!.ready();
    await p;
    return { ...t, child: t.children[0]! };
  }

  it("sin respuesta en 5 s: se mata al hijo, se rechaza y el próximo pedido lo lanza de nuevo", async () => {
    const t = await ready();
    const p = t.client.snapshot();
    const caught = p.catch((e: Error) => e);
    await flush();
    t.clock.advance(5_000);
    expect(((await caught) as Error).message).toMatch(/timeout/);
    expect(t.child.killed).toBe(true);

    const p2 = t.client.snapshot();
    expect(t.children).toHaveLength(2);
    t.children[1]!.ready();
    await flush();
    t.children[1]!.reply(1, RAW);
    await expect(p2).resolves.toEqual(RAW);
  });

  it("si el hijo se cae, rechaza lo que esperaba", async () => {
    const t = await ready();
    const p = t.client.snapshot();
    const caught = p.catch((e: Error) => e);
    await flush();
    t.child.die("exit 1");
    expect(((await caught) as Error).message).toMatch(/exited/);
  });

  it("una respuesta tardía de un hijo descartado no toca al nuevo", async () => {
    const t = await ready();
    const old = t.child;
    const p = t.client.snapshot().catch((e: Error) => e);
    await flush();
    t.clock.advance(5_000);
    await p;
    const p2 = t.client.snapshot();
    t.children[1]!.ready();
    await flush();
    old.reply(1, { ...RAW, defaultWinId: "viejo" });
    t.children[1]!.reply(1, RAW);
    await expect(p2).resolves.toEqual(RAW);
  });

  it("3 caídas en un minuto: Audio queda no disponible y no se lanza más; pasado el minuto vuelve", async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      const p = t.client.ready().catch((e: Error) => e);
      t.children[i]!.die("exit 1");
      await p;
    }
    expect(t.children).toHaveLength(3);
    await expect(t.client.snapshot()).rejects.toThrow(/no disponible|unavailable/i);
    expect(t.children).toHaveLength(3);
    t.clock.advance(60_001);
    const p = t.client.ready();
    expect(t.children).toHaveLength(4);
    t.children[3]!.ready();
    await expect(p).resolves.toMatchObject({ defaultOutput: true });
  });

  it("si no se puede lanzar PowerShell, rechaza y cuenta como caída", async () => {
    const t = setup();
    t.setSpawnFails(true);
    await expect(t.client.snapshot()).rejects.toThrow(/no se pudo lanzar/);
    expect(t.log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("stop() mata al hijo, rechaza lo pendiente y después todo falla", async () => {
    const t = await ready();
    const p = t.client.snapshot().catch((e: Error) => e);
    await flush();
    t.client.stop();
    expect(((await p) as Error).message).toMatch(/stopped|detenido/);
    expect(t.child.killed).toBe(true);
    await expect(t.client.snapshot()).rejects.toThrow(/stopped|detenido/);
    t.client.stop(); // idempotente
  });
});

describe("createLineSplitter", () => {
  it("junta los pedazos hasta tener una línea completa", () => {
    const got: string[] = [];
    const feed = createLineSplitter((l) => got.push(l));
    feed("ab");
    feed("c\nde");
    feed("f\n\ngh\r\n");
    expect(got).toEqual(["abc", "def", "", "gh"]);
  });

  it("no se come caracteres de más de un byte partidos entre pedazos", () => {
    const got: string[] = [];
    const feed = createLineSplitter((l) => got.push(l));
    const bytes = Buffer.from("Altavoces ñandú\n", "utf8");
    feed(bytes.subarray(0, 12));
    feed(bytes.subarray(12));
    expect(got).toEqual(["Altavoces ñandú"]);
  });

  it("corta una línea absurdamente larga (un hijo roto no llena la memoria)", () => {
    const got: string[] = [];
    const feed = createLineSplitter((l) => got.push(l), 100);
    feed("x".repeat(250));
    feed("\nok\n");
    expect(got.at(-1)).toBe("ok");
    expect(got.every((l) => l.length <= 100)).toBe(true);
  });
});
