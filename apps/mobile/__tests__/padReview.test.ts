import { createPadController, DEFAULT_SETTINGS } from "@/pad/controller";
import { ownTouches } from "@/pad/touches";
import { applyTyping } from "@/pad/typing";
import { createTypingSession } from "@/pad/typingSession";
import { noMods } from "@/pad/mods";

describe("ownTouches: solo los dedos que están sobre el touchpad", () => {
  const t = (id: number, target: unknown) => ({ identifier: id, pageX: id * 10, pageY: id * 20, target });
  it("el pulgar apoyado en la barra de clic no cuenta como segundo dedo", () => {
    const r = ownTouches({ target: 7, touches: [t(1, 7), t(2, 99)] });
    expect(r).toEqual([{ id: 1, x: 10, y: 20 }]);
  });
  it("dos dedos sobre el touchpad cuentan los dos", () => {
    expect(ownTouches({ target: 7, touches: [t(1, 7), t(2, 7)] })).toHaveLength(2);
  });
  it("sin dedos, lista vacía", () => {
    expect(ownTouches({ target: 7, touches: [] })).toEqual([]);
  });
});

describe("controller.reset (se cortó la conexión o la PC apagó el Pad)", () => {
  function setup() {
    jest.useFakeTimers();
    const fired: string[] = [];
    const buttons: string[] = [];
    const c = createPadController({
      fire: (type, payload) => (fired.push(`${type}:${JSON.stringify(payload)}`), true),
      button: (b, a) => void buttons.push(`${b}:${a}`),
      haptic: () => undefined,
      settings: () => DEFAULT_SETTINGS,
      now: () => 0,
    });
    return { c, fired, buttons };
  }
  afterEach(() => jest.useRealTimers());

  it("olvida el candado y apaga los avisos, para que la pantalla y el controlador no queden desincronizados", () => {
    const { c, fired, buttons } = setup();
    c.setLock(true);
    expect(buttons).toEqual(["left:down"]);
    c.reset();
    expect(c.isLocked()).toBe(false);
    fired.length = 0;
    jest.advanceTimersByTime(5_000);
    expect(fired).toEqual([]);
    c.setLock(true); // al reconectar, tocar el candado vuelve a apretar de verdad
    expect(buttons.at(-1)).toBe("left:down");
  });
});

describe("escribir en vivo: un error a mitad de camino no repite lo que ya salió", () => {
  it("applyTyping aplica el pedazo al texto de la PC", () => {
    expect(applyTyping("hola", { backspaces: 2, text: "xy" })).toBe("hoxy");
    expect(applyTyping("a😀", { backspaces: 1, text: "b" })).toBe("ab");
    expect(applyTyping("", { backspaces: 3, text: "" })).toBe("");
  });

  it("si falla el segundo pedazo de un texto largo, el reintento manda solo lo que faltó", async () => {
    jest.useFakeTimers();
    const sent: string[] = [];
    let calls = 0;
    const s = createTypingSession({
      type: async (_b, tx) => {
        calls++;
        if (calls === 2) return { ok: false, error: "pad.error.busy" };
        sent.push(tx);
        return { ok: true };
      },
      key: async () => ({ ok: true }),
      mods: () => noMods(),
      setMods: () => undefined,
      setText: () => undefined,
      onError: () => undefined,
    });
    const big = "a".repeat(1200);
    s.change(big);
    jest.advanceTimersByTime(60);
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(sent.join("")).toBe("a".repeat(500)); // el primer pedazo salió; el segundo falló
    s.change(big + "b"); // lo próximo que se escribe reintenta lo que faltó
    jest.advanceTimersByTime(60);
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(sent.join("")).toBe(big + "b"); // sin repetir los primeros 500
    jest.useRealTimers();
  });

  it("al salir del Pad deja de escribir", async () => {
    jest.useFakeTimers();
    const sent: string[] = [];
    const s = createTypingSession({
      type: async (_b, tx) => (sent.push(tx), { ok: true }),
      key: async () => ({ ok: true }),
      mods: () => noMods(),
      setMods: () => undefined,
      setText: () => undefined,
      onError: () => undefined,
    });
    s.change("hola");
    s.dispose();
    jest.advanceTimersByTime(200);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sent).toEqual([]);
    s.change("otra vez");
    jest.advanceTimersByTime(200);
    expect(sent).toEqual([]);
    jest.useRealTimers();
  });
});
