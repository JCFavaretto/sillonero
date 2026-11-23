import { cpus, freemem, hostname, totalmem, uptime } from "node:os";
import type { SystemInfo } from "../ports";

type CpuSource = () => { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[];

export function createSystemInfo(opts: { cpus?: CpuSource } = {}): SystemInfo {
  const readCpus = opts.cpus ?? cpus;
  return {
    hostname: () => hostname(),
    uptimeSec: () => uptime(),
    cpuTimes() {
      let idle = 0;
      let total = 0;
      for (const { times } of readCpus()) {
        idle += times.idle;
        total += times.user + times.nice + times.sys + times.idle + times.irq;
      }
      return { idle, total };
    },
    memTotal: () => totalmem(),
    memFree: () => freemem(),
  };
}
