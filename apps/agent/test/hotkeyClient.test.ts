import { describe, expect, it } from "vitest";
import { createHotkeyClient, type HotkeyChild, type HotkeyMessage, type HotkeyRequest } from "../src/platform/win/hotkeyClient";
import { FakeClock, MemLogger } from "./fakes";

class FakeChild implements HotkeyChild {
  readonly sent: HotkeyRequest[] = [];
  killed = false;
  private msg: ((m: HotkeyMessage) => void) | null = null;
  private exit: ((reason: string) => void) | null = null;
  send(m: HotkeyRequest) {
    this.sent.push(m);
  }
  kill() {
    this.killed = true;
  }
  onMessage(cb: (m: HotkeyMessage) => void) {
    this.msg = cb;
  }
  onExit(cb: (reason: string) => void) {
    this.exit = cb;
  }
  reply(id: number, result: unknown) {
    this.msg?.({ id, ok: true, result } as HotkeyMessage);
  }
  fail(id: number, error: string) {
    this.msg?.({ id, ok: false, error });
  }
  press(hotkey: number) {
    this.msg?.({ event: "pressed", hotkey });
  }
  die(reason = "exit 1") {
    this.exit?.(reason);
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
  const client = createHotkeyClient({
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

const KEYS = [
  { id: 1, vk: 0x54 },
  { id: 2, vk: 0x4d },
];

describe("cliente del hijo de atajos", () => {
  it("no lanza el hijo hasta el primer set, y available() es true mientras tanto", () => {
    const { children, client } = setup();
    expect(children).toHaveLength(0);
    expect(client.available()).toBe(true);
  });

  it("set manda las teclas y devuelve lo que contesta el hijo", async () => {
    const { children, client } = setup();
    const p = client.set(KEYS);
    expect(children[0]!.sent).toEqual([{ id: 1, op: "set", args: { keys: KEYS } }]);
    const results = [
      { id: 1, ok: true },
      { id: 2, ok: false, busy: true, error: "1409" },
    ];
    children[0]!.reply(1, results);
    expect(await p).toEqual(results);
  });

  it("un set vacío sin hijo no lanza nada", async () => {
    const { children, client } = setup();
    expect(await client.set([])).toEqual([]);
    expect(children).toHaveLength(0);
  });

  it("un set vacío con hijo vivo se manda (suelta todo)", async () => {
    const { children, client } = setup();
    const p = client.set(KEYS);
    children[0]!.reply(1, []);
    await p;
    const q = client.set([]);
    expect(children[0]!.sent[1]).toEqual({ id: 2, op: "set", args: { keys: [] } });
    children[0]!.reply(2, []);
    expect(await q).toEqual([]);
  });

  it("los avisos de tecla apretada llegan al callback", async () => {
    const { children, client } = setup();
    const seen: number[] = [];
    client.onPressed((id) => seen.push(id));
    const p = client.set(KEYS);
    children[0]!.reply(1, []);
    await p;
    children[0]!.press(2);
    expect(seen).toEqual([2]);
  });

  it("una respuesta de error rechaza con el motivo", async () => {
    const { children, client } = setup();
    const p = client.set(KEYS);
    children[0]!.fail(1, "boom");
    await expect(p).rejects.toThrow("boom");
  });

  it("si el hijo se cae, se relanza solo y vuelve a registrar lo último pedido", async () => {
    const { children, clock, client } = setup();
    const p = client.set(KEYS);
    children[0]!.reply(1, []);
    await p;
    children[0]!.die();
    await flush();
    clock.advance(1_000);
    await flush();
    expect(children).toHaveLength(2);
    expect(children[1]!.sent).toEqual([{ id: 1, op: "set", args: { keys: KEYS } }]);
  });

  it("avisa cuando el hijo se relanzó y volvió a registrar (para que el panel no quede desfasado)", async () => {
    const { children, clock, client } = setup();
    let restored = 0;
    client.onRestored(() => restored++);
    const p = client.set(KEYS);
    children[0]!.reply(1, []);
    await p;
    children[0]!.die();
    await flush();
    clock.advance(1_000);
    await flush();
    children[1]!.reply(1, []);
    await flush();
    expect(restored).toBe(1);
  });

  it("no relanza si lo último pedido era soltar todo", async () => {
    const { children, clock, client } = setup();
    const p = client.set(KEYS);
    children[0]!.reply(1, []);
    await p;
    const q = client.set([]);
    children[0]!.reply(2, []);
    await q;
    children[0]!.die();
    await flush();
    clock.advance(5_000);
    await flush();
    expect(children).toHaveLength(1);
  });

  it("un pedido sin respuesta en 3 s mata al hijo y rechaza", async () => {
    const { children, clock, client } = setup();
    const p = client.set(KEYS);
    const assertion = expect(p).rejects.toThrow(/timeout/);
    clock.advance(3_000);
    await assertion;
    expect(children[0]!.killed).toBe(true);
  });

  it("3 caídas en un minuto: available() = false y no relanza más", async () => {
    const { children, clock, client } = setup();
    const p = client.set(KEYS);
    children[0]!.reply(1, []);
    await p;
    for (let i = 0; i < 3; i++) {
      children[i]!.die();
      await flush();
      clock.advance(1_000);
      await flush();
    }
    expect(client.available()).toBe(false);
    expect(children).toHaveLength(3);
    await expect(client.set(KEYS)).rejects.toThrow(/no disponible/);
  });

  it("stop() mata al hijo, rechaza lo pendiente y no relanza", async () => {
    const { children, clock, client } = setup();
    const p = client.set(KEYS);
    const assertion = expect(p).rejects.toThrow(/stopped/);
    client.stop();
    await assertion;
    expect(children[0]!.killed).toBe(true);
    clock.advance(5_000);
    await flush();
    expect(children).toHaveLength(1);
    expect(client.available()).toBe(false);
  });

  it("si no se puede lanzar el hijo, set rechaza y cuenta como caída", async () => {
    const { client } = setup({ spawnFails: true });
    await expect(client.set(KEYS)).rejects.toThrow(/no se pudo lanzar/);
  });
});
