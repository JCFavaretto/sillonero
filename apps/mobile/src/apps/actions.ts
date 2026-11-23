import type { DeckItem, Library, SceneDraft, Shortcut, Target, WindowAction, WindowInfo } from "@proyecto-e/protocol";
import type { CommandOutcome } from "@/connection/client";
import { SCENE_TIMEOUT_MS, queryApps, sendAppCommand } from "./commands";
import { DEMO_CATALOG } from "./demo";
import { clearRun, finishRun, initialSearch, useApps, type RunStep } from "./store";

/**
 * Lo que se puede pedir desde Apps, Escenas e Inicio. Con la PC de verdad cada pedido es un comando y la PC contesta
 * con el estado nuevo (`windows.update`, `library.update`): acá no se toca el estado. En la demo se aplica local.
 */
const SEARCH_TIMEOUT_MS = 8_000;

export type ActionResult = { ok: true } | { ok: false; error: string };

const fail = (r: Extract<CommandOutcome, { ok: false }>): ActionResult => ({ ok: false, error: `apps.error.${r.reason}` });
const done = (r: CommandOutcome): ActionResult => (r.ok ? { ok: true } : fail(r));

const demo = () => useApps.getState().demo;
const lib = (): Library => useApps.getState().library ?? { launchers: [], scenes: [], deck: [] };
const setLib = (next: Library) => useApps.setState({ library: next });
let demoSeq = 0;
const demoId = (p: "l_" | "s_") => `${p}Demo${String(++demoSeq).padStart(6, "0")}`;
const siteName = (url: string) => (/^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).replace(/^www\./i, "");

export const appsActions = {
  async act(windowId: string, action: WindowAction): Promise<ActionResult> {
    if (demo()) {
      const { windows } = useApps.getState();
      if (action === "newPrivate") return { ok: true }; // en la demo no hay navegador que abrir
      if (action === "close") {
        useApps.setState({ windows: windows.filter((w) => w.id !== windowId) });
        return { ok: true };
      }
      const state: WindowInfo["state"] = action === "minimize" ? "minimized" : action === "maximize" ? "maximized" : action === "fullscreen" ? "fullscreen" : "normal";
      useApps.setState({
        windows: windows.map((w): WindowInfo => {
          if (action === "focus") return w.id === windowId ? { ...w, focused: true, state: w.state === "minimized" ? "normal" : w.state } : { ...w, focused: false };
          return w.id === windowId ? { ...w, state } : w;
        }),
      });
      return { ok: true };
    }
    const r = await sendAppCommand("window.act", { windowId, action });
    if (!r.ok && action === "newPrivate" && r.reason === "not_supported") return { ok: false, error: "apps.error.privateUnsupported" };
    return done(r);
  },

  /**
   * Un atajo de teclado para una ventana (perfiles de app, D87): primero la trae al frente y recién después manda la
   * tecla. Si no se pudo traer, la tecla NO se manda: caería en la ventana que esté al frente.
   */
  async shortcut(windowId: string, name: Shortcut): Promise<ActionResult> {
    const focused = await appsActions.act(windowId, "focus");
    if (!focused.ok || demo()) return focused;
    const r = await sendAppCommand("pad.shortcut", { name });
    return r.ok ? { ok: true } : { ok: false, error: `pad.error.${r.reason}` };
  },

  async moveTo(windowId: string, monitorId: string): Promise<ActionResult> {
    if (demo()) {
      useApps.setState({ windows: useApps.getState().windows.map((w) => (w.id === windowId ? { ...w, monitorId } : w)) });
      return { ok: true };
    }
    return done(await sendAppCommand("window.move", { windowId, monitorId }));
  },

  async bringAll(): Promise<ActionResult> {
    if (demo()) return { ok: true };
    return done(await sendAppCommand("windows.bringAll", {}));
  },

  /** Busca apps de la PC. La respuesta llega como mensaje propio (y solo se acepta la del último pedido). */
  search(query: string): void {
    if (demo()) {
      const q = query.trim().toLowerCase();
      const items = DEMO_CATALOG.filter((a) => a.name.toLowerCase().includes(q));
      useApps.setState({ search: { requestId: null, items, total: items.length, loading: false, error: false, query: query.trim() } });
      return;
    }
    const q = query.trim().slice(0, 40);
    const requestId = queryApps("apps.search", { query: q });
    useApps.setState({ search: requestId === null ? { ...initialSearch, error: true, query: q } : { ...useApps.getState().search, requestId, query: q, loading: true, error: false } });
    if (requestId !== null) {
      // Si la PC no contesta (se cayó la conexión), no queda cargando para siempre.
      setTimeout(() => {
        const s = useApps.getState().search;
        if (s.requestId === requestId && s.loading) useApps.setState({ search: { ...s, loading: false, error: true } });
      }, SEARCH_TIMEOUT_MS);
    }
  },

  clearSearch(): void {
    useApps.setState({ search: initialSearch });
  },

  async addLauncher(target: Target, name: string | null): Promise<ActionResult> {
    if (demo()) {
      const l = lib();
      const app = target.kind === "app" ? DEMO_CATALOG.find((a) => a.appId === target.appId) : undefined;
      setLib({ ...l, launchers: [...l.launchers, { id: demoId("l_"), name: name ?? app?.name ?? (target.kind === "url" ? siteName(target.url) : "App"), target, iconKey: app?.iconKey ?? null }] });
      return { ok: true };
    }
    return done(await sendAppCommand("launcher.add", { target, name }));
  },

  async renameLauncher(id: string, name: string): Promise<ActionResult> {
    if (demo()) {
      const l = lib();
      setLib({ ...l, launchers: l.launchers.map((x) => (x.id === id ? { ...x, name } : x)) });
      return { ok: true };
    }
    return done(await sendAppCommand("launcher.rename", { id, name }));
  },

  async removeLauncher(id: string): Promise<ActionResult> {
    if (demo()) {
      const l = lib();
      setLib({ ...l, launchers: l.launchers.filter((x) => x.id !== id), deck: l.deck.filter((d) => !(d.kind === "launcher" && d.id === id)) });
      return { ok: true };
    }
    return done(await sendAppCommand("launcher.remove", { id }));
  },

  /** Abre una app o un link que vive en un deck del celu (D104): la PC lo abre sin guardarlo. */
  async runTarget(target: Target): Promise<ActionResult> {
    if (demo()) return { ok: true };
    return done(await sendAppCommand("target.run", { target }));
  },

  async runLauncher(id: string): Promise<ActionResult> {
    if (demo()) return { ok: true };
    return done(await sendAppCommand("launcher.run", { id }));
  },

  async saveScene(draft: SceneDraft): Promise<ActionResult> {
    if (demo()) {
      const l = lib();
      const prev = draft.id ? l.scenes.find((s) => s.id === draft.id) : undefined;
      // Igual que la PC: sin el campo = dejar como está; null = quitarlo. Dos escenas no comparten tecla.
      const hotkey = draft.hotkey === undefined ? prev?.hotkey : (draft.hotkey ?? undefined);
      const trigger = draft.trigger === undefined ? prev?.trigger : (draft.trigger ?? undefined);
      if (hotkey && l.scenes.some((s) => s.hotkey === hotkey && s.id !== draft.id)) return { ok: false, error: "apps.error.hotkey_taken" };
      const extra = { ...(hotkey ? { hotkey } : {}), ...(trigger ? { trigger } : {}) };
      if (draft.id) setLib({ ...l, scenes: l.scenes.map((s) => (s.id === draft.id ? { id: draft.id!, name: draft.name, steps: draft.steps, ...extra } : s)) });
      else setLib({ ...l, scenes: [...l.scenes, { id: demoId("s_"), name: draft.name, steps: draft.steps, ...extra }] });
      return { ok: true };
    }
    return done(await sendAppCommand("scene.save", { scene: draft }));
  },

  async removeScene(id: string): Promise<ActionResult> {
    if (demo()) {
      const l = lib();
      setLib({ ...l, scenes: l.scenes.filter((s) => s.id !== id), deck: l.deck.filter((d) => !(d.kind === "scene" && d.id === id)) });
      return { ok: true };
    }
    return done(await sendAppCommand("scene.remove", { id }));
  },

  /** Ejecuta una escena. El progreso llega por `scene.progress`; al terminar queda el resultado de cada paso. */
  async runScene(id: string): Promise<ActionResult> {
    const scene = lib().scenes.find((s) => s.id === id);
    if (!scene) return { ok: false, error: "apps.error.not_found" };
    if (useApps.getState().run && !useApps.getState().run!.finished) return { ok: false, error: "apps.error.busy" };
    if (demo()) {
      const steps: RunStep[] = scene.steps.map(() => "ok");
      useApps.setState({ run: { runId: "demo", sceneId: id, steps, reasons: steps.map(() => null), finished: true } });
      return { ok: true };
    }
    // Se muestra enseguida con todos los pasos esperando: la PC va avisando cada uno.
    useApps.setState({
      run: { runId: "pending", sceneId: id, steps: scene.steps.map(() => "wait" as RunStep), reasons: scene.steps.map(() => null), finished: false },
    });
    const r = await sendAppCommand("scene.run", { id }, { timeoutMs: SCENE_TIMEOUT_MS });
    const run = useApps.getState().run;
    if (r.steps && run) useApps.setState({ run: { ...run, steps: r.steps } });
    if (!r.ok && !r.steps) {
      // La escena no llegó a correr (otra en curso, sin conexión…): no queda un progreso colgado.
      clearRun();
      return fail(r);
    }
    finishRun();
    return r.ok ? { ok: true } : { ok: false, error: "apps.error.sceneFailed" };
  },

  async setDeck(items: DeckItem[]): Promise<ActionResult> {
    if (demo()) {
      setLib({ ...lib(), deck: items });
      return { ok: true };
    }
    return done(await sendAppCommand("deck.set", { items }));
  },
};

/** Lo que el Inicio puede hacer con una tecla de pantalla / acción fija. */
export const deckActions = {
  identify: () => sendAppCommand("monitor.identify", {}),
};
