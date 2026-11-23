import { STATE_INTERVAL_MS } from "@proyecto-e/protocol";
import type { Clock, TimerHandle } from "../ports";
import type { Extras } from "../apps/extras";
import type { ScreensService } from "../screens/service";
import type { Sampler } from "../state/system";
import type { Session } from "./session";

export interface Broadcaster {
  /** Suma una sesión autenticada. Arranca el intervalo si era la primera. */
  add(session: Session): void;
  /** Le vuelve a mandar a esa sesión el estado completo (después de un rato en silencio por el Pad). */
  resync(session: Session): void;
  /** Saca una sesión. Apaga el intervalo si era la última. */
  remove(session: Session): void;
  size(): number;
  /** Saca todas las sesiones y apaga el intervalo. */
  stop(): void;
}

/**
 * Un solo intervalo de 2 s que reparte la misma muestra a todas las sesiones
 * autenticadas. Corre solo mientras haya al menos una (docs/PLAN.md 5.3).
 */
export function createBroadcaster(deps: {
  clock: Clock;
  sampler: Sampler;
  /** Pantallas y ventana activa (R2). Sin esto solo se manda CPU/RAM. */
  screens?: ScreensService;
  /** B3: ventanas y biblioteca. */
  extras?: Extras;
  intervalMs?: number;
}): Broadcaster {
  const { clock, sampler, screens, extras } = deps;
  const intervalMs = deps.intervalMs ?? STATE_INTERVAL_MS;
  const sessions = new Set<Session>();
  let timer: TimerHandle | null = null;

  function stopTimer(): void {
    if (timer !== null) clock.clear(timer);
    timer = null;
  }

  function tick(): void {
    for (const s of sessions) if (!s.isAuthenticated()) sessions.delete(s);
    if (sessions.size === 0) return stopTimer();
    const state = sampler.sample();
    for (const s of sessions) s.pushState(state);
    if (screens) {
      // Windows se lee en segundo plano: un tick lento no frena el de CPU/RAM.
      void screens
        .refresh()
        .then((r) => {
          if (!r.changed || !r.state) return;
          for (const s of sessions) s.pushScreens(r.state, "update");
        })
        .catch(() => undefined);
    }
    if (extras) {
      void extras
        .tick()
        .then((msgs) => {
          for (const m of msgs) for (const s of sessions) s.pushExtra(m.type, m.payload);
        })
        .catch(() => undefined);
    }
  }

  function sendSnapshots(session: Session): void {
    if (extras) {
      void extras
        .snapshots()
        .then((msgs) => {
          for (const m of msgs) session.pushExtra(m.type, m.payload);
        })
        .catch(() => undefined);
    }
    if (screens) {
      void screens
        .refresh()
        .then((r) => {
          if (r.state) session.pushScreens(r.state, "snapshot");
        })
        .catch(() => undefined);
    }
  }

  return {
    add(session) {
      const isNew = !sessions.has(session);
      sessions.add(session);
      timer ??= clock.setInterval(tick, intervalMs);
      if (isNew) sendSnapshots(session);
    },
    resync(session) {
      if (!sessions.has(session) || !session.isAuthenticated()) return;
      session.pushState(sampler.sample());
      sendSnapshots(session);
    },
    remove(session) {
      sessions.delete(session);
      if (sessions.size === 0) stopTimer();
    },
    size: () => sessions.size,
    stop() {
      sessions.clear();
      stopTimer();
    },
  };
}
