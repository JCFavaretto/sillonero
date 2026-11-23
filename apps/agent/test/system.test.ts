import { describe, expect, it } from "vitest";
import { SystemState } from "@proyecto-e/protocol";
import { createSampler } from "../src/state/system";
import { FakeClock, FakeSystemInfo } from "./fakes";

function setup() {
  const sys = new FakeSystemInfo();
  const clock = new FakeClock(1_700_000_000_123);
  const sampler = createSampler({ sys, clock, agentVersion: "0.1.0" });
  return { sys, clock, sampler };
}

describe("sampler · CPU", () => {
  it("la primera muestra da 0", () => {
    const { sys, sampler } = setup();
    sys.times = { idle: 500, total: 1000 };
    expect(sampler.sample().cpuPercent).toBe(0);
  });

  it("usa el delta entre muestras: 100 * (1 - Δidle/Δtotal)", () => {
    const { sys, sampler } = setup();
    sys.times = { idle: 0, total: 0 };
    sampler.sample();
    sys.times = { idle: 100, total: 200 };
    expect(sampler.sample().cpuPercent).toBe(50);
    sys.times = { idle: 100, total: 300 }; // 200 de total, 0 de idle
    expect(sampler.sample().cpuPercent).toBe(100);
  });

  it("redondea a 1 decimal", () => {
    const { sys, sampler } = setup();
    sampler.sample();
    sys.times = { idle: 1, total: 3 };
    expect(sampler.sample().cpuPercent).toBe(66.7);
  });

  it("Δtotal ≤ 0 (contadores iguales o reiniciados) da 0", () => {
    const { sys, sampler } = setup();
    sys.times = { idle: 100, total: 200 };
    sampler.sample();
    expect(sampler.sample().cpuPercent).toBe(0); // sin cambios
    sys.times = { idle: 10, total: 20 }; // retrocedió
    expect(sampler.sample().cpuPercent).toBe(0);
  });

  it("queda acotado a 0–100 aunque los números no cierren", () => {
    const { sys, sampler } = setup();
    sampler.sample();
    sys.times = { idle: 500, total: 100 }; // Δidle > Δtotal: daría negativo
    expect(sampler.sample().cpuPercent).toBe(0);
    sys.times = { idle: 400, total: 1100 }; // Δidle = -100, Δtotal = 1000: daría 110
    expect(sampler.sample().cpuPercent).toBe(100);
  });
});

describe("sampler · resto del estado", () => {
  it("RAM usada = total - libre, uptime entero y datos de la PC", () => {
    const { sys, clock, sampler } = setup();
    sys.totalMem = 16_000;
    sys.freeMem = 4_000;
    sys.uptime = 3600.9;
    sys.host = "PC-DE-JAY";
    expect(sampler.sample()).toEqual({
      hostname: "PC-DE-JAY",
      agentVersion: "0.1.0",
      uptimeSec: 3600,
      cpuPercent: 0,
      memUsedBytes: 12_000,
      memTotalBytes: 16_000,
      sampledAt: clock.now(),
    });
  });

  it("cada muestra cumple el esquema del protocolo", () => {
    const { sys, sampler } = setup();
    sys.times = { idle: 10, total: 20 };
    expect(SystemState.safeParse(sampler.sample()).success).toBe(true);
    sys.host = "x".repeat(100);
    expect(SystemState.safeParse(sampler.sample()).success).toBe(true); // se recorta a 64
  });
});

describe("sampler · snapshot", () => {
  it("sin muestra previa toma una en el momento", () => {
    const { sampler } = setup();
    expect(sampler.last()).toBeNull();
    const snap = sampler.snapshot();
    expect(snap.cpuPercent).toBe(0);
    expect(sampler.last()).toEqual(snap);
  });

  it("con muestra previa devuelve la última sin volver a medir", () => {
    const { sys, clock, sampler } = setup();
    const first = sampler.sample();
    clock.advance(5000);
    sys.freeMem = 1;
    expect(sampler.snapshot()).toBe(first);
  });
});
