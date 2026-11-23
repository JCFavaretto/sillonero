import type { CommandError, Foreground, Monitor, ScreensState } from "@proyecto-e/protocol";
import type { Clock, Displays, Identifier, Logger, RawDisplay, RawRect, RawWindow, Windows } from "../ports";
import { planOrder } from "./arrange";
import { buildForeground, buildMonitors, monitorId } from "./model";
import { planMove } from "./moveWindow";

// Servicio de pantallas (docs/PLAN.md 8.2.4): lee Windows, arma el estado que ve el celu y avisa si cambió.
// R4 suma los apodos y la memoria de cada pantalla (nombre y última posición), guardados en agent.json.

export interface RefreshResult {
  /** El estado cambió respecto de la lectura anterior. */
  changed: boolean;
  /** El estado actual, o `null` si todavía nunca se pudo leer. */
  state: ScreensState | null;
}

export type Availability = { ok: true } | { ok: false; error: string };

/** Una pantalla que el agente vio alguna vez. Es lo que se guarda en `agent.json` (`monitors.known`). */
export interface KnownMonitor {
  id: string;
  nickname: string | null;
  lastName: string;
  lastBounds: RawRect | null;
  lastSeenAt: string;
}

/** Dónde se guardan las pantallas conocidas (`app.ts` lo arma sobre `agent.json`). */
export interface KnownStore {
  get(): KnownMonitor[];
  save(list: KnownMonitor[]): Promise<void>;
}

export type CommandOutcome = { ok: true } | { ok: false; reason: CommandError };

export interface ScreensService {
  /** Lee Windows. Llamadas simultáneas comparten una sola lectura. Nunca rechaza. */
  refresh(): Promise<RefreshResult>;
  /** El último estado bien leído (puede estar un poco viejo si Windows está fallando). */
  current(): ScreensState | null;
  /** Las pantallas tal como las leyó Windows la última vez (con área de trabajo): para ubicar ventanas. */
  raw(): RawDisplay[];
  available(): Availability;
  /** Pone o saca (`null`) el apodo de una pantalla conectada. Se guarda antes de aplicarse. */
  rename(id: string, nickname: string | null): Promise<CommandOutcome>;
  /**
   * Prende o apaga una pantalla. Nunca apaga la principal ni la última prendida, de a un cambio por vez,
   * y si algo sale mal y no quedara ninguna pantalla prendida, vuelve a prender la que apagó.
   */
  setEnabled(id: string, on: boolean): Promise<CommandOutcome>;
  /**
   * Manda la ventana activa de la PC (la que tiene el foco ahora, no la del último muestreo) a esa pantalla.
   * Conserva la posición relativa, se achica si no entra y las maximizadas se vuelven a maximizar.
   */
  moveActive(monitorId: string): Promise<CommandOutcome>;
  /**
   * Pone las pantallas prendidas en este orden, de izquierda a derecha (la principal queda en 0,0). Todo o nada:
   * si Windows no lo acepta o no queda así, no se cambia nada y responde `failed`.
   */
  setOrder(order: string[]): Promise<CommandOutcome>;
  /** Muestra un número en cada pantalla prendida de la PC durante unos segundos. */
  identify(): Promise<CommandOutcome>;
  /** Se llama con el estado nuevo cada vez que un comando lo cambia (empieza, termina). Devuelve cómo dejar de escuchar. */
  subscribe(cb: (state: ScreensState) => void): () => void;
}

/** Cuántas pantallas se recuerdan (el esquema de `agent.json` lo limita a 32). */
const MAX_KNOWN = 32;

const sameRect = (a: RawRect | null, b: RawRect | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** Se descartan primero las más viejas sin apodo, y recién después las más viejas con apodo. */
function trimKnown(list: KnownMonitor[]): KnownMonitor[] {
  if (list.length <= MAX_KNOWN) return list;
  const dropOrder = [...list].sort(
    (a, b) => Number(a.nickname !== null) - Number(b.nickname !== null) || a.lastSeenAt.localeCompare(b.lastSeenAt),
  );
  const drop = new Set(dropOrder.slice(0, list.length - MAX_KNOWN).map((k) => k.id));
  return list.filter((k) => !drop.has(k.id));
}

export function createScreensService(deps: {
  displays: Displays;
  windows: Windows;
  log: Logger;
  clock?: Clock;
  known?: KnownStore;
  /** "Identificar". Sin esto el comando responde `unsupported`. */
  identifier?: Identifier;
}): ScreensService {
  const { displays, windows, log } = deps;
  const now = () => (deps.clock ? deps.clock.now() : Date.now());
  let known: Map<string, KnownMonitor> | null = null;
  let state: ScreensState | null = null;
  let serialized = "";
  let availability: Availability = { ok: true };
  let inFlight: Promise<RefreshResult> | null = null;
  let saveQueue: Promise<void> = Promise.resolve();
  /** Quien modifica las pantallas conocidas (una lectura o un apodo) lo hace de a uno, sobre la lista vigente. */
  let knownLock: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = knownLock.then(fn, fn);
    knownLock = run.catch(() => undefined);
    return run;
  }
  /** Pantallas con un cambio en curso (el celu las muestra como "cambiando…"). */
  const busyIds = new Set<string>();
  const listeners = new Set<(s: ScreensState) => void>();
  /** Mientras los números están en pantalla no se puede pedir otra vez. */
  let identifying = false;
  let lastRaw: RawDisplay[] = [];
  let lastWindow: RawWindow | null = null;

  /** Se carga de `agent.json` recién en la primera lectura (el servicio se arma antes de leer la config). */
  const knownMap = (): Map<string, KnownMonitor> => {
    known ??= new Map((deps.known?.get() ?? []).map((k) => [k.id, k]));
    return known;
  };

  /** Guarda la lista (en orden, de a una) y devuelve la lista que quedó. Rechaza si no se pudo escribir. */
  function persist(map: Map<string, KnownMonitor>): Promise<KnownMonitor[]> {
    const list = trimKnown([...map.values()]);
    const run = saveQueue.then(() => deps.known?.save(list));
    saveQueue = run.catch(() => undefined);
    return run.then(() => list);
  }

  /** Arma el estado que ve el celu con lo último leído de Windows, los apodos y los cambios en curso. */
  function compose(): { monitors: Monitor[]; next: ScreensState } {
    const nicknames = new Map<string, string>();
    const lastBounds = new Map<string, RawRect>();
    for (const k of knownMap().values()) {
      if (k.nickname !== null) nicknames.set(k.id, k.nickname);
      if (k.lastBounds) lastBounds.set(k.id, k.lastBounds);
    }
    const monitors: Monitor[] = buildMonitors(lastRaw, { nicknames, lastBounds, busy: busyIds });
    const foreground: Foreground | null = buildForeground(lastWindow, monitors, lastRaw);
    return { monitors, next: { monitors, foreground } };
  }

  /** Publica el estado actual (con los cambios en curso) a quien esté escuchando. */
  function emit(): void {
    const { next } = compose();
    state = next;
    serialized = JSON.stringify(next);
    for (const cb of listeners) cb(next);
  }

  async function read(): Promise<RefreshResult> {
    let rawDisplays: RawDisplay[];
    try {
      rawDisplays = await displays.list();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Se avisa solo al empezar a fallar: el celu pregunta cada 2 s y llenaría el log.
      if (availability.ok) log.warn("screens: cannot read displays", { error });
      availability = { ok: false, error };
      return { changed: false, state };
    }
    if (!availability.ok) log.info("screens: recovered");
    availability = { ok: true };

    let rawWindow: RawWindow | null = null;
    try {
      rawWindow = await windows.foreground();
    } catch (err) {
      log.warn("screens: cannot read the active window", { error: String(err) });
    }

    lastRaw = rawDisplays;
    lastWindow = rawWindow;
    const { monitors, next } = compose();

    // Se recuerda cada pantalla vista; solo se escribe el archivo cuando cambia algo que importa
    // (pantalla nueva, otro nombre u otra posición), no por el simple paso del tiempo.
    // Va en la sección exclusiva y parte de la lista VIGENTE: así no pisa un apodo que se está guardando.
    await exclusive(async () => {
      const map = knownMap();
      const seenAt = new Date(now()).toISOString();
      let dirty = false;
      for (const m of monitors) {
        const prev = map.get(m.id);
        const entry: KnownMonitor = {
          id: m.id,
          nickname: prev?.nickname ?? null,
          lastName: m.name,
          lastBounds: m.lastBounds ?? prev?.lastBounds ?? null,
          lastSeenAt: seenAt,
        };
        if (!prev || prev.lastName !== entry.lastName || !sameRect(prev.lastBounds, entry.lastBounds)) dirty = true;
        map.set(m.id, entry);
      }
      if (dirty && deps.known) {
        try {
          known = new Map((await persist(map)).map((k) => [k.id, k]));
        } catch (err) {
          log.warn("screens: cannot save known monitors", { error: String(err) });
        }
      }
    });

    const json = JSON.stringify(next);
    const changed = json !== serialized;
    state = next;
    serialized = json;
    return { changed, state };
  }

  function refresh(): Promise<RefreshResult> {
    inFlight ??= read().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  /** Una lectura que arranca ahora: si había una en curso (que pudo leer antes del cambio) se espera a que termine. */
  async function freshRefresh(): Promise<RefreshResult> {
    if (inFlight) await inFlight.catch(() => undefined);
    return refresh();
  }

  return {
    refresh,
    current: () => state,
    raw: () => structuredClone(lastRaw),
    available: () => availability,

    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },

    async setEnabled(id, on) {
      if (state === null) await refresh();
      const monitor = state?.monitors.find((m) => m.id === id);
      const raw = lastRaw.find((r) => monitorId(r.devicePath) === id);
      if (!monitor || !raw) return { ok: false, reason: "not_found" };
      if (busyIds.size > 0) return { ok: false, reason: "busy" };
      if (monitor.enabled === on) return { ok: true };
      if (!on && monitor.primary) return { ok: false, reason: "primary" };
      if (!on && state!.monitors.filter((m) => m.enabled).length <= 1) return { ok: false, reason: "last_active" };

      busyIds.add(id);
      emit();
      let outcome: CommandOutcome = { ok: true };
      try {
        // Al prender se le dice a Windows dónde estaba: si no, la pone al final de todo (pasó en la PC de Jay).
        await displays.setEnabled(raw.devicePath, on, on ? (monitor.lastBounds ?? undefined) : undefined);
      } catch (err) {
        log.warn("screens: cannot change the display", { on, error: String(err) });
        outcome = { ok: false, reason: "failed" };
      }

      busyIds.delete(id);
      await freshRefresh();
      const after = state?.monitors ?? [];
      if (after.length > 0 && !after.some((m) => m.enabled)) {
        // Nunca te deja sin imagen: si no quedó ninguna pantalla prendida, se deshace.
        log.error("screens: no display left on, reverting", { id });
        try {
          await displays.setEnabled(raw.devicePath, true);
        } catch (err) {
          log.error("screens: could not revert", { error: String(err) });
        }
        await freshRefresh();
        outcome = { ok: false, reason: "failed" };
      } else if (outcome.ok && after.find((m) => m.id === id)?.enabled !== on) {
        log.warn("screens: Windows did not apply the change", { on });
        outcome = { ok: false, reason: "failed" };
      }

      // Red de seguridad: si prendió pero Windows la dejó en otro lugar que el de antes, se la vuelve a poner.
      const was = monitor.lastBounds;
      const now = after.find((m) => m.id === id)?.bounds;
      if (outcome.ok && on && was && now && (now.x !== was.x || now.y !== was.y)) {
        try {
          await displays.arrange([{ devicePath: raw.devicePath, x: was.x, y: was.y }]);
          await freshRefresh();
        } catch (err) {
          log.warn("screens: could not put the display back where it was", { error: String(err) });
        }
      }
      emit();
      return outcome;
    },

    async setOrder(order) {
      if (state === null) await refresh();
      if (busyIds.size > 0) return { ok: false, reason: "busy" };
      const monitors = state?.monitors ?? [];
      const plan = planOrder(monitors, order);
      if (!plan) return { ok: false, reason: "not_found" };

      // Solo se le pide a Windows mover las que cambian de lugar.
      const moves = [...plan].flatMap(([id, pos]) => {
        const m = monitors.find((x) => x.id === id);
        const raw = lastRaw.find((r) => monitorId(r.devicePath) === id);
        if (!m?.bounds || !raw || (m.bounds.x === pos.x && m.bounds.y === pos.y)) return [];
        return [{ id, devicePath: raw.devicePath, x: pos.x, y: pos.y }];
      });
      if (moves.length === 0) return { ok: true };

      for (const m of monitors) if (m.enabled) busyIds.add(m.id);
      emit();
      let outcome: CommandOutcome = { ok: true };
      try {
        await displays.arrange(moves.map(({ devicePath, x, y }) => ({ devicePath, x, y })));
      } catch (err) {
        log.warn("screens: cannot rearrange the displays", { error: String(err) });
        outcome = { ok: false, reason: "failed" };
      }
      busyIds.clear();
      await freshRefresh();
      if (outcome.ok) {
        const placed = moves.every(({ id, x, y }) => {
          const b = state?.monitors.find((m) => m.id === id)?.bounds;
          return b?.x === x && b?.y === y;
        });
        if (!placed) {
          log.warn("screens: Windows did not leave the displays in the requested order");
          outcome = { ok: false, reason: "failed" };
        }
      }
      emit();
      return outcome;
    },

    async identify() {
      if (!deps.identifier) return { ok: false, reason: "unsupported" };
      if (state === null) await refresh();
      if (identifying || busyIds.size > 0) return { ok: false, reason: "busy" };
      // Solo números y posiciones armadas acá, de lo que leyó Windows: nada que venga del celu.
      const items = (state?.monitors ?? []).flatMap((m) => (m.enabled && m.index !== null && m.bounds ? [{ index: m.index, bounds: m.bounds }] : []));
      if (items.length === 0) return { ok: false, reason: "failed" };
      identifying = true;
      try {
        const { done } = await deps.identifier.show(items);
        void done.catch(() => undefined).finally(() => void (identifying = false));
        return { ok: true };
      } catch (err) {
        identifying = false;
        log.warn("screens: cannot identify", { error: String(err) });
        return { ok: false, reason: "failed" };
      }
    },

    async moveActive(targetId) {
      if (state === null) await refresh();
      if (busyIds.size > 0) return { ok: false, reason: "busy" };
      const target = lastRaw.find((r) => monitorId(r.devicePath) === targetId);
      const toArea = target?.active ? (target.workArea ?? target.bounds) : null;
      if (!target || !toArea) return { ok: false, reason: "not_found" };

      // La ventana activa se lee ahora mismo: desde que se tocó el botón pudo haber cambiado el foco.
      let win: RawWindow | null;
      try {
        win = await windows.foreground();
      } catch (err) {
        log.warn("screens: cannot read the active window", { error: String(err) });
        return { ok: false, reason: "failed" };
      }
      const fg = buildForeground(win, state?.monitors ?? [], lastRaw);
      if (!win || !fg) return { ok: false, reason: "no_window" };

      const from = lastRaw.find((r) => fg.monitorId !== null && monitorId(r.devicePath) === fg.monitorId);
      const plan = planMove(win, from ? (from.workArea ?? from.bounds) : null, toArea, fg.monitorId === targetId);
      if (!plan) return { ok: true };

      let outcome: CommandOutcome = { ok: true };
      try {
        await windows.place(win.handle, plan.rect, plan.maximize);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("screens: cannot move the window", { error: message });
        outcome = { ok: false, reason: /elevated|access denied|acceso denegado/i.test(message) ? "elevated" : "failed" };
      }
      await freshRefresh();
      emit();
      return outcome;
    },

    async rename(id, nickname) {
      if (state === null) await refresh();
      const monitor = state?.monitors.find((m) => m.id === id);
      if (!monitor) return { ok: false, reason: "not_found" };

      // Sección exclusiva y sobre la lista vigente. Se arma una copia aparte: si no se puede guardar,
      // el apodo no queda aplicado a medias.
      const saved = await exclusive(async (): Promise<boolean> => {
        const map = new Map(knownMap());
        const prev = map.get(id);
        map.set(id, {
          id,
          nickname,
          lastName: monitor.name,
          lastBounds: monitor.lastBounds ?? prev?.lastBounds ?? null,
          lastSeenAt: new Date(now()).toISOString(),
        });
        try {
          known = new Map((await persist(map)).map((k) => [k.id, k]));
          return true;
        } catch (err) {
          log.warn("screens: cannot save the nickname", { error: String(err) });
          return false;
        }
      });
      if (!saved) return { ok: false, reason: "failed" };
      await freshRefresh();
      return { ok: true };
    },
  };
}
