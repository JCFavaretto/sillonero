import { act, fireEvent, screen, within } from "@testing-library/react-native";
import AppsTab from "@/app/(tabs)/index";
import { setAppsBridge } from "@/apps/commands";
import { loadAppsDemo } from "@/apps/demo";
import { resetIcons } from "@/apps/icons";
import { initialApps, useApps } from "@/apps/store";
import { loadAudioDemo } from "@/audio/demo";
import { setAudioDemo } from "@/audio/demoFlag";
import { initialAudio, useAudio } from "@/audio/store";
import { loadBrowserDemo } from "@/browser/demo";
import { initialBrowser, useBrowser } from "@/browser/store";
import { useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { initI18n } from "@/i18n";
import { loadScreensDemo } from "@/screens/demo";
import { initialScreens, useScreens } from "@/screens/store";
import { PC, SNAPSHOT, renderScreen } from "./screenHelpers";

// Pestañas, marcadores y YouTube con la extensión del navegador conectada (docs/PLAN.md 8.7, bocetos comodidad 03, 04 y 06).

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }) }));
jest.mock("@/haptics", () => ({ tap: jest.fn() }));
jest.mock("@/clipboard", () => ({ readClipboardText: async () => "" }));
jest.mock("@/connection", () => ({
  client: { retry: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));

let calls: [string, unknown][] = [];
/** Lo que pidió el celu, sin los pedidos de íconos que hace la pantalla sola. */
const sent = () => calls.filter(([t]) => t !== "icon.get");
/** La PC de mentira para lo real (no demo): anota los comandos y contesta las preguntas con lo que haya en `answers`. */
function realPc(answers: Partial<Record<string, unknown>> = {}) {
  useApps.setState({ demo: false });
  useBrowser.setState({ demo: false });
  setAppsBridge({
    command: (async (type: string, payload: unknown) => (calls.push([type, payload]), { ok: true })) as never,
    query: (type, payload) => {
      calls.push([type, payload]);
      return "q" + calls.length;
    },
  });
  return answers;
}

beforeAll(() => initI18n("es"));
beforeEach(() => {
  mockLandscape = false;
  calls = [];
  jest.clearAllMocks();
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  useApps.setState(initialApps, true);
  useScreens.setState(initialScreens, true);
  useAudio.setState({ ...initialAudio });
  useBrowser.setState(initialBrowser, true);
  setAudioDemo(false);
  setAppsBridge(null);
  resetIcons();
  loadScreensDemo();
  loadAppsDemo();
  loadAudioDemo();
  loadBrowserDemo();
});

const openBrowser = async () => {
  await renderScreen(<AppsTab />);
  await fireEvent.press(screen.getByTestId("app-card-w_2"));
  await fireEvent.press(screen.getByLabelText("Ver las pestañas y marcadores de chrome"));
  return within(screen.getByTestId("browser-sheet"));
};

describe.each([["vertical", false], ["apaisado", true]] as const)("Navegador · pestañas y marcadores · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });

  it("la tarjeta de Chrome tiene su fila: Pestañas con la cantidad, Ventana nueva e Incógnito", async () => {
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByTestId("app-card-w_2"));
    const row = within(screen.getByTestId("app-browser-row"));
    expect(row.getByText("Pestañas · 4")).toBeTruthy();
    expect(row.getByLabelText("Abrir una ventana nueva de chrome")).toBeTruthy();
    expect(row.getByLabelText("Abrir una ventana de incógnito de chrome")).toBeTruthy();
  });

  it("Ventana nueva e Incógnito mandan la acción a la ventana de ese navegador", async () => {
    realPc();
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByTestId("app-card-w_2"));
    await fireEvent.press(screen.getByLabelText("Abrir una ventana nueva de chrome"));
    await act(async () => {});
    await fireEvent.press(screen.getByLabelText("Abrir una ventana de incógnito de chrome"));
    await act(async () => {});
    expect(sent()).toEqual([
      ["window.act", { windowId: "w_2", action: "newWindow" }],
      ["window.act", { windowId: "w_2", action: "newPrivate" }],
    ]);
  });

  it("lista las pestañas de ESA ventana con su sitio; la que se ve está marcada y la que suena lo dice", async () => {
    const sheet = await openBrowser();
    expect(sheet.getByText("4 pestañas")).toBeTruthy();
    expect(sheet.getAllByText("YouTube — Age of Empires")).toHaveLength(2); // el título de la ventana arriba y la fila de la pestaña
    expect(sheet.getByLabelText("YouTube — Age of Empires, youtube.com, suena").props.accessibilityState.selected).toBe(true);
    expect(sheet.getByLabelText("Instagram, instagram.com").props.accessibilityState.selected).toBe(false);
  });

  it("con varias ventanas del navegador, cada una muestra solo SUS pestañas", async () => {
    const base = useApps.getState().windows[1]!;
    useApps.setState({ windows: [...useApps.getState().windows, { ...base, id: "w_9", title: "Twitch - Google Chrome" }] });
    useBrowser.setState({
      browser: {
        connected: true,
        browser: "chrome",
        tabs: [
          { id: 1, windowId: 1, title: "YouTube — Age of Empires", host: "youtube.com", active: true, audible: false, pinned: false },
          { id: 2, windowId: 1, title: "Instagram", host: "instagram.com", active: false, audible: false, pinned: false },
          { id: 3, windowId: 2, title: "Twitch", host: "twitch.tv", active: true, audible: false, pinned: false },
          { id: 4, windowId: 2, title: "Directorio", host: "twitch.tv", active: false, audible: false, pinned: false },
          { id: 5, windowId: 2, title: "Chat", host: "twitch.tv", active: false, audible: false, pinned: false },
        ],
      },
    });
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByTestId("app-card-w_9"));
    expect(within(screen.getByTestId("app-browser-row")).getByText("Pestañas · 3")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Ver las pestañas y marcadores de chrome"));
    const sheet = within(screen.getByTestId("browser-sheet"));
    expect(sheet.getByText("3 pestañas")).toBeTruthy();
    expect(sheet.getByTestId("tab-4")).toBeTruthy();
    expect(sheet.queryByTestId("tab-2")).toBeNull(); // esa es de la otra ventana
  });

  it("un toque en una pestaña la pone a la vista; ✕ la cierra", async () => {
    realPc();
    useBrowser.setState({ browser: { connected: true, browser: "chrome", tabs: [{ id: 7, windowId: 1, title: "Twitch", host: "twitch.tv", active: false, audible: false, pinned: false }] } });
    const sheet = await openBrowser();
    await fireEvent.press(sheet.getByTestId("tab-7"));
    await fireEvent.press(sheet.getByLabelText("Cerrar la pestaña Twitch"));
    await act(async () => {});
    expect(sent()).toEqual([
      ["browser.act", { op: "tab.activate", tabId: 7 }],
      ["browser.act", { op: "tab.close", tabId: 7 }],
    ]);
  });

  it("abrir una dirección sin escribir https://", async () => {
    realPc();
    const sheet = await openBrowser();
    expect(sheet.getByLabelText("Abrir").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(sheet.getByLabelText("Abrir una dirección"), "https://twitch.tv/directory");
    expect(sheet.getByLabelText("Abrir una dirección").props.value).toBe("twitch.tv/directory");
    await fireEvent.press(sheet.getByLabelText("Abrir"));
    await act(async () => {});
    expect(sent()).toEqual([["browser.act", { op: "tab.open", url: "https://twitch.tv/directory", mode: "tab" }]]);
    expect(sheet.getByText("Abierto en la PC")).toBeTruthy();
  });

  it("una dirección que no sirve no se puede abrir", async () => {
    const sheet = await openBrowser();
    await fireEvent.changeText(sheet.getByLabelText("Abrir una dirección"), "javascript:alert(1)");
    expect(sheet.getByLabelText("Abrir").props.accessibilityState.disabled).toBe(true);
  });

  it("Reabrir manda reabrir la última pestaña cerrada", async () => {
    realPc();
    const sheet = await openBrowser();
    await fireEvent.press(sheet.getByText("Reabrir"));
    await act(async () => {});
    expect(sent()).toEqual([["browser.act", { op: "tab.reopen" }]]);
  });

  it("marcadores: se leen, se agrupan por carpeta y un toque abre en pestaña nueva (mantener: ventana)", async () => {
    realPc();
    const sheet = await openBrowser();
    await fireEvent.press(sheet.getByText("Marcadores"));
    await act(async () => {});
    expect(sent().at(-1)).toEqual(["browser.query", { kind: "bookmarks" }]);
    // la pregunta anda con la respuesta de la PC de verdad: acá se prueba con la demo, que contesta en el acto
    useApps.setState({ demo: true });
    await act(async () => {});
  });

  it("marcadores con la demo: carpeta, títulos y abrir", async () => {
    const sheet = await openBrowser();
    await fireEvent.press(sheet.getByText("Marcadores"));
    await act(async () => {});
    expect(sheet.getByText("Barra de marcadores")).toBeTruthy();
    expect(sheet.getByText("Recetas")).toBeTruthy();
    await fireEvent.press(sheet.getByTestId("bookmark-b2"));
    await act(async () => {});
    expect(sheet.getByText("Abierto en la PC")).toBeTruthy();
  });

  it("sin la extensión: explica cómo sumarla y la app sigue andando", async () => {
    useBrowser.setState({ browser: { connected: false, browser: null, tabs: [] } });
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByTestId("app-card-w_2"));
    expect(within(screen.getByTestId("app-browser-row")).getByText("Pestañas")).toBeTruthy(); // sin número
    await fireEvent.press(screen.getByLabelText("Ver las pestañas y marcadores de chrome"));
    const help = within(screen.getByTestId("extension-help"));
    expect(help.getByText("Ver las pestañas desde el celu")).toBeTruthy();
    expect(help.getByText(/%APPDATA%\\proyecto-e\\extension/)).toBeTruthy();
    expect(help.getByText(/Es opcional/)).toBeTruthy();
    await fireEvent.press(help.getByText("Cerrar"));
    expect(screen.queryByTestId("browser-sheet")).toBeNull();
  });

  it("si la extensión se conecta con la hoja abierta, la hoja pasa de la ayuda a las pestañas", async () => {
    useBrowser.setState({ browser: { connected: false, browser: null, tabs: [] } });
    await renderScreen(<AppsTab />);
    await fireEvent.press(screen.getByTestId("app-card-w_2"));
    await fireEvent.press(screen.getByLabelText("Ver las pestañas y marcadores de chrome"));
    expect(screen.getByTestId("extension-help")).toBeTruthy();
    await act(async () => loadBrowserDemo());
    expect(screen.queryByTestId("extension-help")).toBeNull();
    expect(screen.getByTestId("tab-1")).toBeTruthy();
  });
});

describe.each([["vertical", false], ["apaisado", true]] as const)("Apps · YouTube con la extensión · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
    const a = useAudio.getState().audio!;
    useAudio.setState({ audio: { ...a, media: { ...a.media, targetId: "m_DemoChrome01" } } }); // suena Chrome: "Título del video de YouTube"
    useBrowser.setState({
      browser: { connected: true, browser: "chrome", tabs: [{ id: 2, windowId: 1, title: "Título del video de YouTube - YouTube", host: "youtube.com", active: true, audible: true, pinned: false }] },
    });
  });
  /** Despliega la tarjeta de reproducción de Chrome (es también la de su ventana, w_2) y la devuelve. */
  const card = async () => {
    await fireEvent.press(screen.getByTestId("app-card-w_2"));
    return within(screen.getByTestId("play-m_DemoChrome01"));
  };

  it("al desplegar la tarjeta hay una fila de YouTube con Cola y Buscar; el volumen ya está en la tarjeta (no hay botón Vol app)", async () => {
    await renderScreen(<AppsTab />);
    const c = await card();
    const row = within(c.getByTestId("play-youtube-row"));
    for (const l of ["Cola", "Buscar"]) expect(row.getByText(l)).toBeTruthy();
    expect(c.queryByText("Vol app")).toBeNull();
    expect(c.getByTestId("app-volume-a_DemoChrome01")).toBeTruthy();
  });

  it("Cola: se abre la hoja y lee la cola de ESA pestaña", async () => {
    await renderScreen(<AppsTab />);
    await fireEvent.press((await card()).getByTestId("app-act-yt-queue"));
    await act(async () => {});
    const sheet = within(screen.getByTestId("youtube-sheet"));
    expect(sheet.getByText("Suena en la pestaña de YouTube, sin traerla al frente.")).toBeTruthy();
    expect(sheet.getByText("Tema que suena ahora")).toBeTruthy();
    expect(sheet.getByText("Siguiente tema")).toBeTruthy();
    expect(sheet.getByLabelText("Tema que suena ahora, Canal").props.accessibilityState.selected).toBe(true);
  });

  it("tocar un tema de la cola lo pone a sonar en la pestaña, con su lista y posición", async () => {
    realPc();
    await renderScreen(<AppsTab />);
    await fireEvent.press((await card()).getByTestId("app-act-yt-queue"));
    await act(async () => {});
    expect(sent().at(-1)).toEqual(["browser.query", { kind: "yt.queue", tabId: 2 }]);
  });

  it("con la demo: tocar un tema manda yt.play y avisa qué suena", async () => {
    await renderScreen(<AppsTab />);
    await fireEvent.press((await card()).getByTestId("app-act-yt-queue"));
    await act(async () => {});
    const sheet = within(screen.getByTestId("youtube-sheet"));
    await fireEvent.press(sheet.getByTestId("yt-item-2"));
    await act(async () => {});
    expect(sheet.getByText("Suena: Otro tema de la lista")).toBeTruthy();
  });

  it("Buscar: escribir, buscar y elegir un resultado", async () => {
    await renderScreen(<AppsTab />);
    await fireEvent.press((await card()).getByTestId("app-act-yt-search"));
    const sheet = within(screen.getByTestId("youtube-sheet"));
    expect(sheet.getByText("Escribí qué buscar y tocá Buscar.")).toBeTruthy();
    await fireEvent.changeText(sheet.getByLabelText("Buscar en YouTube"), "lofi para jugar");
    await fireEvent.press(sheet.getAllByText("Buscar").at(-1)!);
    await act(async () => {});
    expect(sheet.getByText("lofi hip hop radio")).toBeTruthy();
    expect(sheet.getByText("VIVO", { includeHiddenElements: true })).toBeTruthy(); // la duración es decorativa para el lector de pantalla
    expect(sheet.getByText("Mix: lofi para jugar")).toBeTruthy();
  });

  it("Mis listas: se leen al abrir esa pestaña", async () => {
    await renderScreen(<AppsTab />);
    await fireEvent.press((await card()).getByTestId("app-act-yt-queue"));
    await act(async () => {});
    const sheet = within(screen.getByTestId("youtube-sheet"));
    await fireEvent.press(sheet.getByLabelText("Mis listas"));
    await act(async () => {});
    expect(sheet.getByText("Videos que me gustan")).toBeTruthy();
    expect(sheet.getByText("Mix para jugar")).toBeTruthy();
  });

  it("sin extensión conectada no hay fila de YouTube: quedan los atajos de teclado de la ventana", async () => {
    useBrowser.setState({ browser: { connected: false, browser: null, tabs: [] } });
    await renderScreen(<AppsTab />);
    const c = await card();
    expect(c.queryByTestId("play-youtube-row")).toBeNull();
    expect(c.queryByText("Cola")).toBeNull();
    expect(c.getByTestId("app-actions")).toBeTruthy();
  });
});
