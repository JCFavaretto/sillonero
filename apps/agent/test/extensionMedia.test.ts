import { afterEach, describe, expect, it } from "vitest";
import { BrowserTab } from "@proyecto-e/protocol";
import { pageMedia, pickFrame, toMedia } from "../../extension/lib/media.js";
import { OpError, createOps } from "../../extension/lib/ops.js";

// F2 del rediseño (docs/PLAN.md 8.8, D99 a D102): la extensión maneja el <video>/<audio> principal de CUALQUIER página.

interface FakeEl {
  tagName: string;
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  playbackRate: number;
  readyState: number;
  currentSrc: string;
  getBoundingClientRect(): { width: number; height: number };
  play(): Promise<void>;
  pause(): void;
}
const el = (o: Partial<FakeEl> & { w?: number; h?: number } = {}): FakeEl => {
  const e: FakeEl = {
    tagName: "VIDEO",
    paused: false,
    ended: false,
    muted: false,
    volume: 1,
    currentTime: 60,
    duration: 243,
    playbackRate: 1,
    readyState: 4,
    currentSrc: "blob:x",
    getBoundingClientRect: () => ({ width: o.w ?? 640, height: o.h ?? 360 }),
    play: async () => void (e.paused = false),
    pause: () => void (e.paused = true),
    ...o,
  };
  return e;
};
const page = (els: FakeEl[]) => {
  (globalThis as { document?: unknown }).document = { querySelectorAll: () => els };
};
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("pageMedia: el video o audio principal de la página", () => {
  it("sin ningún video ni audio devuelve null", () => {
    page([]);
    expect(pageMedia(null, null)).toBeNull();
  });

  it("lee el estado: pausa, posición, duración, velocidad, silencio y volumen", () => {
    page([el({ currentTime: 82.4, playbackRate: 1.5, volume: 0.35 })]);
    expect(pageMedia(null, null)).toMatchObject({ paused: false, position: 82.4, duration: 243, rate: 1.5, muted: false, volume: 0.35 });
  });

  it("entre varios elige el que suena; un video que se reproduce mudo (vista previa) pierde contra el que tiene sonido", () => {
    const preview = el({ muted: true, w: 1280, h: 720, currentTime: 1 });
    const real = el({ w: 300, h: 200, currentTime: 50 });
    const paused = el({ paused: true, w: 1920, h: 1080, currentTime: 9 });
    page([preview, paused, real]);
    expect(pageMedia(null, null)!.position).toBe(50);
  });

  it("si ninguno suena, el más grande; un elemento vacío (sin fuente) no cuenta", () => {
    page([el({ paused: true, w: 100, h: 100, currentTime: 1 }), el({ paused: true, w: 800, h: 450, currentTime: 2 }), el({ paused: true, readyState: 0, currentSrc: "", w: 2000, h: 2000, currentTime: 3 })]);
    expect(pageMedia(null, null)!.position).toBe(2);
  });

  it("un vivo no tiene duración", () => {
    page([el({ duration: Number.POSITIVE_INFINITY })]);
    expect(pageMedia(null, null)!.duration).toBeNull();
  });

  it("reproducir/pausar alterna", () => {
    const e = el();
    page([e]);
    pageMedia("playPause", null);
    expect(e.paused).toBe(true);
    pageMedia("playPause", null);
    expect(e.paused).toBe(false);
  });

  it("saltar suma segundos sin pasarse del principio ni del final", () => {
    const e = el({ currentTime: 5 });
    page([e]);
    pageMedia("seekBy", -10);
    expect(e.currentTime).toBe(0);
    pageMedia("seekBy", 1000);
    expect(e.currentTime).toBe(243);
  });

  it("velocidad, silencio y volumen; subir el volumen saca el silencio", () => {
    const e = el({ muted: true });
    page([e]);
    pageMedia("rate", 1.5);
    expect(e.playbackRate).toBe(1.5);
    pageMedia("mute", false);
    expect(e.muted).toBe(false);
    pageMedia("mute", true);
    pageMedia("volume", 35);
    expect(e.volume).toBeCloseTo(0.35);
    expect(e.muted).toBe(false);
  });

  it("es autocontenida: se puede inyectar en la página (no usa nada de afuera)", () => {
    // chrome.scripting.executeScript manda el TEXTO de la función: si usara un import o una variable del módulo, fallaría allá.
    const rebuilt = new Function(`return (${pageMedia.toString()})`)() as typeof pageMedia;
    page([el({ currentTime: 7 })]);
    expect(rebuilt(null, null)!.position).toBe(7);
  });
});

describe("pickFrame y toMedia", () => {
  it("entre los marcos de la pestaña gana el de mejor puntaje; los que no tienen nada se ignoran", () => {
    const frames = [{ frameId: 0, result: null }, { frameId: 7, result: { score: 5, position: 1 } }, { frameId: 9, result: { score: 90, position: 2 } }, { frameId: 3 }];
    expect(pickFrame(frames)).toMatchObject({ frameId: 9 });
    expect(pickFrame([{ frameId: 0, result: null }])).toBeNull();
    expect(pickFrame(undefined)).toBeNull();
  });

  it("toMedia deja el estado en la forma del protocolo", () => {
    const tab = { id: 4, windowId: 1, title: "t", host: "twitch.tv", active: true, audible: true, pinned: false };
    const media = toMedia({ paused: false, position: 82.44, duration: 243.2, rate: 1.5, muted: false, volume: 0.35 }, "twitch.tv");
    expect(media).toEqual({ paused: false, positionMs: 82_440, durationMs: 243_200, rate: 1.5, muted: false, volume: 35, canSeek: true });
    expect(BrowserTab.safeParse({ ...tab, media }).success).toBe(true);
  });

  it("un vivo: sin duración y sin saltar", () => {
    expect(toMedia({ paused: false, position: 9000, duration: null, rate: 1, muted: false, volume: 1 }, "twitch.tv")).toMatchObject({ durationMs: null, canSeek: false });
  });

  it("sitios donde saltar rompe la reproducción (D102): no se puede saltar ni cambiar la velocidad", () => {
    const s = { paused: false, position: 10, duration: 3000, rate: 1, muted: false, volume: 1 };
    expect(toMedia(s, "netflix.com")!.canSeek).toBe(false);
    expect(toMedia(s, "www.netflix.com")!.canSeek).toBe(false);
    expect(toMedia(s, "notnetflix.com")!.canSeek).toBe(true);
  });

  it("valores rotos de la página: se recortan o se descarta el estado", () => {
    expect(toMedia({ paused: false, position: 500, duration: 243, rate: 1, muted: false, volume: 1 }, "a.com")!.positionMs).toBe(243_000);
    expect(toMedia({ paused: false, position: Number.NaN, duration: 243, rate: 1, muted: false, volume: 1 }, "a.com")!.positionMs).toBe(0);
    expect(toMedia({ paused: false, position: 1, duration: 243, rate: 99, muted: false, volume: 7 }, "a.com")).toMatchObject({ rate: 1, volume: 100 });
    expect(toMedia(null, "a.com")).toBeNull();
    expect(toMedia("x", "a.com")).toBeNull();
  });
});

describe("ops: las órdenes de reproductor y el estado en las pestañas", () => {
  const STATE = { score: 100, paused: false, position: 60, duration: 243, rate: 1, muted: false, volume: 0.8 };
  function fake(opts: { frames?: unknown[]; tabs?: unknown[]; fail?: boolean; url?: string; incognito?: boolean; hang?: number[] } = {}) {
    const calls: { target: { tabId: number; allFrames?: boolean; frameIds?: number[] }; args: unknown[] }[] = [];
    let frames = opts.frames ?? [{ frameId: 0, result: null }, { frameId: 5, result: STATE }];
    const chrome = {
      tabs: {
        query: async () => opts.tabs ?? [{ id: 4, windowId: 1, index: 0, title: "Final", url: "https://www.twitch.tv/videos/1", active: true, audible: true }],
        get: async () => ({ id: 4, url: opts.url ?? "https://www.twitch.tv/videos/1", incognito: opts.incognito === true }),
      },
      scripting: {
        executeScript: async (o: { target: { tabId: number; allFrames?: boolean; frameIds?: number[] }; args: unknown[] }) => {
          calls.push({ target: o.target, args: o.args });
          if (opts.hang?.includes(o.target.tabId)) return new Promise(() => {});
          if (opts.fail) throw new Error("Cannot access contents of the page");
          return o.target.allFrames ? frames : [{ frameId: o.target.frameIds![0], result: STATE }];
        },
      },
    };
    return { ops: createOps(chrome as never, (async () => new Response("")) as never), calls, setFrames: (f: unknown[]) => (frames = f) };
  }

  it("una orden busca el mejor marco y la aplica SOLO ahí", async () => {
    const t = fake();
    await t.ops.act({ op: "media.seekBy", tabId: 4, seconds: -10 });
    expect(t.calls[0]!.target).toEqual({ tabId: 4, allFrames: true });
    expect(t.calls[1]).toEqual({ target: { tabId: 4, frameIds: [5] }, args: ["seekBy", -10] });
  });

  it("cada orden manda su acción y su valor", async () => {
    const t = fake();
    await t.ops.act({ op: "media.playPause", tabId: 4 });
    await t.ops.act({ op: "media.rate", tabId: 4, rate: 1.5 });
    await t.ops.act({ op: "media.mute", tabId: 4, muted: true });
    await t.ops.act({ op: "media.volume", tabId: 4, volume: 35 });
    expect(t.calls.filter((c) => c.target.frameIds).map((c) => c.args)).toEqual([["playPause", null], ["rate", 1.5], ["mute", true], ["volume", 35]]);
  });

  it("sin video en la pestaña, o si la página no se deja tocar, la orden falla con un motivo que el agente entiende", async () => {
    await expect(fake({ frames: [{ frameId: 0, result: null }] }).ops.act({ op: "media.playPause", tabId: 4 })).rejects.toBeInstanceOf(OpError);
    await expect(fake({ fail: true }).ops.act({ op: "media.playPause", tabId: 4 })).rejects.toBeInstanceOf(OpError);
  });

  it("en un vivo o un sitio protegido no se salta ni se cambia la velocidad, pero sí se pausa", async () => {
    const live = fake({ frames: [{ frameId: 0, result: { ...STATE, duration: null } }] });
    await expect(live.ops.act({ op: "media.seekBy", tabId: 4, seconds: 10 })).rejects.toBeInstanceOf(OpError);
    await expect(live.ops.act({ op: "media.rate", tabId: 4, rate: 2 })).rejects.toBeInstanceOf(OpError);
    await live.ops.act({ op: "media.playPause", tabId: 4 });
    expect(live.calls.at(-1)!.args).toEqual(["playPause", null]);
  });

  it("tabs(): la pestaña que suena trae el estado de su reproductor", async () => {
    const t = fake();
    const [tab] = await t.ops.tabs();
    expect(tab.media).toEqual({ paused: false, positionMs: 60_000, durationMs: 243_000, rate: 1, muted: false, volume: 80, canSeek: true });
    expect(BrowserTab.safeParse(tab).success).toBe(true);
    expect(t.ops.hasMedia()).toBe(true);
  });

  it("tabs(): la pestaña a la vista cuenta si su video reproduce con sonido, aunque la pestaña no figure como \"sonando\"", async () => {
    const tabs = [{ id: 4, windowId: 1, index: 0, title: "Video", url: "https://a.example.com", active: true, audible: false }];
    const t = fake({ tabs });
    expect((await t.ops.tabs())[0].media).toMatchObject({ paused: false });
    expect(t.ops.hasMedia()).toBe(true);
  });

  it("tabs(): un video de portada mudo, o uno pausado y olvidado, no es un reproductor (no hace ruido en el celu)", async () => {
    const tabs = [{ id: 4, windowId: 1, index: 0, title: "Noticias", url: "https://a.example.com", active: true, audible: false }];
    const muted = fake({ tabs, frames: [{ frameId: 0, result: { ...STATE, muted: true } }] });
    expect((await muted.ops.tabs())[0].media).toBeUndefined();
    const paused = fake({ tabs, frames: [{ frameId: 0, result: { ...STATE, paused: true } }] });
    expect((await paused.ops.tabs())[0].media).toBeUndefined();
    expect(paused.ops.hasTracked()).toBe(false);
  });

  it("tabs(): una pestaña de fondo en silencio no se mira (no se inyecta nada ahí)", async () => {
    const t = fake({ tabs: [{ id: 4, windowId: 1, index: 0, title: "Mail", url: "https://mail.example.com", active: false, audible: false }] });
    const [tab] = await t.ops.tabs();
    expect(tab.media).toBeUndefined();
    expect(t.calls).toEqual([]);
    expect(t.ops.hasMedia()).toBe(false);
  });

  it("tabs(): al pausar deja de sonar, pero se la sigue mirando para poder reanudarla; si el video desaparece, se la suelta", async () => {
    let audible = true;
    const tabs = [{ id: 4, windowId: 1, index: 0, title: "Final", url: "https://www.twitch.tv/videos/1", active: false, get audible() { return audible; } }];
    const t = fake({ tabs });
    await t.ops.tabs();
    audible = false;
    t.setFrames([{ frameId: 5, result: { ...STATE, paused: true } }]);
    expect((await t.ops.tabs())[0].media).toMatchObject({ paused: true });
    t.setFrames([{ frameId: 0, result: null }]);
    expect((await t.ops.tabs())[0].media).toBeUndefined();
    const before = t.calls.length;
    await t.ops.tabs();
    expect(t.calls.length).toBe(before);
  });

  it("una pestaña colgada no deja sin lista a las demás (seguridad: no se espera sin límite)", async () => {
    const tabs = [
      { id: 4, windowId: 1, index: 0, title: "Colgada", url: "https://a.example.com", active: true, audible: true },
      { id: 5, windowId: 1, index: 1, title: "Final", url: "https://www.twitch.tv/videos/1", active: false, audible: true },
    ];
    const t = fake({ tabs, hang: [4] });
    const list = await t.ops.tabs();
    expect(list).toHaveLength(2);
    expect(list[0].media).toBeUndefined();
    expect(list[1].media).toBeDefined();
  }, 10_000);

  it("las órdenes no se aplican a una pestaña de incógnito ni a una página que no es http(s)", async () => {
    await expect(fake({ incognito: true }).ops.act({ op: "media.playPause", tabId: 4 })).rejects.toBeInstanceOf(OpError);
    await expect(fake({ url: "chrome://settings" }).ops.act({ op: "media.playPause", tabId: 4 })).rejects.toBeInstanceOf(OpError);
    await expect(fake({ url: "file:///C:/secreto.mp4" }).ops.act({ op: "media.playPause", tabId: 4 })).rejects.toBeInstanceOf(OpError);
  });

  it("tabs(): una página que no se deja leer no rompe la lista", async () => {
    const t = fake({ fail: true });
    const list = await t.ops.tabs();
    expect(list).toHaveLength(1);
    expect(list[0].media).toBeUndefined();
  });
});
