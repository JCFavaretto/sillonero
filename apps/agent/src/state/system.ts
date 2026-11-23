import type { SystemState } from "@proyecto-e/protocol";
import type { Clock, SystemInfo } from "../ports";

export interface Sampler {
  /** Toma una muestra nueva y la guarda como la última. */
  sample(): SystemState;
  /** La última muestra, o `null` si todavía no se tomó ninguna. */
  last(): SystemState | null;
  /** Para una conexión nueva: la última muestra; si no hay, toma una en el momento. */
  snapshot(): SystemState;
}

const HOSTNAME_MAX = 64; // límite del esquema SystemState

/** Muestreo de CPU (delta entre muestras), RAM y uptime de la PC (docs/PLAN.md 5.3). */
export function createSampler(deps: { sys: SystemInfo; clock: Clock; agentVersion: string }): Sampler {
  const { sys, clock, agentVersion } = deps;
  let prev: { idle: number; total: number } | null = null;
  let latest: SystemState | null = null;

  function cpuPercent(): number {
    const now = sys.cpuTimes();
    const before = prev;
    prev = now;
    if (!before) return 0; // primera muestra
    const dTotal = now.total - before.total;
    if (dTotal <= 0) return 0;
    const pct = 100 * (1 - (now.idle - before.idle) / dTotal);
    return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
  }

  return {
    sample() {
      const total = sys.memTotal();
      const sample: SystemState = {
        hostname: sys.hostname().slice(0, HOSTNAME_MAX),
        agentVersion,
        uptimeSec: Math.floor(sys.uptimeSec()),
        cpuPercent: cpuPercent(),
        memUsedBytes: total - sys.memFree(),
        memTotalBytes: total,
        sampledAt: clock.now(),
      };
      latest = sample;
      return sample;
    },
    last: () => latest,
    snapshot() {
      return latest ?? this.sample();
    },
  };
}
