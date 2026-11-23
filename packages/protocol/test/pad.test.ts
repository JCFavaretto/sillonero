import { describe, expect, it } from "vitest";
import { PadDelta, PadKey, PadMods, PadState, PadText, Shortcut, WheelDelta } from "../src/pad";
import { CommandError, parseClientMessage, parseServerMessage } from "../src/messages";

const env = (type: string, payload: unknown) => JSON.stringify({ v: 1, id: "c1", type, payload });
const ok = (type: string, payload: unknown) => parseClientMessage(env(type, payload)).ok;

describe("pad.ts", () => {
  it("PadDelta y WheelDelta son enteros acotados", () => {
    for (const v of [-512, 0, 1, 512]) expect(PadDelta.safeParse(v).success, String(v)).toBe(true);
    for (const v of [513, -513, 2.5, "1", NaN]) expect(PadDelta.safeParse(v).success, String(v)).toBe(false);
    for (const v of [-1200, 0, 120, 1200]) expect(WheelDelta.safeParse(v).success, String(v)).toBe(true);
    for (const v of [1201, 0.5]) expect(WheelDelta.safeParse(v).success, String(v)).toBe(false);
  });

  it("PadKey es una lista cerrada", () => {
    for (const k of ["esc", "enter", "left", "f1", "f12", "a", "z", "0", "9", "pageDown", "backspace", "space"]) {
      expect(PadKey.safeParse(k).success, k).toBe(true);
    }
    for (const k of ["f13", "A", "ctrl", "", "rm -rf", "C:\\Windows", "aa"]) expect(PadKey.safeParse(k).success, k).toBe(false);
  });

  it("PadMods no repite ni inventa", () => {
    expect(PadMods.safeParse([]).success).toBe(true);
    expect(PadMods.safeParse(["ctrl", "shift"]).success).toBe(true);
    expect(PadMods.safeParse(["ctrl", "ctrl"]).success).toBe(false);
    expect(PadMods.safeParse(["meta"]).success).toBe(false);
  });

  it("Shortcut es una lista cerrada", () => {
    for (const s of ["closeTab", "addressBar", "ytPlayPause", "copy", "mediaPlayPause", "mediaBack", "mediaForward", "mediaMute", "mediaFullscreen"]) expect(Shortcut.safeParse(s).success, s).toBe(true);
    for (const s of ["altF4", "lock", "ctrl+w", ""]) expect(Shortcut.safeParse(s).success, s).toBe(false);
  });

  it("PadText rechaza caracteres de control y pasa ñ, tildes y emojis", () => {
    for (const t of ["lofi hip hop", "ñandú ¿qué?", "😀", "a b"]) expect(PadText.safeParse(t).success, t).toBe(true);
    for (const t of ["a\u0007b", "a\nb", "a\tb", "a\u007fb", "a\u0000b"]) expect(PadText.safeParse(t).success, JSON.stringify(t)).toBe(false);
    expect(PadText.safeParse("a".repeat(500)).success).toBe(true);
    expect(PadText.safeParse("a".repeat(501)).success).toBe(false);
  });

  it("PadState", () => {
    const s = { available: true, enabled: true, elevated: false, holding: { left: false, alt: false } };
    expect(PadState.safeParse(s).success).toBe(true);
    expect(PadState.safeParse({ ...s, extra: 1 }).success).toBe(false);
    expect(PadState.safeParse({ ...s, holding: { left: true } }).success).toBe(false);
  });
});

describe("mensajes del Pad (celu → agente)", () => {
  it("pad.move y pad.scroll", () => {
    expect(ok("pad.move", { dx: 5, dy: -3 })).toBe(true);
    expect(ok("pad.move", { dx: 513, dy: 0 })).toBe(false);
    expect(ok("pad.move", { dx: 1.5, dy: 0 })).toBe(false);
    expect(ok("pad.move", { dx: 1 })).toBe(false);
    expect(ok("pad.scroll", { dx: 0, dy: 120 })).toBe(true);
    expect(ok("pad.scroll", { dx: 0, dy: 5000 })).toBe(false);
  });
  it("pad.button", () => {
    expect(ok("pad.button", { button: "left", action: "click" })).toBe(true);
    expect(ok("pad.button", { button: "right", action: "down" })).toBe(true);
    expect(ok("pad.button", { button: "middle", action: "click" })).toBe(true);
    expect(ok("pad.button", { button: "wheel", action: "click" })).toBe(false);
    expect(ok("pad.button", { button: "left", action: "hold" })).toBe(false);
  });
  it("pad.key", () => {
    expect(ok("pad.key", { key: "l", mods: ["ctrl"] })).toBe(true);
    expect(ok("pad.key", { key: "enter", mods: [] })).toBe(true);
    expect(ok("pad.key", { key: "l" })).toBe(false);
    expect(ok("pad.key", { key: "power", mods: [] })).toBe(false);
  });
  it("pad.shortcut", () => {
    expect(ok("pad.shortcut", { name: "closeTab" })).toBe(true);
    expect(ok("pad.shortcut", { name: "altF4" })).toBe(false);
  });
  it("pad.type necesita borrar o escribir algo", () => {
    expect(ok("pad.type", { backspaces: 0, text: "hola" })).toBe(true);
    expect(ok("pad.type", { backspaces: 3, text: "" })).toBe(true);
    expect(ok("pad.type", { backspaces: 2, text: "ñ" })).toBe(true);
    expect(ok("pad.type", { backspaces: 0, text: "" })).toBe(false);
    expect(ok("pad.type", { backspaces: -1, text: "a" })).toBe(false);
    expect(ok("pad.type", { backspaces: 501, text: "a" })).toBe(false);
    expect(ok("pad.type", { backspaces: 0, text: "a\u0007" })).toBe(false);
    expect(ok("pad.type", { backspaces: 0, text: "a".repeat(501) })).toBe(false);
  });
  it("pad.altTab y pad.release", () => {
    for (const step of ["start", "next", "prev", "commit", "cancel"]) expect(ok("pad.altTab", { step }), step).toBe(true);
    expect(ok("pad.altTab", { step: "hold" })).toBe(false);
    expect(ok("pad.release", {})).toBe(true);
    expect(ok("pad.release", { x: 1 })).toBe(false);
  });
  it("un mensaje del agente no entra como del celu", () => {
    expect(parseClientMessage(env("pad.state", {})).ok).toBe(false);
  });
});

describe("mensajes del Pad (agente → celu)", () => {
  it("pad.state", () => {
    const payload = { available: true, enabled: true, elevated: true, holding: { left: false, alt: true } };
    expect(parseServerMessage(env("pad.state", payload)).ok).toBe(true);
    expect(parseServerMessage(env("pad.state", { ...payload, enabled: "si" })).ok).toBe(false);
  });
  it("pad.ack no lleva datos", () => {
    expect(parseServerMessage(env("pad.ack", {})).ok).toBe(true);
    expect(parseServerMessage(env("pad.ack", { x: 1 })).ok).toBe(false);
    expect(parseClientMessage(env("pad.ack", {})).ok).toBe(false);
  });
  it("command.result acepta los errores nuevos", () => {
    for (const reason of ["input_disabled", "input_blocked", "input_unavailable"]) {
      expect(CommandError.safeParse(reason).success, reason).toBe(true);
      expect(parseServerMessage(env("command.result", { replyTo: "c1", ok: false, reason })).ok, reason).toBe(true);
    }
  });
});
