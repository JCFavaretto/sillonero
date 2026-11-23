import type { AudioState, ServerMessage } from "@proyecto-e/protocol";
import { applyAudio, initialAudio, useAudio } from "@/audio/store";
import { createThrottle } from "@/audio/throttle";
import { appRouteLabel, outputIcon, outputLabel, visibleOutputs } from "@/audio/view";

const OUT_A = "o_AAAAAAAAAAAA";
const OUT_B = "o_BBBBBBBBBBBB";
const ART = "r_DDDDDDDDDDDD";
const out = (o: Partial<AudioState["outputs"][number]> = {}): AudioState["outputs"][number] => ({
  id: OUT_A, name: "Altavoces (HyperX)", nick: null, kind: "speakers", state: "active", isDefault: true, volume: 46, muted: false, hidden: false, ...o,
});
const STATE: AudioState = {
  available: { audio: true, defaultOutput: true, appRouting: true },
  outputs: [out(), out({ id: OUT_B, name: "LG TV", nick: "Tele", kind: "tv", isDefault: false, hidden: true })],
  apps: [{ id: "a_BBBBBBBBBBBB", name: "Spotify", iconKey: null, outputIds: [OUT_A], volume: 60, muted: false, sounding: true, routed: OUT_B }],
  media: { sessions: [], targetId: null, chosen: false },
};
const msg = (type: string, payload: unknown) => ({ v: 1, id: "x", type, payload }) as unknown as ServerMessage;

beforeEach(() => useAudio.setState({ ...initialAudio }));

describe("applyAudio", () => {
  it("audio.snapshot y audio.update reemplazan el estado", () => {
    applyAudio(msg("audio.snapshot", STATE));
    expect(useAudio.getState().audio).toEqual(STATE);
    applyAudio(msg("audio.update", { ...STATE, outputs: [] }));
    expect(useAudio.getState().audio!.outputs).toEqual([]);
  });
  it("media.artData guarda la carátula como data URI; null = sin carátula", () => {
    applyAudio(msg("media.artData", { key: ART, jpeg: "/9j/AAA=" }));
    expect(useAudio.getState().art[ART]).toBe("data:image/jpeg;base64,/9j/AAA=");
    applyAudio(msg("media.artData", { key: "r_EEEEEEEEEEEE", jpeg: null }));
    expect(useAudio.getState().art["r_EEEEEEEEEEEE"]).toBeNull();
  });
  it("guarda como mucho las últimas 10 carátulas", () => {
    for (let i = 0; i < 12; i++) applyAudio(msg("media.artData", { key: `r_${String(i).padStart(12, "0")}`, jpeg: "AA==" }));
    const keys = Object.keys(useAudio.getState().art);
    expect(keys).toHaveLength(10);
    expect(keys).not.toContain("r_000000000000");
    expect(keys).toContain("r_000000000011");
  });
  it("null (olvidó la PC) borra todo, incluso lo mostrado", () => {
    applyAudio(msg("audio.snapshot", STATE));
    useAudio.setState({ showHidden: true });
    applyAudio(null);
    expect(useAudio.getState()).toMatchObject({ audio: null, art: {}, showHidden: false });
  });
  it("un mensaje que no es de audio se ignora", () => {
    applyAudio(msg("pong", {}));
    expect(useAudio.getState().audio).toBeNull();
  });
});

describe("arrastre (D38): el valor local manda mientras se mueve el deslizador", () => {
  it("startDrag / valueFor / endDrag", () => {
    const now = 1000;
    useAudio.getState().drag(`output:${OUT_A}`, 30, now);
    expect(useAudio.getState().valueFor(`output:${OUT_A}`, 46, now + 500)).toBe(30);
    expect(useAudio.getState().valueFor(`output:${OUT_A}`, 46, now + 1501)).toBe(46); // pasó 1,5 s sin tocar: vuelve a mandar la PC
    expect(useAudio.getState().valueFor("app:x", 10, now)).toBe(10);
  });
  it("un update de la PC no pisa el deslizador que se está moviendo", () => {
    useAudio.getState().drag(`output:${OUT_A}`, 30, Date.now());
    applyAudio(msg("audio.update", STATE));
    expect(useAudio.getState().valueFor(`output:${OUT_A}`, 46, Date.now())).toBe(30);
  });
});

describe("createThrottle (D38)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("manda el primero enseguida y después como mucho cada 100 ms, siempre con el último", () => {
    const send = jest.fn();
    const t = createThrottle(send, 100);
    t.push(1);
    t.push(2);
    t.push(3);
    expect(send.mock.calls).toEqual([[1]]);
    jest.advanceTimersByTime(100);
    expect(send.mock.calls).toEqual([[1], [3]]);
    t.push(4);
    jest.advanceTimersByTime(100);
    expect(send.mock.calls.at(-1)).toEqual([4]);
  });
  it("flush manda el último valor pendiente al soltar, y no repite uno ya mandado", () => {
    const send = jest.fn();
    const t = createThrottle(send, 100);
    t.push(10);
    t.push(20);
    t.flush();
    expect(send.mock.calls).toEqual([[10], [20]]);
    t.flush();
    jest.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("cancel descarta lo pendiente", () => {
    const send = jest.fn();
    const t = createThrottle(send, 100);
    t.push(1);
    t.push(2);
    t.cancel();
    jest.advanceTimersByTime(500);
    expect(send.mock.calls).toEqual([[1]]);
  });
});

describe("view", () => {
  it("outputLabel: el apodo manda, si no el nombre de Windows", () => {
    expect(outputLabel(out())).toBe("Altavoces (HyperX)");
    expect(outputLabel(out({ nick: "Parlantes" }))).toBe("Parlantes");
  });
  it("outputIcon por tipo", () => {
    expect(["headphones", "speakers", "tv", "digital", "other"].map((k) => outputIcon(k as never))).toEqual(["headset", "volume-high", "tv", "hardware-chip", "musical-notes"]);
  });
  it("visibleOutputs: las ocultas no salen salvo que se pidan; la predeterminada siempre sale", () => {
    expect(visibleOutputs(STATE, false).map((o) => o.id)).toEqual([OUT_A]);
    expect(visibleOutputs(STATE, true).map((o) => o.id)).toEqual([OUT_A, OUT_B]);
    const hiddenDefault = { ...STATE, outputs: [out({ hidden: true })] };
    expect(visibleOutputs(hiddenDefault, false)).toHaveLength(1);
  });
  it("appRouteLabel: la salida fijada o 'predeterminada'", () => {
    expect(appRouteLabel(STATE.apps[0]!, STATE.outputs)).toEqual({ kind: "fixed", label: "Tele" });
    expect(appRouteLabel({ ...STATE.apps[0]!, routed: null }, STATE.outputs)).toEqual({ kind: "default", label: "Altavoces (HyperX)" });
    expect(appRouteLabel({ ...STATE.apps[0]!, routed: null }, [])).toEqual({ kind: "default", label: "" });
  });
});
