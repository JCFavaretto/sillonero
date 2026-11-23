import type { Clock, TimerHandle } from "../ports";

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle,
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as TimerHandle,
  clear: (h) => clearTimeout(h as unknown as NodeJS.Timeout), // sirve también para intervals
};
