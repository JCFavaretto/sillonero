import { describe, expect, it } from "vitest";
import { Library, SCENE_KEYS, Scene, SceneDraft, SceneHotkey, SceneTrigger } from "../src/library";
import { CommandError, parseClientMessage } from "../src/messages";

const MON = "m_DemoMonitorUno01";
const base = { id: "s_AAAAAAAAAA", name: "Juego", steps: [{ kind: "bringAll" }] };

describe("atajo y disparador de escena (B6.3)", () => {
  it("las teclas posibles son letras (menos T y M, que ya tienen dueño), 8 y 9", () => {
    expect(SCENE_KEYS).toHaveLength(27);
    for (const reserved of ["T", "M", "1", "2", "3", "4", "5", "6", "7"]) expect(SCENE_KEYS).not.toContain(reserved);
    for (const ok of ["A", "J", "K", "Z", "0", "8", "9"]) expect(SceneHotkey.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["T", "M", "5", "a", "AA", "", "Esc", "ñ"]) expect(SceneHotkey.safeParse(bad).success, bad).toBe(false);
  });

  it("los dos campos son opcionales: una escena vieja sigue siendo válida", () => {
    expect(Scene.safeParse(base).success).toBe(true);
    expect(SceneDraft.safeParse({ name: "x", steps: base.steps }).success).toBe(true);
  });

  it("una escena puede traer atajo y disparador", () => {
    expect(Scene.safeParse({ ...base, hotkey: "J", trigger: { type: "agentStart" } }).success).toBe(true);
    expect(Scene.safeParse({ ...base, trigger: { type: "displayOn", displayId: MON } }).success).toBe(true);
  });

  it("rechaza teclas reservadas, disparadores raros y campos de más", () => {
    expect(Scene.safeParse({ ...base, hotkey: "T" }).success).toBe(false);
    expect(Scene.safeParse({ ...base, trigger: { type: "displayOn" } }).success).toBe(false);
    expect(Scene.safeParse({ ...base, trigger: { type: "displayOn", displayId: "nope" } }).success).toBe(false);
    expect(Scene.safeParse({ ...base, trigger: { type: "cada5s" } }).success).toBe(false);
    expect(SceneTrigger.safeParse({ type: "agentStart", extra: 1 }).success).toBe(false);
    expect(Scene.safeParse({ ...base, hotkey: null }).success).toBe(false); // guardada: o hay tecla o no está el campo
  });

  it("en el borrador, null significa 'quitar' y no mandar el campo significa 'dejar como está'", () => {
    expect(SceneDraft.safeParse({ id: base.id, name: "x", steps: base.steps, hotkey: null, trigger: null }).success).toBe(true);
    expect(SceneDraft.safeParse({ id: base.id, name: "x", steps: base.steps, hotkey: "K" }).success).toBe(true);
    expect(SceneDraft.safeParse({ name: "x", steps: base.steps, hotkey: "T" }).success).toBe(false);
  });

  it("la biblioteca con escenas con atajo viaja bien en scene.save", () => {
    const raw = JSON.stringify({ v: 1, id: "c1", type: "scene.save", payload: { scene: { name: "Juego", steps: base.steps, hotkey: "J", trigger: { type: "agentStart" } } } });
    expect(parseClientMessage(raw).ok).toBe(true);
    expect(Library.safeParse({ launchers: [], scenes: [{ ...base, hotkey: "J" }], deck: [] }).success).toBe(true);
  });

  it("CommandError suma hotkey_taken", () => {
    expect(CommandError.safeParse("hotkey_taken").success).toBe(true);
  });
});
