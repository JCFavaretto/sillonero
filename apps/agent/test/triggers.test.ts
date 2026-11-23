import { describe, expect, it } from "vitest";
import type { Library, Monitor, Scene, ScreensState } from "@proyecto-e/protocol";
import { createTriggers, AGENT_START_DELAY_MS, DISPLAY_POLL_MS, REPEAT_GUARD_MS } from "../src/scenes/triggers";
import { FakeClock, MemLogger } from "./fakes";

const TELE = "m_TeleLivingRoom01";
const OTRA = "m_OtraPantalla0001";
const STEPS = [{ kind: "bringAll" as const }];
const scene = (id: string, over: Partial<Scene> = {}): Scene => ({ id, name: id, steps: STEPS, ...over });
const mon = (id: string, enabled: boolean): Monitor =>
  ({ id, index: enabled ? 1 : null, nickname: null, name: id, connector: "hdmi", enabled, primary: false, bounds: null, lastBounds: null, resolution: null, canDisable: true, blockedBy: null, busy: false }) as Monitor;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(scenes: Scene[], opts: { teleOn?: boolean } = {}) {
  const clock = new FakeClock(0);
  const log = new MemLogger();
  const lib: Library = { launchers: [], scenes, deck: [] };
  const state = { tele: opts.teleOn ?? true, other: true };
  const ran: string[] = [];
  let running: string | null = null;
  let gate: Promise<void> | null = null;
  const triggers = createTriggers({
    library: { state: () => lib },
    async runScene(id) {
      ran.push(id);
      running = id;
      if (gate) await gate;
      running = null;
      return { ok: true };
    },
    running: () => running,
    screens: {
      async refresh() {},
      current: (): ScreensState => ({ monitors: [mon(TELE, state.tele), mon(OTRA, state.other)], foreground: null }),
    },
    clock,
    log,
  });
  return {
    clock,
    log,
    ran,
    triggers,
    state,
    lib,
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    setRunning: (id: string | null) => (running = id),
    async advance(ms: number) {
      clock.advance(ms);
      await flush();
    },
  };
}

describe("disparador: al iniciar el agente (agentStart)", () => {
  it("corre a los 20 s de arrancar, no antes, y una sola vez", async () => {
    const t = setup([scene("s_A", { trigger: { type: "agentStart" } }), scene("s_B")]);
    t.triggers.start();
    await t.advance(AGENT_START_DELAY_MS - 1);
    expect(t.ran).toEqual([]);
    await t.advance(1);
    expect(t.ran).toEqual(["s_A"]);
    await t.advance(5 * 60_000);
    expect(t.ran).toEqual(["s_A"]);
  });

  it("si hay varias, corren una después de la otra (nunca pisándose)", async () => {
    const t = setup([scene("s_A", { trigger: { type: "agentStart" } }), scene("s_B", { trigger: { type: "agentStart" } })]);
    t.triggers.start();
    await t.advance(AGENT_START_DELAY_MS);
    expect(t.ran).toEqual(["s_A", "s_B"]);
  });

  it("si en esos 20 s se borró la escena o le sacaron el disparador, no corre", async () => {
    const t = setup([scene("s_A", { trigger: { type: "agentStart" } })]);
    t.triggers.start();
    t.lib.scenes.length = 0;
    await t.advance(AGENT_START_DELAY_MS);
    expect(t.ran).toEqual([]);
  });

  it("si ya hay otra escena corriendo, no corre (y lo anota)", async () => {
    const t = setup([scene("s_A", { trigger: { type: "agentStart" } })]);
    t.setRunning("s_OTRA");
    t.triggers.start();
    await t.advance(AGENT_START_DELAY_MS);
    expect(t.ran).toEqual([]);
    expect(t.log.entries.some((e) => e.msg.includes("skipped"))).toBe(true);
  });

  it("stop() antes de los 20 s la cancela", async () => {
    const t = setup([scene("s_A", { trigger: { type: "agentStart" } })]);
    t.triggers.start();
    t.triggers.stop();
    await t.advance(AGENT_START_DELAY_MS * 2);
    expect(t.ran).toEqual([]);
  });
});

describe("disparador: al prender una pantalla (displayOn)", () => {
  const withTele = () => scene("s_T", { trigger: { type: "displayOn", displayId: TELE } });

  it("corre cuando esa pantalla pasa de apagada a prendida", async () => {
    const t = setup([withTele()], { teleOn: false });
    t.triggers.start();
    await t.advance(DISPLAY_POLL_MS); // primera lectura: solo toma nota
    expect(t.ran).toEqual([]);
    t.state.tele = true;
    await t.advance(DISPLAY_POLL_MS);
    expect(t.ran).toEqual(["s_T"]);
  });

  it("si la pantalla ya estaba prendida al arrancar, no corre", async () => {
    const t = setup([withTele()], { teleOn: true });
    t.triggers.start();
    await t.advance(DISPLAY_POLL_MS * 3);
    expect(t.ran).toEqual([]);
  });

  it("apagarla no corre nada; solo prender", async () => {
    const t = setup([withTele()], { teleOn: true });
    t.triggers.start();
    await t.advance(DISPLAY_POLL_MS);
    t.state.tele = false;
    await t.advance(DISPLAY_POLL_MS);
    expect(t.ran).toEqual([]);
  });

  it("otra pantalla que se prende no la dispara", async () => {
    const t = setup([withTele()], { teleOn: true });
    t.state.other = false;
    t.triggers.start();
    await t.advance(DISPLAY_POLL_MS);
    t.state.other = true;
    await t.advance(DISPLAY_POLL_MS);
    expect(t.ran).toEqual([]);
  });

  it("anti-repetición: un cable flojo (apaga y prende seguido) no la repite antes de 60 s", async () => {
    const t = setup([withTele()], { teleOn: false });
    t.triggers.start();
    await t.advance(DISPLAY_POLL_MS);
    t.state.tele = true;
    await t.advance(DISPLAY_POLL_MS);
    expect(t.ran).toEqual(["s_T"]);
    t.state.tele = false;
    await t.advance(DISPLAY_POLL_MS);
    t.state.tele = true;
    await t.advance(DISPLAY_POLL_MS);
    expect(t.ran).toEqual(["s_T"]);
    // pasado el minuto, sí
    await t.advance(REPEAT_GUARD_MS);
    t.state.tele = false;
    await t.advance(DISPLAY_POLL_MS);
    t.state.tele = true;
    await t.advance(DISPLAY_POLL_MS);
    expect(t.ran).toEqual(["s_T", "s_T"]);
  });

  it("no pisa a otra escena que está corriendo", async () => {
    const t = setup([withTele()], { teleOn: false });
    t.triggers.start();
    await t.advance(DISPLAY_POLL_MS);
    t.setRunning("s_OTRA");
    t.state.tele = true;
    await t.advance(DISPLAY_POLL_MS);
    expect(t.ran).toEqual([]);
  });

  it("sin escenas con displayOn no lee las pantallas para nada", async () => {
    let refreshes = 0;
    const clock = new FakeClock(0);
    const triggers = createTriggers({
      library: { state: () => ({ launchers: [], scenes: [scene("s_A")], deck: [] }) },
      runScene: async () => ({ ok: true }),
      running: () => null,
      screens: { refresh: async () => void refreshes++, current: () => null },
      clock,
      log: new MemLogger(),
    });
    triggers.start();
    clock.advance(DISPLAY_POLL_MS * 5);
    await flush();
    expect(refreshes).toBe(0);
  });

  it("si leer las pantallas falla, sigue andando en el próximo turno", async () => {
    const clock = new FakeClock(0);
    const ran: string[] = [];
    let fail = true;
    let on = false;
    const triggers = createTriggers({
      library: { state: () => ({ launchers: [], scenes: [scene("s_T", { trigger: { type: "displayOn", displayId: TELE } })], deck: [] }) },
      runScene: async (id) => (ran.push(id), { ok: true }),
      running: () => null,
      screens: {
        refresh: async () => {
          if (fail) throw new Error("ccd boom");
        },
        current: () => ({ monitors: [mon(TELE, on)], foreground: null }),
      },
      clock,
      log: new MemLogger(),
    });
    triggers.start();
    clock.advance(DISPLAY_POLL_MS);
    await flush();
    fail = false;
    clock.advance(DISPLAY_POLL_MS); // primera lectura buena
    await flush();
    on = true;
    clock.advance(DISPLAY_POLL_MS);
    await flush();
    expect(ran).toEqual(["s_T"]);
  });
});
