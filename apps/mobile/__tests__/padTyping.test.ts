import { createTypingSession } from "@/pad/typingSession";
import { noMods, type ModState } from "@/pad/mods";

type Call = ["type", number, string] | ["key", string, string[]];
type R = { ok: true } | { ok: false; error: string };

function setup() {
  jest.useFakeTimers();
  const calls: Call[] = [];
  const texts: string[] = [];
  const errors: Array<string | null> = [];
  let mods: ModState = noMods();
  let nextResult: R = { ok: true };
  let gate: Promise<void> | null = null;
  const s = createTypingSession({
    type: async (b, t) => {
      if (gate) await gate;
      calls.push(["type", b, t]);
      return nextResult;
    },
    key: async (k, m) => {
      calls.push(["key", k, [...m]]);
      return nextResult;
    },
    mods: () => mods,
    setMods: (m) => (mods = m),
    setText: (t) => texts.push(t),
    onError: (e) => errors.push(e),
  });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    s, calls, texts, errors, flush,
    setMods: (m: Partial<ModState>) => (mods = { ...mods, ...m }),
    getMods: () => mods,
    fail: (error: string) => (nextResult = { ok: false, error }),
    ok: () => (nextResult = { ok: true }),
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
  };
}
afterEach(() => jest.useRealTimers());

describe("escribir en vivo", () => {
  it("lo que se escribe sale a los 50 ms (varias letras juntas en un solo mensaje)", async () => {
    const t = setup();
    t.s.change("h");
    t.s.change("ho");
    t.s.change("hol");
    expect(t.calls).toEqual([]);
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([["type", 0, "hol"]]);
  });

  it("corregir: borra y reescribe lo justo", async () => {
    const t = setup();
    t.s.change("hola mundo");
    jest.advanceTimersByTime(50);
    await t.flush();
    t.calls.length = 0;
    t.s.change("hola tierra");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([["type", 5, "tierra"]]);
  });

  it("borrar: solo retrocesos", async () => {
    const t = setup();
    t.s.change("abc");
    jest.advanceTimersByTime(50);
    await t.flush();
    t.calls.length = 0;
    t.s.change("a");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([["type", 2, ""]]);
  });

  it("escribir y borrar lo mismo antes de los 50 ms no manda nada", async () => {
    const t = setup();
    t.s.change("x");
    t.s.change("");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([]);
  });

  it("mientras un mensaje está en vuelo, lo que se escribe espera y sale después, en orden", async () => {
    const t = setup();
    const release = t.hold();
    t.s.change("uno");
    jest.advanceTimersByTime(50);
    await t.flush();
    t.s.change("unodos");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([]);
    release();
    await t.flush();
    jest.advanceTimersByTime(60);
    await t.flush();
    expect(t.calls).toEqual([["type", 0, "uno"], ["type", 0, "dos"]]);
  });

  it("los caracteres de control no se mandan (Enter y Tab son teclas)", async () => {
    const t = setup();
    t.s.change("a\nb");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([["type", 0, "ab"]]);
  });

  it("un error avisa y el texto queda en el campo; lo próximo que se escriba reintenta lo que faltó", async () => {
    const t = setup();
    t.fail("pad.error.input_blocked");
    t.s.change("hola");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.errors.at(-1)).toBe("pad.error.input_blocked");
    t.ok();
    t.calls.length = 0;
    t.s.change("hola!");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([["type", 0, "hola!"]]);
    expect(t.errors.at(-1)).toBeNull();
  });

  it("una carga grande se parte en mensajes de hasta 500", async () => {
    const t = setup();
    t.s.change("a".repeat(1200));
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls.map((c) => (c[0] === "type" ? c[2].length : 0))).toEqual([500, 500, 200]);
  });
});

describe("Enter y vaciar", () => {
  it("Enviar = Enter: manda lo que falte, aprieta Enter y vacía el campo sin borrar nada en la PC", async () => {
    const t = setup();
    t.s.change("lofi");
    await t.s.enter();
    expect(t.calls).toEqual([["type", 0, "lofi"], ["key", "enter", []]]);
    expect(t.texts.at(-1)).toBe("");
    t.calls.length = 0;
    t.s.change("jazz");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([["type", 0, "jazz"]]); // arranca de cero: no intenta borrar "lofi"
  });

  it("Enter con el campo vacío manda solo Enter", async () => {
    const t = setup();
    await t.s.enter();
    expect(t.calls).toEqual([["key", "enter", []]]);
  });

  it("si Enter falla, avisa y no vacía el campo", async () => {
    const t = setup();
    t.s.change("x");
    jest.advanceTimersByTime(50);
    await t.flush();
    t.fail("pad.error.timeout");
    await t.s.enter();
    expect(t.errors.at(-1)).toBe("pad.error.timeout");
    expect(t.texts).not.toContain("");
  });

  it("Vaciar limpia el campo y no toca la PC", async () => {
    const t = setup();
    t.s.change("algo");
    jest.advanceTimersByTime(50);
    await t.flush();
    t.calls.length = 0;
    t.s.clear();
    expect(t.texts.at(-1)).toBe("");
    t.s.change("nuevo");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([["type", 0, "nuevo"]]);
  });
});

describe("modificadores enganchados", () => {
  it("con Ctrl enganchado, la letra que se escribe va como Ctrl+letra y no entra al campo", async () => {
    const t = setup();
    t.setMods({ ctrl: "once" });
    t.s.change("l");
    await t.flush();
    expect(t.calls).toEqual([["key", "l", ["ctrl"]]]);
    expect(t.texts.at(-1)).toBe(""); // el campo vuelve a como estaba
    expect(t.getMods().ctrl).toBe("off"); // se soltó (era de una vez)
  });

  it("un modificador fijo se queda para la próxima", async () => {
    const t = setup();
    t.setMods({ shift: "locked" });
    t.s.change("a");
    await t.flush();
    expect(t.getMods().shift).toBe("locked");
  });

  it("un carácter sin tecla (ñ, ¿) con un modificador enganchado se ignora y el campo no cambia", async () => {
    const t = setup();
    t.setMods({ ctrl: "once" });
    t.s.change("ñ");
    await t.flush();
    expect(t.calls).toEqual([]);
    expect(t.texts.at(-1)).toBe("");
  });

  it("sin modificadores, todo sigue siendo texto", async () => {
    const t = setup();
    t.s.change("l");
    jest.advanceTimersByTime(50);
    await t.flush();
    expect(t.calls).toEqual([["type", 0, "l"]]);
  });

  it("las teclas del Pad (Esc, flechas…) también usan lo enganchado", async () => {
    const t = setup();
    t.setMods({ ctrl: "once", shift: "once" });
    await t.s.pressKey("left");
    expect(t.calls).toEqual([["key", "left", ["ctrl", "shift"]]]);
    expect(t.getMods()).toEqual(noMods());
  });
});
