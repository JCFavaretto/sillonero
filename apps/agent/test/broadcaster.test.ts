import { describe, expect, it } from "vitest";
import { STATE_INTERVAL_MS, type ScreensState, type SystemState } from "@proyecto-e/protocol";
import { createBroadcaster } from "../src/remote/broadcaster";
import type { Session } from "../src/remote/session";
import { createSampler } from "../src/state/system";
import type { ScreensService } from "../src/screens/service";
import { FakeClock, FakeSystemInfo } from "./fakes";

function fakeSession(): Session & { pushed: SystemState[]; screens: [string, ScreensState][]; authed: boolean } {
  const s = {
    pushed: [] as SystemState[],
    screens: [] as [string, ScreensState][],
    authed: true,
    deviceId: "d",
    start: () => undefined,
    receive: () => undefined,
    handleClose: () => undefined,
    revoke: () => undefined,
    shutdown: () => undefined,
    pushState(state: SystemState) {
      s.pushed.push(state);
    },
    pushScreens(state: ScreensState, kind: "snapshot" | "update") {
      s.screens.push([kind, state]);
    },
    pushExtra() {},
    isAuthenticated: () => s.authed,
  };
  return s;
}

function setup() {
  const clock = new FakeClock(0);
  const sys = new FakeSystemInfo();
  const sampler = createSampler({ sys, clock, agentVersion: "0.1.0" });
  const broadcaster = createBroadcaster({ clock, sampler });
  return { clock, sys, sampler, broadcaster };
}

describe("broadcaster", () => {
  it("sin sesiones no hay ningún timer corriendo", () => {
    const { clock, broadcaster } = setup();
    expect(clock.pendingTimers()).toBe(0);
    expect(broadcaster.size()).toBe(0);
  });

  it("con una sesión autenticada manda state.update cada 2 s", () => {
    const { clock, broadcaster } = setup();
    const s = fakeSession();
    broadcaster.add(s);
    clock.advance(STATE_INTERVAL_MS - 1);
    expect(s.pushed).toHaveLength(0);
    clock.advance(1);
    expect(s.pushed).toHaveLength(1);
    clock.advance(STATE_INTERVAL_MS);
    expect(s.pushed).toHaveLength(2);
  });

  it("toma una sola muestra por tick y la reparte a todas las sesiones", () => {
    const { clock, sys, broadcaster } = setup();
    const a = fakeSession();
    const b = fakeSession();
    broadcaster.add(a);
    broadcaster.add(b);
    sys.freeMem = 123;
    clock.advance(STATE_INTERVAL_MS);
    expect(a.pushed).toHaveLength(1);
    expect(b.pushed[0]).toBe(a.pushed[0]);
    const state = a.pushed[0]!;
    expect(state.memTotalBytes - state.memUsedBytes).toBe(123);
  });

  it("agregar la misma sesión dos veces no duplica los envíos", () => {
    const { clock, broadcaster } = setup();
    const s = fakeSession();
    broadcaster.add(s);
    broadcaster.add(s);
    clock.advance(STATE_INTERVAL_MS);
    expect(s.pushed).toHaveLength(1);
  });

  it("al sacar la última sesión se apaga el intervalo", () => {
    const { clock, broadcaster } = setup();
    const a = fakeSession();
    const b = fakeSession();
    broadcaster.add(a);
    broadcaster.add(b);
    broadcaster.remove(a);
    expect(clock.pendingTimers()).toBe(1);
    broadcaster.remove(b);
    expect(clock.pendingTimers()).toBe(0);
    clock.advance(10 * STATE_INTERVAL_MS);
    expect(a.pushed).toHaveLength(0);
  });

  it("una sesión que dejó de estar autenticada se descarta en el próximo tick", () => {
    const { clock, broadcaster } = setup();
    const s = fakeSession();
    broadcaster.add(s);
    s.authed = false;
    clock.advance(STATE_INTERVAL_MS);
    expect(s.pushed).toHaveLength(0);
    expect(broadcaster.size()).toBe(0);
    expect(clock.pendingTimers()).toBe(0);
  });

  it("stop() saca todo y apaga el intervalo", () => {
    const { clock, broadcaster } = setup();
    broadcaster.add(fakeSession());
    broadcaster.stop();
    expect(broadcaster.size()).toBe(0);
    expect(clock.pendingTimers()).toBe(0);
  });
});

const flush = () => new Promise<void>((r) => setImmediate(r));
const STATE_A: ScreensState = { monitors: [], foreground: { title: "A", app: "a.exe", monitorId: null } };
const STATE_B: ScreensState = { monitors: [], foreground: { title: "B", app: "b.exe", monitorId: null } };

function fakeScreens(initial: ScreensState | null) {
  const svc = {
    state: initial,
    nextChanged: true,
    refreshes: 0,
    refresh: (): Promise<{ changed: boolean; state: ScreensState | null }> => {
      svc.refreshes++;
      const changed = svc.nextChanged;
      svc.nextChanged = false;
      return Promise.resolve({ changed, state: svc.state });
    },
    current: () => svc.state,
    raw: () => [],
    available: () => ({ ok: true as const }),
    rename: () => Promise.resolve({ ok: true as const }),
    setEnabled: () => Promise.resolve({ ok: true as const }),
    subscribe: () => () => undefined,
    moveActive: () => Promise.resolve({ ok: true as const }),
    identify: () => Promise.resolve({ ok: true as const }),
    setOrder: () => Promise.resolve({ ok: true as const }),
  };
  return svc satisfies ScreensService;
}

describe("broadcaster con pantallas", () => {
  function withScreens(initial: ScreensState | null) {
    const clock = new FakeClock(0);
    const sampler = createSampler({ sys: new FakeSystemInfo(), clock, agentVersion: "0.1.0" });
    const screens = fakeScreens(initial);
    const broadcaster = createBroadcaster({ clock, sampler, screens });
    return { clock, screens, broadcaster };
  }

  it("al sumar una sesión le manda un screens.snapshot", async () => {
    const { screens, broadcaster } = withScreens(STATE_A);
    const s = fakeSession();
    broadcaster.add(s);
    await flush();
    expect(screens.refreshes).toBe(1);
    expect(s.screens).toEqual([["snapshot", STATE_A]]);
  });

  it("en cada tick lee Windows, pero solo manda update si cambió", async () => {
    const { clock, screens, broadcaster } = withScreens(STATE_A);
    const s = fakeSession();
    broadcaster.add(s);
    await flush();
    s.screens.length = 0;

    screens.nextChanged = false;
    clock.advance(STATE_INTERVAL_MS);
    await flush();
    expect(s.screens).toEqual([]);

    screens.state = STATE_B;
    screens.nextChanged = true;
    clock.advance(STATE_INTERVAL_MS);
    await flush();
    expect(s.screens).toEqual([["update", STATE_B]]);
  });

  it("el update llega a todas las sesiones autenticadas", async () => {
    const { clock, screens, broadcaster } = withScreens(STATE_A);
    const a = fakeSession();
    const b = fakeSession();
    broadcaster.add(a);
    broadcaster.add(b);
    await flush();
    screens.state = STATE_B;
    screens.nextChanged = true;
    clock.advance(STATE_INTERVAL_MS);
    await flush();
    expect(a.screens.at(-1)).toEqual(["update", STATE_B]);
    expect(b.screens.at(-1)).toEqual(["update", STATE_B]);
  });

  it("si Windows nunca pudo leerse (estado null) no manda nada", async () => {
    const { clock, broadcaster } = withScreens(null);
    const s = fakeSession();
    broadcaster.add(s);
    await flush();
    clock.advance(STATE_INTERVAL_MS);
    await flush();
    expect(s.screens).toEqual([]);
  });

  it("sin sesiones no lee Windows: el intervalo está apagado", async () => {
    const { clock, screens } = withScreens(STATE_A);
    clock.advance(STATE_INTERVAL_MS * 3);
    await flush();
    expect(screens.refreshes).toBe(0);
  });

  it("un servicio que rechaza no rompe el broadcaster ni el state.update de CPU/RAM", async () => {
    const { clock, screens, broadcaster } = withScreens(STATE_A);
    screens.refresh = () => Promise.reject(new Error("boom"));
    const s = fakeSession();
    broadcaster.add(s);
    await flush();
    clock.advance(STATE_INTERVAL_MS);
    await flush();
    expect(s.pushed.length).toBe(1);
  });
});
