import { describe, expect, it } from "vitest";
import { AudioState } from "@proyecto-e/protocol";
import { SoundingHistory, buildAudio, comparableAudio } from "../src/audio/model";
import type { RawAudio, RawMedia } from "../src/ports";
import { setup } from "./audioHelpers";

// D97 (docs/PLAN.md 8.8): la posición de reproducción sale de Windows (GetTimelineProperties). El agente manda por dónde va
// AHORA; el celu avanza la barra solo, y el agente avisa de nuevo solo si cambia el tema, el estado o la posición salta > 2 s.

const NOW = 1_000_000;
const med = (o: Partial<RawMedia> = {}): RawMedia => ({ aumid: "Spotify.exe", index: 0, title: "Midnight City", artist: "M83", status: "playing", controls: { prev: true, playPause: true, next: true }, hasArt: false, isCurrent: true, ...o });
const tl = (o: Partial<NonNullable<RawMedia["timeline"]>> = {}): NonNullable<RawMedia["timeline"]> => ({ startMs: 0, endMs: 243_000, positionMs: 60_000, ageMs: 0, rate: 1, ...o });
const raw = (media: RawMedia[]): RawAudio => ({ outputs: [], sessions: [], defaultWinId: null, media });
const build = (media: RawMedia[], now = NOW) =>
  buildAudio({ raw: raw(media), config: { outputs: {}, known: {}, disable: { defaultOutput: false, appRouting: false } }, history: new SoundingHistory(), now, chosenMedia: null, available: { audio: true, defaultOutput: true, appRouting: true } }).state;
const first = (media: RawMedia[]) => build(media).media.sessions[0]!;

describe("línea de tiempo de una reproducción (D97)", () => {
  it("con posición y duración: viaja por dónde va, cuánto dura y la velocidad, y cumple el protocolo", () => {
    const state = build([med({ timeline: tl() })]);
    expect(state.media.sessions[0]!.timeline).toEqual({ positionMs: 60_000, durationMs: 243_000, rate: 1 });
    expect(AudioState.safeParse(state).success).toBe(true);
  });

  it("reproduciendo: suma el tiempo que pasó desde que la app informó la posición (por su velocidad)", () => {
    expect(first([med({ timeline: tl({ ageMs: 5_000 }) })]).timeline!.positionMs).toBe(65_000);
    expect(first([med({ timeline: tl({ ageMs: 4_000, rate: 1.5 }) })]).timeline).toMatchObject({ positionMs: 66_000, rate: 1.5 });
  });

  it("en pausa: la posición queda donde está, por viejo que sea el dato", () => {
    expect(first([med({ status: "paused", timeline: tl({ ageMs: 600_000 }) })]).timeline!.positionMs).toBe(60_000);
  });

  it("nunca pasa del final ni baja de cero; el comienzo distinto de cero se descuenta", () => {
    expect(first([med({ timeline: tl({ positionMs: 240_000, ageMs: 30_000 }) })]).timeline!.positionMs).toBe(243_000);
    expect(first([med({ timeline: tl({ positionMs: -5 }) })]).timeline!.positionMs).toBe(0);
    expect(first([med({ timeline: tl({ startMs: 10_000, endMs: 70_000, positionMs: 40_000 }) })]).timeline).toEqual({ positionMs: 30_000, durationMs: 60_000, rate: 1 });
  });

  it("sin duración (un vivo, o la app no la informa) no hay línea de tiempo: no se inventa una barra", () => {
    // Medido en la PC de Jay el 14/11/2026: Chrome informó posición 2.548.558 ms y fin 0.
    expect(first([med({ aumid: "chrome.exe", timeline: tl({ endMs: 0, positionMs: 2_548_558, ageMs: 15_572 }) })]).timeline).toBeUndefined();
    expect(first([med()]).timeline).toBeUndefined();
    expect(first([med({ timeline: null })]).timeline).toBeUndefined();
  });

  it("reproduciendo sin saber cuándo se informó la posición: no se puede calcular, no hay línea de tiempo", () => {
    expect(first([med({ timeline: tl({ ageMs: null }) })]).timeline).toBeUndefined();
    expect(first([med({ status: "paused", timeline: tl({ ageMs: null }) })]).timeline!.positionMs).toBe(60_000);
  });

  it("datos rotos del lado de Windows no rompen el estado: se descartan", () => {
    for (const bad of [{ positionMs: Number.NaN }, { endMs: Number.POSITIVE_INFINITY }, { rate: -1 }, { rate: 0 }, { endMs: 9e12 }] as const) {
      const s = build([med({ timeline: tl(bad) })]);
      expect(AudioState.safeParse(s).success).toBe(true);
    }
    // velocidad inválida: se toma 1
    expect(first([med({ timeline: tl({ rate: 0 }) })]).timeline).toMatchObject({ rate: 1 });
    expect(first([med({ timeline: tl({ rate: null }) })]).timeline).toMatchObject({ rate: 1 });
  });
});

describe("cuándo avisar al celu (D97): el avance normal no es un cambio", () => {
  const keys = () => new Map<string, number>();

  it("una reproducción que avanza a su ritmo se ve igual, aunque la posición sea otra", () => {
    const a = comparableAudio(build([med({ timeline: tl({ positionMs: 60_000 }) })], NOW), NOW, keys());
    const b = comparableAudio(build([med({ timeline: tl({ positionMs: 62_000 }) })], NOW + 2_000), NOW + 2_000, a.keys);
    expect(b.json).toBe(a.json);
  });

  it("tolera hasta 2 s de diferencia; un salto mayor (adelantar, retroceder) sí es un cambio", () => {
    const a = comparableAudio(build([med({ timeline: tl({ positionMs: 60_000 }) })], NOW), NOW, keys());
    const drift = comparableAudio(build([med({ timeline: tl({ positionMs: 63_500 }) })], NOW + 2_000), NOW + 2_000, a.keys);
    expect(drift.json).toBe(a.json);
    const seek = comparableAudio(build([med({ timeline: tl({ positionMs: 120_000 }) })], NOW + 2_000), NOW + 2_000, a.keys);
    expect(seek.json).not.toBe(a.json);
  });

  it("pausar, cambiar de tema, cambiar la duración o la velocidad son cambios", () => {
    const a = comparableAudio(build([med({ timeline: tl() })], NOW), NOW, keys());
    const changed = (m: RawMedia) => comparableAudio(build([m], NOW), NOW, a.keys).json !== a.json;
    expect(changed(med({ status: "paused", timeline: tl() }))).toBe(true);
    expect(changed(med({ title: "Otro tema", timeline: tl() }))).toBe(true);
    expect(changed(med({ timeline: tl({ endMs: 200_000 }) }))).toBe(true);
    expect(changed(med({ timeline: tl({ rate: 2 }) }))).toBe(true);
    expect(changed(med())).toBe(true);
  });

  it("en pausa, mover la posición más de 2 s es un cambio; quedarse quieto no", () => {
    const paused = (positionMs: number, now: number) => build([med({ status: "paused", timeline: tl({ positionMs }) })], now);
    const a = comparableAudio(paused(60_000, NOW), NOW, keys());
    expect(comparableAudio(paused(60_000, NOW + 60_000), NOW + 60_000, a.keys).json).toBe(a.json);
    expect(comparableAudio(paused(90_000, NOW + 1_000), NOW + 1_000, a.keys).json).not.toBe(a.json);
  });

  it("un tema que llegó al final y sigue figurando como 'reproduciendo' no dispara un aviso en cada lectura", () => {
    // La posición queda recortada en la duración: comparar el "momento en que empezó" haría que cambie con el reloj.
    const ended = (now: number) => build([med({ timeline: tl({ positionMs: 243_000, ageMs: now - NOW }) })], now);
    const a = comparableAudio(ended(NOW), NOW, keys());
    const b = comparableAudio(ended(NOW + 10_000), NOW + 10_000, a.keys);
    const c = comparableAudio(ended(NOW + 60_000), NOW + 60_000, b.keys);
    expect(b.json).toBe(a.json);
    expect(c.json).toBe(a.json);
  });

  it("la deriva lenta no se acumula sin avisar: pasados los 2 s respecto del último aviso, avisa una vez", () => {
    const a = comparableAudio(build([med({ timeline: tl({ positionMs: 60_000 }) })], NOW), NOW, keys());
    // cada lectura se atrasa 1,5 s respecto del ritmo esperado: la primera entra en la tolerancia, la segunda ya no
    const b = comparableAudio(build([med({ timeline: tl({ positionMs: 60_500 }) })], NOW + 2_000), NOW + 2_000, a.keys);
    expect(b.json).toBe(a.json);
    const c = comparableAudio(build([med({ timeline: tl({ positionMs: 61_000 }) })], NOW + 4_000), NOW + 4_000, b.keys);
    expect(c.json).not.toBe(a.json);
  });
});

describe("audioService con línea de tiempo", () => {
  it("el avance normal no manda audio.update; `current()` igual tiene la posición fresca", async () => {
    const t = setup();
    t.audio.raw = { ...t.audio.raw!, media: [med({ timeline: tl({ positionMs: 60_000 }) })] };
    await t.service.refresh();
    const sent = t.updates.length;
    t.clock.advance(3_000);
    t.audio.raw = { ...t.audio.raw!, media: [med({ timeline: tl({ positionMs: 63_000 }) })] };
    expect((await t.service.refresh()).changed).toBe(false);
    expect(t.updates.length).toBe(sent);
    expect(t.service.current()!.media.sessions[0]!.timeline!.positionMs).toBe(63_000);
  });

  it("adelantar el tema manda un audio.update con la posición nueva", async () => {
    const t = setup();
    t.audio.raw = { ...t.audio.raw!, media: [med({ timeline: tl({ positionMs: 60_000 }) })] };
    await t.service.refresh();
    const sent = t.updates.length;
    t.clock.advance(1_000);
    t.audio.raw = { ...t.audio.raw!, media: [med({ timeline: tl({ positionMs: 180_000 }) })] };
    expect((await t.service.refresh()).changed).toBe(true);
    expect(t.updates.length).toBe(sent + 1);
    expect(t.updates.at(-1)!.media.sessions[0]!.timeline!.positionMs).toBe(180_000);
  });
});
