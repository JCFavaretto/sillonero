import { describe, expect, it } from "vitest";
import { HOTKEYS, activeHotkeys, hotkeyById, sceneHotkeys } from "../src/hotkeys/model";

describe("tabla de atajos (D69)", () => {
  it("tiene ids y teclas sin repetir", () => {
    const ids = HOTKEYS.map((h) => h.id);
    const vks = HOTKEYS.map((h) => h.vk);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(vks).size).toBe(vks.length);
  });

  it("trae la paridad del .ahk: T, M, 1 a 7 y Esc para cortar el Pad", () => {
    const labels = HOTKEYS.map((h) => h.label);
    expect(labels).toEqual(["T", "M", "1", "2", "3", "4", "5", "6", "7", "Esc"]);
  });

  it("cada tecla tiene su acción", () => {
    const by = (label: string) => HOTKEYS.find((h) => h.label === label)!.action;
    expect(by("T")).toEqual({ kind: "tv" });
    expect(by("M")).toEqual({ kind: "panel" });
    expect(by("1")).toEqual({ kind: "moveActive", index: 1 });
    expect(by("3")).toEqual({ kind: "moveActive", index: 3 });
    expect(by("4")).toEqual({ kind: "fullscreen" });
    expect(by("5")).toEqual({ kind: "media", key: "prev" });
    expect(by("6")).toEqual({ kind: "media", key: "playPause" });
    expect(by("7")).toEqual({ kind: "media", key: "next" });
    expect(by("Esc")).toEqual({ kind: "cutPad" });
  });

  it("los códigos virtuales son los de Windows (0–9 y A–Z son su ASCII; Esc es 0x1B)", () => {
    const vk = (label: string) => HOTKEYS.find((h) => h.label === label)!.vk;
    expect(vk("T")).toBe(0x54);
    expect(vk("M")).toBe(0x4d);
    expect(vk("1")).toBe(0x31);
    expect(vk("7")).toBe(0x37);
    expect(vk("Esc")).toBe(0x1b);
  });

  it("con la llave global apagada solo queda el de cortar el Pad", () => {
    expect(activeHotkeys(false).map((h) => h.label)).toEqual(["Esc"]);
    expect(activeHotkeys(true)).toHaveLength(HOTKEYS.length);
  });

  it("hotkeyById encuentra por id y devuelve undefined si no existe", () => {
    expect(hotkeyById(HOTKEYS[0]!.id)).toBe(HOTKEYS[0]);
    expect(hotkeyById(9999)).toBeUndefined();
  });
});

describe("atajos de escenas (B6.3)", () => {
  const scenes = [
    { id: "s_AAAAAAAAAA", name: "Juego", hotkey: "J" as const },
    { id: "s_BBBBBBBBBB", name: "Sin tecla" },
    { id: "s_CCCCCCCCCC", name: "Nueve", hotkey: "9" as const },
  ];

  it("arma uno por escena con tecla, con la acción de correr esa escena", () => {
    const defs = sceneHotkeys(scenes);
    expect(defs.map((d) => d.label)).toEqual(["J", "9"]);
    expect(defs[0]).toMatchObject({ vk: 0x4a, action: { kind: "scene", sceneId: "s_AAAAAAAAAA" }, always: false, sceneName: "Juego" });
    expect(defs[1]).toMatchObject({ vk: 0x39, action: { kind: "scene", sceneId: "s_CCCCCCCCCC" } });
  });

  it("los ids no chocan con los fijos ni entre sí, y no cambian si cambia el resto de las escenas", () => {
    const defs = sceneHotkeys(scenes);
    const fixed = new Set(HOTKEYS.map((h) => h.id));
    for (const d of defs) {
      expect(d.id).toBeGreaterThanOrEqual(100);
      expect(fixed.has(d.id)).toBe(false);
    }
    expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length);
    expect(sceneHotkeys([scenes[2]!])[0]!.id).toBe(defs[1]!.id);
  });

  it("si dos escenas traen la misma tecla (archivo editado a mano) gana la primera", () => {
    const defs = sceneHotkeys([scenes[0]!, { id: "s_DDDDDDDDDD", name: "Otra", hotkey: "J" as const }]);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.action).toEqual({ kind: "scene", sceneId: "s_AAAAAAAAAA" });
  });

  it("hotkeyById no encuentra las de escenas (esas se buscan aparte)", () => {
    expect(hotkeyById(sceneHotkeys(scenes)[0]!.id)).toBeUndefined();
  });
});
