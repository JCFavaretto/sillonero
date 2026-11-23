import type { CatalogApp, CommandError, Library, ServerMessage, WindowInfo } from "@proyecto-e/protocol";
import { create } from "zustand";
import type { StepResult } from "@/connection/client";

/**
 * Estado de Apps y Escenas (docs/PLAN.md 8.3.5). Lo escribe el cliente (mensajes de la PC) y, en la demo,
 * `actions.ts`. Las pantallas leen con selectores. Los datos van separados para reiniciarlos en los tests
 * con `setState(initialApps, true)`.
 */
export type RunStep = "wait" | "running" | StepResult;

export interface RunState {
  runId: string;
  sceneId: string;
  steps: RunStep[];
  reasons: (CommandError | null)[];
  /** Terminó (la PC contestó el `command.result`, o no quedó nada por correr). */
  finished: boolean;
}

export interface SearchState {
  /** El id del último pedido: solo se acepta la respuesta con ese `replyTo` (las viejas se ignoran). */
  requestId: string | null;
  items: CatalogApp[];
  total: number;
  loading: boolean;
  error: boolean;
  /** Lo que se buscó en el último pedido. */
  query: string;
}

export interface AppsData {
  windows: WindowInfo[];
  /** Llegó la primera lista de ventanas. */
  windowsLoaded: boolean;
  /** `null` hasta que llega la biblioteca. */
  library: Library | null;
  /** PNG en base64 por IconKey; `null` = no hay ícono (se muestra la inicial); ausente = todavía no se pidió. */
  icons: Record<string, string | null>;
  search: SearchState;
  run: RunState | null;
  /** Clave de i18n del último error de un comando, o null. */
  error: string | null;
  demo: boolean;
}

export const initialSearch: SearchState = { requestId: null, items: [], total: 0, loading: false, error: false, query: "" };
export const initialApps: AppsData = {
  windows: [],
  windowsLoaded: false,
  library: null,
  icons: {},
  search: initialSearch,
  run: null,
  error: null,
  demo: false,
};

export const useApps = create<AppsData>()(() => initialApps);

/** Lo que manda la PC; `null` borra todo (olvidó la PC o la revocaron). */
export function applyExtra(msg: ServerMessage | null): void {
  if (msg === null) {
    useApps.setState({ ...initialApps }, true);
    return;
  }
  const s = useApps.getState();
  switch (msg.type) {
    case "windows.snapshot":
    case "windows.update":
      return useApps.setState({ windows: msg.payload.windows, windowsLoaded: true, demo: false });
    case "library.snapshot":
    case "library.update":
      return useApps.setState({ library: msg.payload, demo: false });
    case "apps.results":
      if (msg.payload.replyTo !== s.search.requestId) return; // una búsqueda vieja: ya hay otra en curso
      return useApps.setState({ search: { ...s.search, items: msg.payload.items, total: msg.payload.total, loading: false, error: false } });
    case "icon.data":
      return useApps.setState({ icons: { ...s.icons, [msg.payload.key]: msg.payload.png } });
    case "scene.progress": {
      const p = msg.payload;
      const scene = s.library?.scenes.find((x) => x.id === p.sceneId);
      const len = scene?.steps.length ?? p.index + 1;
      const same = s.run?.runId === p.runId;
      const steps: RunStep[] = same ? [...s.run!.steps] : Array.from({ length: len }, () => "wait" as RunStep);
      const reasons = same ? [...s.run!.reasons] : Array.from({ length: len }, () => null as CommandError | null);
      steps[p.index] = p.status;
      reasons[p.index] = p.reason;
      // Si ya no queda ningún paso esperando ni corriendo, terminó (aunque el comando no sea de este celu o se haya perdido).
      const finished = steps.every((x) => x !== "wait" && x !== "running");
      return useApps.setState({ run: { runId: p.runId, sceneId: p.sceneId, steps, reasons, finished } });
    }
    default:
      return;
  }
}

/** La escena terminó (llegó el `command.result`). */
export function finishRun(): void {
  const { run } = useApps.getState();
  if (run) useApps.setState({ run: { ...run, finished: true } });
}

export function clearRun(): void {
  useApps.setState({ run: null });
}
