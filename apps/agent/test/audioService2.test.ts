import { describe, expect, it } from "vitest";
import { mediaIdFor, outputIdFor } from "../src/audio/model";
import type { RawMedia } from "../src/ports";
import { APP_CHROME, OUT_H, OUT_R, REALTEK, setup } from "./audioHelpers";

const med = (o: Partial<RawMedia> = {}): RawMedia => ({ aumid: "chrome.exe", index: 0, title: "Un video", artist: "Canal", status: "playing", controls: { prev: false, playPause: true, next: false }, hasArt: true, isCurrent: true, ...o });

describe("audioService · salida predeterminada (D29)", () => {
  it("la hace predeterminada con el id de Windows y se vuelve a leer", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.setDefault(OUT_R)).toEqual({ ok: true });
    expect(t.audio.calls).toEqual([`setDefault ${REALTEK}`]);
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_R)!.isDefault).toBe(true);
  });

  it("si ya es la predeterminada, no toca Windows", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.setDefault(OUT_H)).toEqual({ ok: true });
    expect(t.audio.calls).toEqual([]);
  });

  it("apagada a mano en la config, o sin soporte en esta PC → audio_unavailable", async () => {
    const a = setup({ config: { disable: { defaultOutput: true, appRouting: false } } });
    await a.service.refresh();
    expect(await a.service.setDefault(OUT_R)).toEqual({ ok: false, reason: "audio_unavailable" });
    const b = setup();
    b.audio.flags = { defaultOutput: false, appRouting: true };
    await b.service.refresh();
    expect(await b.service.setDefault(OUT_R)).toEqual({ ok: false, reason: "audio_unavailable" });
    expect(a.audio.calls.concat(b.audio.calls)).toEqual([]);
  });

  it("id desconocido → not_found; conocida pero no activa → output_unavailable; error de Windows → failed", async () => {
    const t = setup({ config: { known: { [outputIdFor("{tele}")]: { name: "Tele", kind: "tv" } } } });
    await t.service.refresh();
    expect(await t.service.setDefault("o_ZZZZZZZZZZZZ")).toEqual({ ok: false, reason: "not_found" });
    expect(await t.service.setDefault(outputIdFor("{tele}"))).toEqual({ ok: false, reason: "output_unavailable" });
    t.audio.failNext("setDefault", "E_FAIL");
    expect(await t.service.setDefault(OUT_R)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("audioService · app a una salida (D30)", () => {
  it("manda todos los PID de la app a la salida, y null la devuelve a la predeterminada", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.route(APP_CHROME, OUT_R)).toEqual({ ok: true });
    expect(t.audio.calls).toEqual([`route 100 ${REALTEK}`]);
    expect(t.service.current()!.apps[0]!.routed).toBe(OUT_R);
    expect(await t.service.route(APP_CHROME, null)).toEqual({ ok: true });
    expect(t.audio.calls[1]).toBe("route 100 null");
    expect(t.service.current()!.apps[0]!.routed).toBeNull();
  });

  it("apagada → audio_unavailable; app o salida desconocida → not_found", async () => {
    const off = setup({ config: { disable: { defaultOutput: false, appRouting: true } } });
    await off.service.refresh();
    expect(await off.service.route(APP_CHROME, OUT_R)).toEqual({ ok: false, reason: "audio_unavailable" });
    const t = setup();
    await t.service.refresh();
    expect(await t.service.route("a_ZZZZZZZZZZZZ", OUT_R)).toEqual({ ok: false, reason: "not_found" });
    expect(await t.service.route(APP_CHROME, "o_ZZZZZZZZZZZZ")).toEqual({ ok: false, reason: "not_found" });
    expect(t.audio.calls).toEqual([]);
  });
});

describe("audioService · apodos y ocultar (D32)", () => {
  it("renombrar guarda el apodo y suma la salida a las conocidas", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.rename(OUT_H, "Auriculares")).toEqual({ ok: true });
    expect(t.config().outputs[OUT_H]).toEqual({ nick: "Auriculares", hidden: false });
    expect(t.config().known[OUT_H]).toMatchObject({ name: "HyperX", kind: "speakers" });
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.nick).toBe("Auriculares");
    expect(t.updates.at(-1)!.outputs.find((o) => o.id === OUT_H)!.nick).toBe("Auriculares");
  });

  it("nick null borra el apodo; sin apodo y sin ocultar, la entrada desaparece", async () => {
    const t = setup();
    await t.service.refresh();
    await t.service.rename(OUT_H, "X");
    await t.service.rename(OUT_H, null);
    expect(t.config().outputs[OUT_H]).toBeUndefined();
  });

  it("ocultar y volver a mostrar conserva el apodo", async () => {
    const t = setup();
    await t.service.refresh();
    await t.service.rename(OUT_H, "Aur");
    await t.service.hide(OUT_H, true);
    expect(t.config().outputs[OUT_H]).toEqual({ nick: "Aur", hidden: true });
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.hidden).toBe(true);
    await t.service.hide(OUT_H, false);
    expect(t.config().outputs[OUT_H]).toEqual({ nick: "Aur", hidden: false });
  });

  it("una salida que nunca se vio → not_found, y no se guarda nada", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.rename("o_ZZZZZZZZZZZZ", "X")).toEqual({ ok: false, reason: "not_found" });
    expect(await t.service.hide("o_ZZZZZZZZZZZZ", true)).toEqual({ ok: false, reason: "not_found" });
    expect(t.saved).toEqual([]);
  });

  it("si el disco falla, falla el comando y el estado no cambia", async () => {
    const t = setup({ saveFails: true });
    await t.service.refresh();
    expect(await t.service.rename(OUT_H, "X")).toEqual({ ok: false, reason: "failed" });
    expect(t.service.current()!.outputs.find((o) => o.id === OUT_H)!.nick).toBeNull();
  });

  it("remember() suma a las conocidas una salida vista (para escenas y teclas); una nunca vista da false", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.remember(OUT_R)).toBe(true);
    expect(t.config().known[OUT_R]).toBeDefined();
    expect(await t.service.remember("o_ZZZZZZZZZZZZ")).toBe(false);
  });
});

describe("audioService · media (D34 y D35)", () => {
  it("⏯ va a la sesión de destino con el AUMID real", async () => {
    const t = setup();
    t.audio.raw.media = [med()];
    await t.service.refresh();
    expect(await t.service.pressKey("playPause")).toEqual({ ok: true });
    expect(t.audio.calls).toEqual(["mediaControl chrome.exe playPause"]);
    expect(t.keys.pressed).toEqual([]);
  });

  it("un control que la app no acepta → not_supported, sin llamar a Windows", async () => {
    const t = setup();
    t.audio.raw.media = [med()];
    await t.service.refresh();
    expect(await t.service.pressKey("next")).toEqual({ ok: false, reason: "not_supported" });
    expect(t.audio.calls).toEqual([]);
  });

  it("Windows dice not_supported igual → not_supported", async () => {
    const t = setup();
    t.audio.raw.media = [med({ controls: { prev: true, playPause: true, next: true } })];
    await t.service.refresh();
    t.audio.failNext("mediaControl", "not_supported");
    expect(await t.service.pressKey("next")).toEqual({ ok: false, reason: "not_supported" });
  });

  it("sin ninguna sesión de media, usa la tecla del teclado como respaldo", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.pressKey("playPause")).toEqual({ ok: true });
    expect(t.keys.pressed).toEqual(["playPause"]);
    t.keys.fail = true;
    expect(await t.service.pressKey("next")).toEqual({ ok: false, reason: "failed" });
  });

  it("elegir la app: los botones van a ella; null vuelve a la actual de Windows", async () => {
    const t = setup();
    t.audio.raw.media = [med({ aumid: "chrome.exe", isCurrent: true }), med({ aumid: "Spotify.exe", title: "Tema", controls: { prev: true, playPause: true, next: true }, isCurrent: false })];
    await t.service.refresh();
    expect(t.service.current()!.media).toMatchObject({ targetId: mediaIdFor("chrome.exe"), chosen: false });
    expect(await t.service.selectMedia(mediaIdFor("Spotify.exe"))).toEqual({ ok: true });
    expect(t.service.current()!.media).toMatchObject({ targetId: mediaIdFor("Spotify.exe"), chosen: true });
    await t.service.pressKey("prev");
    expect(t.audio.calls).toEqual(["mediaControl Spotify.exe prev"]);
    expect(await t.service.selectMedia(null)).toEqual({ ok: true });
    expect(t.service.current()!.media.chosen).toBe(false);
  });

  it("elegir una app que no está → not_found", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.selectMedia("m_ZZZZZZZZZZZZ")).toEqual({ ok: false, reason: "not_found" });
  });

  it("elegir avisa a los suscriptos", async () => {
    const t = setup();
    t.audio.raw.media = [med({ aumid: "a.exe", isCurrent: true }), med({ aumid: "b.exe", isCurrent: false })];
    await t.service.refresh();
    const n = t.updates.length;
    await t.service.selectMedia(mediaIdFor("b.exe"));
    expect(t.updates.length).toBe(n + 1);
  });
});

describe("audioService · dos sesiones de la misma app", () => {
  it("los botones van a la sesión elegida (por número), no a la primera de esa app", async () => {
    const t = setup();
    t.audio.raw.media = [med({ title: "Video", index: 0, isCurrent: true }), med({ title: "Canción", index: 1, isCurrent: false, controls: { prev: true, playPause: true, next: true } })];
    await t.service.refresh();
    const second = t.service.current()!.media.sessions.find((s) => s.title === "Canción")!;
    expect(await t.service.selectMedia(second.id)).toEqual({ ok: true });
    await t.service.pressKey("next");
    expect(t.audio.calls).toEqual(["mediaControl chrome.exe#1 next"]);
  });
  it("la carátula se pide para la sesión correcta", async () => {
    const t = setup();
    t.audio.raw.media = [med({ title: "Video", index: 0 }), med({ title: "Canción", index: 1, isCurrent: false })];
    t.audio.arts.set("chrome.exe#1", "SEGUNDA");
    await t.service.refresh();
    const second = t.service.current()!.media.sessions.find((s) => s.title === "Canción")!;
    expect(await t.service.art([second.artKey!])).toEqual([{ key: second.artKey, jpeg: "SEGUNDA" }]);
  });
});

describe("audioService · carátulas · no se recuerda un null", () => {
  it("si Windows contesta null (todavía no cargó), la próxima vez se vuelve a pedir", async () => {
    const t = setup();
    t.audio.raw.media = [med()];
    await t.service.refresh();
    const key = t.service.current()!.media.sessions[0]!.artKey!;
    expect(await t.service.art([key])).toEqual([{ key, jpeg: null }]);
    t.audio.arts.set("chrome.exe", "/9j/AAA=");
    expect(await t.service.art([key])).toEqual([{ key, jpeg: "/9j/AAA=" }]);
    expect(t.audio.artCalls).toBe(2);
  });
});

describe("audioService · carátulas", () => {
  it("devuelve el JPEG de la clave y lo guarda: la segunda vez no vuelve a Windows", async () => {
    const t = setup();
    t.audio.raw.media = [med()];
    t.audio.arts.set("chrome.exe", "/9j/AAA=");
    await t.service.refresh();
    const key = t.service.current()!.media.sessions[0]!.artKey!;
    expect(await t.service.art([key])).toEqual([{ key, jpeg: "/9j/AAA=" }]);
    expect(await t.service.art([key])).toEqual([{ key, jpeg: "/9j/AAA=" }]);
    expect(t.audio.artCalls).toBe(1);
  });

  it("una clave que no es de las sesiones de ahora → null, sin ir a Windows", async () => {
    const t = setup();
    await t.service.refresh();
    expect(await t.service.art(["r_ZZZZZZZZZZZZ"])).toEqual([{ key: "r_ZZZZZZZZZZZZ", jpeg: null }]);
    expect(t.audio.artCalls).toBe(0);
  });

  it("si Windows falla, null (no rompe la lista)", async () => {
    const t = setup();
    t.audio.raw.media = [med()];
    await t.service.refresh();
    const key = t.service.current()!.media.sessions[0]!.artKey!;
    t.audio.art = async () => Promise.reject(new Error("x"));
    expect(await t.service.art([key])).toEqual([{ key, jpeg: null }]);
  });

  it("cuando cambia el tema, la clave es otra y se pide otra carátula", async () => {
    const t = setup();
    t.audio.raw.media = [med({ title: "Uno" })];
    t.audio.arts.set("chrome.exe", "UNO");
    await t.service.refresh();
    const k1 = t.service.current()!.media.sessions[0]!.artKey!;
    await t.service.art([k1]);
    t.audio.raw.media = [med({ title: "Dos" })];
    t.audio.arts.set("chrome.exe", "DOS");
    await t.service.refresh();
    const k2 = t.service.current()!.media.sessions[0]!.artKey!;
    expect(k2).not.toBe(k1);
    expect(await t.service.art([k2])).toEqual([{ key: k2, jpeg: "DOS" }]);
  });
});
