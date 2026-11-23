import type { WindowInfo } from "@proyecto-e/protocol";
import { DEMO_WINDOWS } from "@/apps/demo";
import { windowCards } from "@/apps/groups";
import { DEMO_AUDIO } from "@/audio/demo";

const w = (over: Partial<WindowInfo>): WindowInfo => ({ ...DEMO_WINDOWS[1]!, ...over });

describe("windowCards: una tarjeta por ventana", () => {
  it("cada ventana es una tarjeta, aunque sean de la misma app, en el orden de la PC", () => {
    const cards = windowCards([...DEMO_WINDOWS, w({ id: "w_9", title: "Otra ventana de Chrome" })], null);
    expect(cards.map((c) => c.key)).toEqual(["w_1", "w_2", "w_3", "w_4", "w_9"]);
    expect(cards.filter((c) => c.app === "chrome").map((c) => c.main.title)).toEqual(["YouTube — Age of Empires", "Otra ventana de Chrome"]);
  });

  it("veinte ventanas de Chrome son veinte tarjetas", () => {
    expect(windowCards(Array.from({ length: 20 }, (_, i) => w({ id: `w_${i}`, title: `Pestaña ${i}` })), null)).toHaveLength(20);
  });

  it("al frente y minimizada se miran por ventana, no por app", () => {
    const [a, b, c] = windowCards([w({ id: "a", focused: true }), w({ id: "b", state: "minimized", monitorId: null }), w({ id: "c" })], null);
    expect([a!.front, b!.front, c!.front]).toEqual([true, false, false]);
    expect([a!.minimized, b!.minimized, c!.minimized]).toEqual([false, true, false]);
  });

  it("sonando: la app figura en el audio de la PC como sonando (sin importar mayúsculas)", () => {
    const audio = structuredClone(DEMO_AUDIO);
    audio.apps[1] = { ...audio.apps[1]!, name: "Chrome", sounding: true };
    const cards = windowCards(DEMO_WINDOWS, audio);
    expect(cards.find((c) => c.app === "chrome")!.sounding).toBe(true);
    expect(cards.find((c) => c.app === "Discord")!.sounding).toBe(false);
    expect(cards.find((c) => c.app === "chrome")!.audioId).toBe("a_DemoChrome01");
  });
});
