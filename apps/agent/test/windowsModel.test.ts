import { describe, expect, it } from "vitest";
import { WindowsState } from "@proyecto-e/protocol";
import type { RawDisplay, RawWindowFull } from "../src/ports";
import { monitorId } from "../src/screens/model";
import { WindowIds, buildWindows, iconKeyFor } from "../src/apps/windowsModel";

const disp = (path: string, x: number, over: Partial<RawDisplay> = {}): RawDisplay => ({
  devicePath: path, friendlyName: path, outputTechnology: 10, active: true, primary: false, gdiName: null,
  bounds: { x, y: 0, w: 1920, h: 1080 }, workArea: null, ...over,
});
const win = (n: number, over: Partial<RawWindowFull> = {}): RawWindowFull => ({
  handle: "0x" + n, title: "Ventana " + n, exe: `app${n}.exe`, className: "Cls", rect: { x: 100, y: 100, w: 800, h: 600 },
  state: "normal", pid: 10 + n, exePath: `C:\Apps\app${n}.exe`, focused: false, fullscreen: false, ...over,
});
const RAW = [disp("izq", 0), disp("der", 1920, { primary: true })];
const MONS = RAW.map((r, i) => ({ id: monitorId(r.devicePath), enabled: true, index: i + 1 }) as never);

describe("WindowIds", () => {
  it("el mismo handle siempre da el mismo id; los ids nunca se reutilizan", () => {
    const ids = new WindowIds();
    const a = ids.idFor("0x1");
    expect(ids.idFor("0x1")).toBe(a);
    const b = ids.idFor("0x2");
    expect(b).not.toBe(a);
    ids.prune(new Set(["0x2"]));
    expect(ids.handleFor(a)).toBeUndefined();
    expect(ids.idFor("0x9")).not.toBe(a);
  });
});

describe("buildWindows", () => {
  it("arma ventanas que pasan el esquema del protocolo, con la pantalla por el centro", () => {
    const out = buildWindows([win(1), win(2, { rect: { x: 2100, y: 50, w: 400, h: 300 }, focused: true })], RAW, MONS, new WindowIds());
    expect(WindowsState.safeParse({ windows: out }).success).toBe(true);
    expect(out[0]).toMatchObject({ monitorId: monitorId("izq"), state: "normal", focused: false, app: "app1" });
    expect(out[1]).toMatchObject({ monitorId: monitorId("der"), focused: true });
  });
  it("minimizada no tiene pantalla; pantalla completa se informa como tal", () => {
    const out = buildWindows([win(1, { state: "minimized" }), win(2, { fullscreen: true })], RAW, MONS, new WindowIds());
    expect(out[0]).toMatchObject({ state: "minimized", monitorId: null });
    expect(out[1]!.state).toBe("fullscreen");
  });
  it("descarta el escritorio y la barra, y las sin título", () => {
    const out = buildWindows([win(1, { className: "Progman" }), win(2, { className: "Shell_TrayWnd" }), win(3, { title: "  " }), win(4)], RAW, MONS, new WindowIds());
    expect(out.map((w) => w.app)).toEqual(["app4"]);
  });
  it("recorta títulos largos y se queda con 40 (la enfocada siempre entra)", () => {
    const many = Array.from({ length: 55 }, (_, i) => win(i + 1, { title: "x".repeat(300), focused: i === 50 }));
    const out = buildWindows(many, RAW, MONS, new WindowIds());
    expect(out).toHaveLength(40);
    expect(out.every((w) => w.title.length === 120)).toBe(true);
    expect(out.some((w) => w.focused)).toBe(true);
  });
  it("el ícono sale de la ruta del .exe (misma ruta = misma clave) y es una IconKey válida", () => {
    const [a, b] = buildWindows([win(1), win(1, { handle: "0x77", title: "Otra" })], RAW, MONS, new WindowIds());
    expect(a!.iconKey).toBe(b!.iconKey);
    expect(a!.iconKey).toBe(iconKeyFor("C:\Apps\app1.exe"));
    expect(iconKeyFor("a")).toMatch(/^i_[A-Za-z0-9_-]{16}$/);
  });
  it("sin ruta del .exe no hay ícono", () => {
    expect(buildWindows([win(1, { exePath: "" })], RAW, MONS, new WindowIds())[0]!.iconKey).toBeNull();
  });
});
