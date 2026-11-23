import { describe, expect, it } from "vitest";
import { createInputClient, type InputChild, type InputReply, type InputRequest } from "../src/platform/win/inputClient";
import { FakeClock, MemLogger } from "./fakes";

class FakeChild implements InputChild {
  readonly sent: InputRequest[] = [];
  killed = false;
  private msg: ((m: InputReply) => void) | null = null;
  private exit: ((reason: string) => void) | null = null;
  send(m: InputRequest) {
    this.sent.push(m);
  }
  kill() {
    this.killed = true;
  }
  onMessage(cb: (m: InputReply) => void) {
    this.msg = cb;
  }
  onExit(cb: (reason: string) => void) {
    this.exit = cb;
  }
  reply(id: number, result: unknown = null) {
    this.msg?.({ id, ok: true, result });
  }
  fail(id: number, error: string) {
    this.msg?.({ id, ok: false, error });
  }
  die(reason = "exit 1") {
    this.exit?.(reason);
  }
  ops() {
    return this.sent.map((s) => s.op);
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup(over: { spawnFails?: boolean } = {}) {
  const clock = new FakeClock(0);
  const log = new MemLogger();
  const children: FakeChild[] = [];
  let failSpawn = over.spawnFails ?? false;
  const client = createInputClient({
    clock,
    log,
    spawn: () => {
      if (failSpawn) throw new Error("no se pudo lanzar");
      const c = new FakeChild();
      children.push(c);
      return c;
    },
  });
  return { clock, log, children, client, setSpawnFails: (v: boolean) => (failSpawn = v) };
}

describe("lecturas y acciones", () => {
  it("no lanza el hijo hasta el primer pedido, y available() es true mientras tanto", () => {
    const { children, client } = setup();
    expect(children).toHaveLength(0);
    expect(client.available()).toBe(true);
  });

  it("cursor y monitors devuelven lo que contesta el hijo", async () => {
    const { children, client } = setup();
    const c = client.cursor();
    children[0]!.reply(1, { x: 5, y: 6 });
    expect(await c).toEqual({ x: 5, y: 6 });
    const m = client.monitors();
    const mons = { list: [{ x: 0, y: 0, w: 1, h: 1, scale: 1 }], virtual: { x: 0, y: 0, w: 1, h: 1 } };
    children[0]!.reply(2, mons);
    expect(await m).toEqual(mons);
  });

  it("button, keys y text salen en el orden en que se piden", () => {
    const { children, client } = setup();
    void client.button("left", "down").catch(() => undefined);
    void client.keys([[0x41, false, false]]).catch(() => undefined);
    void client.text([0x61]).catch(() => undefined);
    void client.button("left", "up").catch(() => undefined);
    expect(children[0]!.ops()).toEqual(["button", "keys", "text", "button"]);
    expect(children[0]!.sent[1]!.args).toEqual({ events: [[0x41, false, false]] });
  });

  it("una respuesta de error rechaza con el motivo", async () => {
    const { children, client } = setup();
    const p = client.keys([[0x41, false, false]]);
    children[0]!.fail(1, "SendInput mandó 0 de 2 eventos (¿ventana de administrador?)");
    await expect(p).rejects.toThrow(/administrador/);
  });

  it("elevated devuelve el booleano", async () => {
    const { children, client } = setup();
    const p = client.elevated();
    children[0]!.reply(1, true);
    expect(await p).toBe(true);
  });
});

describe("fusión de movimientos (D56)", () => {
  it("con un moveAbs en vuelo, los siguientes se fusionan en el último", async () => {
    const { children, client } = setup();
    for (let i = 1; i <= 10; i++) client.moveAbs(i * 100, i * 100);
    const c = children[0]!;
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]!.args).toEqual({ nx: 100, ny: 100 });
    c.reply(1);
    await flush();
    expect(c.sent).toHaveLength(2);
    expect(c.sent[1]!.args).toEqual({ nx: 1000, ny: 1000 });
    c.reply(2);
    await flush();
    expect(c.sent).toHaveLength(2); // nada más para mandar
  });

  it("sin nada en vuelo, cada moveAbs sale enseguida", async () => {
    const { children, client } = setup();
    client.moveAbs(1, 1);
    children[0]!.reply(1);
    await flush();
    client.moveAbs(2, 2);
    expect(children[0]!.sent).toHaveLength(2);
  });

  it("la rueda en vuelo suma lo que llega después", async () => {
    const { children, client } = setup();
    client.wheel(0, 120);
    client.wheel(0, 120);
    client.wheel(0, -30);
    client.wheel(60, 0);
    const c = children[0]!;
    expect(c.sent).toHaveLength(1);
    c.reply(1);
    await flush();
    expect(c.sent[1]!.args).toEqual({ dx: 60, dy: 90 });
  });

  it("la rueda acumulada se manda en tandas de hasta 1200", async () => {
    const { children, client } = setup();
    client.wheel(0, 120);
    for (let i = 0; i < 20; i++) client.wheel(0, 120);
    const c = children[0]!;
    c.reply(1);
    await flush();
    expect(c.sent[1]!.args).toEqual({ dx: 0, dy: 1200 });
    c.reply(2);
    await flush();
    expect(c.sent[2]!.args).toEqual({ dx: 0, dy: 1200 });
    expect(c.sent).toHaveLength(3);
  });

  it("la rueda acumulada tiene tope (no sigue scrolleando mucho después de que el celu corta)", async () => {
    const { children, client } = setup();
    client.wheel(0, 120);
    for (let i = 0; i < 500; i++) client.wheel(0, 1200);
    const c = children[0]!;
    let total = 0;
    for (let id = 1; id < 40 && c.sent.length >= id; id++) {
      total += (c.sent[id - 1]!.args as { dy: number }).dy;
      c.reply(id);
      await flush();
    }
    expect(total).toBeLessThanOrEqual(120 + 12_000);
  });

  it("si el moveAbs en vuelo falla, igual manda el que estaba esperando y no hay promesas sin atajar", async () => {
    const { children, client } = setup();
    client.moveAbs(1, 1);
    client.moveAbs(2, 2);
    children[0]!.fail(1, "boom");
    await flush();
    expect(children[0]!.sent).toHaveLength(2);
  });
});

describe("caídas y plazos", () => {
  it("un pedido sin respuesta en 3 s mata al hijo y rechaza", async () => {
    const { clock, children, client } = setup();
    const p = client.cursor();
    clock.advance(3_001);
    await expect(p).rejects.toThrow(/timeout/);
    expect(children[0]!.killed).toBe(true);
  });

  it("si el hijo se cae, lo pendiente rechaza y el siguiente pedido lo relanza", async () => {
    const { children, client } = setup();
    const p = client.cursor();
    children[0]!.die();
    await expect(p).rejects.toThrow(/exited/);
    void client.cursor().catch(() => undefined);
    expect(children).toHaveLength(2);
  });

  it("3 caídas en un minuto: available() = false y todo rechaza", async () => {
    const { children, client } = setup();
    for (let i = 0; i < 3; i++) {
      const p = client.cursor();
      children.at(-1)!.die();
      await p.catch(() => undefined);
    }
    expect(client.available()).toBe(false);
    await expect(client.cursor()).rejects.toThrow(/unavailable|no disponible/);
    expect(children).toHaveLength(3);
  });

  it("pasado el minuto vuelve a estar disponible", async () => {
    const { clock, children, client } = setup();
    for (let i = 0; i < 3; i++) {
      const p = client.cursor();
      children.at(-1)!.die();
      await p.catch(() => undefined);
    }
    clock.advance(61_000);
    expect(client.available()).toBe(true);
    void client.cursor().catch(() => undefined);
    expect(children).toHaveLength(4);
  });

  it("si no se puede lanzar el hijo, cuenta como caída y rechaza", async () => {
    const { client } = setup({ spawnFails: true });
    await expect(client.cursor()).rejects.toThrow(/lanzar/);
  });

  it("moveAbs con el hijo caído no tira excepción (se pierde ese movimiento)", () => {
    const { client } = setup({ spawnFails: true });
    expect(() => client.moveAbs(1, 1)).not.toThrow();
  });

  it("stop() mata al hijo, rechaza lo pendiente y no deja timers", async () => {
    const { clock, children, client } = setup();
    const p = client.cursor();
    client.stop();
    await expect(p).rejects.toThrow(/stopped/);
    expect(children[0]!.killed).toBe(true);
    expect(clock.pendingTimers()).toBe(0);
    await expect(client.cursor()).rejects.toThrow(/stopped/);
  });
});
