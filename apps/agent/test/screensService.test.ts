import { describe, expect, it } from "vitest";
import { ScreensState } from "@proyecto-e/protocol";
import type { RawDisplay, RawWindow } from "../src/ports";
import { monitorId } from "../src/screens/model";
import { createScreensService, type KnownMonitor } from "../src/screens/service";
import { FakeClock, FakeDisplays, FakeIdentifier, FakeWindows, MemLogger } from "./fakes";

const disp = (path: string, over: Partial<RawDisplay> = {}): RawDisplay => ({
  devicePath: path,
  friendlyName: path,
  outputTechnology: 10,
  active: true,
  primary: false,
  gdiName: null,
  bounds: { x: 0, y: 0, w: 1920, h: 1080 },
  workArea: null,
  ...over,
});
const WIN: RawWindow = {
  handle: "0x1",
  title: "PLAN.md",
  exe: "Code.exe",
  className: "Chrome_WidgetWin_1",
  rect: { x: 100, y: 100, w: 800, h: 600 },
  state: "normal",
};

function setup() {
  const displays = new FakeDisplays();
  const windows = new FakeWindows();
  const log = new MemLogger();
  displays.raw = [
    disp("izq"),
    disp("prin", { primary: true, bounds: { x: 1920, y: 0, w: 2560, h: 1440 } }),
    disp("tele", { active: false, bounds: null, outputTechnology: 5 }),
  ];
  windows.win = WIN;
  const service = createScreensService({ displays, windows, log });
  return { displays, windows, log, service };
}

describe("screensService", () => {
  it("antes del primer refresh no hay estado", () => {
    expect(setup().service.current()).toBeNull();
  });

  it("refresh arma un estado válido con pantallas y ventana activa", async () => {
    const { service } = setup();
    const r = await service.refresh();
    expect(r.changed).toBe(true);
    expect(ScreensState.safeParse(r.state).success).toBe(true);
    expect(r.state?.monitors).toHaveLength(3);
    expect(r.state?.foreground).toMatchObject({ title: "PLAN.md", monitorId: monitorId("izq") });
    expect(service.current()).toEqual(r.state);
  });

  it("si nada cambió, el segundo refresh dice changed=false", async () => {
    const { service } = setup();
    await service.refresh();
    expect((await service.refresh()).changed).toBe(false);
  });

  it("cambia cuando se mueve la ventana activa o se enchufa/apaga una pantalla", async () => {
    const { service, windows, displays } = setup();
    await service.refresh();
    windows.win = { ...WIN, rect: { x: 2000, y: 100, w: 800, h: 600 } };
    expect((await service.refresh()).changed).toBe(true);
    displays.raw = displays.raw.filter((d) => d.devicePath !== "tele");
    const r = await service.refresh();
    expect(r.changed).toBe(true);
    expect(r.state?.monitors).toHaveLength(2);
  });

  it("recuerda dónde estaba una pantalla que se apagó (lastBounds)", async () => {
    const { service, displays } = setup();
    await service.refresh();
    displays.raw = displays.raw.map((d) => (d.devicePath === "izq" ? { ...d, active: false, bounds: null } : d));
    const izq = (await service.refresh()).state?.monitors.find((m) => m.id === monitorId("izq"));
    expect(izq).toMatchObject({ enabled: false, bounds: null, lastBounds: { x: 0, y: 0, w: 1920, h: 1080 } });
  });

  it("llamadas simultáneas comparten una sola lectura de Windows", async () => {
    const { service, displays } = setup();
    const [a, b] = await Promise.all([service.refresh(), service.refresh()]);
    expect(displays.calls).toBe(1);
    expect(a.state).toEqual(b.state);
  });

  it("si falla leer las pantallas: conserva el último estado, avisa una sola vez y se marca no disponible", async () => {
    const { service, displays, log } = setup();
    const ok = await service.refresh();
    displays.failNext();
    const r1 = await service.refresh();
    expect(r1.changed).toBe(false);
    expect(service.current()).toEqual(ok.state);
    expect(service.available()).toEqual({ ok: false, error: "displays boom" });
    displays.failNext();
    await service.refresh();
    expect(log.entries.filter((e) => e.level === "warn")).toHaveLength(1);
    await service.refresh(); // se recupera
    expect(service.available()).toEqual({ ok: true });
    expect(log.entries.some((e) => e.msg.includes("recovered"))).toBe(true);
  });

  it("si falla solo la ventana activa, las pantallas igual se informan (foreground null)", async () => {
    const { service, windows } = setup();
    windows.failNext();
    const r = await service.refresh();
    expect(r.state?.monitors).toHaveLength(3);
    expect(r.state?.foreground).toBeNull();
    expect(service.available()).toEqual({ ok: true });
  });

  it("si nunca pudo leer, current() sigue en null", async () => {
    const { service, displays } = setup();
    displays.failNext();
    const r = await service.refresh();
    expect(r.state).toBeNull();
    expect(service.current()).toBeNull();
  });
});

/** Un almacén de monitores conocidos en memoria, como el que arma app.ts sobre agent.json. */
function memKnown(initial: KnownMonitor[] = []) {
  const s = {
    list: initial,
    saves: 0,
    fail: false,
    get: () => s.list,
    save: async (list: KnownMonitor[]) => {
      if (s.fail) throw new Error("disco lleno");
      s.saves++;
      s.list = list;
    },
  };
  return s;
}

function setupKnown(initial: KnownMonitor[] = []) {
  const displays = new FakeDisplays();
  const windows = new FakeWindows();
  const log = new MemLogger();
  const clock = new FakeClock(Date.UTC(2026, 10, 7, 12, 0, 0));
  const known = memKnown(initial);
  displays.raw = [disp("izq"), disp("prin", { primary: true, bounds: { x: 1920, y: 0, w: 2560, h: 1440 } }), disp("tele", { active: false, bounds: null, outputTechnology: 5 })];
  const service = createScreensService({ displays, windows, log, clock, known });
  return { displays, windows, log, clock, known, service };
}

describe("screensService · apodos y monitores conocidos (R4)", () => {
  it("renombrar guarda el apodo, lo muestra en el próximo estado y lo persiste", async () => {
    const { service, known } = setupKnown();
    await service.refresh();
    const id = monitorId("tele");
    expect(await service.rename(id, "Tele living")).toEqual({ ok: true });
    expect(service.current()?.monitors.find((m) => m.id === id)?.nickname).toBe("Tele living");
    expect(known.list.find((k) => k.id === id)).toMatchObject({ nickname: "Tele living", lastName: "tele" });
  });

  it("el apodo sobrevive a reiniciar el agente (servicio nuevo con el mismo almacén)", async () => {
    const a = setupKnown();
    await a.service.refresh();
    await a.service.rename(monitorId("tele"), "Tele living");
    const displays = a.displays;
    const b = createScreensService({ displays, windows: a.windows, log: a.log, clock: a.clock, known: a.known });
    const r = await b.refresh();
    expect(r.state?.monitors.find((m) => m.id === monitorId("tele"))?.nickname).toBe("Tele living");
  });

  it("el apodo sobrevive a desenchufar y volver a enchufar la pantalla", async () => {
    const { service, displays } = setupKnown();
    await service.refresh();
    await service.rename(monitorId("tele"), "Tele living");
    const tele = displays.raw.find((d) => d.devicePath === "tele")!;
    displays.raw = displays.raw.filter((d) => d.devicePath !== "tele");
    expect((await service.refresh()).state?.monitors.some((m) => m.id === monitorId("tele"))).toBe(false);
    displays.raw.push(tele);
    expect((await service.refresh()).state?.monitors.find((m) => m.id === monitorId("tele"))?.nickname).toBe("Tele living");
  });

  it("renombrar con null saca el apodo", async () => {
    const { service } = setupKnown();
    await service.refresh();
    await service.rename(monitorId("izq"), "Izquierdo");
    expect(await service.rename(monitorId("izq"), null)).toEqual({ ok: true });
    expect(service.current()?.monitors.find((m) => m.id === monitorId("izq"))?.nickname).toBeNull();
  });

  it("una pantalla que no está conectada → not_found", async () => {
    const { service } = setupKnown();
    await service.refresh();
    expect(await service.rename("m_NoExisteNoExiste", "x")).toEqual({ ok: false, reason: "not_found" });
  });

  it("antes de la primera lectura renombrar lee Windows primero", async () => {
    const { service } = setupKnown();
    expect(await service.rename(monitorId("izq"), "Izquierdo")).toEqual({ ok: true });
  });

  it("si no se puede guardar: failed, y el apodo no queda aplicado", async () => {
    const { service, known } = setupKnown();
    await service.refresh();
    known.fail = true;
    expect(await service.rename(monitorId("izq"), "Izquierdo")).toEqual({ ok: false, reason: "failed" });
    expect(service.current()?.monitors.find((m) => m.id === monitorId("izq"))?.nickname).toBeNull();
  });

  it("recuerda la última posición de cada pantalla (la apagada se dibuja en su lugar aun tras reiniciar)", async () => {
    const a = setupKnown();
    await a.service.refresh();
    a.displays.raw = a.displays.raw.map((d) => (d.devicePath === "izq" ? { ...d, active: false, bounds: null } : d));
    const b = createScreensService({ displays: a.displays, windows: a.windows, log: a.log, clock: a.clock, known: a.known });
    const izq = (await b.refresh()).state?.monitors.find((m) => m.id === monitorId("izq"));
    expect(izq).toMatchObject({ enabled: false, lastBounds: { x: 0, y: 0, w: 1920, h: 1080 } });
  });

  it("no reescribe el archivo si nada cambió (el celu pregunta cada 2 s)", async () => {
    const { service, known, clock } = setupKnown();
    await service.refresh();
    const first = known.saves;
    for (let i = 0; i < 5; i++) {
      clock.advance(2_000);
      await service.refresh();
    }
    expect(known.saves).toBe(first);
  });

  it("guarda cuando aparece una pantalla nueva o cambia una posición", async () => {
    const { service, known, displays } = setupKnown();
    await service.refresh();
    const base = known.saves;
    displays.raw.push(disp("nueva", { bounds: { x: 4480, y: 0, w: 1280, h: 1024 } }));
    await service.refresh();
    expect(known.saves).toBe(base + 1);
    displays.raw = displays.raw.map((d) => (d.devicePath === "nueva" ? { ...d, bounds: { x: 4480, y: 100, w: 1280, h: 1024 } } : d));
    await service.refresh();
    expect(known.saves).toBe(base + 2);
  });

  it("guarda a lo sumo 32; se descartan primero las más viejas sin apodo", async () => {
    const old = Array.from({ length: 32 }, (_, i): KnownMonitor => ({
      id: monitorId(`viejo${i}`),
      nickname: i === 0 ? "Con apodo" : null,
      lastName: `viejo${i}`,
      lastBounds: null,
      lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const { service, known } = setupKnown(old);
    await service.refresh();
    expect(known.list).toHaveLength(32);
    expect(known.list.some((k) => k.nickname === "Con apodo")).toBe(true);
    expect(known.list.some((k) => k.id === monitorId("izq"))).toBe(true);
  });

  it("un fallo al guardar en una lectura normal no tumba la lectura: se avisa en el log", async () => {
    const { service, known, log } = setupKnown();
    known.fail = true;
    const r = await service.refresh();
    expect(r.state?.monitors).toHaveLength(3);
    expect(log.entries.some((e) => e.level === "warn" && e.msg.includes("known"))).toBe(true);
  });
});

describe("screensService · prender y apagar (R5)", () => {
  const IZQ = monitorId("izq");
  const PRIN = monitorId("prin");
  const TELE = monitorId("tele");

  async function ready() {
    const t = setupKnown();
    await t.service.refresh();
    const pushed: ScreensState[] = [];
    t.service.subscribe((s) => pushed.push(s));
    return { ...t, pushed };
  }
  const enabledOf = (s: ScreensState | null, id: string) => s?.monitors.find((m) => m.id === id)?.enabled;

  it("apagar una pantalla secundaria: la apaga en Windows y el estado lo refleja", async () => {
    const { service, displays } = await ready();
    expect(await service.setEnabled(IZQ, false)).toEqual({ ok: true });
    expect(displays.sets).toEqual([{ devicePath: "izq", on: false }]);
    expect(enabledOf(service.current(), IZQ)).toBe(false);
  });

  it("prender la tele: la prende en Windows y aparece con número y posición", async () => {
    const { service, displays } = await ready();
    displays.enableAt["tele"] = { x: 4480, y: 0, w: 3840, h: 2160 };
    expect(await service.setEnabled(TELE, true)).toEqual({ ok: true });
    expect(displays.sets).toEqual([{ devicePath: "tele", on: true }]);
    const tele = service.current()?.monitors.find((m) => m.id === TELE);
    expect(tele).toMatchObject({ enabled: true, index: 3, bounds: { x: 4480, y: 0, w: 3840, h: 2160 } });
  });

  it("la principal no se apaga: primary, y Windows ni se entera", async () => {
    const { service, displays } = await ready();
    expect(await service.setEnabled(PRIN, false)).toEqual({ ok: false, reason: "primary" });
    expect(displays.sets).toEqual([]);
  });

  it("la última pantalla prendida no se apaga aunque Windows no la marque como principal: last_active", async () => {
    const { service, displays } = await ready();
    // Windows deja prendida solo una pantalla que no es la principal (caso raro de Windows)
    displays.raw = displays.raw.map((d) => ({ ...d, primary: false, active: d.devicePath === "izq", bounds: d.devicePath === "izq" ? { x: 0, y: 0, w: 1920, h: 1080 } : null }));
    await service.refresh();
    expect(await service.setEnabled(IZQ, false)).toEqual({ ok: false, reason: "last_active" });
    expect(displays.sets).toEqual([]);
  });

  it("pedir lo que ya está así es un éxito sin tocar Windows", async () => {
    const { service, displays } = await ready();
    expect(await service.setEnabled(IZQ, true)).toEqual({ ok: true });
    expect(await service.setEnabled(TELE, false)).toEqual({ ok: true });
    expect(displays.sets).toEqual([]);
  });

  it("una pantalla que no existe: not_found", async () => {
    const { service } = await ready();
    expect(await service.setEnabled("m_NoExisteNoExiste", true)).toEqual({ ok: false, reason: "not_found" });
  });

  it("mientras cambia, la pantalla sale con busy:true y se avisa a los celus; al terminar sale con busy:false", async () => {
    const { service, displays, pushed } = await ready();
    let release!: () => void;
    displays.gate = new Promise<void>((r) => (release = r));
    const op = service.setEnabled(IZQ, false);
    await new Promise<void>((r) => setImmediate(r));
    expect(service.current()?.monitors.find((m) => m.id === IZQ)?.busy).toBe(true);
    expect(pushed.at(-1)?.monitors.find((m) => m.id === IZQ)?.busy).toBe(true);
    release();
    expect(await op).toEqual({ ok: true });
    expect(service.current()?.monitors.find((m) => m.id === IZQ)?.busy).toBe(false);
    expect(pushed.at(-1)?.monitors.find((m) => m.id === IZQ)).toMatchObject({ busy: false, enabled: false });
  });

  it("un segundo cambio mientras hay uno en curso: busy (se serializan), y el primero termina bien", async () => {
    const { service, displays } = await ready();
    let release!: () => void;
    displays.gate = new Promise<void>((r) => (release = r));
    const first = service.setEnabled(IZQ, false);
    await new Promise<void>((r) => setImmediate(r));
    expect(await service.setEnabled(TELE, true)).toEqual({ ok: false, reason: "busy" });
    release();
    expect(await first).toEqual({ ok: true });
    expect(displays.sets).toHaveLength(1);
  });

  it("si Windows falla: failed, busy se limpia y el estado vuelve a lo real", async () => {
    const { service, displays } = await ready();
    displays.failSetNext();
    expect(await service.setEnabled(IZQ, false)).toEqual({ ok: false, reason: "failed" });
    const izq = service.current()?.monitors.find((m) => m.id === IZQ);
    expect(izq).toMatchObject({ busy: false, enabled: true });
    expect(await service.setEnabled(IZQ, false)).toEqual({ ok: true }); // y se puede volver a intentar
  });

  it("si después de apagar no queda ninguna prendida, la vuelve a prender (nunca te deja sin imagen)", async () => {
    const { service, displays } = await ready();
    displays.afterSet = (raw) => {
      for (const d of raw) if (d.devicePath !== "izq" || false) { d.active = false; d.bounds = null; }
    };
    const out = await service.setEnabled(IZQ, false);
    displays.afterSet = null;
    expect(out).toEqual({ ok: false, reason: "failed" });
    expect(displays.sets.at(-1)).toEqual({ devicePath: "izq", on: true });
    expect(displays.sets.some((s) => s.on)).toBe(true);
  });

  it("pide prender y Windows no lo hizo: failed", async () => {
    const { service, displays } = await ready();
    displays.afterSet = (raw) => {
      const d = raw.find((r) => r.devicePath === "tele");
      if (d) { d.active = false; d.bounds = null; }
    };
    expect(await service.setEnabled(TELE, true)).toEqual({ ok: false, reason: "failed" });
  });

  it("subscribe: se puede dejar de escuchar", async () => {
    const { service } = await ready();
    const seen: number[] = [];
    const off = service.subscribe(() => seen.push(1));
    off();
    await service.setEnabled(IZQ, false);
    expect(seen).toEqual([]);
  });

  it("apagar una pantalla no pierde su apodo ni su lugar en el mapa", async () => {
    const { service } = await ready();
    await service.rename(IZQ, "Izquierdo");
    await service.setEnabled(IZQ, false);
    const izq = service.current()?.monitors.find((m) => m.id === IZQ);
    expect(izq).toMatchObject({ nickname: "Izquierdo", enabled: false, bounds: null, lastBounds: { x: 0, y: 0, w: 1920, h: 1080 } });
  });
});

describe("screensService · mover la ventana activa (R6)", () => {
  const IZQ = monitorId("izq");
  const PRIN = monitorId("prin");
  const TELE = monitorId("tele");

  async function ready() {
    const t = setupKnown();
    t.windows.win = { handle: "0xABC", title: "PLAN.md", exe: "Code.exe", className: "Chrome_WidgetWin_1", rect: { x: 192, y: 208, w: 800, h: 600 }, state: "normal" };
    await t.service.refresh();
    const pushed: ScreensState[] = [];
    t.service.subscribe((s) => pushed.push(s));
    return { ...t, pushed };
  }

  it("manda la ventana activa a otra pantalla conservando su posición relativa, y el estado lo refleja", async () => {
    const { service, windows } = await ready();
    expect(service.current()?.foreground?.monitorId).toBe(IZQ);
    expect(await service.moveActive(PRIN)).toEqual({ ok: true });
    expect(windows.placed).toHaveLength(1);
    expect(windows.placed[0]).toMatchObject({ handle: "0xABC", maximize: false });
    const r = windows.placed[0]!.rect;
    expect(r.x).toBeGreaterThanOrEqual(1920); // quedó en la pantalla principal
    expect(r.x + r.w).toBeLessThanOrEqual(1920 + 2560);
    expect(service.current()?.foreground?.monitorId).toBe(PRIN);
  });

  it("usa el área de trabajo (sin la barra de tareas) si Windows la informa", async () => {
    const { service, displays, windows } = await ready();
    displays.raw = displays.raw.map((d) => (d.devicePath === "prin" ? { ...d, workArea: { x: 1920, y: 0, w: 2560, h: 1360 } } : d));
    await service.refresh();
    windows.win = { ...windows.win!, rect: { x: 0, y: 1000, w: 1900, h: 80 } }; // pegada abajo
    await service.moveActive(PRIN);
    const r = windows.placed[0]!.rect;
    expect(r.y + r.h).toBeLessThanOrEqual(1360);
  });

  it("si ya está en esa pantalla: éxito sin tocar Windows", async () => {
    const { service, windows } = await ready();
    expect(await service.moveActive(IZQ)).toEqual({ ok: true });
    expect(windows.placed).toEqual([]);
  });

  it("maximizada: se mueve y se vuelve a maximizar", async () => {
    const { service, windows } = await ready();
    windows.win = { ...windows.win!, state: "maximized", rect: { x: 0, y: 0, w: 1920, h: 1040 } };
    await service.moveActive(PRIN);
    expect(windows.placed[0]).toMatchObject({ maximize: true });
  });

  it("minimizada: se restaura en la pantalla de destino, sin maximizar", async () => {
    const { service, windows } = await ready();
    windows.win = { ...windows.win!, state: "minimized", rect: { x: -32000, y: -32000, w: 160, h: 28 } };
    expect(await service.moveActive(IZQ)).toEqual({ ok: true });
    expect(windows.placed[0]).toMatchObject({ maximize: false });
  });

  it("sin ventana activa, o con el escritorio / la barra de tareas: no_window", async () => {
    const { service, windows } = await ready();
    windows.win = null;
    expect(await service.moveActive(PRIN)).toEqual({ ok: false, reason: "no_window" });
    windows.win = { handle: "0x1", title: "", exe: "explorer.exe", className: "Shell_TrayWnd", rect: { x: 0, y: 1040, w: 1920, h: 40 }, state: "normal" };
    expect(await service.moveActive(PRIN)).toEqual({ ok: false, reason: "no_window" });
    expect(windows.placed).toEqual([]);
  });

  it("a una pantalla que no existe o está apagada: not_found", async () => {
    const { service, windows } = await ready();
    expect(await service.moveActive("m_NoExisteNoExiste")).toEqual({ ok: false, reason: "not_found" });
    expect(await service.moveActive(TELE)).toEqual({ ok: false, reason: "not_found" });
    expect(windows.placed).toEqual([]);
  });

  it("una ventana de administrador: elevated", async () => {
    const { service, windows } = await ready();
    windows.failPlaceNext(new Error("elevated: acceso denegado (la ventana corre como administrador)"));
    expect(await service.moveActive(PRIN)).toEqual({ ok: false, reason: "elevated" });
  });

  it("cualquier otro fallo de Windows: failed", async () => {
    const { service, windows } = await ready();
    windows.failPlaceNext();
    expect(await service.moveActive(PRIN)).toEqual({ ok: false, reason: "failed" });
  });

  it("si no se puede leer la ventana activa: failed", async () => {
    const { service, windows } = await ready();
    windows.failNext();
    expect(await service.moveActive(PRIN)).toEqual({ ok: false, reason: "failed" });
  });

  it("avisa a los celus del estado nuevo cuando termina de mover", async () => {
    const { service, pushed } = await ready();
    await service.moveActive(PRIN);
    expect(pushed.at(-1)?.foreground?.monitorId).toBe(PRIN);
  });

  it("mientras se prende o apaga una pantalla no se mueve nada: busy", async () => {
    const { service, displays, windows } = await ready();
    let release!: () => void;
    displays.gate = new Promise<void>((r) => (release = r));
    const change = service.setEnabled(monitorId("izq"), false);
    await new Promise<void>((r) => setImmediate(r));
    expect(await service.moveActive(PRIN)).toEqual({ ok: false, reason: "busy" });
    release();
    await change;
    expect(windows.placed).toEqual([]);
  });
});

describe("screensService · identificar (R7)", () => {
  async function ready(withIdentifier = true) {
    const t = setupKnown();
    const identifier = new FakeIdentifier();
    const service = createScreensService({ displays: t.displays, windows: t.windows, log: t.log, clock: t.clock, known: t.known, identifier: withIdentifier ? identifier : undefined });
    await service.refresh();
    return { ...t, service, identifier };
  }

  it("muestra un cuadro por cada pantalla prendida, con su número y su lugar; las apagadas no", async () => {
    const { service, identifier } = await ready();
    expect(await service.identify()).toEqual({ ok: true });
    expect(identifier.shown).toEqual([
      [
        { index: 1, bounds: { x: 0, y: 0, w: 1920, h: 1080 } },
        { index: 2, bounds: { x: 1920, y: 0, w: 2560, h: 1440 } },
      ],
    ]);
  });

  it("lo que se muestra son solo números y posiciones (nada de texto del celu ni de los nombres)", async () => {
    const { service, identifier } = await ready();
    await service.rename(monitorId("izq"), "Tele; rm -rf /");
    await service.identify();
    expect(JSON.stringify(identifier.shown)).not.toMatch(/rm|Tele/);
  });

  it("sin identificador (otro sistema): unsupported", async () => {
    const { service } = await ready(false);
    expect(await service.identify()).toEqual({ ok: false, reason: "unsupported" });
  });

  it("mientras los cuadros están en pantalla, otro pedido es busy; cuando desaparecen, se puede de nuevo", async () => {
    const { service, identifier } = await ready();
    await service.identify();
    expect(await service.identify()).toEqual({ ok: false, reason: "busy" });
    identifier.finish();
    await new Promise<void>((r) => setImmediate(r));
    expect(await service.identify()).toEqual({ ok: true });
    expect(identifier.shown).toHaveLength(2);
  });

  it("si no se pudo lanzar: failed, y no queda trabado (se puede reintentar)", async () => {
    const { service, identifier } = await ready();
    identifier.failNext();
    expect(await service.identify()).toEqual({ ok: false, reason: "failed" });
    expect(await service.identify()).toEqual({ ok: true });
  });

  it("mientras se prende o apaga una pantalla: busy", async () => {
    const { service, displays, identifier } = await ready();
    let release!: () => void;
    displays.gate = new Promise<void>((r) => (release = r));
    const change = service.setEnabled(monitorId("izq"), false);
    await new Promise<void>((r) => setImmediate(r));
    expect(await service.identify()).toEqual({ ok: false, reason: "busy" });
    release();
    await change;
    expect(identifier.shown).toEqual([]);
  });

  it("sin ninguna pantalla leída: failed", async () => {
    const { service, displays } = await ready();
    displays.raw = [];
    await service.refresh();
    expect(await service.identify()).toEqual({ ok: false, reason: "failed" });
  });
});

describe("screensService · carreras (revisión de B2)", () => {
  it("una lectura que detecta una pantalla nueva mientras se guarda un apodo no lo pisa", async () => {
    const { service, displays, known } = setupKnown();
    await service.refresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const save = known.save;
    known.save = async (list) => {
      await gate;
      return save(list);
    };
    const renamed = service.rename(monitorId("izq"), "Izquierdo"); // se queda guardando
    await new Promise<void>((r) => setImmediate(r));
    displays.raw.push({ devicePath: "nueva", friendlyName: "nueva", outputTechnology: 10, active: true, primary: false, gdiName: null, bounds: { x: 4480, y: 0, w: 1280, h: 1024 }, workArea: null });
    const read = service.refresh(); // detecta la pantalla nueva y también quiere guardar
    await new Promise<void>((r) => setImmediate(r));
    release();
    await Promise.all([renamed, read]);
    await service.refresh();
    expect(known.list.find((k) => k.id === monitorId("izq"))?.nickname).toBe("Izquierdo");
    expect(known.list.some((k) => k.id === monitorId("nueva"))).toBe(true);
    expect(service.current()?.monitors.find((m) => m.id === monitorId("izq"))?.nickname).toBe("Izquierdo");
  });

  it("apagar una pantalla mientras había una lectura vieja en curso: no informa 'failed' de más", async () => {
    const { service, displays } = setupKnown();
    await service.refresh();
    let release!: () => void;
    displays.listGate = new Promise<void>((r) => (release = r));
    const stale = service.refresh(); // ya leyó el estado de antes del cambio y espera
    await new Promise<void>((r) => setImmediate(r));
    const change = service.setEnabled(monitorId("izq"), false);
    await new Promise<void>((r) => setImmediate(r));
    displays.listGate = null;
    release();
    await stale;
    expect(await change).toEqual({ ok: true });
    expect(service.current()?.monitors.find((m) => m.id === monitorId("izq"))?.enabled).toBe(false);
  });
});

describe("screensService · volver a su lugar y cambiar el orden", () => {
  const PRIN = monitorId("prin");
  const TELE = monitorId("tele");

  /** La PC de Jay: la tele a la izquierda (x=-1920), la principal en 0 y otra a la derecha. */
  async function ready() {
    const t = setupKnown();
    t.displays.raw = [
      { devicePath: "tele", friendlyName: "LG TV", outputTechnology: 5, active: true, primary: false, gdiName: null, bounds: { x: -1920, y: 0, w: 1920, h: 1080 }, workArea: null },
      { devicePath: "prin", friendlyName: "Principal", outputTechnology: 10, active: true, primary: true, gdiName: null, bounds: { x: 0, y: 0, w: 1920, h: 1080 }, workArea: null },
      { devicePath: "der", friendlyName: "Derecha", outputTechnology: 10, active: true, primary: false, gdiName: null, bounds: { x: 1920, y: 0, w: 1920, h: 1080 }, workArea: null },
    ];
    await t.service.refresh();
    return t;
  }
  const xOf = (s: ScreensState | null, id: string) => s?.monitors.find((m) => m.id === id)?.bounds?.x;

  it("al prender una pantalla que ya estuvo prendida le pide a Windows su lugar y tamaño de antes", async () => {
    const { service, displays } = await ready();
    await service.setEnabled(TELE, false);
    await service.setEnabled(TELE, true);
    const on = displays.sets.filter((s) => s.on);
    expect(on).toEqual([{ devicePath: "tele", on: true, restoreAt: { x: -1920, y: 0, w: 1920, h: 1080 } }]);
  });

  it("si Windows igual la deja en otro lado (al final de todo, como pasó), la vuelve a poner en su lugar", async () => {
    const { service, displays } = await ready();
    await service.setEnabled(TELE, false);
    displays.enableAt["tele"] = { x: 3840, y: 0, w: 1920, h: 1080 }; // donde la puso Windows
    expect(await service.setEnabled(TELE, true)).toEqual({ ok: true });
    expect(displays.arranged).toEqual([[{ devicePath: "tele", x: -1920, y: 0 }]]);
    expect(xOf(service.current(), TELE)).toBe(-1920);
    expect(service.current()?.monitors.find((m) => m.id === TELE)?.index).toBe(1); // vuelve a ser la 1
  });

  it("si ya quedó en su lugar no hace nada de más", async () => {
    const { service, displays } = await ready();
    await service.setEnabled(TELE, false);
    displays.enableAt["tele"] = { x: -1920, y: 0, w: 1920, h: 1080 };
    await service.setEnabled(TELE, true);
    expect(displays.arranged).toEqual([]);
  });

  it("si no puede reponerla, el prender igual salió bien (queda prendida donde Windows la puso)", async () => {
    const { service, displays } = await ready();
    await service.setEnabled(TELE, false);
    displays.enableAt["tele"] = { x: 3840, y: 0, w: 1920, h: 1080 };
    displays.afterSet = () => displays.failSetNext();
    expect(await service.setEnabled(TELE, true)).toEqual({ ok: true });
    displays.afterSet = null;
    expect(service.current()?.monitors.find((m) => m.id === TELE)?.enabled).toBe(true);
  });

  it("setOrder: mandar la tele al final de todo", async () => {
    const { service, displays } = await ready();
    expect(await service.setOrder([PRIN, monitorId("der"), TELE])).toEqual({ ok: true });
    expect(xOf(service.current(), TELE)).toBe(3840);
    expect(xOf(service.current(), PRIN)).toBe(0);
    expect(service.current()?.monitors.map((m) => m.id)).toEqual([PRIN, monitorId("der"), TELE]);
    expect(displays.arranged).toHaveLength(1);
  });

  it("setOrder: solo se le pide a Windows mover las que cambian de lugar", async () => {
    const { service, displays } = await ready();
    await service.setOrder([PRIN, monitorId("der"), TELE]);
    const moved = displays.arranged[0]!.map((i) => i.devicePath).sort();
    expect(moved).toEqual(["tele"]); // la principal y la derecha ya estaban en su lugar
  });

  it("setOrder con el mismo orden que ya tiene: éxito sin tocar Windows", async () => {
    const { service, displays } = await ready();
    expect(await service.setOrder([TELE, PRIN, monitorId("der")])).toEqual({ ok: true });
    expect(displays.arranged).toEqual([]);
  });

  it.each([
    ["falta una", () => [PRIN, TELE]],
    ["sobra una desconocida", () => [PRIN, TELE, monitorId("der"), "m_NoExisteNoExiste"]],
    ["repetida", () => [PRIN, PRIN, TELE]],
  ])("setOrder inválido (%s): not_found y no se toca nada", async (_n, order) => {
    const { service, displays } = await ready();
    expect(await service.setOrder(order())).toEqual({ ok: false, reason: "not_found" });
    expect(displays.arranged).toEqual([]);
  });

  it("setOrder: mientras corre se marcan 'cambiando…' las pantallas y se avisa a los celus", async () => {
    const { service, displays } = await ready();
    const pushed: ScreensState[] = [];
    service.subscribe((s) => pushed.push(s));
    let release!: () => void;
    displays.gate = new Promise<void>((r) => (release = r));
    const op = service.setOrder([PRIN, monitorId("der"), TELE]);
    await new Promise<void>((r) => setImmediate(r));
    expect(pushed.at(-1)?.monitors.every((m) => m.busy)).toBe(true);
    expect(await service.setEnabled(TELE, false)).toEqual({ ok: false, reason: "busy" });
    release();
    expect(await op).toEqual({ ok: true });
    expect(pushed.at(-1)?.monitors.some((m) => m.busy)).toBe(false);
  });

  it("setOrder: si Windows falla, failed y el estado vuelve a lo real", async () => {
    const { service, displays } = await ready();
    displays.failSetNext();
    expect(await service.setOrder([PRIN, monitorId("der"), TELE])).toEqual({ ok: false, reason: "failed" });
    expect(xOf(service.current(), TELE)).toBe(-1920);
    expect(service.current()?.monitors.some((m) => m.busy)).toBe(false);
  });

  it("setOrder: si Windows dice que sí pero el orden no quedó, failed", async () => {
    const { service, displays } = await ready();
    displays.afterArrange = (raw) => {
      for (const d of raw) if (d.bounds) d.bounds = { ...d.bounds, x: d.devicePath === "tele" ? -1920 : d.bounds.x };
    };
    expect(await service.setOrder([PRIN, monitorId("der"), TELE])).toEqual({ ok: false, reason: "failed" });
  });

  it("la ventana activa y los apodos no se pierden al reordenar", async () => {
    const { service } = await ready();
    await service.rename(TELE, "Tele living");
    await service.setOrder([PRIN, monitorId("der"), TELE]);
    expect(service.current()?.monitors.find((m) => m.id === TELE)?.nickname).toBe("Tele living");
  });
});
