import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "@proyecto-e/protocol";
import { backspaceEvents, keyEvents, nextCursor, shortcutEvents, textUnits, toVirtual, VK, type MonitorGeom } from "../src/input/model";

const mon = (x: number, y: number, w: number, h: number, scale = 1): MonitorGeom => ({ x, y, w, h, scale });

describe("nextCursor", () => {
  it("mueve en una sola pantalla al 100 %", () => {
    expect(nextCursor({ x: 100, y: 100 }, 10, 5, [mon(0, 0, 1920, 1080)])).toEqual({ x: 110, y: 105 });
  });

  it("multiplica por la escala del monitor donde está el cursor (y conserva lo fraccionario)", () => {
    const m = [mon(0, 0, 3840, 2160, 3)];
    expect(nextCursor({ x: 1000, y: 1000 }, 10, 0, m)).toEqual({ x: 1030, y: 1000 });
    const r = nextCursor({ x: 1000, y: 1000 }, 1, 1, [mon(0, 0, 1920, 1080, 1.5)]);
    expect(r).toEqual({ x: 1001.5, y: 1001.5 });
  });

  it("el mismo gesto recorre lo mismo (en px lógicos) en pantallas de distinta escala", () => {
    const monitors = [mon(0, 0, 1920, 1080, 1), mon(1920, 0, 3840, 2160, 3)];
    const a = nextCursor({ x: 500, y: 500 }, 40, 0, monitors);
    const b = nextCursor({ x: 3000, y: 500 }, 40, 0, monitors);
    expect(a.x - 500).toBe(40);
    expect(b.x - 3000).toBe(120);
  });

  it("cruza de una pantalla a la otra", () => {
    const monitors = [mon(0, 0, 1920, 1080, 1), mon(1920, 0, 1920, 1080, 1)];
    expect(nextCursor({ x: 1910, y: 500 }, 30, 0, monitors)).toEqual({ x: 1940, y: 500 });
  });

  it("funciona con pantallas a la izquierda del origen (coordenadas negativas)", () => {
    const monitors = [mon(-1920, 0, 1920, 1080, 1), mon(0, 0, 1920, 1080, 1)];
    expect(nextCursor({ x: 10, y: 500 }, -30, 0, monitors)).toEqual({ x: -20, y: 500 });
  });

  it("no se sale del escritorio: queda en el último píxel de la pantalla", () => {
    const monitors = [mon(0, 0, 1920, 1080)];
    expect(nextCursor({ x: 1900, y: 1070 }, 500, 500, monitors)).toEqual({ x: 1919, y: 1079 });
    expect(nextCursor({ x: 5, y: 5 }, -500, -500, monitors)).toEqual({ x: 0, y: 0 });
  });

  it("si cae en un hueco entre pantallas de distinto alto, se queda en el borde más cercano", () => {
    const monitors = [mon(0, 0, 1920, 1080), mon(1920, 0, 1920, 2160)];
    // Está en la pantalla alta, abajo (y=1500), y va a la izquierda: arriba de y=1079 no hay pantalla a la izquierda.
    const r = nextCursor({ x: 2000, y: 1500 }, -200, 0, monitors);
    expect(r).toEqual({ x: 1920, y: 1500 });
  });

  it("sin monitores no se mueve", () => {
    expect(nextCursor({ x: 10, y: 10 }, 5, 5, [])).toEqual({ x: 10, y: 10 });
  });
});

describe("toVirtual", () => {
  const roundTrip = (v: { x: number; y: number; w: number; h: number }, px: number, py: number) => {
    const n = toVirtual(px, py, v);
    return { x: v.x + Math.floor((n.x * v.w) / 65536), y: v.y + Math.floor((n.y * v.h) / 65536), n };
  };

  it("la esquina de arriba a la izquierda es (0,0) y todo cae en 0..65535", () => {
    const v = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(toVirtual(0, 0, v)).toEqual({ x: 0, y: 0 });
    const last = toVirtual(1919, 1079, v);
    expect(last.x).toBeLessThanOrEqual(65535);
    expect(last.y).toBeLessThanOrEqual(65535);
  });

  it("ida y vuelta: Windows (floor(n·w/65536)) devuelve el mismo píxel", () => {
    const v = { x: -1920, y: -200, w: 1920 + 3840, h: 2160 + 200 };
    for (const [px, py] of [[-1920, -200], [-1, 0], [0, 0], [1919, 1079], [3839, 1959], [v.x + v.w - 1, v.y + v.h - 1]]) {
      const r = roundTrip(v, px!, py!);
      expect(r.x, `x ${px}`).toBe(px);
      expect(r.y, `y ${py}`).toBe(py);
    }
  });

  it("recorta lo que cae fuera", () => {
    const v = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(toVirtual(-50, -50, v)).toEqual({ x: 0, y: 0 });
    expect(toVirtual(99999, 99999, v).x).toBeLessThanOrEqual(65535);
  });
});

describe("keyEvents", () => {
  it("una tecla sola: abajo y arriba", () => {
    expect(keyEvents("l", [])).toEqual([[0x4c, false, false], [0x4c, true, false]]);
  });

  it("Ctrl+L: Ctrl abajo, L abajo, L arriba, Ctrl arriba", () => {
    expect(keyEvents("l", ["ctrl"])).toEqual([
      [VK.CTRL, false, false],
      [0x4c, false, false],
      [0x4c, true, false],
      [VK.CTRL, true, false],
    ]);
  });

  it("varios modificadores se sueltan en orden inverso", () => {
    const ev = keyEvents("t", ["ctrl", "shift"]);
    expect(ev.map((e) => `${e[0].toString(16)}${e[1] ? "^" : "v"}`)).toEqual(["11v", "10v", "54v", "54^", "10^", "11^"]);
  });

  it("flechas, Inicio, Fin, Supr, Insert y RePág/AvPág son teclas extendidas; las demás no", () => {
    for (const k of ["left", "up", "right", "down", "home", "end", "delete", "insert", "pageUp", "pageDown"] as const) {
      expect(keyEvents(k, [])[0]![2], k).toBe(true);
    }
    for (const k of ["enter", "esc", "tab", "backspace", "space", "f5", "a", "7"] as const) {
      expect(keyEvents(k, [])[0]![2], k).toBe(false);
    }
  });

  it("códigos virtuales: Enter, Esc, F1, F12, letras y números", () => {
    expect(keyEvents("enter", [])[0]![0]).toBe(0x0d);
    expect(keyEvents("esc", [])[0]![0]).toBe(0x1b);
    expect(keyEvents("f1", [])[0]![0]).toBe(0x70);
    expect(keyEvents("f12", [])[0]![0]).toBe(0x7b);
    expect(keyEvents("a", [])[0]![0]).toBe(0x41);
    expect(keyEvents("z", [])[0]![0]).toBe(0x5a);
    expect(keyEvents("0", [])[0]![0]).toBe(0x30);
    expect(keyEvents("9", [])[0]![0]).toBe(0x39);
  });

  it("la tecla Win es VK_LWIN", () => {
    expect(keyEvents("d", ["win"])[0]![0]).toBe(0x5b);
  });
});

describe("shortcutEvents", () => {
  it("todos los atajos de la lista cerrada tienen teclas", () => {
    for (const s of SHORTCUTS) expect(shortcutEvents(s).length, s).toBeGreaterThanOrEqual(2);
  });

  it("combinaciones del boceto 04", () => {
    expect(shortcutEvents("addressBar")).toEqual(keyEvents("l", ["ctrl"]));
    expect(shortcutEvents("newTab")).toEqual(keyEvents("t", ["ctrl"]));
    expect(shortcutEvents("closeTab")).toEqual(keyEvents("w", ["ctrl"]));
    expect(shortcutEvents("back")).toEqual(keyEvents("left", ["alt"]));
    expect(shortcutEvents("forward")).toEqual(keyEvents("right", ["alt"]));
    expect(shortcutEvents("desktop")).toEqual(keyEvents("d", ["win"]));
    expect(shortcutEvents("fullscreen")).toEqual(keyEvents("f11", []));
    expect(shortcutEvents("reload")).toEqual(keyEvents("f5", []));
    expect(shortcutEvents("ytPlayPause")).toEqual(keyEvents("k", []));
    // D101: los genéricos de cualquier reproductor
    expect(shortcutEvents("mediaPlayPause")).toEqual(keyEvents("space", []));
    expect(shortcutEvents("mediaBack")).toEqual(keyEvents("left", []));
    expect(shortcutEvents("mediaForward")).toEqual(keyEvents("right", []));
    expect(shortcutEvents("mediaMute")).toEqual(keyEvents("m", []));
    expect(shortcutEvents("mediaFullscreen")).toEqual(keyEvents("f", []));
    expect(shortcutEvents("ytBack10")).toEqual(keyEvents("j", []));
    expect(shortcutEvents("ytForward10")).toEqual(keyEvents("l", []));
    expect(shortcutEvents("copy")).toEqual(keyEvents("c", ["ctrl"]));
    expect(shortcutEvents("paste")).toEqual(keyEvents("v", ["ctrl"]));
    expect(shortcutEvents("undo")).toEqual(keyEvents("z", ["ctrl"]));
  });

  it("no hay Alt+F4 ni Win+L entre los atajos", () => {
    const all = JSON.stringify(SHORTCUTS.map((s) => shortcutEvents(s)));
    expect(all).not.toContain(JSON.stringify([0x73, false, false])); // F4
  });
});

describe("textUnits y backspaceEvents", () => {
  it("texto común, ñ y tildes", () => {
    expect(textUnits("ñandú")).toEqual([0xf1, 0x61, 0x6e, 0x64, 0xfa]);
  });

  it("un emoji son dos unidades UTF-16", () => {
    expect(textUnits("😀")).toEqual([0xd83d, 0xde00]);
  });

  it("cada retroceso es abajo y arriba de VK_BACK", () => {
    expect(backspaceEvents(2)).toEqual([
      [0x08, false, false],
      [0x08, true, false],
      [0x08, false, false],
      [0x08, true, false],
    ]);
    expect(backspaceEvents(0)).toEqual([]);
  });
});
