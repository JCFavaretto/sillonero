import {
  MAX_LAUNCHERS,
  MAX_SCENES,
  type CommandError,
  type DeckItem,
  type Launcher,
  type Library,
  type Scene,
  type SceneDraft,
  type Step,
  type Target,
} from "@proyecto-e/protocol";
import type { Logger, Random } from "../ports";
import type { Catalog } from "./catalog";
import type { Icons } from "./icons";
import { iconKeyFor } from "./windowsModel";

// Biblioteca: lanzadores, escenas y teclas del Inicio (docs/PLAN.md D20, D22, D25). Vive en agent.json.
// El agente vuelve a validar todo lo que llega del celu: un appId solo se acepta si está en el catálogo.

export type Outcome = { ok: true } | { ok: false; reason: CommandError };

export interface LibraryStore {
  get(): Library;
  save(next: Library): Promise<void>;
}

export interface LibraryService {
  state(): Library;
  addLauncher(target: Target, name: string | null): Promise<Outcome>;
  renameLauncher(id: string, name: string): Promise<Outcome>;
  removeLauncher(id: string): Promise<Outcome>;
  saveScene(draft: SceneDraft): Promise<Outcome>;
  removeScene(id: string): Promise<Outcome>;
  setDeck(items: DeckItem[]): Promise<Outcome>;
  /** La config recién se leyó del disco: registra los íconos de lo guardado. */
  reload(): void;
  /** Se llama con la biblioteca nueva cada vez que cambia. Devuelve cómo dejar de escuchar. */
  subscribe(cb: (lib: Library) => void): () => void;
}

/** La biblioteca viaja entera en un mensaje (tope 60 KB): se frena antes, con margen para el sobre y el cifrado. */
export const MAX_LIBRARY_BYTES = 40_000;

const newId = (prefix: "l_" | "s_", random: Random) => prefix + random.bytes(8).reduce((s, b) => s + b.toString(36), "").padEnd(10, "x").slice(0, 10);

/** "https://www.youtube.com/x" → "youtube.com". */
const siteName = (url: string): string => (/^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).replace(/^www\./i, "").slice(0, 32);

/** De dónde sale el ícono de una app: la entrada de la carpeta de apps de Windows. */
const iconSource = (appId: string) => "shell:AppsFolder\\" + appId;

export function createLibraryService(deps: {
  store: LibraryStore;
  catalog: Catalog;
  icons: Icons;
  random: Random;
  log: Logger;
  /** B4: las salidas de audio que usan los pasos y las teclas. Sin esto no se pueden guardar. */
  audio?: { remember(outputId: string): Promise<boolean> };
}): LibraryService {
  const { store, catalog, icons, random, log, audio } = deps;
  const listeners = new Set<(lib: Library) => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const registerIcons = (lib: Library) => {
    for (const l of lib.launchers) if (l.target.kind === "app") icons.register(iconKeyFor(l.target.appId), iconSource(l.target.appId));
    for (const s of lib.scenes)
      for (const st of s.steps) if (st.kind === "open" && st.target.kind === "app") icons.register(iconKeyFor(st.target.appId), iconSource(st.target.appId));
  };
  registerIcons(store.get());

  /** Las escrituras se hacen de a una: dos pedidos seguidos no se pisan. */
  function mutate(fn: (lib: Library) => Promise<{ next: Library } | { error: CommandError }>): Promise<Outcome> {
    const run = queue.then(async (): Promise<Outcome> => {
      const result = await fn(store.get());
      if ("error" in result) return { ok: false, reason: result.error };
      const json = JSON.stringify(result.next);
      // En bytes UTF-8 (no en caracteres): un nombre o link con caracteres no ASCII ocupa más de lo que parece.
      if (Buffer.byteLength(json, "utf8") > MAX_LIBRARY_BYTES) return { ok: false, reason: "limit" };
      if (json === JSON.stringify(store.get())) return { ok: true }; // nada cambió: no se reescribe el disco ni se avisa
      try {
        await store.save(result.next);
      } catch (err) {
        log.warn("library: cannot save", { error: String(err) });
        return { ok: false, reason: "failed" };
      }
      registerIcons(result.next);
      for (const cb of listeners) cb(result.next);
      return { ok: true };
    });
    queue = run.catch(() => undefined);
    return run;
  }

  const deckKey = (it: DeckItem): string => {
    switch (it.kind) {
      case "scene":
      case "launcher":
        return `${it.kind}:${it.id}`;
      case "monitorToggle":
        return `m:${it.monitorId}`;
      case "media":
        return `media:${it.key}`;
      case "volume":
        return `volume:${it.delta}`;
      case "output":
        return `output:${it.outputId}`;
      default:
        return it.kind;
    }
  };

  const withoutFromDeck = (deck: DeckItem[], kind: "scene" | "launcher", id: string) => deck.filter((d) => !((d.kind === "scene" || d.kind === "launcher") && d.kind === kind && d.id === id));

  /** Cada paso `open` con una app tiene que estar en el catálogo; el ícono lo pone el agente (nunca viene del celu). */
  async function checkSteps(steps: Step[]): Promise<{ steps: Step[] } | { error: CommandError }> {
    const out: Step[] = [];
    for (const st of steps) {
      if (st.kind === "open" && st.target.kind === "app") {
        if (!(await catalog.has(st.target.appId))) return { error: "not_allowed" };
        out.push({ ...st, iconKey: iconKeyFor(st.target.appId) });
      } else if (st.kind === "open") out.push({ ...st, iconKey: null });
      else if (st.kind === "audio") {
        // La salida tiene que ser una que el agente vio alguna vez; se anota entre las conocidas para mostrarla "no disponible" cuando se desconecte.
        if (!audio) return { error: "audio_unavailable" };
        if (!(await audio.remember(st.outputId))) return { error: "not_found" };
        out.push(st);
      } else out.push(st);
    }
    return { steps: out };
  }

  return {
    state: () => store.get(),
    reload: () => registerIcons(store.get()),

    addLauncher(target, name) {
      return mutate(async (lib) => {
        if (lib.launchers.length >= MAX_LAUNCHERS) return { error: "limit" };
        let finalName = name;
        if (target.kind === "app") {
          if (!(await catalog.has(target.appId))) return { error: "not_allowed" };
          finalName ??= (await catalog.nameOf(target.appId))?.slice(0, 32) ?? "App";
        } else finalName ??= siteName(target.url);
        const launcher: Launcher = {
          id: newId("l_", random),
          name: finalName,
          target,
          iconKey: target.kind === "app" ? iconKeyFor(target.appId) : null,
        };
        return { next: { ...lib, launchers: [...lib.launchers, launcher] } };
      });
    },

    renameLauncher(id, name) {
      return mutate(async (lib) =>
        lib.launchers.some((l) => l.id === id) ? { next: { ...lib, launchers: lib.launchers.map((l) => (l.id === id ? { ...l, name } : l)) } } : { error: "not_found" },
      );
    },

    removeLauncher(id) {
      return mutate(async (lib) =>
        lib.launchers.some((l) => l.id === id)
          ? { next: { ...lib, launchers: lib.launchers.filter((l) => l.id !== id), deck: withoutFromDeck(lib.deck, "launcher", id) } }
          : { error: "not_found" },
      );
    },

    saveScene(draft) {
      return mutate(async (lib) => {
        const checked = await checkSteps(draft.steps);
        if ("error" in checked) return checked;
        const previous = draft.id ? lib.scenes.find((s) => s.id === draft.id) : undefined;
        if (draft.id && !previous) return { error: "not_found" };
        // Sin el campo = dejar como está (un celu viejo no los borra al editar); null = quitarlo.
        const hotkey = draft.hotkey === undefined ? previous?.hotkey : (draft.hotkey ?? undefined);
        const trigger = draft.trigger === undefined ? previous?.trigger : (draft.trigger ?? undefined);
        if (hotkey && lib.scenes.some((s) => s.hotkey === hotkey && s.id !== draft.id)) return { error: "hotkey_taken" };
        const extra = { ...(hotkey ? { hotkey } : {}), ...(trigger ? { trigger } : {}) };
        if (draft.id) {
          const scene: Scene = { id: draft.id, name: draft.name, steps: checked.steps, ...extra };
          return { next: { ...lib, scenes: lib.scenes.map((s) => (s.id === draft.id ? scene : s)) } };
        }
        if (lib.scenes.length >= MAX_SCENES) return { error: "limit" };
        return { next: { ...lib, scenes: [...lib.scenes, { id: newId("s_", random), name: draft.name, steps: checked.steps, ...extra }] } };
      });
    },

    removeScene(id) {
      return mutate(async (lib) =>
        lib.scenes.some((s) => s.id === id)
          ? { next: { ...lib, scenes: lib.scenes.filter((s) => s.id !== id), deck: withoutFromDeck(lib.deck, "scene", id) } }
          : { error: "not_found" },
      );
    },

    setDeck(items) {
      return mutate(async (lib) => {
        const seen = new Set<string>();
        const deck: DeckItem[] = [];
        for (const it of items) {
          if (it.kind === "scene" && !lib.scenes.some((s) => s.id === it.id)) return { error: "not_found" };
          if (it.kind === "launcher" && !lib.launchers.some((l) => l.id === it.id)) return { error: "not_found" };
          if (it.kind === "output" && !(audio && (await audio.remember(it.outputId)))) return { error: "not_found" };
          const key = deckKey(it);
          if (seen.has(key)) continue; // una misma cosa no va dos veces
          seen.add(key);
          deck.push(it);
        }
        return { next: { ...lib, deck } };
      });
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
