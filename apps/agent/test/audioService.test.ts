import { describe, expect, it } from "vitest";
import { APP_CHROME, HYPER, OUT_H, OUT_R, REALTEK, outputIdFor, ses, setup } from "./audioHelpers";

const flush = () => new Promise<void>((r) => setImmediate(r));

describe("audioService · lectura", () => {
  it("antes de leer no hay estado; después sí, con ids opacos", async () => {
    const t = setup();
    expect(t.service.current()).toBeNull();
    const r = await t.service.refresh();
    expect(r.changed).toBe(true);
    expect(r.state!.outputs.map((o) => o.id).sort()).toEqual([OUT_H, OUT_R].sort());
    expect(r.state!.available).toEqual({ audio: true, defaultOutput: true, appRouting: true });
    expect(JSON.stringify(r.state)).not.toContain("{0.0.0");
  });

  it("avisa a los suscriptos solo cuando algo cambia", async () => {
    const t = setup();
    await t.service.refresh();
    await t.service.refresh();
    expect(t.updates).toHaveLength(1);
    t.audio.raw.outputs[0]!.volume = 0.2;
    await t.service.refresh();
    expect(t.updates).toHaveLength(2);
  });

  it("si Windows falla, el estado queda 'audio no disponible' y se recupera solo", async () => {
    const t = setup();
    t.audio.snapshotFails = true;
    const r = await t.service.refresh();
    expect(r.state!.available.audio).toBe(false);
    expect(r.state!.outputs).toEqual([]);
    t.audio.snapshotFails = false;
    const r2 = await t.service.refresh();
    expect(r2.state!.available.audio).toBe(true);
    expect(r2.state!.outputs).toHaveLength(2);
  });

  it("si el hijo ni arranca (ready rechaza), tampoco se pide el snapshot", async () => {
    const t = setup();
    t.audio.readyFails = true;
    const r = await t.service.refresh();
    expect(r.state!.available.audio).toBe(false);
    expect(t.audio.snapshots).toBe(0);
  });

  it("sin puerto de audio (otro sistema), todo da 'audio no disponible'", async () => {
    const t = setup({ audio: false });
    expect((await t.service.refresh()).state!.available.audio).toBe(false);
    expect(await t.service.setVolume({ kind: "output", id: OUT_H }, 10)).toEqual({ ok: false, reason: "audio_unavailable" });
    expect(await t.service.setDefault(OUT_R)).toEqual({ ok: false, reason: "audio_unavailable" });
  });
});

describe("audioService · volumen y silencio", () => {
  it("volumen de una salida: entero 0–100 → escalar 0–1, y se vuelve a leer", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.setVolume({ kind: "output", id: OUT_R }, 30)).toEqual({ ok: true });
    expect(t.audio.calls).toEqual([`setOutputVolume ${REALTEK} 0.3`]);
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_R)!.volume).toBe(30);
  });

  it("volumen de una app: todas sus sesiones", async () => {
    const t = setup();
    t.audio.raw.sessions.push(ses({ pid: 101 }));
    await t.service.refresh();
    expect(await t.service.setVolume({ kind: "app", id: APP_CHROME }, 20)).toEqual({ ok: true });
    expect(t.audio.calls).toEqual(["setAppVolume 100,101 0.2"]);
  });

  it("silencio de salida y de app", async () => {
    const t = setup();
    await t.service.refresh();
    await t.service.setMute({ kind: "output", id: OUT_H }, true);
    await t.service.setMute({ kind: "app", id: APP_CHROME }, true);
    expect(t.audio.calls).toEqual([`setOutputMute ${HYPER} true`, "setAppMute 100 true"]);
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.muted).toBe(true);
  });

  it("un id que no está en la lista → not_found; sin tocar Windows", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.setVolume({ kind: "output", id: "o_ZZZZZZZZZZZZ" }, 10)).toEqual({ ok: false, reason: "not_found" });
    expect(await t.service.setVolume({ kind: "app", id: "a_ZZZZZZZZZZZZ" }, 10)).toEqual({ ok: false, reason: "not_found" });
    expect(t.audio.calls).toEqual([]);
  });

  it("una salida conocida pero no activa → output_unavailable", async () => {
    const t = setup({ config: { known: { [outputIdFor("{tele}")]: { name: "Tele", kind: "tv" } } } });
    await t.service.refresh();
    expect(await t.service.setVolume({ kind: "output", id: outputIdFor("{tele}") }, 10)).toEqual({ ok: false, reason: "output_unavailable" });
  });

  it("los errores de Windows se traducen: output_unavailable, not_found, failed", async () => {
    const t = setup();
    await t.service.refresh();
    t.audio.failNext("setOutputVolume", "output_unavailable");
    expect(await t.service.setVolume({ kind: "output", id: OUT_H }, 10)).toEqual({ ok: false, reason: "output_unavailable" });
    t.audio.failNext("setOutputVolume", "not_found");
    expect(await t.service.setVolume({ kind: "output", id: OUT_H }, 10)).toEqual({ ok: false, reason: "not_found" });
    t.audio.failNext("setOutputVolume", "algo raro");
    expect(await t.service.setVolume({ kind: "output", id: OUT_H }, 10)).toEqual({ ok: false, reason: "failed" });
    t.audio.failNext("setOutputVolume", "audio no disponible (el hijo se cayó 3 veces en un minuto)");
    expect(await t.service.setVolume({ kind: "output", id: OUT_H }, 10)).toEqual({ ok: false, reason: "audio_unavailable" });
  });

  it("D38: 10 volúmenes seguidos de la misma salida → Windows recibe solo el primero y el último; todos reciben ok", async () => {
    const t = setup();
    await t.service.refresh();
    let release!: () => void;
    t.audio.holdChanges = new Promise<void>((r) => (release = r));
    const all = Array.from({ length: 10 }, (_, i) => t.service.setVolume({ kind: "output", id: OUT_R }, (i + 1) * 5));
    await flush();
    t.audio.holdChanges = null;
    release();
    const results = await Promise.all(all);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(t.audio.calls).toEqual([`setOutputVolume ${REALTEK} 0.05`, `setOutputVolume ${REALTEK} 0.5`]);
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_R)!.volume).toBe(50);
  });

  it("la cola es por id: dos salidas distintas no se pisan", async () => {
    const t = setup();
    await t.service.refresh();
    await Promise.all([t.service.setVolume({ kind: "output", id: OUT_R }, 10), t.service.setVolume({ kind: "output", id: OUT_H }, 20)]);
    expect(t.audio.calls).toHaveLength(2);
  });

  it("nudge: ±5 sobre la predeterminada, sin pasarse de 0 ni de 100", async () => {
    const t = setup();
    t.audio.raw.outputs[0]!.volume = 0.98;
    await t.service.refresh();
    await t.service.nudge(5);
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.volume).toBe(100);
    t.audio.raw.outputs[0]!.volume = 0.03;
    await t.service.refresh();
    await t.service.nudge(-5);
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.volume).toBe(0);
  });

  it("nudge y toggleMute sin predeterminada → not_found", async () => {
    const t = setup();
    t.audio.raw.defaultWinId = null;
    await t.service.refresh();
    expect(await t.service.nudge(5)).toEqual({ ok: false, reason: "not_found" });
    expect(await t.service.toggleMute()).toEqual({ ok: false, reason: "not_found" });
  });

  it("toggleMute alterna el silencio de la predeterminada", async () => {
    const t = setup();
    await t.service.refresh();
    await t.service.toggleMute();
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.muted).toBe(true);
    await t.service.toggleMute();
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.muted).toBe(false);
  });
});

describe("audioService · waitForOutput (D37)", () => {
  it("devuelve true enseguida si la salida está activa", async () => {
    const t = setup();
    expect(await t.service.waitForOutput(OUT_R, 8000)).toBe(true);
  });
  it("espera hasta que aparece (la tele recién prendida) y lee de nuevo cada 400 ms", async () => {
    const t = setup({ config: { known: { [outputIdFor("{tele}")]: { name: "Tele", kind: "tv" } } } });
    await t.service.refresh();
    const p = t.service.waitForOutput(outputIdFor("{tele}"), 8000);
    await flush();
    t.clock.advance(400);
    await flush();
    t.audio.raw.outputs.push({ winId: "{tele}", name: "Tele", formFactor: 9, volume: 0.3, muted: false });
    t.clock.advance(400);
    await flush();
    t.clock.advance(400);
    expect(await p).toBe(true);
  });
  it("si no aparece en el plazo, false", async () => {
    const t = setup({ config: { known: { [outputIdFor("{tele}")]: { name: "Tele", kind: "tv" } } } });
    await t.service.refresh();
    const p = t.service.waitForOutput(outputIdFor("{tele}"), 2000);
    for (let i = 0; i < 8; i++) {
      await flush();
      t.clock.advance(400);
    }
    expect(await p).toBe(false);
  });
  it("una salida que nunca se vio: false sin esperar", async () => {
    const t = setup();
    expect(await t.service.waitForOutput("o_ZZZZZZZZZZZZ", 8000)).toBe(false);
  });
});

describe("audioService · Vol +/− y Silenciar seguidos (revisión C1)", () => {
  it("tres Vol + seguidos suman +15 (cada uno parte de lo que dejó el anterior)", async () => {
    const t = setup();
    t.audio.raw.outputs[0]!.volume = 0.4;
    await t.service.refresh();
    const r = await Promise.all([t.service.nudge(5), t.service.nudge(5), t.service.nudge(5)]);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.volume).toBe(55);
  });
  it("Silenciar dos veces seguidas lo deja como estaba", async () => {
    const t = setup();
    await t.service.refresh();
    await Promise.all([t.service.toggleMute(), t.service.toggleMute()]);
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.muted).toBe(false);
  });
  it("un Vol + que falla no frena a los siguientes", async () => {
    const t = setup();
    t.audio.raw.outputs[0]!.volume = 0.4;
    await t.service.refresh();
    t.audio.failNext("setOutputVolume", "algo raro");
    const r = await Promise.all([t.service.nudge(5), t.service.nudge(5)]);
    expect(r[0]).toEqual({ ok: false, reason: "failed" });
    expect(r[1]).toEqual({ ok: true });
  });
});

describe("audioService · lecturas (revisión C4)", () => {
  it("varios refresh a la vez se juntan: Windows recibe como mucho dos lecturas, y la última es posterior a todas las llamadas", async () => {
    const t = setup();
    await t.service.refresh();
    const before = t.audio.snapshots;
    await Promise.all(Array.from({ length: 10 }, () => t.service.refresh()));
    expect(t.audio.snapshots - before).toBeLessThanOrEqual(2);
  });
  it("una lectura pedida mientras otra corre ve el cambio hecho en el medio", async () => {
    const t = setup();
    await t.service.refresh();
    const slow = t.service.refresh();
    t.audio.raw.outputs[1]!.volume = 0.9;
    const after = await t.service.refresh();
    await slow;
    expect(after.state!.outputs.find((o) => o.id === OUT_R)!.volume).toBe(90);
  });
  it("con el audio caído, waitForOutput no espera los 8 s", async () => {
    const t = setup({ config: { known: { [outputIdFor("{tele}")]: { name: "Tele", kind: "tv" } } } });
    t.audio.snapshotFails = true;
    await t.service.refresh();
    expect(await t.service.waitForOutput(outputIdFor("{tele}"), 8000)).toBe(false);
  });
});
