import type { WindowInfo } from "@proyecto-e/protocol";
import { DEMO_WINDOWS } from "@/apps/demo";
import { DEMO_AUDIO } from "@/audio/demo";
import { buildPages, isWindowPage, mediaTitleOfWindow, neighborId, selectedPage } from "@/apps/playing";

const win = (id: string, title: string, over: Partial<WindowInfo> = {}): WindowInfo => ({ ...DEMO_WINDOWS[1]!, id, title, ...over });
const audioWith = (titles: string[]) => {
  const a = structuredClone(DEMO_AUDIO);
  const base = a.media.sessions[0]!;
  a.media.sessions = titles.map((title, i) => ({ ...base, id: "m_S" + i, title, app: "chrome" }));
  a.media.targetId = a.media.sessions[0]?.id ?? null;
  return a;
};

describe("mediaTitleOfWindow: el video de una ventana de YouTube", () => {
  it("saca el título del video del de la ventana", () => {
    expect(mediaTitleOfWindow("lofi hip hop radio - YouTube - Google Chrome")).toBe("lofi hip hop radio");
    expect(mediaTitleOfWindow("Tema - YouTube Music - Google Chrome")).toBe("Tema");
    expect(mediaTitleOfWindow("Un video - YouTube and 3 more pages - Personal - Microsoft Edge")).toBe("Un video");
    expect(mediaTitleOfWindow("Video con - guiones - YouTube - Brave")).toBe("Video con - guiones");
  });
  it("lo que no es YouTube, o es la portada sin video, no cuenta", () => {
    expect(mediaTitleOfWindow("Instagram - Google Chrome")).toBeNull();
    expect(mediaTitleOfWindow("YouTube - Google Chrome")).toBeNull();
    expect(mediaTitleOfWindow("proyecto-e — PLAN.md")).toBeNull();
  });
});

describe("buildPages: una por reproducción de Windows y una por ventana de YouTube que Windows no separó", () => {
  it("sin ventanas de YouTube, son las de Windows", () => {
    const p = buildPages(audioWith(["A", "B"]), [win("w1", "Instagram - Google Chrome")]);
    expect(p.list.map((s) => s.id)).toEqual(["m_S0", "m_S1"]);
  });

  it("una reproducción de Windows SIN título no hace pasar por conocida a cualquier ventana de YouTube", () => {
    // Algunas apps informan la sesión con el título vacío: "empieza con vacío" es siempre verdad y tapaba todas las ventanas.
    const p = buildPages(audioWith([""]), [win("w1", "Video dos - YouTube - Google Chrome")]);
    expect(p.list.map((s) => s.title)).toEqual(["", "Video dos"]);
  });

  it("cada ventana de Chrome con YouTube que Windows no informa es su propia página", () => {
    const p = buildPages(audioWith(["Solo uno"]), [win("w1", "Video dos - YouTube - Google Chrome"), win("w2", "Video tres - YouTube - Google Chrome")]);
    expect(p.list.map((s) => s.title)).toEqual(["Solo uno", "Video dos", "Video tres"]);
    expect(isWindowPage(p.list[1]!.id)).toBe(true);
    expect(p.windowOf.get(p.list[2]!.id)!.id).toBe("w2");
    expect(p.list[1]!.controls).toEqual({ prev: false, playPause: true, next: false });
  });

  it("una ventana cuyo video Windows ya informa no se repite", () => {
    const p = buildPages(audioWith(["Video dos"]), [win("w1", "Video dos - YouTube - Google Chrome")]);
    expect(p.list).toHaveLength(1);
  });

  it("dos ventanas con el mismo video cuentan una vez; las minimizadas y las de otras apps no cuentan", () => {
    const p = buildPages(audioWith([]), [
      win("w1", "Mismo - YouTube - Google Chrome"),
      win("w2", "Mismo - YouTube - Google Chrome"),
      win("w3", "Minimizada - YouTube - Google Chrome", { state: "minimized", monitorId: null }),
      win("w4", "Otra - YouTube - Google Chrome", { app: "Code" }),
    ]);
    expect(p.list.map((s) => s.title)).toEqual(["Mismo"]);
  });
});

describe("selectedPage y neighborId", () => {
  const audio = audioWith(["A", "B"]);
  const pages = buildPages(audio, [win("w1", "C - YouTube - Google Chrome")]);

  it("la elegida es la que se tocó en el celu, y si no, la que Windows dice", () => {
    expect(selectedPage(pages, null, audio)!.id).toBe("m_S0");
    expect(selectedPage(pages, "win:w1", audio)!.title).toBe("C");
    expect(selectedPage(pages, "win:ya-no-existe", audio)!.id).toBe("m_S0");
  });

  it("la de al lado, sin dar la vuelta", () => {
    expect(neighborId(pages, "m_S0", 1)).toBe("m_S1");
    expect(neighborId(pages, "m_S1", 1)).toBe("win:w1");
    expect(neighborId(pages, "win:w1", 1)).toBeNull();
    expect(neighborId(pages, "m_S0", -1)).toBeNull();
    expect(neighborId(buildPages(audioWith(["A"]), []), "m_S0", 1)).toBeNull();
  });
});
