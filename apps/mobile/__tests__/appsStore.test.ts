import type { ServerMessage } from "@proyecto-e/protocol";
import { appsActions } from "@/apps/actions";
import { setAppsBridge } from "@/apps/commands";
import { loadAppsDemo } from "@/apps/demo";
import { flushIcons, resetIcons, requestIcon } from "@/apps/icons";
import { applyExtra, initialApps, useApps } from "@/apps/store";

const m = (type: string, payload: unknown) => ({ v: 1, id: "1", type, payload }) as unknown as ServerMessage;
const KEY = "i_AAAAAAAAAAAAAAAA";

beforeEach(() => {
  useApps.setState(initialApps, true);
  setAppsBridge(null);
  resetIcons();
});

describe("applyExtra", () => {
  it("guarda ventanas y biblioteca de la PC y desactiva la demo", () => {
    useApps.setState({ demo: true });
    applyExtra(m("windows.snapshot", { windows: [{ id: "w_1", title: "t", app: "a", iconKey: null, monitorId: null, state: "normal", focused: false }] }));
    applyExtra(m("library.snapshot", { launchers: [], scenes: [], deck: [] }));
    const s = useApps.getState();
    expect(s.windows).toHaveLength(1);
    expect(s.windowsLoaded).toBe(true);
    expect(s.library).toEqual({ launchers: [], scenes: [], deck: [] });
    expect(s.demo).toBe(false);
  });
  it("solo acepta los resultados de la última búsqueda (replyTo)", () => {
    useApps.setState({ search: { requestId: "q2", items: [], total: 0, loading: true, error: false, query: "" } });
    applyExtra(m("apps.results", { replyTo: "q1", items: [{ appId: "viejo", name: "Viejo", iconKey: KEY }], total: 1 }));
    expect(useApps.getState().search.items).toEqual([]);
    applyExtra(m("apps.results", { replyTo: "q2", items: [{ appId: "nuevo", name: "Nuevo", iconKey: KEY }], total: 1 }));
    expect(useApps.getState().search).toMatchObject({ items: [{ name: "Nuevo" }], total: 1, loading: false });
  });
  it("íconos: guarda el PNG o null", () => {
    applyExtra(m("icon.data", { key: KEY, png: "iVBOR" }));
    applyExtra(m("icon.data", { key: "i_BBBBBBBBBBBBBBBB", png: null }));
    expect(useApps.getState().icons).toEqual({ [KEY]: "iVBOR", i_BBBBBBBBBBBBBBBB: null });
  });
  it("progreso de una escena: arma los pasos y los va marcando", () => {
    applyExtra(m("library.snapshot", { launchers: [], scenes: [{ id: "s_AAAAAAAAAA", name: "J", steps: [{ kind: "bringAll" }, { kind: "bringAll" }, { kind: "bringAll" }] }], deck: [] }));
    const p = (index: number, status: string, reason: string | null = null) => applyExtra(m("scene.progress", { runId: "r1", sceneId: "s_AAAAAAAAAA", index, status, reason }));
    p(0, "running");
    expect(useApps.getState().run!.steps).toEqual(["running", "wait", "wait"]);
    p(0, "ok");
    p(1, "failed", "not_allowed");
    const run = useApps.getState().run!;
    expect(run.steps).toEqual(["ok", "failed", "wait"]);
    expect(run.reasons[1]).toBe("not_allowed");
    expect(run.finished).toBe(false);
  });
  it("una escena que corrió desde otro celu (o cuyo comando se perdió) igual termina cuando no queda ningún paso pendiente", () => {
    applyExtra(m("library.snapshot", { launchers: [], scenes: [{ id: "s_AAAAAAAAAA", name: "J", steps: [{ kind: "bringAll" }, { kind: "bringAll" }] }], deck: [] }));
    const p = (index: number, status: string) => applyExtra(m("scene.progress", { runId: "r9", sceneId: "s_AAAAAAAAAA", index, status, reason: null }));
    p(0, "ok");
    expect(useApps.getState().run!.finished).toBe(false);
    p(1, "failed");
    expect(useApps.getState().run!.finished).toBe(true);
  });
  it("null borra todo (olvidó la PC)", () => {
    loadAppsDemo();
    applyExtra(null);
    expect(useApps.getState()).toMatchObject({ windows: [], library: null, demo: false });
  });
});

describe("íconos: se piden de a 10", () => {
  it("junta los pedidos y manda tandas de 10", () => {
    const sent: unknown[] = [];
    setAppsBridge({ command: (async () => ({ ok: true })) as never, query: (_t, p) => (sent.push(p), "id") });
    for (let i = 0; i < 25; i++) requestIcon("i_" + String(i).padStart(16, "0"));
    requestIcon("i_" + String(0).padStart(16, "0")); // repetido: no se vuelve a pedir
    flushIcons();
    expect(sent.map((p) => (p as { keys: string[] }).keys.length)).toEqual([10, 10, 5]);
  });
  it("sin conexión no se pierden: se pueden volver a pedir", () => {
    setAppsBridge({ command: (async () => ({ ok: true })) as never, query: () => null });
    requestIcon(KEY);
    flushIcons();
    const sent: unknown[] = [];
    setAppsBridge({ command: (async () => ({ ok: true })) as never, query: (_t, p) => (sent.push(p), "id") });
    requestIcon(KEY);
    flushIcons();
    expect(sent).toHaveLength(1);
  });
});

describe("acciones", () => {
  it("sin conexión da el error de offline y no toca el estado", async () => {
    loadAppsDemo();
    useApps.setState({ demo: false });
    expect(await appsActions.act("w_1", "close")).toEqual({ ok: false, error: "apps.error.offline" });
    expect(useApps.getState().windows).toHaveLength(4);
  });
  it("manda cada comando a la PC con su contenido", async () => {
    const calls: [string, unknown, unknown][] = [];
    setAppsBridge({ command: (async (t: string, p: unknown, o: unknown) => (calls.push([t, p, o]), { ok: true })) as never, query: () => "q" });
    await appsActions.act("w_1", "focus");
    await appsActions.moveTo("w_1", "m_DemoMonitorUno01");
    await appsActions.addLauncher({ kind: "url", url: "https://a.com" }, null);
    expect(calls.map((c) => c[0])).toEqual(["window.act", "window.move", "launcher.add"]);
    expect(calls[0]![1]).toEqual({ windowId: "w_1", action: "focus" });
  });
  it("un error de la PC se traduce a una clave de i18n", async () => {
    setAppsBridge({ command: (async () => ({ ok: false, reason: "focus_denied" })) as never, query: () => null });
    expect(await appsActions.act("w_1", "focus")).toEqual({ ok: false, error: "apps.error.focus_denied" });
  });
  it("ejecutar una escena: muestra el progreso, avisa los pasos al terminar y usa un plazo largo", async () => {
    useApps.setState({ library: { launchers: [], scenes: [{ id: "s_AAAAAAAAAA", name: "J", steps: [{ kind: "bringAll" }, { kind: "bringAll" }] }], deck: [] } });
    const opts: unknown[] = [];
    setAppsBridge({ command: (async (_t: string, _p: unknown, o: unknown) => (opts.push(o), { ok: false, reason: "failed", steps: ["ok", "failed"] })) as never, query: () => null });
    const r = await appsActions.runScene("s_AAAAAAAAAA");
    expect(r).toEqual({ ok: false, error: "apps.error.sceneFailed" });
    expect(opts[0]).toEqual({ timeoutMs: 65_000 });
    expect(useApps.getState().run).toMatchObject({ steps: ["ok", "failed"], finished: true });
  });
  it("si la escena no llegó a correr (otra en curso), no queda un progreso colgado", async () => {
    useApps.setState({ library: { launchers: [], scenes: [{ id: "s_AAAAAAAAAA", name: "J", steps: [{ kind: "bringAll" }] }], deck: [] } });
    setAppsBridge({ command: (async () => ({ ok: false, reason: "busy" })) as never, query: () => null });
    expect(await appsActions.runScene("s_AAAAAAAAAA")).toEqual({ ok: false, error: "apps.error.busy" });
    expect(useApps.getState().run).toBeNull();
  });
  it("demo: la biblioteca se edita local", async () => {
    loadAppsDemo();
    await appsActions.addLauncher({ kind: "app", appId: "Cursor" }, null);
    expect(useApps.getState().library!.launchers.map((l) => l.name)).toContain("Cursor");
    const id = useApps.getState().library!.scenes[0]!.id;
    await appsActions.removeScene(id);
    expect(useApps.getState().library!.deck.some((d) => d.kind === "scene" && d.id === id)).toBe(false);
  });
});
