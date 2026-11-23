import { setAppsBridge } from "@/apps/commands";
import { flushArt, forgetUnresolvedArt, requestArt, resetArt } from "@/audio/art";
import { initialAudio, useAudio } from "@/audio/store";

const K = (n: number) => `r_${String(n).padStart(12, "0")}`;
const query = jest.fn<string | null, [string, Record<string, unknown>]>();

beforeEach(() => {
  jest.useFakeTimers();
  query.mockReset().mockReturnValue("id");
  setAppsBridge({ command: jest.fn() as never, query });
  useAudio.setState({ ...initialAudio });
  resetArt();
});
afterEach(() => jest.useRealTimers());

describe("carátulas · reintentos (revisión R3 y C6)", () => {
  it("un pedido que no llegó en 5 s se puede volver a hacer (límite de ritmo, conexión cortada)", () => {
    requestArt(K(0));
    flushArt();
    requestArt(K(0));
    flushArt();
    expect(query).toHaveBeenCalledTimes(1); // todavía en vuelo
    jest.advanceTimersByTime(5_001);
    requestArt(K(0));
    flushArt();
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("una carátula desalojada de la memoria (las últimas 10) se vuelve a pedir, no queda en '…'", () => {
    requestArt(K(0));
    flushArt();
    useAudio.setState({ art: { [K(0)]: "data:image/jpeg;base64,AA==" } });
    useAudio.setState({ art: {} }); // la desalojó el límite de 10
    jest.advanceTimersByTime(5_001);
    requestArt(K(0));
    flushArt();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("carátulas (D34)", () => {
  it("junta los pedidos de 150 ms y los manda de a 3", () => {
    for (let i = 0; i < 7; i++) requestArt(K(i));
    expect(query).not.toHaveBeenCalled();
    jest.advanceTimersByTime(150);
    expect(query.mock.calls.map((c) => c[0])).toEqual(["media.art", "media.art", "media.art"]);
    expect(query.mock.calls.map((c) => (c[1].keys as string[]).length)).toEqual([3, 3, 1]);
  });
  it("no pide dos veces la misma, ni una que ya llegó (ni una que llegó como 'sin carátula')", () => {
    useAudio.setState({ art: { [K(1)]: "data:image/jpeg;base64,AA==", [K(2)]: null } });
    requestArt(K(0));
    requestArt(K(0));
    requestArt(K(1));
    requestArt(K(2));
    flushArt();
    expect(query.mock.calls).toEqual([["media.art", { keys: [K(0)] }]]);
  });
  it("sin conexión se vuelve a intentar cuando alguien la pide de nuevo", () => {
    query.mockReturnValueOnce(null);
    requestArt(K(0));
    flushArt();
    requestArt(K(0));
    flushArt();
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("forgetUnresolvedArt: al reconectar, lo que no llegó se pide otra vez", () => {
    requestArt(K(0));
    flushArt();
    forgetUnresolvedArt();
    requestArt(K(0));
    flushArt();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
