import { act, fireEvent, screen, within } from "@testing-library/react-native";
import AudioTab from "@/app/(tabs)/audio";
import { setAppsBridge } from "@/apps/commands";
import { resetArt } from "@/audio/art";
import { loadAudioDemo } from "@/audio/demo";
import { setAudioDemo } from "@/audio/demoFlag";
import { initialAudio, useAudio } from "@/audio/store";
import { useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { initI18n } from "@/i18n";
import { PC, SNAPSHOT, hasRowAncestor, renderScreen } from "./screenHelpers";

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
jest.mock("@/haptics", () => ({ tap: jest.fn() }));
jest.mock("@/connection", () => ({
  client: { retry: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));

const HP = "o_DemoHeadphon";
const SP = "o_DemoSpeakers";
const TV = "o_DemoTelevisi";
const SPOTIFY = "a_DemoSpotify1";

beforeAll(() => {
  initI18n("es");
  jest.useFakeTimers();
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  mockLandscape = false;
  jest.clearAllMocks();
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  useAudio.setState({ ...initialAudio });
  setAppsBridge(null);
  setAudioDemo(false);
  resetArt();
});

const outputsBox = () => within(screen.getByTestId("outputs"));

describe.each([["vertical", false], ["apaisado", true]] as const)("Audio · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
    loadAudioDemo();
  });

  it("muestra lo que suena, las salidas (con apodo, la predeterminada marcada y la oculta no) y las apps", async () => {
    await renderScreen(<AudioTab />);
    expect(screen.getByRole("header", { name: "Audio" })).toBeTruthy();
    expect(screen.getByText("Nombre del tema")).toBeTruthy();
    expect(outputsBox().getByText("Auriculares")).toBeTruthy();
    expect(outputsBox().getByText("Parlantes")).toBeTruthy();
    expect(outputsBox().getByText("predeterminada")).toBeTruthy();
    expect(outputsBox().queryByText("Realtek Digital Output")).toBeNull(); // oculta
    expect(screen.getByText("Mostrar ocultas (1)")).toBeTruthy();
    expect(within(screen.getByTestId("audio-apps")).getByText("Spotify")).toBeTruthy();
    expect(screen.getByTestId(`sounding-${SPOTIFY}`)).toBeTruthy();
    expect(screen.getByText("Salida: Parlantes (fijada) ▾")).toBeTruthy(); // Discord
    // en apaisado salidas y apps van en dos columnas
    expect(hasRowAncestor(screen.getByTestId("audio-apps"))).toBe(landscape);
  });

  it("la salida desconectada sale en gris con 'no disponible'", async () => {
    await renderScreen(<AudioTab />);
    expect(outputsBox().getByText("Tele")).toBeTruthy();
    expect(outputsBox().getByText("no disponible")).toBeTruthy();
    expect(screen.queryByTestId(`slider-output-${TV}`)).toBeNull();
  });

  it("Mostrar ocultas suma la oculta; Ocultar las ocultas la saca", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId("toggle-hidden"));
    expect(outputsBox().getByText("Realtek Digital Output")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("toggle-hidden"));
    expect(outputsBox().queryByText("Realtek Digital Output")).toBeNull();
  });

  it("el deslizador sube y baja de a 5 con las acciones de accesibilidad (demo: lo aplica local)", async () => {
    await renderScreen(<AudioTab />);
    const slider = screen.getByTestId(`slider-output-${SP}`);
    expect(slider.props.accessibilityValue.now).toBe(40);
    await fireEvent(slider, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    expect(useAudio.getState().audio!.outputs.find((o) => o.id === SP)!.volume).toBe(45);
    await fireEvent(slider, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });
    await fireEvent(slider, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });
    expect(useAudio.getState().audio!.outputs.find((o) => o.id === SP)!.volume).toBe(35);
  });

  it("nunca pasa de 0 ni de 100", async () => {
    await renderScreen(<AudioTab />);
    const slider = screen.getByTestId(`slider-app-a_DemoChrome01`);
    await fireEvent(slider, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    expect(useAudio.getState().audio!.apps.find((a) => a.name === "chrome")!.volume).toBe(100);
  });

  it("silenciar una salida y una app", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByLabelText("Silenciar Parlantes"));
    expect(useAudio.getState().audio!.outputs.find((o) => o.id === SP)!.muted).toBe(true);
    expect(screen.getByLabelText("Activar el sonido de Parlantes")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Silenciar Spotify"));
    expect(useAudio.getState().audio!.apps.find((a) => a.id === SPOTIFY)!.muted).toBe(true);
  });

  it("⋯ abre las acciones; 'Hacer predeterminada' pasa la marca a esa salida y cierra la hoja", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId(`output-menu-${SP}`));
    const sheet = within(screen.getByTestId("output-sheet"));
    expect(sheet.getByText("Altavoces (Realtek High Definition Audio)")).toBeTruthy();
    await fireEvent.press(sheet.getByText("Hacer predeterminada"));
    await act(async () => {});
    expect(useAudio.getState().audio!.outputs.find((o) => o.id === SP)!.isDefault).toBe(true);
    expect(useAudio.getState().audio!.outputs.find((o) => o.id === HP)!.isDefault).toBe(false);
    expect(screen.queryByTestId("output-sheet")).toBeNull();
  });

  it("la predeterminada no se puede ocultar ni volver a elegir", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId(`output-menu-${HP}`));
    const sheet = within(screen.getByTestId("output-sheet"));
    expect(sheet.getByLabelText("Ya es la predeterminada").props.accessibilityState.disabled).toBe(true);
    expect(sheet.getByLabelText("Ocultar en el celu").props.accessibilityState.disabled).toBe(true);
  });

  it("renombrar guarda el apodo; vacío vuelve al nombre de Windows", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId(`output-menu-${SP}`));
    await fireEvent.press(within(screen.getByTestId("output-sheet")).getByText("Renombrar"));
    await fireEvent.changeText(screen.getByTestId("rename-input"), "Living");
    await fireEvent.press(screen.getByLabelText("Guardar"));
    await act(async () => {});
    expect(useAudio.getState().audio!.outputs.find((o) => o.id === SP)!.nick).toBe("Living");
    await fireEvent.press(screen.getByTestId(`output-menu-${SP}`));
    await fireEvent.press(within(screen.getByTestId("output-sheet")).getByText("Renombrar"));
    await fireEvent.changeText(screen.getByTestId("rename-input"), "   ");
    await fireEvent.press(screen.getByLabelText("Guardar"));
    await act(async () => {});
    expect(useAudio.getState().audio!.outputs.find((o) => o.id === SP)!.nick).toBeNull();
  });

  it("ocultar una salida la saca de la lista", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId(`output-menu-${SP}`));
    await fireEvent.press(within(screen.getByTestId("output-sheet")).getByText("Ocultar en el celu"));
    await act(async () => {});
    expect(outputsBox().queryByText("Parlantes")).toBeNull();
    expect(screen.getByText("Mostrar ocultas (2)")).toBeTruthy();
  });

  it("mandar una app a una salida: elegir la salida la fija y 'Seguir a la predeterminada' la suelta", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId(`route-${SPOTIFY}`));
    const sheet = within(screen.getByTestId("route-sheet"));
    expect(sheet.getByText("¿Por dónde suena Spotify?")).toBeTruthy();
    expect(sheet.queryByText("Tele")).toBeNull(); // solo salidas activas
    await fireEvent.press(sheet.getByTestId(`route-opt-${SP}`));
    await act(async () => {});
    expect(useAudio.getState().audio!.apps.find((a) => a.id === SPOTIFY)!.routed).toBe(SP);
    expect(screen.getAllByText("Salida: Parlantes (fijada) ▾")).toHaveLength(2);
    await fireEvent.press(screen.getByTestId(`route-${SPOTIFY}`));
    await fireEvent.press(within(screen.getByTestId("route-sheet")).getByTestId("route-opt-default"));
    await act(async () => {});
    expect(useAudio.getState().audio!.apps.find((a) => a.id === SPOTIFY)!.routed).toBeNull();
  });

  it("sin la función de mandar apps a otra salida (D30), la fila no tiene ▾ ni abre la hoja", async () => {
    useAudio.setState({ audio: { ...useAudio.getState().audio!, available: { audio: true, defaultOutput: true, appRouting: false } } });
    await renderScreen(<AudioTab />);
    expect(screen.queryByTestId(`route-${SPOTIFY}`)).toBeNull();
    expect(screen.getAllByText("Salida: Auriculares")).toHaveLength(2); // Spotify y Chrome siguen a la predeterminada
  });

  it("sin la función de cambiar la predeterminada (D29), la hoja muestra la nota en vez del botón", async () => {
    useAudio.setState({ audio: { ...useAudio.getState().audio!, available: { audio: true, defaultOutput: false, appRouting: true } } });
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId(`output-menu-${SP}`));
    const sheet = within(screen.getByTestId("output-sheet"));
    expect(sheet.queryByText("Hacer predeterminada")).toBeNull();
    expect(sheet.getByText(/no está disponible en esta PC/)).toBeTruthy();
  });

  it("Atrás de Android (onRequestClose) cierra la hoja", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId(`output-menu-${SP}`));
    await fireEvent(screen.getByTestId("output-sheet"), "requestClose");
    expect(screen.queryByTestId("output-sheet")).toBeNull();
  });
});

describe.each([["vertical", false], ["apaisado", true]] as const)("Audio · Ahora suena · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
    loadAudioDemo();
  });

  it("muestra el chip de a qué app van los botones; tocarlo abre la hoja con las apps de media", async () => {
    await renderScreen(<AudioTab />);
    expect(screen.getByText(/⏯ va a: Spotify/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("media-pick"));
    const sheet = within(screen.getByTestId("media-sheet"));
    expect(sheet.getByText("La que elija Windows")).toBeTruthy();
    expect(sheet.getByText("Spotify")).toBeTruthy();
    expect(sheet.getByText("chrome")).toBeTruthy();
  });

  it("elegir una app: la tarjeta pasa a ella y el chip queda resaltado; volver a 'la que elija Windows' lo suelta", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId("media-pick"));
    await fireEvent.press(screen.getByTestId("media-opt-m_DemoChrome01"));
    await act(async () => {});
    const media = useAudio.getState().audio!.media;
    expect(media).toMatchObject({ targetId: "m_DemoChrome01", chosen: true });
    expect(screen.getByText("Título del video de YouTube")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("media-pick"));
    await fireEvent.press(screen.getByTestId("media-opt-auto"));
    await act(async () => {});
    expect(useAudio.getState().audio!.media.chosen).toBe(false);
  });

  it("los botones que la app no acepta salen apagados (Chrome no tiene ⏮ ⏭)", async () => {
    await renderScreen(<AudioTab />);
    await fireEvent.press(screen.getByTestId("media-pick"));
    await fireEvent.press(screen.getByTestId("media-opt-m_DemoChrome01"));
    await act(async () => {});
    expect(screen.getByTestId("media-prev").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("media-next").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("media-playPause").props.accessibilityState.disabled).toBe(false);
  });

  it("sin carátula se ve la inicial de la app; mientras llega, una ruedita", async () => {
    await renderScreen(<AudioTab />);
    expect(screen.getByTestId("media-art-fallback")).toBeTruthy();
    await act(async () => {
      const a = useAudio.getState().audio!;
      useAudio.setState({ audio: { ...a, media: { ...a.media, sessions: a.media.sessions.map((s, i) => (i === 0 ? { ...s, artKey: "r_AAAAAAAAAAAA" } : s)) } } });
    });
    expect(screen.getByTestId("media-art-loading")).toBeTruthy();
    await act(async () => useAudio.setState({ art: { r_AAAAAAAAAAAA: "data:image/jpeg;base64,AA==" } }));
    expect(screen.getByTestId("media-art")).toBeTruthy();
  });

  it("nada sonando: aviso en vez de la tarjeta (no es un error)", async () => {
    useAudio.setState({ audio: { ...useAudio.getState().audio!, media: { sessions: [], targetId: null, chosen: false } } });
    await renderScreen(<AudioTab />);
    expect(screen.getByTestId("now-empty")).toBeTruthy();
    expect(screen.getByText("Nada sonando")).toBeTruthy();
  });
});

describe("Audio · varios reproductores de la misma app", () => {
  beforeEach(() => loadAudioDemo());
  it("Chrome con dos ventanas de media: es una sola app (Windows le da un solo volumen) y la fila dice cuántos reproductores tiene", async () => {
    await act(async () => {
      const a = useAudio.getState().audio!;
      const chrome = a.media.sessions.find((s) => s.id === "m_DemoChrome01")!;
      useAudio.setState({ audio: { ...a, media: { ...a.media, sessions: [...a.media.sessions, { ...chrome, id: "m_DemoChrome02", title: "Señorita", artist: "Duki" }] } } });
    });
    await renderScreen(<AudioTab />);
    expect(within(screen.getByTestId("audio-apps")).getAllByText("chrome")).toHaveLength(1);
    expect(screen.getByText(/2 reproductores: Título del video de YouTube · Señorita/)).toBeTruthy();
  });
  it("con un solo reproductor no agrega nada", async () => {
    await renderScreen(<AudioTab />);
    expect(screen.queryByText(/reproductores:/)).toBeNull();
  });
});

describe("Audio · estados", () => {
  it("cargando (todavía no llegó el estado)", async () => {
    await renderScreen(<AudioTab />);
    expect(screen.getByTestId("audio-loading")).toBeTruthy();
  });
  it("sin conexión: se ve avisando, y no se puede tocar nada", async () => {
    loadAudioDemo();
    useConn.setState({ ...initialState, pc: PC, status: "offline" }, true);
    await renderScreen(<AudioTab />);
    expect(screen.getByText("Sin conexión")).toBeTruthy();
    expect(screen.getByTestId(`output-menu-${SP}`).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId(`slider-output-${SP}`).props.accessibilityState.disabled).toBe(true);
  });
  it("audio caído en la PC: pantalla de 'Audio no disponible'", async () => {
    useAudio.setState({ audio: { available: { audio: false, defaultOutput: false, appRouting: false }, outputs: [], apps: [], media: { sessions: [], targetId: null, chosen: false } } });
    await renderScreen(<AudioTab />);
    expect(screen.getByTestId("audio-off")).toBeTruthy();
    expect(screen.getByText("Audio no disponible")).toBeTruthy();
  });
  it("sin apps con sonido: explica por qué", async () => {
    loadAudioDemo();
    useAudio.setState({ audio: { ...useAudio.getState().audio!, apps: [] } });
    await renderScreen(<AudioTab />);
    expect(screen.getByTestId("apps-empty")).toBeTruthy();
  });
  it("un error de la PC al cambiar el volumen se ve en palabras", async () => {
    useAudio.setState({ audio: JSON.parse(JSON.stringify({ ...require("@/audio/demo").DEMO_AUDIO })) });
    setAppsBridge({ command: jest.fn().mockResolvedValue({ ok: false, reason: "output_unavailable" }) as never, query: jest.fn() });
    await renderScreen(<AudioTab />);
    await fireEvent(screen.getByTestId(`slider-output-${SP}`), "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    await act(async () => {});
    expect(screen.getByText("Esa salida no está conectada ahora.")).toBeTruthy();
  });
});
