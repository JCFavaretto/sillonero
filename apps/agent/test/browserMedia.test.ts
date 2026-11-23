import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { EXTENSION_ORIGIN } from "../src/browser/install";
import { comparableTabs, sanitizeTabs } from "../src/browser/sanitize";
import { createBrowserService, type BrowserService } from "../src/browser/service";
import { FakeClock, MemLogger } from "./fakes";

// F2 del rediseño (docs/PLAN.md 8.8, D99): el estado del reproductor de una pestaña llega de la extensión (dato no confiable),
// se valida y viaja al celu. El avance normal de la reproducción no es un cambio que haya que avisar.

const TOKEN = "t".repeat(32);
const tab = { id: 1, windowId: 1, title: "Final del torneo", host: "twitch.tv", active: true, audible: true, pinned: false };
const media = { paused: false, positionMs: 60_000, durationMs: 243_000, rate: 1, muted: false, volume: 80, canSeek: true };

describe("sanitize: el reproductor de una pestaña", () => {
  it("un estado válido pasa tal cual", () => {
    expect(sanitizeTabs([{ ...tab, media }])).toEqual([{ ...tab, media }]);
    expect(sanitizeTabs([{ ...tab, media: { ...media, durationMs: null, canSeek: false } }])[0]!.media).toMatchObject({ durationMs: null });
  });

  it("un estado roto se descarta, pero la pestaña sigue", () => {
    for (const bad of [{ ...media, positionMs: -5 }, { ...media, rate: 99 }, { ...media, volume: 500 }, "texto", 7, null, { paused: false }]) {
      const out = sanitizeTabs([{ ...tab, media: bad }]);
      expect(out).toHaveLength(1);
      expect(out[0]!.media).toBeUndefined();
    }
  });

  it("campos de más en el estado no viajan al celu", () => {
    const out = sanitizeTabs([{ ...tab, media: { ...media, url: "https://secreto.com/x", score: 5 } }]);
    expect(JSON.stringify(out)).not.toContain("secreto");
  });
});

describe("comparableTabs: el avance normal no es un cambio", () => {
  const NOW = 1_000_000;
  const tabs = (positionMs: number, o: Partial<typeof media> = {}) => sanitizeTabs([{ ...tab, media: { ...media, positionMs, ...o } }]);

  it("avanzar a su ritmo se ve igual; un salto de más de 2 s, no", () => {
    const a = comparableTabs(tabs(60_000), NOW, new Map());
    expect(comparableTabs(tabs(65_000), NOW + 5_000, a.keys).json).toBe(a.json);
    expect(comparableTabs(tabs(66_500), NOW + 5_000, a.keys).json).toBe(a.json);
    expect(comparableTabs(tabs(120_000), NOW + 5_000, a.keys).json).not.toBe(a.json);
  });

  it("pausar, silenciar, cambiar el volumen o la velocidad sí son cambios", () => {
    const a = comparableTabs(tabs(60_000), NOW, new Map());
    for (const o of [{ paused: true }, { muted: true }, { volume: 10 }, { rate: 1.5 }]) expect(comparableTabs(tabs(60_000, o), NOW, a.keys).json).not.toBe(a.json);
  });

  it("en pausa no cambia con el reloj; un vivo (sin duración) tampoco avisa por avanzar", () => {
    const a = comparableTabs(tabs(60_000, { paused: true }), NOW, new Map());
    expect(comparableTabs(tabs(60_000, { paused: true }), NOW + 90_000, a.keys).json).toBe(a.json);
    const live = (p: number) => tabs(p, { durationMs: null as never, canSeek: false });
    const b = comparableTabs(live(9_000_000), NOW, new Map());
    expect(comparableTabs(live(9_005_000), NOW + 5_000, b.keys).json).toBe(b.json);
  });

  it("a velocidad 1,5 el ritmo esperado es 1,5 s por segundo", () => {
    const a = comparableTabs(tabs(60_000, { rate: 1.5 }), NOW, new Map());
    expect(comparableTabs(tabs(67_500, { rate: 1.5 }), NOW + 5_000, a.keys).json).toBe(a.json);
  });
});

describe("browserService: reproductor de las pestañas", () => {
  const open: { svc: BrowserService; clients: WebSocket[] }[] = [];
  afterEach(async () => {
    for (const o of open.splice(0)) {
      for (const c of o.clients) c.terminate();
      await o.svc.stop();
    }
  });
  async function setup() {
    const clock = new FakeClock(1_000_000);
    const svc = createBrowserService({ clock, log: new MemLogger(), port: 0, token: TOKEN, origin: EXTENSION_ORIGIN });
    const port = await svc.start();
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://127.0.0.1:${port}/?k=${TOKEN}`, { origin: EXTENSION_ORIGIN });
      s.once("open", () => resolve(s));
      s.once("error", reject);
    });
    open.push({ svc, clients: [ws] });
    const seen: unknown[] = [];
    svc.subscribe((s) => seen.push(s));
    const send = (positionMs: number, o: Partial<typeof media> = {}) => ws.send(JSON.stringify({ t: "tabs", tabs: [{ ...tab, media: { ...media, positionMs, ...o } }] }));
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(cond()).toBe(true);
    };
    const position = () => svc.state().tabs[0]?.media?.positionMs;
    return { svc, clock, send, seen, until, position };
  }

  it("el avance normal no avisa al celu, pero el estado guardado queda con la posición fresca", async () => {
    const t = await setup();
    t.send(60_000);
    await t.until(() => t.position() === 60_000);
    const sent = t.seen.length;
    t.clock.advance(5_000);
    t.send(65_000);
    await t.until(() => t.position() === 65_000);
    expect(t.seen.length).toBe(sent);
  });

  it("un salto o una pausa sí avisan", async () => {
    const t = await setup();
    t.send(60_000);
    await t.until(() => t.position() === 60_000);
    const sent = t.seen.length;
    t.clock.advance(1_000);
    t.send(200_000);
    await t.until(() => t.seen.length === sent + 1);
    t.send(200_000, { paused: true });
    await t.until(() => t.seen.length === sent + 2);
  });

  it("las órdenes de reproductor viajan a la extensión como las demás", async () => {
    const t = await setup();
    expect(await Promise.race([t.svc.act({ op: "media.playPause", tabId: 1 }), new Promise((r) => setTimeout(() => r("sin respuesta"), 50))])).toBe("sin respuesta");
  });
});
