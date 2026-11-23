import { describe, expect, it } from "vitest";
import type { CommandError, Scene, ScreensState } from "@proyecto-e/protocol";
import { createSceneRunner, type ScreensControl } from "../src/scenes/runner";
import type { LaunchOutcome } from "../src/apps/launch";
import { FakeClock, FakeRandom, MemLogger } from "./fakes";

const A = "m_AAAAAAAAAAAAAAAA";
const B = "m_BBBBBBBBBBBBBBBB";
const mon = (id: string, enabled: boolean) => ({ id, enabled }) as ScreensState["monitors"][number];

type AudioOutcome = { ok: true } | { ok: false; reason: CommandError };
function setup(opts: { scenes?: Scene[]; launch?: (i: number) => LaunchOutcome | Promise<LaunchOutcome>; catalogHas?: (id: string) => boolean; audio?: { appears?: boolean; setDefault?: AudioOutcome; setVolume?: AudioOutcome } | null } = {}) {
  const clock = new FakeClock();
  const calls: string[] = [];
  const progress: { index: number; status: string; reason: CommandError | null }[] = [];
  let monitors = [mon(A, true), mon(B, false)];
  const screens: ScreensControl = {
    current: () => ({ monitors, foreground: null }) as ScreensState,
    async setEnabled(id, on) {
      calls.push(`screen ${id} ${on ? "on" : "off"}`);
      if (id === "m_FAIL" + "AAAAAAAAAAA") return { ok: false, reason: "failed" };
      monitors = monitors.map((m) => (m.id === id ? { ...m, enabled: on } : m));
      return { ok: true };
    },
  };
  let n = 0;
  const runner = createSceneRunner({
    library: { state: () => ({ launchers: [], scenes: opts.scenes ?? [], deck: [] }) },
    screens,
    windows: { bringAll: async () => (calls.push("bringAll"), { ok: true as const }) },
    launch: { runTarget: async (t) => (calls.push("open " + (t.kind === "app" ? t.appId : t.url)), (opts.launch ?? (() => ({ status: "ok" as const })))(n++)) },
    catalog: { has: async (id) => (opts.catalogHas ?? (() => true))(id) },
    clock,
    random: new FakeRandom(),
    log: new MemLogger(),
    audio:
      opts.audio === null
        ? undefined
        : {
            waitForOutput: async (id, ms) => (calls.push(`wait ${id} ${ms}`), opts.audio?.appears ?? true),
            setDefault: async (id) => (calls.push(`default ${id}`), opts.audio?.setDefault ?? { ok: true as const }),
            setVolume: async (target, v) => (calls.push(`volume ${target.id} ${v}`), opts.audio?.setVolume ?? { ok: true as const }),
          },
    emit: (p) => progress.push({ index: p.index, status: p.status, reason: p.reason }),
  });
  return { runner, calls, progress, clock };
}
const scene = (steps: Scene["steps"]): Scene => ({ id: "s_AAAAAAAAAA", name: "Juego", steps });
const openApp = (appId: string): Scene["steps"][number] => ({ kind: "open", target: { kind: "app", appId }, name: "x", iconKey: null, place: null });

describe("runner", () => {
  it("corre los pasos en orden y avisa cada uno (corriendo → resultado)", async () => {
    const t = setup({ scenes: [scene([openApp("Discord"), { kind: "bringAll" }, openApp("Cursor")])] });
    const r = await t.runner.run("s_AAAAAAAAAA");
    expect(t.calls).toEqual(["open Discord", "bringAll", "open Cursor"]);
    expect(r).toEqual({ ok: true, steps: ["ok", "ok", "ok"] });
    expect(t.progress).toEqual([
      { index: 0, status: "running", reason: null }, { index: 0, status: "ok", reason: null },
      { index: 1, status: "running", reason: null }, { index: 1, status: "ok", reason: null },
      { index: 2, status: "running", reason: null }, { index: 2, status: "ok", reason: null },
    ]);
  });
  it("si un paso falla, los demás siguen y el resultado lo dice", async () => {
    const t = setup({ scenes: [scene([openApp("a"), openApp("b"), openApp("c")])], launch: (i) => (i === 1 ? { status: "failed", reason: "launch_failed" } : { status: "ok" }) });
    const r = await t.runner.run("s_AAAAAAAAAA");
    expect(t.calls).toEqual(["open a", "open b", "open c"]);
    expect(r).toEqual({ ok: false, reason: "failed", steps: ["ok", "failed", "ok"] });
    expect(t.progress.find((p) => p.status === "failed")).toMatchObject({ index: 1, reason: "launch_failed" });
  });
  it("abierta pero sin ubicar (partial) no cuenta como falla", async () => {
    const t = setup({ scenes: [scene([openApp("a")])], launch: () => ({ status: "partial", reason: "not_placed" }) });
    expect(await t.runner.run("s_AAAAAAAAAA")).toEqual({ ok: true, steps: ["partial"] });
  });
  it("pantallas: prende antes de apagar y salta lo que ya está como se pidió", async () => {
    const t = setup({ scenes: [scene([{ kind: "screens", monitors: [{ monitorId: A, enabled: false }, { monitorId: B, enabled: true }] }])] });
    const r = await t.runner.run("s_AAAAAAAAAA");
    expect(t.calls).toEqual([`screen ${B} on`, `screen ${A} off`]);
    expect(r.ok).toBe(true);
    const again = await t.runner.run("s_AAAAAAAAAA"); // ahora A ya está apagada y B prendida
    expect(again.ok).toBe(true);
    expect(t.calls).toHaveLength(2);
  });
  it("pantallas: una desconectada falla ese paso (not_found), el resto sigue", async () => {
    const t = setup({ scenes: [scene([{ kind: "screens", monitors: [{ monitorId: "m_GONEGONEGONEGONE", enabled: true }] }, { kind: "bringAll" }])] });
    const r = await t.runner.run("s_AAAAAAAAAA");
    expect(r).toEqual({ ok: false, reason: "failed", steps: ["failed", "ok"] });
    expect(t.progress.find((p) => p.status === "failed")!.reason).toBe("not_found");
  });
  it("pantallas: algunas bien y otras no → partial", async () => {
    const t = setup({ scenes: [scene([{ kind: "screens", monitors: [{ monitorId: B, enabled: true }, { monitorId: "m_GONEGONEGONEGONE", enabled: true }] }])] });
    expect((await t.runner.run("s_AAAAAAAAAA")).steps).toEqual(["partial"]);
  });
  it("una app que ya no está en el catálogo → not_allowed, sin abrir nada", async () => {
    const t = setup({ scenes: [scene([openApp("Vieja")])], catalogHas: () => false });
    const r = await t.runner.run("s_AAAAAAAAAA");
    expect(t.calls).toEqual([]);
    expect(r).toEqual({ ok: false, reason: "failed", steps: ["failed"] });
    expect(t.progress.find((p) => p.status === "failed")!.reason).toBe("not_allowed");
  });
  it("una sola escena a la vez (busy); después de terminar se puede otra vez", async () => {
    let release!: (o: LaunchOutcome) => void;
    const t = setup({ scenes: [scene([openApp("a")])], launch: () => new Promise<LaunchOutcome>((r) => (release = r)) });
    const first = t.runner.run("s_AAAAAAAAAA");
    await Promise.resolve();
    expect(await t.runner.run("s_AAAAAAAAAA")).toEqual({ ok: false, reason: "busy" });
    expect(t.runner.running()).toBe("s_AAAAAAAAAA");
    release({ status: "ok" });
    expect((await first).ok).toBe(true);
    expect(t.runner.running()).toBeNull();
  });
  it("escena que no existe → not_found", async () => {
    expect(await setup().runner.run("s_AAAAAAAAAA")).toEqual({ ok: false, reason: "not_found" });
  });
  it("pasados 60 s los pasos que faltan se saltan", async () => {
    const t = setup({
      scenes: [scene([openApp("a"), openApp("b"), openApp("c")])],
      launch: async (i) => {
        if (i === 0) t.clock.advance(61_000);
        return { status: "ok" };
      },
    });
    const r = await t.runner.run("s_AAAAAAAAAA");
    expect(r).toEqual({ ok: false, reason: "failed", steps: ["ok", "skipped", "skipped"] });
    expect(t.calls).toEqual(["open a"]);
  });
  it("si un paso explota, queda como failed y la escena sigue", async () => {
    const t = setup({ scenes: [scene([openApp("a"), openApp("b")])], launch: (i) => { if (i === 0) throw new Error("boom"); return { status: "ok" }; } });
    expect((await t.runner.run("s_AAAAAAAAAA")).steps).toEqual(["failed", "ok"]);
  });
});

const OUT = "o_AAAAAAAAAAAA";
const audioStep = (over: object = {}): Scene["steps"][number] => ({ kind: "audio", outputId: OUT, makeDefault: true, volume: null, ...over }) as Scene["steps"][number];

describe("runner · paso de audio (D37)", () => {
  it("espera hasta 8 s a que aparezca la salida, la hace predeterminada y le pone el volumen", async () => {
    const t = setup({ scenes: [scene([audioStep({ volume: 30 })])] });
    expect(await t.runner.run("s_AAAAAAAAAA")).toEqual({ ok: true, steps: ["ok"] });
    expect(t.calls).toEqual([`wait ${OUT} 8000`, `default ${OUT}`, `volume ${OUT} 30`]);
  });
  it("solo volumen: no toca la predeterminada", async () => {
    const t = setup({ scenes: [scene([audioStep({ makeDefault: false, volume: 40 })])] });
    await t.runner.run("s_AAAAAAAAAA");
    expect(t.calls).toEqual([`wait ${OUT} 8000`, `volume ${OUT} 40`]);
  });
  it("solo predeterminada: no toca el volumen", async () => {
    const t = setup({ scenes: [scene([audioStep()])] });
    await t.runner.run("s_AAAAAAAAAA");
    expect(t.calls).toEqual([`wait ${OUT} 8000`, `default ${OUT}`]);
  });
  it("si la salida no aparece (la tele no prendió), el paso falla con output_unavailable y los demás siguen", async () => {
    const t = setup({ scenes: [scene([audioStep(), { kind: "bringAll" }])], audio: { appears: false } });
    const r = await t.runner.run("s_AAAAAAAAAA");
    expect(r).toEqual({ ok: false, reason: "failed", steps: ["failed", "ok"] });
    expect(t.progress.find((p) => p.status === "failed")).toMatchObject({ index: 0, reason: "output_unavailable" });
    expect(t.calls).toEqual([`wait ${OUT} 8000`, "bringAll"]);
  });
  it("la predeterminada falla: el paso falla con ese motivo y no sigue con el volumen", async () => {
    const t = setup({ scenes: [scene([audioStep({ volume: 30 })])], audio: { setDefault: { ok: false, reason: "audio_unavailable" } } });
    const r = await t.runner.run("s_AAAAAAAAAA");
    expect(r).toEqual({ ok: false, reason: "failed", steps: ["failed"] });
    expect(t.progress.find((p) => p.status === "failed")!.reason).toBe("audio_unavailable");
    expect(t.calls.some((c) => c.startsWith("volume"))).toBe(false);
  });
  it("la predeterminada anduvo pero el volumen no: partial", async () => {
    const t = setup({ scenes: [scene([audioStep({ volume: 30 })])], audio: { setVolume: { ok: false, reason: "failed" } } });
    expect(await t.runner.run("s_AAAAAAAAAA")).toEqual({ ok: true, steps: ["partial"] });
  });
  it("sin servicio de audio (otro sistema): el paso falla con audio_unavailable", async () => {
    const t = setup({ scenes: [scene([audioStep()])], audio: null });
    expect(await t.runner.run("s_AAAAAAAAAA")).toEqual({ ok: false, reason: "failed", steps: ["failed"] });
    expect(t.progress.find((p) => p.status === "failed")!.reason).toBe("audio_unavailable");
  });
});
