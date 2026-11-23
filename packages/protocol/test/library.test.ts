import { describe, expect, it } from "vitest";
import { MAX_FRAME_BYTES, MAX_MESSAGE_BYTES, MAX_SERVER_MESSAGE_BYTES } from "../src/constants";
import { encodeFrame, parseFrame } from "../src/frame";
import { Library, Name, Scene, SafeUrl, Step, Target } from "../src/library";
import { parseClientMessage, parseServerMessage } from "../src/messages";
import { WindowAction, WindowId, WindowInfo, WindowsState } from "../src/windows";

const MON = "m_DemoMonitorUno01";
const KEY = "i_AAAAAAAAAAAAAAAA";
const env = (type: string, payload: unknown) => JSON.stringify({ v: 1, id: "c1", type, payload });

describe("windows.ts", () => {
  it("WindowId y IconKey tienen forma fija", () => {
    expect(WindowId.safeParse("w_12").success).toBe(true);
    expect(WindowId.safeParse("12").success).toBe(false);
    expect(WindowId.safeParse("w_1234567890").success).toBe(false);
  });
  it("WindowInfo y WindowsState", () => {
    const w = { id: "w_1", title: "PLAN.md", app: "Code", iconKey: KEY, monitorId: MON, state: "normal", focused: true };
    expect(WindowInfo.safeParse(w).success).toBe(true);
    expect(WindowInfo.safeParse({ ...w, state: "hidden" }).success).toBe(false);
    expect(WindowsState.safeParse({ windows: Array.from({ length: 41 }, () => w) }).success).toBe(false);
  });
  it("WindowAction", () => {
    for (const a of ["focus", "minimize", "maximize", "restore", "fullscreen", "close"]) expect(WindowAction.safeParse(a).success).toBe(true);
    expect(WindowAction.safeParse("kill").success).toBe(false);
  });
});

describe("library.ts", () => {
  it("SafeUrl solo acepta http(s) de hasta 2048", () => {
    expect(SafeUrl.safeParse("https://www.youtube.com/watch?v=1&t=42").success).toBe(true);
    expect(SafeUrl.safeParse("http://example.com").success).toBe(true);
    for (const bad of ["file:///C:/Windows/System32/cmd.exe", "javascript:alert(1)", "ftp://x.com/a", "calc.exe", "https://" + "a".repeat(2050)]) {
      expect(SafeUrl.safeParse(bad).success, bad).toBe(false);
    }
  });
  it("Name: 1 a 32 caracteres, sin espacios de más", () => {
    expect(Name.safeParse("  Juego ").data).toBe("Juego");
    expect(Name.safeParse("   ").success).toBe(false);
    expect(Name.safeParse("x".repeat(33)).success).toBe(false);
  });
  it("Target app o url", () => {
    expect(Target.safeParse({ kind: "app", appId: "Anysphere.Cursor" }).success).toBe(true);
    expect(Target.safeParse({ kind: "url", url: "https://a.com" }).success).toBe(true);
    // D93: un link puede pedir ventana privada; el campo es opcional (los lanzadores viejos no lo tienen)
    expect(Target.safeParse({ kind: "url", url: "https://a.com", open: "private" }).success).toBe(true);
    expect(Target.safeParse({ kind: "url", url: "https://a.com", open: "si" }).success).toBe(false);
    expect(Target.safeParse({ kind: "app", appId: "Anysphere.Cursor", open: "private" }).success).toBe(false);
    expect(Target.safeParse({ kind: "path", path: "C:\\x.exe" }).success).toBe(false);
  });
  const open = { kind: "open", target: { kind: "app", appId: "Discord" }, name: "Discord", iconKey: null, place: { monitorId: MON, zone: "right" } };
  it("Step: screens, open, bringAll; zona inválida no", () => {
    expect(Step.safeParse({ kind: "screens", monitors: [{ monitorId: MON, enabled: true }] }).success).toBe(true);
    expect(Step.safeParse(open).success).toBe(true);
    expect(Step.safeParse({ kind: "bringAll" }).success).toBe(true);
    expect(Step.safeParse({ ...open, place: { monitorId: MON, zone: "diagonal" } }).success).toBe(false);
    expect(Step.safeParse({ kind: "screens", monitors: [] }).success).toBe(false);
  });
  it("Scene: de 1 a 12 pasos", () => {
    const s = (n: number) => ({ id: "s_AAAAAAAAAA", name: "Juego", steps: Array.from({ length: n }, () => ({ kind: "bringAll" })) });
    expect(Scene.safeParse(s(1)).success).toBe(true);
    expect(Scene.safeParse(s(12)).success).toBe(true);
    expect(Scene.safeParse(s(13)).success).toBe(false);
    expect(Scene.safeParse(s(0)).success).toBe(false);
  });
  it("Library con topes", () => {
    expect(Library.safeParse({ launchers: [], scenes: [], deck: [] }).success).toBe(true);
    expect(Library.safeParse({ launchers: [], scenes: [], deck: Array.from({ length: 31 }, () => ({ kind: "bringAll" })) }).success).toBe(false);
  });
});

describe("mensajes de B3", () => {
  it("celu → agente válidos", () => {
    const ok = (type: string, payload: unknown) => expect(parseClientMessage(env(type, payload)).ok, type).toBe(true);
    ok("window.move", { windowId: "w_1", monitorId: MON });
    ok("window.act", { windowId: "w_1", action: "close" });
    ok("windows.bringAll", {});
    ok("apps.search", { query: "disc" });
    ok("icon.get", { keys: [KEY] });
    ok("launcher.add", { target: { kind: "app", appId: "Discord" }, name: null });
    ok("launcher.rename", { id: "l_AAAAAAAAAA", name: "Disc" });
    ok("launcher.remove", { id: "l_AAAAAAAAAA" });
    ok("launcher.run", { id: "l_AAAAAAAAAA" });
    // F3 (D104): abrir un link o una app sin guardarla en la PC
    ok("target.run", { target: { kind: "app", appId: "Discord" } });
    ok("target.run", { target: { kind: "url", url: "https://twitch.tv/directory", open: "private" } });
    ok("scene.save", { scene: { name: "Juego", steps: [{ kind: "bringAll" }] } });
    ok("scene.save", { scene: { id: "s_AAAAAAAAAA", name: "Juego", steps: [{ kind: "bringAll" }] } });
    ok("scene.remove", { id: "s_AAAAAAAAAA" });
    ok("scene.run", { id: "s_AAAAAAAAAA" });
    ok("deck.set", { items: [{ kind: "scene", id: "s_AAAAAAAAAA" }, { kind: "identify" }] });
  });
  it("celu → agente inválidos", () => {
    const bad = (type: string, payload: unknown) => expect(parseClientMessage(env(type, payload)).ok, type).toBe(false);
    bad("target.run", { target: { kind: "url", url: "javascript:alert(1)" } });
    bad("target.run", { target: { kind: "url", url: "file:///C:/x" } });
    bad("target.run", { target: { kind: "app", appId: "" } });
    bad("target.run", { target: { kind: "app", appId: "Discord" }, extra: 1 });
    bad("target.run", {});
    bad("window.act", { windowId: "w_1", action: "kill" });
    bad("icon.get", { keys: [] });
    bad("icon.get", { keys: Array.from({ length: 11 }, () => KEY) });
    bad("apps.search", { query: "x".repeat(41) });
    bad("launcher.add", { target: { kind: "url", url: "file:///x" }, name: null });
    bad("deck.set", { items: [{ kind: "scene", id: "mal" }] });
  });
  it("agente → celu", () => {
    const ok = (type: string, payload: unknown) => expect(parseServerMessage(env(type, payload)).ok, type).toBe(true);
    ok("windows.snapshot", { windows: [] });
    ok("windows.update", { windows: [] });
    ok("library.snapshot", { launchers: [], scenes: [], deck: [] });
    ok("library.update", { launchers: [], scenes: [], deck: [] });
    ok("apps.results", { replyTo: "c1", items: [{ appId: "Discord", name: "Discord", iconKey: KEY }], total: 1 });
    ok("icon.data", { key: KEY, png: "iVBORw0KGgo" });
    ok("icon.data", { key: KEY, png: null });
    ok("scene.progress", { runId: "r1", sceneId: "s_AAAAAAAAAA", index: 0, status: "running", reason: null });
    ok("command.result", { replyTo: "c1", ok: false, reason: "focus_denied" });
    ok("command.result", { replyTo: "c1", ok: true, steps: ["ok", "failed"] });
  });
});

describe("tamaños (D26)", () => {
  it("el agente puede mandar hasta 60 KB; el celu solo 16 KB", () => {
    expect(MAX_SERVER_MESSAGE_BYTES).toBe(61_440);
    expect(MAX_MESSAGE_BYTES).toBe(16_384);
    const big = JSON.stringify({ v: 1, id: "x", type: "windows.snapshot", payload: { windows: [], pad: "a".repeat(30_000) } });
    expect(parseServerMessage(big)).toMatchObject({ ok: false, code: "bad_message" }); // pasó el tamaño; falla por el campo extra
    expect(parseClientMessage(big)).toMatchObject({ ok: false, code: "too_large" });
    const huge = "a".repeat(MAX_SERVER_MESSAGE_BYTES + 1);
    expect(parseServerMessage(huge)).toMatchObject({ ok: false, code: "too_large" });
  });
  it("el marco: 60 KB cifrados entran; con el tope del celu (24 KB) no", () => {
    const frame = encodeFrame("data", new Uint8Array(61_440 + 16));
    expect(frame.length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    expect(parseFrame(frame).ok).toBe(true);
    expect(parseFrame(frame, 24_576)).toMatchObject({ ok: false, code: "too_large" });
  });
});
