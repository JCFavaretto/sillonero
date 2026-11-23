import { describe, expect, it } from "vitest";
import { createLogger, createThrottledLogger, redact } from "../src/log";
import { FakeClock, MemFs, MemLogger } from "./fakes";

const PATH = "/logs/agent.log";

function setup(maxBytes = 1_048_576) {
  const fs = new MemFs();
  const clock = new FakeClock(Date.UTC(2026, 10, 6, 12, 0, 0));
  const log = createLogger({ fs, clock, path: PATH, maxBytes });
  return { fs, clock, log };
}

describe("log", () => {
  it("escribe una línea JSON por entrada con hora, nivel y mensaje", async () => {
    const { fs, log } = setup();
    log.info("agent started", { port: 47800 });
    await log.flush();
    const lines = (fs.files.get(PATH) ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      t: "2026-11-06T12:00:00.000Z",
      level: "info",
      msg: "agent started",
      port: 47800,
    });
  });

  it("crea la carpeta de logs", async () => {
    const { fs, log } = setup();
    log.warn("x");
    await log.flush();
    expect(fs.dirs.has("/logs")).toBe(true);
  });

  it("mantiene el orden de las entradas", async () => {
    const { fs, log } = setup();
    log.info("a");
    log.warn("b");
    log.error("c");
    await log.flush();
    const msgs = (fs.files.get(PATH) ?? "")
      .trimEnd()
      .split("\n")
      .map((l) => (JSON.parse(l) as { msg: string }).msg);
    expect(msgs).toEqual(["a", "b", "c"]);
  });

  it("rota a .1 al pasar el máximo y sigue en un archivo nuevo", async () => {
    const { fs, log } = setup(300);
    for (let i = 0; i < 10; i++) log.info(`entry ${i}`, { pad: "x".repeat(40) });
    await log.flush();
    expect(fs.files.has(`${PATH}.1`)).toBe(true);
    const current = fs.files.get(PATH) ?? "";
    expect(Buffer.byteLength(current)).toBeLessThanOrEqual(300);
    expect(current).toContain("entry 9");
    expect(fs.files.get(`${PATH}.1`)).toContain("entry");
  });

  it("no guarda más de un archivo rotado", async () => {
    const { fs, log } = setup(200);
    for (let i = 0; i < 40; i++) log.info(`entry ${i}`, { pad: "x".repeat(40) });
    await log.flush();
    const names = [...fs.files.keys()].sort();
    expect(names).toEqual([PATH, `${PATH}.1`]);
  });

  it("nunca escribe token, code ni secret", async () => {
    const { fs, log } = setup();
    log.info("pairing", {
      token: "TOKEN-VALUE-123",
      code: "CODE-VALUE-456",
      secret: "SECRET-VALUE-789",
      adminSecret: "ADMIN-VALUE-000",
      pairCode: "PAIR-VALUE-111",
      nested: { token: "NESTED-TOKEN", deviceId: "d1" },
      list: [{ secret: "IN-ARRAY" }],
    });
    await log.flush();
    const text = fs.files.get(PATH) ?? "";
    for (const leak of [
      "TOKEN-VALUE-123",
      "CODE-VALUE-456",
      "SECRET-VALUE-789",
      "ADMIN-VALUE-000",
      "PAIR-VALUE-111",
      "NESTED-TOKEN",
      "IN-ARRAY",
    ]) {
      expect(text).not.toContain(leak);
    }
    expect(text).toContain("[redacted]");
    expect(text).toContain("d1"); // lo que no es sensible sí queda
  });

  it("redact no toca los valores no sensibles ni muta el original", () => {
    const input = { token: "abc", port: 1, nested: { secret: "s" } };
    const out = redact(input);
    expect(out).toEqual({ token: "[redacted]", port: 1, nested: { secret: "[redacted]" } });
    expect(input.token).toBe("abc");
    expect(input.nested.secret).toBe("s");
  });

  it("un campo reservado no pisa hora, nivel ni mensaje", async () => {
    const { fs, log } = setup();
    log.info("real", { msg: "fake", level: "error", t: "nope" });
    await log.flush();
    const entry = JSON.parse((fs.files.get(PATH) ?? "").trim()) as Record<string, unknown>;
    expect(entry.msg).toBe("real");
    expect(entry.level).toBe("info");
    expect(entry.t).toBe("2026-11-06T12:00:00.000Z");
  });

  it("tolera valores que no se pueden serializar (ciclos)", async () => {
    const { fs, log } = setup();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    log.info("cyclic", { cyclic });
    await log.flush();
    expect(fs.files.get(PATH)).toContain("cyclic");
  });

  it("si el disco falla no tira y sigue logueando después", async () => {
    const { fs, log } = setup();
    fs.failNextWrite();
    log.info("lost");
    log.info("kept");
    await expect(log.flush()).resolves.toBeUndefined();
    expect(fs.files.get(PATH)).toContain("kept");
    expect(fs.files.get(PATH)).not.toContain("lost");
  });
});

describe("createThrottledLogger", () => {
  function throttled(windowMs = 10_000) {
    const clock = new FakeClock(0);
    const inner = new MemLogger();
    return { clock, inner, log: createThrottledLogger(inner, clock, windowMs) };
  }

  it("el primer mensaje pasa y los repetidos dentro de la ventana se descartan", () => {
    const { inner, log } = throttled();
    for (let i = 0; i < 100; i++) log.warn("connection rejected", { ip: "192.168.1.9" });
    expect(inner.entries).toHaveLength(1);
  });

  it("al pasar la ventana vuelve a loguear e informa cuántos se descartaron", () => {
    const { clock, inner, log } = throttled();
    for (let i = 0; i < 5; i++) log.warn("connection rejected");
    clock.advance(10_000);
    log.warn("connection rejected");
    expect(inner.entries).toHaveLength(2);
    expect(inner.entries[1]?.fields).toMatchObject({ suppressed: 4 });
  });

  it("los mensajes distintos y los niveles distintos no se pisan", () => {
    const { inner, log } = throttled();
    log.warn("a");
    log.warn("b");
    log.info("a");
    log.error("a");
    expect(inner.entries.map((e) => `${e.level}:${e.msg}`)).toEqual(["warn:a", "warn:b", "info:a", "error:a"]);
  });
});
