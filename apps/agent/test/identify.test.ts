import { describe, expect, it } from "vitest";
import { createIdentifier, type SpawnedProcess } from "../src/platform/win/identify";
import { FakeClock, MemLogger } from "./fakes";

class FakeProc implements SpawnedProcess {
  killed = false;
  private onStart!: () => void;
  private onFail!: (e: Error) => void;
  private onExit!: () => void;
  readonly started = new Promise<void>((res, rej) => {
    this.onStart = res;
    this.onFail = rej;
  });
  readonly exited = new Promise<void>((res) => (this.onExit = res));
  kill() {
    this.killed = true;
    this.onExit();
  }
  start() {
    this.onStart();
  }
  fail(e = new Error("spawn powershell.exe ENOENT")) {
    this.onFail(e);
  }
  exit() {
    this.onExit();
  }
}

function setup() {
  const clock = new FakeClock(0);
  const log = new MemLogger();
  const calls: { cmd: string; args: string[] }[] = [];
  const proc = new FakeProc();
  const identifier = createIdentifier({
    spawn: (cmd, args) => (calls.push({ cmd, args }), proc),
    scriptPath: "C:\\app\\identify.ps1",
    powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    clock,
    log,
  });
  return { clock, log, calls, proc, identifier };
}

const ITEMS = [
  { index: 1, bounds: { x: 0, y: 0, w: 1920, h: 1080 } },
  { index: 2, bounds: { x: 1920, y: 0, w: 2560, h: 1440 } },
];
const flush = () => new Promise<void>((r) => setImmediate(r));

describe("createIdentifier", () => {
  it("lanza PowerShell sin ventana, sin perfil y con el script, pasando solo números", async () => {
    const t = setup();
    const p = t.identifier.show(ITEMS);
    t.proc.start();
    await p;
    expect(t.calls).toEqual([
      {
        cmd: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "C:\\app\\identify.ps1",
          "-Items",
          "1,0,0,1920,1080;2,1920,0,2560,1440",
          "-Seconds",
          "2",
        ],
      },
    ]);
  });

  it("acepta coordenadas negativas (pantalla a la izquierda del escritorio)", async () => {
    const t = setup();
    const p = t.identifier.show([{ index: 3, bounds: { x: -1920, y: -200, w: 1920, h: 1080 } }]);
    t.proc.start();
    await p;
    expect(t.calls[0]!.args).toContain("3,-1920,-200,1920,1080");
  });

  it.each([
    ["índice 0", { index: 0, bounds: { x: 0, y: 0, w: 100, h: 100 } }],
    ["índice con decimales", { index: 1.5, bounds: { x: 0, y: 0, w: 100, h: 100 } }],
    ["índice enorme", { index: 99, bounds: { x: 0, y: 0, w: 100, h: 100 } }],
    ["NaN", { index: 1, bounds: { x: Number.NaN, y: 0, w: 100, h: 100 } }],
    ["Infinity", { index: 1, bounds: { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 100 } }],
    ["ancho cero", { index: 1, bounds: { x: 0, y: 0, w: 0, h: 100 } }],
    ["coordenada absurda", { index: 1, bounds: { x: 1e9, y: 0, w: 100, h: 100 } }],
  ])("no lanza nada si los datos no son enteros razonables: %s", async (_n, item) => {
    const t = setup();
    await expect(t.identifier.show([item])).rejects.toThrow();
    expect(t.calls).toEqual([]);
  });

  it("sin pantallas no hay nada que mostrar: rechaza", async () => {
    const t = setup();
    await expect(t.identifier.show([])).rejects.toThrow();
    expect(t.calls).toEqual([]);
  });

  it("si no se pudo lanzar PowerShell, rechaza", async () => {
    const t = setup();
    const p = t.identifier.show(ITEMS);
    t.proc.fail();
    await expect(p).rejects.toThrow(/ENOENT/);
  });

  it("done se cumple cuando el proceso termina", async () => {
    const t = setup();
    const p = t.identifier.show(ITEMS);
    t.proc.start();
    const { done } = await p;
    let finished = false;
    void done.then(() => (finished = true));
    await flush();
    expect(finished).toBe(false);
    t.proc.exit();
    await flush();
    expect(finished).toBe(true);
  });

  it("si el script se cuelga, a los 8 s (2 s + margen) se lo mata para que no queden cuadros en pantalla", async () => {
    const t = setup();
    const p = t.identifier.show(ITEMS);
    t.proc.start();
    await p;
    t.clock.advance(7_999);
    expect(t.proc.killed).toBe(false);
    t.clock.advance(1);
    expect(t.proc.killed).toBe(true);
  });

  it("si termina solo, no queda ningún timer", async () => {
    const t = setup();
    const p = t.identifier.show(ITEMS);
    t.proc.start();
    await p;
    t.proc.exit();
    await flush();
    expect(t.clock.pendingTimers()).toBe(0);
  });
});
