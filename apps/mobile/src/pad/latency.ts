/** Latencia que se muestra en el Pad (D57): mediana de las últimas 5 respuestas a `ping`; "lento" si pasa de 80 ms tres veces seguidas. */
const KEEP = 5;
const SLOW_MS = 80;
const SLOW_STREAK = 3;

export function createLatency() {
  let samples: number[] = [];
  let streak = 0;
  return {
    add(ms: number) {
      samples = [...samples, ms].slice(-KEEP);
      streak = ms > SLOW_MS ? streak + 1 : 0;
    },
    median(): number | null {
      if (samples.length === 0) return null;
      const sorted = [...samples].sort((x, y) => x - y);
      return sorted[Math.floor(sorted.length / 2)]!;
    },
    slow: () => streak >= SLOW_STREAK,
    reset() {
      samples = [];
      streak = 0;
    },
  };
}
