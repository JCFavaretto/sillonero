import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { AddLauncherSheet } from "@/components/AddLauncherSheet";
import AppsTab from "@/app/(tabs)/index";
import { setAppsBridge } from "@/apps/commands";
import { loadAppsDemo } from "@/apps/demo";
import { resetIcons } from "@/apps/icons";
import { initialApps, useApps } from "@/apps/store";
import { loadAudioDemo } from "@/audio/demo";
import { useBrowser } from "@/browser/store";
import { setAudioDemo } from "@/audio/demoFlag";
import { initialAudio, useAudio } from "@/audio/store";
import { useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { initI18n } from "@/i18n";
import { loadScreensDemo } from "@/screens/demo";
import { initialScreens, useScreens } from "@/screens/store";
import { PC, SNAPSHOT, hasRowAncestor, renderScreen } from "./screenHelpers";

// Navegadores sin extensión (docs/PLAN.md D87 y D93): ventana de incógnito, link en incógnito y atajos por sitio.

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }) }));
jest.mock("@/haptics", () => ({ tap: jest.fn() }));
jest.mock("@/connection", () => ({
  client: { retry: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));

let mockClipboard = "";
jest.mock("@/clipboard", () => ({ readClipboardText: async () => mockClipboard }));

let calls: [string, unknown][] = [];
/** La PC de mentira: anota cada comando y contesta que salió bien (o lo que diga `fail`). */
const bridge = (fail: Record<string, string> = {}) =>
  setAppsBridge({
    command: (async (type: string, payload: unknown) => {
      calls.push([type, payload]);
      return fail[type] ? { ok: false, reason: fail[type] } : { ok: true };
    }) as never,
    query: () => null,
  });

beforeAll(() => initI18n("es"));
beforeEach(() => {
  mockLandscape = false;
  mockClipboard = "";
  calls = [];
  jest.clearAllMocks();
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  useApps.setState(initialApps, true);
  useScreens.setState(initialScreens, true);
  useAudio.setState({ ...initialAudio });
  setAudioDemo(false);
  setAppsBridge(null);
  resetIcons();
  loadScreensDemo();
  loadAppsDemo();
  loadAudioDemo();
});

const WIN: Record<string, string> = { chrome: "w_2", Discord: "w_3", Code: "w_1", Spotify: "w_4" };
const openCard = async (app: string) => fireEvent.press(screen.getByTestId(`app-card-${WIN[app]}`));
const real = () => {
  useApps.setState({ demo: false });
  bridge();
};

describe.each([["vertical", false], ["apaisado", true]] as const)("Apps · navegador sin extensión · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });

  it("la tarjeta de un navegador ofrece Incógnito y abre una ventana privada de ESE navegador", async () => {
    real();
    await renderScreen(<AppsTab />);
    await openCard("chrome");
    await fireEvent.press(screen.getByLabelText("Abrir una ventana de incógnito de chrome"));
    await act(async () => {});
    expect(calls).toEqual([["window.act", { windowId: "w_2", action: "newPrivate" }]]);
  });

  it("una app que no es navegador no tiene Incógnito ni atajos", async () => {
    await renderScreen(<AppsTab />);
    await openCard("Discord");
    expect(screen.queryByLabelText(/incógnito/i)).toBeNull();
    expect(screen.queryByTestId("app-shortcuts")).toBeNull();
    expect(screen.getByLabelText("Restaurar Discord")).toBeTruthy(); // conserva sus acciones de ventana
  });

  it("con YouTube a la vista hay atajos de YouTube y del navegador, y dicen que traen la ventana al frente", async () => {
    await renderScreen(<AppsTab />);
    await openCard("chrome");
    const rows = within(screen.getByTestId("app-shortcuts"));
    expect(rows.getByText("Atajos: traen la ventana al frente")).toBeTruthy();
    for (const l of ["−10 s", "+10 s", "Completa", "Subtítulos", "Atrás", "Adelante", "Recargar", "Pestaña nueva"]) expect(rows.getByText(l)).toBeTruthy();
  });

  it("sin sonido en la ventana no se ofrece la fila genérica (escribiría a ciegas); con sonido, sí", async () => {
    useApps.setState({ windows: useApps.getState().windows.map((w) => (w.id === "w_2" ? { ...w, title: "Gmail - Google Chrome" } : w)) });
    await renderScreen(<AppsTab />);
    await openCard("chrome");
    expect(within(screen.getByTestId("app-shortcuts")).queryByText("Silencio")).toBeNull();
  });

  it("con otra página a la vista (D101): fila genérica de reproductor y atajos del navegador, sin los de YouTube", async () => {
    {
      const a = useAudio.getState().audio!;
      useAudio.setState({ audio: { ...a, media: { ...a.media, sessions: a.media.sessions.map((m) => (m.app === "chrome" ? { ...m, status: "playing" as const } : m)) } } });
    }
    useApps.setState({ windows: useApps.getState().windows.map((w) => (w.id === "w_2" ? { ...w, title: "Instagram - Google Chrome" } : w)) });
    await renderScreen(<AppsTab />);
    await openCard("chrome");
    const rows = within(screen.getByTestId("app-shortcuts"));
    expect(rows.queryByText("−10 s")).toBeNull();
    expect(rows.getByText("Recargar")).toBeTruthy();
    for (const l of ["Atrás 5 s", "Adelante 5 s", "Silencio", "Completa"]) expect(rows.getByText(l)).toBeTruthy();
  });

  it("un botón del reproductor genérico trae la ventana al frente y manda la tecla de cualquier reproductor", async () => {
    real();
    {
      const a = useAudio.getState().audio!;
      useAudio.setState({ audio: { ...a, media: { ...a.media, sessions: a.media.sessions.map((m) => (m.app === "chrome" ? { ...m, status: "playing" as const } : m)) } } });
    }
    useApps.setState({ windows: useApps.getState().windows.map((w) => (w.id === "w_2" ? { ...w, title: "Instagram - Google Chrome" } : w)) });
    await renderScreen(<AppsTab />);
    await openCard("chrome");
    await fireEvent.press(within(screen.getByTestId("app-shortcuts")).getByText("Silencio"));
    await act(async () => {});
    expect(calls).toEqual([
      ["window.act", { windowId: "w_2", action: "focus" }],
      ["pad.shortcut", { name: "mediaMute" }],
    ]);
  });

  it("un atajo primero trae la ventana al frente y después manda la tecla", async () => {
    real();
    await renderScreen(<AppsTab />);
    await openCard("chrome");
    await fireEvent.press(within(screen.getByTestId("app-shortcuts")).getByText("+10 s"));
    await act(async () => {});
    expect(calls).toEqual([
      ["window.act", { windowId: "w_2", action: "focus" }],
      ["pad.shortcut", { name: "ytForward10" }],
    ]);
  });

  it("si Windows no deja traerla al frente, la tecla NO se manda (caería en otra ventana) y se ve el motivo", async () => {
    useApps.setState({ demo: false });
    bridge({ "window.act": "focus_denied" });
    await renderScreen(<AppsTab />);
    await openCard("chrome");
    await fireEvent.press(within(screen.getByTestId("app-shortcuts")).getByText("Recargar"));
    await act(async () => {});
    expect(calls.map(([t]) => t)).toEqual(["window.act"]);
    expect(screen.getByText(/Windows no dejó traerla al frente/)).toBeTruthy();
  });

  it("si el control remoto está apagado en la PC, el atajo lo dice", async () => {
    useApps.setState({ demo: false });
    bridge({ "pad.shortcut": "input_disabled" });
    await renderScreen(<AppsTab />);
    await openCard("chrome");
    await fireEvent.press(within(screen.getByTestId("app-shortcuts")).getByText("Recargar"));
    await act(async () => {});
    expect(screen.getByTestId("apps-notice")).toBeTruthy();
  });

  // El formulario de link ahora se usa en modo elegir (D104): devuelve el destino y el nombre, no lo guarda en la PC.
  const picked = jest.fn();
  const openLinkTab = async () => {
    picked.mockClear();
    await renderScreen(<AddLauncherSheet onClose={() => undefined} onPick={picked} />);
    const sheet = within(screen.getByTestId("add-launcher-sheet"));
    await fireEvent.press(sheet.getByText("Link"));
    await act(async () => {}); // lee el portapapeles
    return sheet;
  };
  const added = () => ({ target: picked.mock.calls.at(-1)![0], name: picked.mock.calls.at(-1)![1] });

  it("agregar un link: sin elegir nada, se abre como siempre (pestaña) y no viaja el campo `open`", async () => {
    const sheet = await openLinkTab();
    await fireEvent.changeText(sheet.getByLabelText("Dirección"), "twitch.tv");
    expect(sheet.getByLabelText("Pestaña").props.accessibilityState.selected).toBe(true);
    await fireEvent.press(sheet.getByLabelText("Agregar"));
    await act(async () => {});
    expect(added().target).toEqual({ kind: "url", url: "https://twitch.tv" });
  });

  it("agregar un link: ventana nueva o incógnito, a elección", async () => {
    let sheet = await openLinkTab();
    await fireEvent.changeText(sheet.getByLabelText("Dirección"), "twitch.tv");
    await fireEvent.press(sheet.getByLabelText("Ventana"));
    expect(sheet.getByText("En una ventana nueva del navegador.")).toBeTruthy();
    await fireEvent.press(sheet.getByLabelText("Agregar"));
    await act(async () => {});
    expect(added()).toMatchObject({ name: null, target: { kind: "url", url: "https://twitch.tv", open: "window" } });

    await screen.unmount();
    sheet = await openLinkTab();
    await fireEvent.changeText(sheet.getByLabelText("Dirección"), "twitch.tv/directory");
    await fireEvent.press(sheet.getByLabelText("Incógnito"));
    expect(sheet.getByText(/no queda en el historial/)).toBeTruthy();
    await fireEvent.press(sheet.getByLabelText("Agregar"));
    await act(async () => {});
    expect(added()).toMatchObject({ name: "twitch.tv (incógnito)", target: { kind: "url", url: "https://twitch.tv/directory", open: "private" } });
  });

  it("el campo esconde el https:// (también si se pega) pero se guarda completo", async () => {
    const sheet = await openLinkTab();
    await fireEvent.changeText(sheet.getByLabelText("Dirección"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(sheet.getByLabelText("Dirección").props.value).toBe("www.youtube.com/watch?v=dQw4w9WgXcQ");
    await fireEvent.press(sheet.getByLabelText("Agregar"));
    await act(async () => {});
    expect(added().target).toEqual({ kind: "url", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  });

  it("un http:// escrito a propósito se respeta", async () => {
    const sheet = await openLinkTab();
    await fireEvent.changeText(sheet.getByLabelText("Dirección"), "http://192.168.0.5:8096");
    expect(sheet.getByLabelText("Dirección").props.value).toBe("http://192.168.0.5:8096");
    await fireEvent.press(sheet.getByLabelText("Agregar"));
    await act(async () => {});
    expect(added().target).toEqual({ kind: "url", url: "http://192.168.0.5:8096" });
  });

  it("si hay un link en el portapapeles, lo ofrece; al tocarlo llena el campo", async () => {
    mockClipboard = "https://www.twitch.tv/directory";
    const sheet = await openLinkTab();
    expect(sheet.getByText("Tenés un link copiado")).toBeTruthy();
    await fireEvent.press(sheet.getByTestId("clipboard-offer"));
    expect(sheet.getByLabelText("Dirección").props.value).toBe("www.twitch.tv/directory");
    expect(sheet.queryByTestId("clipboard-offer")).toBeNull(); // ya se usó
  });

  it("un texto cualquiera en el portapapeles no se ofrece", async () => {
    mockClipboard = "comprar leche";
    const sheet = await openLinkTab();
    expect(sheet.queryByTestId("clipboard-offer")).toBeNull();
  });

  it("el link ofrecido no estorba si ya se empezó a escribir", async () => {
    mockClipboard = "twitch.tv";
    const sheet = await openLinkTab();
    await fireEvent.changeText(sheet.getByLabelText("Dirección"), "youtube");
    expect(sheet.queryByTestId("clipboard-offer")).toBeNull();
  });
});

describe.each([["vertical", false], ["apaisado", true]] as const)("Apps · tarjeta de reproducción (D95 a D97) · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });
  /** La PC de verdad también para el audio (la demo de audio contesta sola y no manda nada). */
  const realAudio = () => {
    real();
    setAudioDemo(false);
  };

  it("hay dos secciones: lo que reproduce arriba, con su ventana, y el resto en Abiertas", async () => {
    await renderScreen(<AppsTab />);
    expect(screen.getByText("Reproduciendo · 2")).toBeTruthy();
    expect(screen.getByText("Abiertas · 2")).toBeTruthy();
    const playing = within(screen.getByTestId("apps-playing"));
    expect(playing.getByText("Nombre del tema")).toBeTruthy();
    expect(playing.getByText("Título del video de YouTube")).toBeTruthy();
    // Spotify y Chrome reproducen: sus ventanas no se repiten en Abiertas
    const open = within(screen.getByTestId("apps-open"));
    expect(open.queryByTestId("app-card-w_2")).toBeNull();
    expect(open.queryByTestId("app-card-w_4")).toBeNull();
    expect(open.getByTestId("app-card-w_1")).toBeTruthy();
    // en apaisado, Reproduciendo a la izquierda y Abiertas a la derecha
    expect(hasRowAncestor(screen.getByTestId("apps-playing"))).toBe(landscape);
  });

  it("cada tarjeta tiene el volumen de SU app; en un navegador aclara que es el de todas sus ventanas", async () => {
    await renderScreen(<AppsTab />);
    const spotify = within(screen.getByTestId("play-m_DemoSpotify1"));
    expect(spotify.getByLabelText("Volumen de Spotify")).toBeTruthy();
    expect(spotify.queryByText("todo Spotify")).toBeNull();
    const chrome = within(screen.getByTestId("play-m_DemoChrome01"));
    expect(chrome.getByLabelText("Volumen de chrome")).toBeTruthy();
    expect(chrome.getByText("todo chrome")).toBeTruthy();
    // una ventana cuya app no figura en el mezclador no tiene barra
    expect(screen.queryByLabelText("Volumen de Code")).toBeNull();
    expect(screen.getByLabelText("Volumen de Discord")).toBeTruthy();
  });

  it("silenciar desde la tarjeta silencia solo esa app", async () => {
    realAudio();
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByLabelText("Silenciar Spotify"));
    await act(async () => {});
    expect(calls).toEqual([["audio.setMute", { target: { kind: "app", id: "a_DemoSpotify1" }, muted: true }]]);
  });

  it("⏯ de la tarjeta que ya es la elegida manda solo la tecla", async () => {
    realAudio();
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByLabelText("Pausar Spotify"));
    await act(async () => {});
    expect(calls).toEqual([["media.key", { key: "playPause" }]]);
  });

  it("⏯ de otra tarjeta primero elige ESA reproducción y después manda la tecla", async () => {
    realAudio();
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByLabelText("Reproducir chrome"));
    await act(async () => {});
    expect(calls).toEqual([
      ["media.select", { id: "m_DemoChrome01" }],
      ["media.key", { key: "playPause" }],
    ]);
  });

  it("si la PC no deja elegir esa reproducción, la tecla no se manda y se ve el motivo", async () => {
    useApps.setState({ demo: false });
    setAudioDemo(false);
    bridge({ "media.select": "not_found" });
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByLabelText("Reproducir chrome"));
    await act(async () => {});
    expect(calls.map((c) => c[0])).toEqual(["media.select"]);
    expect(screen.getByTestId("apps-notice")).toBeTruthy();
  });

  it("desplegada: Anterior y Siguiente (grises si la app no los acepta), Salida, y debajo las acciones de su ventana", async () => {
    realAudio();
    await renderScreen(<AppsTab />);
    await openCard("Spotify");
    const spotify = within(screen.getByTestId("play-m_DemoSpotify1"));
    await fireEvent.press(spotify.getByLabelText("Tema siguiente de Spotify"));
    await act(async () => {});
    expect(calls).toEqual([["media.key", { key: "next" }]]);
    expect(spotify.getByLabelText("Mandar Spotify a otra salida")).toBeTruthy();
    expect(within(spotify.getByTestId("app-actions")).getByText("Traer")).toBeTruthy();
    // Chrome no acepta ⏮ ⏭
    await openCard("chrome");
    const chrome = within(screen.getByTestId("play-m_DemoChrome01"));
    expect(chrome.getByLabelText("Tema siguiente de chrome").props.accessibilityState.disabled).toBe(true);
    // una sola desplegada a la vez
    expect(spotify.queryByTestId("play-actions")).toBeNull();
  });

  it("una reproducción sin ventana tiene tarjeta igual, sin acciones de ventana", async () => {
    useApps.setState({ windows: useApps.getState().windows.filter((w) => w.app !== "Spotify") });
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByTestId("play-card-m_DemoSpotify1"));
    const spotify = within(screen.getByTestId("play-m_DemoSpotify1"));
    expect(spotify.getByTestId("play-actions")).toBeTruthy();
    expect(spotify.queryByTestId("app-actions")).toBeNull();
  });

  it("sin extensión, una ventana de YouTube que Windows no informó tiene su tarjeta y se pausa con la tecla de YouTube (trae la ventana)", async () => {
    realAudio();
    const base = useApps.getState().windows[1]!;
    useApps.setState({ windows: [...useApps.getState().windows, { ...base, id: "w_9", title: "lofi hip hop radio - YouTube - Google Chrome" }] });
    await renderScreen(<AppsTab />);
    const extra = within(screen.getByTestId("play-win:w_9"));
    expect(extra.getByText("lofi hip hop radio")).toBeTruthy();
    await fireEvent.press(extra.getByTestId("play-toggle-win:w_9"));
    await act(async () => {});
    expect(calls).toEqual([
      ["window.act", { windowId: "w_9", action: "focus" }],
      ["pad.shortcut", { name: "ytPlayPause" }],
    ]);
  });

  it("la barra de reproducción aparece solo si la app dice por dónde va, y avanza sola mientras reproduce", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-11-14T22:00:00Z"));
      const a = useAudio.getState().audio!;
      const sessions = a.media.sessions.map((m) => (m.id === "m_DemoSpotify1" ? { ...m, timeline: { positionMs: 60_000, durationMs: 243_000, rate: 1 } } : m));
      useAudio.setState({ audio: { ...a, media: { ...a.media, sessions } }, audioAt: Date.now() });
      await renderScreen(<AppsTab />);
      const bar = () => screen.getByTestId("progress-m_DemoSpotify1");
      expect(bar().props.accessibilityLabel).toBe("Va por 1:00 de 4:03");
      expect(within(bar()).getByText("−3:03", { includeHiddenElements: true })).toBeTruthy();
      // Chrome (en pausa y sin datos) no tiene barra
      expect(screen.queryByTestId("progress-m_DemoChrome01")).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      expect(bar().props.accessibilityLabel).toBe("Va por 1:05 de 4:03");
    } finally {
      jest.useRealTimers();
    }
  });

  it("en pausa la barra queda quieta", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-11-14T22:00:00Z"));
      const a = useAudio.getState().audio!;
      const sessions = a.media.sessions.map((m) => (m.id === "m_DemoSpotify1" ? { ...m, status: "paused" as const, timeline: { positionMs: 60_000, durationMs: 243_000, rate: 1 } } : m));
      useAudio.setState({ audio: { ...a, media: { ...a.media, sessions } }, audioAt: Date.now() });
      await renderScreen(<AppsTab />);
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(screen.getByTestId("progress-m_DemoSpotify1").props.accessibilityLabel).toBe("Va por 1:00 de 4:03");
    } finally {
      jest.useRealTimers();
    }
  });

  it("las tarjetas no se cruzan cuando una se pausa y la PC las manda en otro orden", async () => {
    await renderScreen(<AppsTab />);
    const order = () => screen.getAllByTestId(/^play-m_/).map((n) => n.props.testID);
    expect(order()).toEqual(["play-m_DemoSpotify1", "play-m_DemoChrome01"]);
    const a = useAudio.getState().audio!;
    const [spotify, chrome] = a.media.sessions;
    await act(async () => useAudio.setState({ audio: { ...a, media: { ...a.media, sessions: [{ ...chrome!, status: "playing" }, { ...spotify!, status: "paused" }] } } }));
    expect(order()).toEqual(["play-m_DemoSpotify1", "play-m_DemoChrome01"]);
  });

  it("arriba queda el volumen general, con silenciar y cambiar de salida, como en el Inicio de antes", async () => {
    await renderScreen(<AppsTab />);
    const bar = within(screen.getByTestId("output-bar"));
    expect(bar.getByTestId("card-change-output")).toBeTruthy();
    await fireEvent.press(bar.getByTestId("card-change-output"));
    expect(screen.getByTestId("output-pick-sheet")).toBeTruthy();
  });

  it("con el audio de la PC caído: aviso, sin volumen general ni sección Reproduciendo; las ventanas siguen", async () => {
    const a = useAudio.getState().audio!;
    useAudio.setState({ audio: { ...a, available: { audio: false, defaultOutput: false, appRouting: false } } });
    await renderScreen(<AppsTab />);
    expect(screen.getByTestId("apps-audio-off")).toBeTruthy();
    expect(screen.queryByTestId("output-bar")).toBeNull();
    expect(screen.queryByTestId("apps-playing")).toBeNull();
    expect(screen.getByText("Abiertas · 4")).toBeTruthy();
  });

  it("sin conexión: las tarjetas de reproducción no se despliegan ni responden", async () => {
    realAudio();
    useConn.setState({ status: "offline" });
    await renderScreen(<AppsTab />);
    await openCard("Spotify");
    expect(screen.queryByTestId("play-actions")).toBeNull();
    await fireEvent.press(screen.getByTestId("play-toggle-m_DemoSpotify1"));
    await act(async () => {});
    expect(calls).toEqual([]);
  });
});

// F2 (D99, boceto rediseño 03): con la extensión, la ventana de un navegador con un reproductor es una tarjeta de Reproduciendo
// con los controles DEL VIDEO, en cualquier sitio, sin traer la ventana al frente.
describe.each([["vertical", false], ["apaisado", true]] as const)("Apps · reproductor web (D99) · %s", (_n, landscape) => {
  const media = { paused: false, positionMs: 60_000, durationMs: 243_000, rate: 1, muted: false, volume: 80, canSeek: true };
  const webTab = (over: Record<string, unknown> = {}) => ({ id: 7, windowId: 1, title: "YouTube — Age of Empires", host: "twitch.tv", active: true, audible: true, pinned: false, media, ...over });
  const withTab = (over: Record<string, unknown> = {}, at = Date.now()) => {
    useBrowser.setState({ browser: { connected: true, browser: "chrome", tabs: [webTab(over)] } as never, browserAt: at, demo: false });
  };
  beforeEach(() => {
    mockLandscape = landscape;
    // sin reproducciones de Windows: solo manda la extensión
    useAudio.setState({ audio: { ...useAudio.getState().audio!, media: { sessions: [], targetId: null, chosen: false } } });
    real();
    setAudioDemo(false);
  });
  const card = () => within(screen.getByTestId("play-tab:7"));
  const open = async () => fireEvent.press(screen.getByTestId("app-card-w_2"));

  it("la ventana del navegador está en Reproduciendo con la barra del video y el volumen de ESE video (no el de todo Chrome)", async () => {
    withTab();
    await renderScreen(<AppsTab />);
    expect(screen.getByText("Reproduciendo · 1")).toBeTruthy();
    expect(card().getByTestId("progress-tab:7")).toBeTruthy();
    expect(card().getByLabelText("Volumen de este video")).toBeTruthy();
    expect(card().queryByText("todo chrome")).toBeNull();
  });

  it("⏯ pausa el VIDEO por la extensión: sin traer la ventana al frente ni mandar teclas", async () => {
    withTab();
    await renderScreen(<AppsTab />);
    await fireEvent.press(card().getByLabelText("Pausar chrome"));
    await act(async () => {});
    expect(calls).toEqual([["browser.act", { op: "media.playPause", tabId: 7 }]]);
  });

  it("desplegada: −10 s y +10 s saltan en el video", async () => {
    withTab();
    await renderScreen(<AppsTab />);
    await open();
    await fireEvent.press(card().getByLabelText("10 segundos atrás en chrome"));
    await fireEvent.press(card().getByLabelText("10 segundos adelante en chrome"));
    await act(async () => {});
    expect(calls).toEqual([
      ["browser.act", { op: "media.seekBy", tabId: 7, seconds: -10 }],
      ["browser.act", { op: "media.seekBy", tabId: 7, seconds: 10 }],
    ]);
  });

  it("la velocidad abre una fila con siete valores; elegir uno la manda y la cierra", async () => {
    withTab({ media: { ...media, rate: 1.5 } });
    await renderScreen(<AppsTab />);
    await open();
    expect(card().getByLabelText("Velocidad, ahora 1,5×")).toBeTruthy();
    await fireEvent.press(card().getByLabelText("Velocidad, ahora 1,5×"));
    for (const v of ["0,5", "0,75", "1", "1,25", "1,5", "1,75", "2"]) expect(card().getByLabelText(`Velocidad ${v}×`)).toBeTruthy();
    await fireEvent.press(card().getByLabelText("Velocidad 2×"));
    await act(async () => {});
    expect(calls).toEqual([["browser.act", { op: "media.rate", tabId: 7, rate: 2 }]]);
    expect(card().queryByLabelText("Velocidad 0,5×")).toBeNull();
  });

  it("silenciar el video y la barra de volumen mandan sus órdenes", async () => {
    withTab();
    await renderScreen(<AppsTab />);
    await fireEvent.press(card().getByLabelText("Silenciar este video"));
    await act(async () => {});
    expect(calls).toEqual([["browser.act", { op: "media.mute", tabId: 7, muted: true }]]);
  });

  it("un vivo: sin barra, sin ±10 s ni velocidad; sí pausar y silenciar", async () => {
    withTab({ media: { ...media, durationMs: null, canSeek: false } });
    await renderScreen(<AppsTab />);
    await open();
    expect(screen.queryByTestId("progress-tab:7")).toBeNull();
    expect(card().queryByLabelText("10 segundos atrás en chrome")).toBeNull();
    expect(card().queryByLabelText(/^Velocidad/)).toBeNull();
    expect(card().getByLabelText("Pausar chrome")).toBeTruthy();
    expect(card().getByTestId("web-note")).toBeTruthy();
  });

  it("pantalla completa manda la tecla F y por eso trae la ventana al frente (D101); lo dice antes de tocar", async () => {
    withTab();
    await renderScreen(<AppsTab />);
    await open();
    expect(card().getByText("Completa trae la ventana al frente.")).toBeTruthy();
    await fireEvent.press(card().getByLabelText("Pantalla completa en chrome"));
    await act(async () => {});
    expect(calls).toEqual([
      ["window.act", { windowId: "w_2", action: "focus" }],
      ["pad.shortcut", { name: "ytFullscreen" }],
    ]);
  });

  it("la barra de reproducción avanza sola desde que llegó el estado", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-11-17T12:00:00Z"));
      withTab({}, Date.now());
      await renderScreen(<AppsTab />);
      expect(screen.getByTestId("progress-tab:7").props.accessibilityLabel).toBe("Va por 1:00 de 4:03");
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      expect(screen.getByTestId("progress-tab:7").props.accessibilityLabel).toBe("Va por 1:05 de 4:03");
    } finally {
      jest.useRealTimers();
    }
  });

  it("si la extensión rechaza la orden, se ve el motivo", async () => {
    useApps.setState({ demo: false });
    bridge({ "browser.act": "failed" });
    withTab();
    await renderScreen(<AppsTab />);
    await fireEvent.press(card().getByLabelText("Pausar chrome"));
    await act(async () => {});
    expect(screen.getByTestId("apps-notice")).toBeTruthy();
  });

  it("sin extensión conectada la ventana vuelve a ser una tarjeta común", async () => {
    useBrowser.setState({ browser: { connected: false, browser: null, tabs: [] }, browserAt: Date.now(), demo: false });
    await renderScreen(<AppsTab />);
    expect(screen.queryByTestId("play-tab:7")).toBeNull();
    expect(screen.getByTestId("app-card-w_2")).toBeTruthy();
  });
});
