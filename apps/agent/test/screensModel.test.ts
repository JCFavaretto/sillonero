import { describe, expect, it } from "vitest";
import { Monitor } from "@proyecto-e/protocol";
import { buildForeground, buildMonitors, connectorFor, monitorId } from "../src/screens/model";
import type { RawDisplay, RawWindow } from "../src/ports";

const raw = (over: Partial<RawDisplay>): RawDisplay => ({
  devicePath: "\\\\?\\DISPLAY#GSM59A4#5&1&0&UID1",
  friendlyName: "DELL U2412M",
  outputTechnology: 10,
  active: true,
  primary: false,
  gdiName: "\\\\.\\DISPLAY1",
  bounds: { x: 0, y: 0, w: 1920, h: 1080 },
  workArea: { x: 0, y: 0, w: 1920, h: 1040 },
  ...over,
});

// La PC de Jay: izquierdo, principal y la tele (HDMI).
const IZQ = raw({ devicePath: "path-izq" });
const PRIN = raw({
  devicePath: "path-prin",
  friendlyName: "LG 27GL850",
  primary: true,
  bounds: { x: 1920, y: 0, w: 2560, h: 1440 },
});
const TELE = raw({
  devicePath: "path-tele",
  friendlyName: "Samsung TV",
  outputTechnology: 5,
  active: false,
  bounds: null,
  workArea: null,
  gdiName: null,
});

describe("monitorId", () => {
  it("es estable y tiene el formato del protocolo", () => {
    expect(monitorId("path-izq")).toBe(monitorId("path-izq"));
    expect(monitorId("path-izq")).not.toBe(monitorId("path-prin"));
    expect(monitorId("path-izq")).toMatch(/^m_[A-Za-z0-9_-]{16}$/);
  });
});

describe("connectorFor", () => {
  it.each([
    [0, "vga"],
    [4, "dvi"],
    [5, "hdmi"],
    [10, "displayport"],
    [11, "internal"], // DisplayPort embebido = pantalla de notebook
    [6, "internal"], // LVDS
    [0x80000000, "internal"],
    [-2147483648, "internal"], // el mismo valor visto como entero con signo
    [-1, "other"],
    [15, "other"], // Miracast
    [999, "other"],
  ])("%s → %s", (tech, expected) => {
    expect(connectorFor(tech)).toBe(expected);
  });
});

describe("buildMonitors", () => {
  it("cada resultado cumple el esquema del protocolo", () => {
    for (const m of buildMonitors([IZQ, PRIN, TELE])) expect(Monitor.safeParse(m).success).toBe(true);
  });

  it("numera las prendidas de izquierda a derecha y deja las apagadas sin número", () => {
    const ms = buildMonitors([PRIN, TELE, IZQ]); // desordenadas a propósito
    expect(ms.map((m) => [m.name, m.index])).toEqual([
      ["DELL U2412M", 1],
      ["LG 27GL850", 2],
      ["Samsung TV", null],
    ]);
  });

  it("desempata por arriba cuando están a la misma altura de X", () => {
    const arriba = raw({ devicePath: "a", bounds: { x: 0, y: 0, w: 100, h: 100 } });
    const abajo = raw({ devicePath: "b", bounds: { x: 0, y: 100, w: 100, h: 100 } });
    const ms = buildMonitors([abajo, arriba]);
    expect(ms.map((m) => m.id)).toEqual([monitorId("a"), monitorId("b")]);
  });

  it("la principal no se apaga; la apagada trae bounds null y la resolución de antes si se conoce", () => {
    const [izq, prin, tele] = buildMonitors([IZQ, PRIN, TELE], {
      lastBounds: new Map([[monitorId("path-tele"), { x: 4480, y: 0, w: 3840, h: 2160 }]]),
    });
    expect(prin).toMatchObject({ primary: true, canDisable: false, blockedBy: "primary", enabled: true });
    expect(izq).toMatchObject({ canDisable: true, blockedBy: null });
    expect(tele).toMatchObject({
      enabled: false,
      bounds: null,
      lastBounds: { x: 4480, y: 0, w: 3840, h: 2160 },
      resolution: null,
      canDisable: false,
      connector: "hdmi",
    });
  });

  it("una apagada que nunca se vio prendida no tiene lastBounds", () => {
    const tele = buildMonitors([IZQ, PRIN, TELE]).find((m) => m.name === "Samsung TV");
    expect(tele?.lastBounds).toBeNull();
  });

  it("las prendidas guardan sus bounds como lastBounds y su resolución", () => {
    const [izq] = buildMonitors([IZQ]);
    expect(izq).toMatchObject({ bounds: IZQ.bounds, lastBounds: IZQ.bounds, resolution: { w: 1920, h: 1080 } });
  });

  it("la única prendida no se puede apagar aunque no sea la principal", () => {
    const [m] = buildMonitors([raw({ primary: false }), TELE]);
    expect(m).toMatchObject({ canDisable: false, blockedBy: "last_active" });
  });

  it("usa los apodos que le pasan y marca las ocupadas", () => {
    const id = monitorId("path-tele");
    const ms = buildMonitors([IZQ, PRIN, TELE], { nicknames: new Map([[id, "Tele living"]]), busy: new Set([id]) });
    const tele = ms.find((m) => m.id === id);
    expect(tele).toMatchObject({ nickname: "Tele living", busy: true });
  });

  it("sin nombre de monitor usa 'Pantalla' y recorta lo larguísimo", () => {
    expect(buildMonitors([raw({ friendlyName: "" })])[0]?.name).toBe("Pantalla");
    expect(buildMonitors([raw({ friendlyName: "x".repeat(200) })])[0]?.name).toHaveLength(64);
  });

  it("si Windows repite una misma pantalla, queda una sola (la prendida)", () => {
    const dup = raw({ devicePath: "path-izq", active: false, bounds: null, workArea: null });
    const ms = buildMonitors([dup, IZQ]);
    expect(ms).toHaveLength(1);
    expect(ms[0]?.enabled).toBe(true);
  });

  it("sin ninguna prendida no rompe (todas quedan sin número ni frenos)", () => {
    const ms = buildMonitors([TELE]);
    expect(ms[0]).toMatchObject({ index: null, canDisable: false, blockedBy: null });
  });

  it("no pasa de 16 pantallas", () => {
    const muchas = Array.from({ length: 20 }, (_, i) => raw({ devicePath: `p${i}`, bounds: { x: i * 10, y: 0, w: 10, h: 10 } }));
    expect(buildMonitors(muchas)).toHaveLength(16);
  });
});

describe("buildForeground", () => {
  const monitors = buildMonitors([IZQ, PRIN, TELE]);
  const win = (over: Partial<RawWindow>): RawWindow => ({
    handle: "0x1234",
    title: "PLAN.md — proyecto-e — Visual Studio Code",
    exe: "Code.exe",
    className: "Chrome_WidgetWin_1",
    rect: { x: 2000, y: 100, w: 1200, h: 800 },
    state: "normal",
    ...over,
  });

  it("sin ventana → null", () => {
    expect(buildForeground(null, monitors, [IZQ, PRIN, TELE])).toBeNull();
  });

  it("devuelve título, app y la pantalla donde está (por el centro de la ventana)", () => {
    const f = buildForeground(win({}), monitors, [IZQ, PRIN, TELE]);
    expect(f).toEqual({
      title: "PLAN.md — proyecto-e — Visual Studio Code",
      app: "Code.exe",
      monitorId: monitorId("path-prin"),
    });
  });

  it("una ventana a medias entre dos pantallas cuenta donde está su centro", () => {
    const izqMasQueMitad = win({ rect: { x: 1500, y: 0, w: 800, h: 600 } }); // centro x=1900, todavía en la izquierda
    const prinMasQueMitad = win({ rect: { x: 1700, y: 0, w: 800, h: 600 } }); // centro x=2100, ya en la principal
    expect(buildForeground(izqMasQueMitad, monitors, [IZQ, PRIN, TELE])?.monitorId).toBe(monitorId("path-izq"));
    expect(buildForeground(prinMasQueMitad, monitors, [IZQ, PRIN, TELE])?.monitorId).toBe(monitorId("path-prin"));
  });

  it("fuera de toda pantalla → monitorId null", () => {
    expect(buildForeground(win({ rect: { x: 9000, y: 9000, w: 100, h: 100 } }), monitors, [IZQ, PRIN, TELE])?.monitorId).toBeNull();
  });

  it.each(["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"])("el escritorio o la barra (%s) no cuentan", (className) => {
    expect(buildForeground(win({ className }), monitors, [IZQ, PRIN, TELE])).toBeNull();
  });

  it("sin título usa el nombre del programa; recorta lo larguísimo", () => {
    expect(buildForeground(win({ title: "   " }), monitors, [IZQ, PRIN, TELE])?.title).toBe("Code.exe");
    const f = buildForeground(win({ title: "t".repeat(500), exe: "e".repeat(500) }), monitors, [IZQ, PRIN, TELE]);
    expect(f?.title).toHaveLength(120);
    expect(f?.app).toHaveLength(64);
  });

  it("una ventana minimizada no tiene pantalla (Windows la manda a coordenadas -32000)", () => {
    const f = buildForeground(win({ state: "minimized", rect: { x: -32000, y: -32000, w: 160, h: 28 } }), monitors, [IZQ, PRIN, TELE]);
    expect(f?.monitorId).toBeNull();
  });
});
