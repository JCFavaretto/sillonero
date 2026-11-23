import { createAccel, gain } from "@/pad/accel";
import { createBatcher } from "@/pad/batcher";
import { activeMods, consumeMods, toggleMod, type ModState } from "@/pad/mods";
import { chunkTyping, charToPadKey, diffTyping, sanitizeTyped } from "@/pad/typing";
import { createLatency } from "@/pad/latency";

describe("accel (D45)", () => {
  it("lento: casi la sensibilidad; rápido: hasta 2 veces más (con tope)", () => {
    expect(gain(0, 1)).toBeCloseTo(1, 5);
    expect(gain(2.5, 1)).toBeCloseTo(2, 5);
    expect(gain(100, 1)).toBeCloseTo(2, 5); // tope
    expect(gain(1, 2)).toBeCloseTo(2 * (1 + 1 / 2.5), 5);
    expect(gain(-3, 1)).toBeCloseTo(1, 5);
  });

  it("devuelve enteros y guarda el resto para el próximo movimiento (no se pierde lo lento)", () => {
    const a = createAccel();
    let sumX = 0;
    for (let i = 0; i < 100; i++) sumX += a.apply(0.3, 0, 16, 1).dx; // 0,3 px por tick, lento
    // 100 × 0,3 × ganancia (≈1) ≈ 30 px: sin guardar el resto daría 0
    expect(sumX).toBeGreaterThanOrEqual(29);
    expect(sumX).toBeLessThanOrEqual(33);
    expect(Number.isInteger(sumX)).toBe(true);
  });

  it("los ejes llevan su propio resto y el signo se respeta", () => {
    const a = createAccel();
    const r = a.apply(-0.6, 0.6, 16, 1);
    expect(r.dx).toBeLessThanOrEqual(0);
    expect(r.dy).toBeGreaterThanOrEqual(0);
  });

  it("reset borra el resto", () => {
    const a = createAccel();
    a.apply(0.4, 0.4, 16, 1);
    a.reset();
    expect(a.apply(0, 0, 16, 1)).toEqual({ dx: 0, dy: 0 });
  });

  it("dt cero o negativo no rompe (se toma 1 ms)", () => {
    const a = createAccel();
    const r = a.apply(5, 5, 0, 1);
    expect(Number.isFinite(r.dx) && Number.isFinite(r.dy)).toBe(true);
  });
});

describe("batcher (D43)", () => {
  function setup(ms = 16, max = 512) {
    jest.useFakeTimers();
    const sent: Array<[number, number]> = [];
    const b = createBatcher((dx, dy) => sent.push([dx, dy]), ms, max);
    return { b, sent };
  }
  afterEach(() => jest.useRealTimers());

  it("el primero sale enseguida; lo que llega mientras tanto se suma y sale al vencer el plazo", () => {
    const { b, sent } = setup();
    b.push(1, 0);
    expect(sent).toEqual([[1, 0]]);
    for (let i = 0; i < 10; i++) b.push(1, 2);
    expect(sent).toHaveLength(1);
    jest.advanceTimersByTime(16);
    expect(sent).toEqual([[1, 0], [10, 20]]);
  });

  it("100 deltas en 50 ms son pocos mensajes y la suma exacta", () => {
    const { b, sent } = setup();
    for (let i = 0; i < 100; i++) {
      b.push(1, 1);
      jest.advanceTimersByTime(0.5);
    }
    jest.advanceTimersByTime(50);
    expect(sent.length).toBeLessThanOrEqual(5);
    expect(sent.reduce((s, [x]) => s + x, 0)).toBe(100);
    expect(sent.reduce((s, [, y]) => s + y, 0)).toBe(100);
  });

  it("flush manda lo que falte ya (al soltar el dedo)", () => {
    const { b, sent } = setup();
    b.push(1, 0);
    b.push(4, 4);
    b.flush();
    expect(sent).toEqual([[1, 0], [4, 4]]);
    jest.advanceTimersByTime(100);
    expect(sent).toHaveLength(2);
  });

  it("nunca manda más del tope por mensaje: parte lo que se acumuló", () => {
    const { b, sent } = setup(16, 512);
    b.push(0, 0);
    b.push(1300, -700);
    b.flush();
    const pieces = sent;
    for (const [x, y] of pieces) {
      expect(Math.abs(x)).toBeLessThanOrEqual(512);
      expect(Math.abs(y)).toBeLessThanOrEqual(512);
    }
    expect(pieces.reduce((s, [x]) => s + x, 0)).toBe(1300);
    expect(pieces.reduce((s, [, y]) => s + y, 0)).toBe(-700);
  });

  it("cero no manda nada; cancel descarta lo pendiente", () => {
    const { b, sent } = setup();
    b.push(0, 0);
    expect(sent).toEqual([]);
    b.push(2, 2);
    b.push(3, 3);
    b.cancel();
    jest.advanceTimersByTime(100);
    expect(sent).toEqual([[2, 2]]);
  });
});

describe("typing (escribir en vivo)", () => {
  it("agregar al final: solo texto", () => {
    expect(diffTyping("hol", "hola")).toEqual({ backspaces: 0, text: "a" });
    expect(diffTyping("", "hola")).toEqual({ backspaces: 0, text: "hola" });
  });
  it("borrar al final: solo retrocesos", () => {
    expect(diffTyping("hola", "ho")).toEqual({ backspaces: 2, text: "" });
    expect(diffTyping("a", "")).toEqual({ backspaces: 1, text: "" });
  });
  it("corregir en el medio o cambiar una palabra: borra desde el primer carácter distinto", () => {
    expect(diffTyping("hola mundo", "hola tierra")).toEqual({ backspaces: 5, text: "tierra" });
    expect(diffTyping("helo", "hello")).toEqual({ backspaces: 1, text: "lo" });
  });
  it("sin cambios no hay nada que mandar", () => {
    expect(diffTyping("igual", "igual")).toEqual({ backspaces: 0, text: "" });
  });
  it("un emoji cuenta como UN carácter para borrar", () => {
    expect(diffTyping("ok😀", "ok")).toEqual({ backspaces: 1, text: "" });
    expect(diffTyping("ok", "ok😀")).toEqual({ backspaces: 0, text: "😀" });
    expect(diffTyping("a😀b", "a😀c")).toEqual({ backspaces: 1, text: "c" });
  });
  it("sanitizeTyped saca los caracteres de control (Enter y Tab van como teclas)", () => {
    expect(sanitizeTyped("a\nb\tc\u0007d")).toBe("abcd");
    expect(sanitizeTyped("ñandú ¿? 😀")).toBe("ñandú ¿? 😀");
  });
  it("chunkTyping parte lo que pasa de 500 sin cortar un emoji", () => {
    expect(chunkTyping({ backspaces: 0, text: "" })).toEqual([]);
    expect(chunkTyping({ backspaces: 3, text: "ab" })).toEqual([{ backspaces: 3, text: "ab" }]);
    const big = chunkTyping({ backspaces: 1200, text: "😀".repeat(400) }); // 800 unidades UTF-16
    expect(big.reduce((s, c) => s + c.backspaces, 0)).toBe(1200);
    expect(big.map((c) => c.text).join("")).toBe("😀".repeat(400));
    for (const c of big) {
      expect(c.backspaces).toBeLessThanOrEqual(500);
      expect(c.text.length).toBeLessThanOrEqual(500);
      expect(c.backspaces > 0 || c.text.length > 0).toBe(true);
      expect(/[\uD800-\uDBFF]$/.test(c.text)).toBe(false); // no termina a mitad de un emoji
    }
  });
  it("charToPadKey: letras, números y espacio; lo demás no tiene tecla", () => {
    expect(charToPadKey("a")).toBe("a");
    expect(charToPadKey("L")).toBe("l");
    expect(charToPadKey("7")).toBe("7");
    expect(charToPadKey(" ")).toBe("space");
    expect(charToPadKey("ñ")).toBeNull();
    expect(charToPadKey("¿")).toBeNull();
    expect(charToPadKey("ab")).toBeNull();
    expect(charToPadKey("")).toBeNull();
  });
});

describe("mods (modificadores enganchados)", () => {
  const off: ModState = { ctrl: "off", alt: "off", shift: "off", win: "off" };

  it("un toque engancha para la próxima tecla; otro toque lo suelta", () => {
    const a = toggleMod(off, "ctrl", 1000);
    expect(a.ctrl).toBe("once");
    expect(toggleMod(a, "ctrl", 2000).ctrl).toBe("off");
  });
  it("dos toques seguidos (menos de 400 ms) lo dejan fijo, y un toque más lo suelta", () => {
    const a = toggleMod(off, "ctrl", 1000);
    const b = toggleMod(a, "ctrl", 1300);
    expect(b.ctrl).toBe("locked");
    expect(toggleMod(b, "ctrl", 5000).ctrl).toBe("off");
  });
  it("activeMods lista los enganchados en orden fijo", () => {
    expect(activeMods({ ctrl: "once", alt: "off", shift: "locked", win: "off" })).toEqual(["ctrl", "shift"]);
    expect(activeMods(off)).toEqual([]);
  });
  it("consumeMods suelta los de una vez y deja los fijos", () => {
    expect(consumeMods({ ctrl: "once", alt: "locked", shift: "once", win: "off" })).toEqual({ ctrl: "off", alt: "locked", shift: "off", win: "off" });
  });
  it("cada modificador es independiente", () => {
    const a = toggleMod(toggleMod(off, "ctrl", 0), "shift", 10);
    expect(a).toEqual({ ctrl: "once", alt: "off", shift: "once", win: "off" });
  });
});

describe("latency (D57)", () => {
  it("la mediana de las últimas 5 muestras", () => {
    const l = createLatency();
    for (const v of [10, 90, 20, 30, 25]) l.add(v);
    expect(l.median()).toBe(25);
    l.add(1000);
    expect(l.median()).toBe(30); // las últimas 5: 90, 20, 30, 25, 1000 → 30
  });
  it("sin muestras no hay mediana", () => {
    expect(createLatency().median()).toBeNull();
  });
  it("lento si pasa de 80 ms durante 3 muestras seguidas; vuelve a normal con una buena", () => {
    const l = createLatency();
    l.add(100);
    l.add(100);
    expect(l.slow()).toBe(false);
    l.add(100);
    expect(l.slow()).toBe(true);
    l.add(20);
    expect(l.slow()).toBe(false);
  });
  it("reset borra todo", () => {
    const l = createLatency();
    l.add(500);
    l.add(500);
    l.add(500);
    l.reset();
    expect(l.median()).toBeNull();
    expect(l.slow()).toBe(false);
  });
});
