import { describe, expect, it } from "vitest";
import type { RawDisplay, RawWindow } from "../src/ports";
import { createNativeClient, type HostChild, type HostReply, type HostRequest } from "../src/platform/win/nativeClient";
import { FakeClock, MemLogger } from "./fakes";

class FakeChild implements HostChild {
  readonly sent: HostRequest[] = [];
  killed = false;
  private msg: ((m: HostReply) => void) | null = null;
  private exit: ((reason: string) => void) | null = null;
  send(m: HostRequest) {
    this.sent.push(m);
  }
  kill() {
    this.killed = true;
  }
  onMessage(cb: (m: HostReply) => void) {
    this.msg = cb;
  }
  onExit(cb: (reason: string) => void) {
    this.exit = cb;
  }
  // — lado "hijo" para los tests —
  reply(id: number, result: unknown) {
    this.msg?.({ id, ok: true, result });
  }
  fail(id: number, error: string) {
    this.msg?.({ id, ok: false, error });
  }
  die(reason = "exit 1") {
    this.exit?.(reason);
  }
}

function setup(over: { spawnFails?: boolean } = {}) {
  const clock = new FakeClock(0);
  const log = new MemLogger();
  const children: FakeChild[] = [];
  let failSpawn = over.spawnFails ?? false;
  const client = createNativeClient({
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

const DISPLAY: RawDisplay = {
  devicePath: "p",
  friendlyName: "x",
  outputTechnology: 5,
  active: true,
  primary: true,
  gdiName: null,
  bounds: { x: 0, y: 0, w: 1, h: 1 },
  workArea: null,
};
const flush = () => new Promise<void>((r) => setImmediate(r));

describe("nativeClient · lugar y orden de las pantallas", () => {
  const RECT = { x: -1920, y: 0, w: 1920, h: 1080 };

  it("prender manda también dónde estaba la pantalla (restoreAt)", async () => {
    const t = setup();
    const p = t.client.displays.setEnabled("path-tele", true, RECT);
    await flush();
    expect(t.children[0]?.sent).toEqual([{ id: 1, op: "displays.setEnabled", args: { devicePath: "path-tele", on: true, restoreAt: RECT } }]);
    t.children[0]?.reply(1, null);
    await expect(p).resolves.toBeUndefined();
  });

  it("sin restoreAt el pedido no lo lleva", async () => {
    const t = setup();
    void t.client.displays.setEnabled("x", false).catch(() => undefined);
    await flush();
    expect(t.children[0]?.sent[0]).toEqual({ id: 1, op: "displays.setEnabled", args: { devicePath: "x", on: false } });
  });

  it("displays.arrange manda la lista de lugares y resuelve cuando el hijo contesta", async () => {
    const t = setup();
    const items = [{ devicePath: "a", x: 0, y: 0 }, { devicePath: "b", x: 1920, y: 0 }];
    const p = t.client.displays.arrange(items);
    await flush();
    expect(t.children[0]?.sent).toEqual([{ id: 1, op: "displays.arrange", args: { items } }]);
    t.children[0]?.reply(1, null);
    await expect(p).resolves.toBeUndefined();
  });

  it("reordenar tiene el plazo largo (20 s), como prender y apagar", async () => {
    const t = setup();
    const p = t.client.displays.arrange([{ devicePath: "a", x: 0, y: 0 }]);
    const caught = p.catch((e: Error) => e.message);
    await flush();
    t.clock.advance(6_000);
    expect(t.children[0]?.killed).toBe(false);
    t.clock.advance(14_000);
    expect(await caught).toMatch(/timeout/);
  });
});

describe("nativeClient · mover ventanas", () => {
  it("windows.place manda el handle, el rectángulo y si hay que maximizar", async () => {
    const t = setup();
    const p = t.client.windows.place("0xABC", { x: 1920, y: 40, w: 800, h: 600 }, true);
    await flush();
    expect(t.children[0]?.sent).toEqual([
      { id: 1, op: "windows.place", args: { handle: "0xABC", rect: { x: 1920, y: 40, w: 800, h: 600 }, maximize: true } },
    ]);
    t.children[0]?.reply(1, null);
    await expect(p).resolves.toBeUndefined();
  });

  it("si el hijo dice que es una ventana de administrador, el error conserva la palabra 'elevated'", async () => {
    const t = setup();
    const p = t.client.windows.place("0x1", { x: 0, y: 0, w: 1, h: 1 }, false);
    await flush();
    t.children[0]?.fail(1, "elevated: acceso denegado");
    await expect(p).rejects.toThrow(/elevated/);
  });
});

describe("nativeClient · prender y apagar", () => {
  it("displays.setEnabled manda la ruta y si hay que prender, y resuelve cuando el hijo contesta", async () => {
    const t = setup();
    const p = t.client.displays.setEnabled("path-tele", true);
    await flush();
    expect(t.children[0]?.sent).toEqual([{ id: 1, op: "displays.setEnabled", args: { devicePath: "path-tele", on: true } }]);
    t.children[0]?.reply(1, null);
    await expect(p).resolves.toBeUndefined();
  });

  it("un error del hijo (SetDisplayConfig falló) rechaza ese pedido y el hijo sigue vivo", async () => {
    const t = setup();
    const p = t.client.displays.setEnabled("x", false);
    await flush();
    t.children[0]?.fail(1, "SetDisplayConfig devolvió 87");
    await expect(p).rejects.toThrow("SetDisplayConfig devolvió 87");
    expect(t.children[0]?.killed).toBe(false);
  });

  it("cambiar una pantalla tiene más plazo que leer: a los 5 s sigue esperando, a los 20 s vence", async () => {
    const t = setup();
    const p = t.client.displays.setEnabled("x", false);
    const caught = p.catch((e: Error) => e.message);
    await flush();
    t.clock.advance(6_000);
    expect(t.children[0]?.killed).toBe(false);
    t.clock.advance(14_000);
    expect(await caught).toMatch(/timeout/);
    expect(t.children[0]?.killed).toBe(true);
  });

  it("una lectura que queda esperando detrás de un cambio de pantalla no vence a los 5 s (no se mata al hijo a mitad de SetDisplayConfig)", async () => {
    const t = setup();
    const change = t.client.displays.setEnabled("x", false);
    const list = t.client.displays.list();
    await flush();
    t.clock.advance(6_000);
    expect(t.children[0]?.killed).toBe(false);
    t.children[0]?.reply(1, null);
    t.children[0]?.reply(2, []);
    await expect(change).resolves.toBeUndefined();
    await expect(list).resolves.toEqual([]);
  });

  it("leer sigue venciendo a los 5 s", async () => {
    const t = setup();
    const p = t.client.displays.list();
    const caught = p.catch((e: Error) => e.message);
    await flush();
    t.clock.advance(5_000);
    expect(await caught).toMatch(/timeout/);
  });
});

describe("nativeClient", () => {
  it("no lanza el proceso hijo hasta el primer pedido", () => {
    expect(setup().children).toHaveLength(0);
  });

  it("displays.list: manda el pedido, espera la respuesta y devuelve el resultado", async () => {
    const t = setup();
    const p = t.client.displays.list();
    await flush();
    expect(t.children).toHaveLength(1);
    expect(t.children[0]?.sent).toEqual([{ id: 1, op: "displays.list" }]);
    t.children[0]?.reply(1, [DISPLAY]);
    await expect(p).resolves.toEqual([DISPLAY]);
  });

  it("windows.foreground devuelve la ventana (o null)", async () => {
    const t = setup();
    const win: RawWindow = { handle: "0x1", title: "t", exe: "e.exe", className: "c", rect: { x: 0, y: 0, w: 1, h: 1 }, state: "normal" };
    const p = t.client.windows.foreground();
    await flush();
    t.children[0]?.reply(1, win);
    await expect(p).resolves.toEqual(win);
    const q = t.client.windows.foreground();
    await flush();
    t.children[0]?.reply(2, null);
    await expect(q).resolves.toBeNull();
  });

  it("pedidos simultáneos: cada respuesta llega a su pedido", async () => {
    const t = setup();
    const a = t.client.displays.list();
    const b = t.client.windows.foreground();
    await flush();
    expect(t.children).toHaveLength(1); // un solo hijo para los dos
    t.children[0]?.reply(2, null);
    t.children[0]?.reply(1, [DISPLAY]);
    await expect(a).resolves.toEqual([DISPLAY]);
    await expect(b).resolves.toBeNull();
  });

  it("un error del hijo rechaza solo ese pedido y el hijo sigue vivo", async () => {
    const t = setup();
    const p = t.client.displays.list();
    await flush();
    t.children[0]?.fail(1, "QueryDisplayConfig 87");
    await expect(p).rejects.toThrow("QueryDisplayConfig 87");
    expect(t.children[0]?.killed).toBe(false);
  });

  it("sin respuesta en 5 s: rechaza, mata al hijo y el próximo pedido lanza uno nuevo", async () => {
    const t = setup();
    const p = t.client.displays.list();
    const caught = p.catch((e: Error) => e.message);
    await flush();
    t.clock.advance(5_000);
    expect(await caught).toMatch(/timeout/);
    expect(t.children[0]?.killed).toBe(true);

    const q = t.client.displays.list();
    await flush();
    expect(t.children).toHaveLength(2);
    t.children[1]?.reply(1, []);
    await expect(q).resolves.toEqual([]);
  });

  it("una respuesta tardía de un hijo ya descartado se ignora", async () => {
    const t = setup();
    const p = t.client.displays.list().catch(() => undefined);
    await flush();
    t.clock.advance(5_000);
    await p;
    expect(() => t.children[0]?.reply(1, [DISPLAY])).not.toThrow();
  });

  it("si el hijo muere con pedidos pendientes, los rechaza; el siguiente pedido lanza otro", async () => {
    const t = setup();
    const p = t.client.displays.list();
    const caught = p.catch((e: Error) => e.message);
    await flush();
    t.children[0]?.die("access violation");
    expect(await caught).toMatch(/access violation/);
    const q = t.client.displays.list();
    await flush();
    expect(t.children).toHaveLength(2);
    t.children[1]?.reply(1, []);
    await expect(q).resolves.toEqual([]);
  });

  it("3 caídas en un minuto: deja de intentar y rechaza enseguida; pasado el minuto vuelve a probar", async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      const p = t.client.displays.list().catch(() => undefined);
      await flush();
      t.children[i]?.die();
      await p;
    }
    expect(t.children).toHaveLength(3);
    await expect(t.client.displays.list()).rejects.toThrow(/no disponible|unavailable/i);
    expect(t.children).toHaveLength(3); // no lanzó un cuarto

    t.clock.advance(60_001);
    const p = t.client.displays.list();
    await flush();
    expect(t.children).toHaveLength(4);
    t.children[3]?.reply(1, []);
    await expect(p).resolves.toEqual([]);
  });

  it("si no se puede lanzar el hijo, el pedido falla (y cuenta como caída)", async () => {
    const t = setup({ spawnFails: true });
    await expect(t.client.displays.list()).rejects.toThrow("no se pudo lanzar");
    t.setSpawnFails(false);
    const p = t.client.displays.list();
    await flush();
    t.children[0]?.reply(1, []);
    await expect(p).resolves.toEqual([]);
  });

  it("stop() mata al hijo, rechaza lo pendiente y no deja timers", async () => {
    const t = setup();
    const p = t.client.displays.list();
    const caught = p.catch((e: Error) => e.message);
    await flush();
    t.client.stop();
    expect(t.children[0]?.killed).toBe(true);
    expect(await caught).toMatch(/stopped|detenido/i);
    expect(t.clock.pendingTimers()).toBe(0);
    await expect(t.client.displays.list()).rejects.toThrow(/stopped|detenido/i);
  });

  it("registra las caídas en el log sin llenarlo con cada pedido", async () => {
    const t = setup();
    const p = t.client.displays.list().catch(() => undefined);
    await flush();
    t.children[0]?.die("boom");
    await p;
    expect(t.log.entries.filter((e) => e.level === "warn")).toHaveLength(1);
  });
});

describe("nativeClient · teclas de Media (D35, respaldo)", () => {
  it("cada tecla manda su código virtual y nada más", async () => {
    const t = setup();
    const keys = [t.client.mediaKeys.press("prev"), t.client.mediaKeys.press("playPause"), t.client.mediaKeys.press("next")];
    const c = t.children[0]!;
    expect(c.sent.map((s) => [s.op, s.args])).toEqual([
      ["input.mediaKey", { vk: 0xb1 }],
      ["input.mediaKey", { vk: 0xb3 }],
      ["input.mediaKey", { vk: 0xb0 }],
    ]);
    for (const s of c.sent) c.reply(s.id, null);
    await Promise.all(keys);
  });

  it("una tecla que no es de Media se rechaza sin llegar al hijo", async () => {
    const t = setup();
    await expect(t.client.mediaKeys.press("stop" as never)).rejects.toThrow(/inválid/i);
    expect(t.children).toHaveLength(0);
  });
});
