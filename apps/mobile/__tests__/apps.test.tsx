import { act, fireEvent, screen, within } from "@testing-library/react-native";
import AppsTab from "@/app/(tabs)/index";
import { setAppsBridge } from "@/apps/commands";
import { loadAppsDemo } from "@/apps/demo";
import { resetIcons } from "@/apps/icons";
import { initialApps, useApps } from "@/apps/store";
import { client, useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { initI18n } from "@/i18n";
import { loadScreensDemo } from "@/screens/demo";
import { initialScreens, useScreens } from "@/screens/store";
import { PC, SNAPSHOT, hasRowAncestor, renderScreen } from "./screenHelpers";

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, navigate: mockNavigate, back: jest.fn() }) }));
jest.mock("@/haptics", () => ({ tap: jest.fn() }));
jest.mock("@/connection", () => ({
  client: { retry: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));

const WIN: Record<string, string> = { chrome: "w_2", Discord: "w_3", Code: "w_1", Spotify: "w_4" }; // las tarjetas son por ventana

beforeAll(() => {
  initI18n("es");
  jest.useFakeTimers();
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  mockLandscape = false;
  jest.clearAllMocks();
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  useApps.setState(initialApps, true);
  useScreens.setState(initialScreens, true);
  setAppsBridge(null);
  resetIcons();
  loadScreensDemo();
  loadAppsDemo();
});

// Apps en tarjetas desplegables (boceto comodidad 05): una tarjeta por app, acciones rápidas al desplegar y "Todo".
describe.each([["vertical", false], ["apaisado", true]] as const)("Apps · Abiertas · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });
  const open = async (app: string) => fireEvent.press(screen.getByTestId(`app-card-${WIN[app]}`));

  it("una tarjeta por ventana con los datos en íconos: pantalla, minimizada y cuál está al frente", async () => {
    await renderScreen(<AppsTab />);
    expect(screen.getByRole("header", { name: "Apps" })).toBeTruthy();
    expect(screen.getByText("Abiertas · 4")).toBeTruthy();
    expect(screen.getByLabelText("proyecto-e — PLAN.md, Code, en la pantalla 2, al frente")).toBeTruthy();
    expect(screen.getByLabelText("YouTube — Age of Empires, chrome, en la pantalla 1")).toBeTruthy();
    expect(screen.getByLabelText("Spotify Premium, Spotify, minimizada")).toBeTruthy();
    // todas plegadas: no hay acciones a la vista
    expect(screen.queryByTestId("app-actions")).toBeNull();
    // en apaisado las tarjetas van en dos columnas
    expect(hasRowAncestor(screen.getByTestId("app-card-w_1"))).toBe(landscape);
  });

  it("los lanzadores ya no están en Apps (pasaron a Escenas, D98)", async () => {
    await renderScreen(<AppsTab />);
    expect(screen.queryByText("Abrir")).toBeNull();
    expect(screen.queryByTestId("launcher-l_DemoDiscord")).toBeNull();
    expect(screen.queryByTestId("add-launcher")).toBeNull();
  });

  it("arriba está la tira de estado de la PC; tocarla abre Ajustes (D94)", async () => {
    await renderScreen(<AppsTab />);
    expect(screen.getByText("PC-DE-JAY")).toBeTruthy();
    expect(screen.getByText("CPU 23 % · RAM 61 %")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("PC-DE-JAY, Ajustes"));
    expect(mockPush).toHaveBeenCalledWith("/settings");
  });

  it("cada ventana es su propia tarjeta con el título de su pestaña: Chrome con varias ventanas aparece varias veces", async () => {
    const base = useApps.getState().windows[1]!;
    useApps.setState({ windows: [...useApps.getState().windows, { ...base, id: "w_9", title: "Instagram" }, { ...base, id: "w_10", title: "Twitch" }] });
    await renderScreen(<AppsTab />);
    expect(screen.getByText("Abiertas · 6")).toBeTruthy();
    expect(screen.getByTestId("app-card-w_2")).toBeTruthy();
    expect(screen.getByTestId("app-card-w_9")).toBeTruthy();
    expect(screen.getByText("Instagram")).toBeTruthy();
    expect(screen.getByText("Twitch")).toBeTruthy();
    // las acciones de una tarjeta actúan sobre SU ventana
    await fireEvent.press(screen.getByTestId("app-card-w_9"));
    await fireEvent.press(screen.getByLabelText("Mandar chrome a la pantalla 2"));
    await act(async () => {});
    expect(useApps.getState().windows.find((x) => x.id === "w_9")!.monitorId).toBe("m_DemoMonitorDos02");
    expect(useApps.getState().windows.find((x) => x.id === "w_2")!.monitorId).toBe("m_DemoMonitorUno01");
  });

  it("tocar una tarjeta la despliega con las acciones rápidas; abrir otra pliega la anterior", async () => {
    await renderScreen(<AppsTab />);
    await open("chrome");
    const acts = within(screen.getByTestId("app-actions"));
    for (const l of ["Traer chrome al frente", "Mandar chrome a la pantalla 1", "Mandar chrome a la pantalla 2", "Abrir una ventana de incógnito de chrome", "Minimizar chrome", "Cerrar chrome", "Todas las opciones de chrome"]) expect(acts.getByLabelText(l)).toBeTruthy();
    expect(screen.getByTestId("app-card-w_2").props.accessibilityState.expanded).toBe(true);
    expect(acts.getByLabelText("Mandar chrome a la pantalla 1").props.accessibilityState).toMatchObject({ selected: true, disabled: true }); // ya está ahí
    await open("Discord");
    expect(screen.getAllByTestId("app-actions")).toHaveLength(1);
    expect(screen.getByTestId("app-card-w_2").props.accessibilityState.expanded).toBe(false);
    await open("Discord");
    expect(screen.queryByTestId("app-actions")).toBeNull();
  });

  it("mandarla a otra pantalla es un toque", async () => {
    await renderScreen(<AppsTab />);
    await open("chrome");
    await fireEvent.press(screen.getByLabelText("Mandar chrome a la pantalla 2"));
    await act(async () => {});
    expect(useApps.getState().windows.find((w) => w.id === "w_2")!.monitorId).toBe("m_DemoMonitorDos02");
  });

  it("Traer la pone al frente; Minimizar la minimiza", async () => {
    await renderScreen(<AppsTab />);
    await open("chrome");
    await fireEvent.press(screen.getByLabelText("Traer chrome al frente"));
    await act(async () => {});
    expect(useApps.getState().windows.find((w) => w.id === "w_2")!.focused).toBe(true);
    await fireEvent.press(screen.getByLabelText("Minimizar chrome"));
    await act(async () => {});
    expect(useApps.getState().windows.find((w) => w.id === "w_2")!.state).toBe("minimized");
  });

  it("una app maximizada ofrece Restaurar en vez de Maximizar", async () => {
    await renderScreen(<AppsTab />);
    await open("Discord");
    expect(screen.getByLabelText("Restaurar Discord")).toBeTruthy();
  });

  it("cerrar pide confirmación y recién ahí cierra", async () => {
    await renderScreen(<AppsTab />);
    await open("Discord");
    await fireEvent.press(screen.getByLabelText("Cerrar Discord"));
    const dlg = within(screen.getByTestId("confirm-dialog"));
    expect(dlg.getByText("¿Cerrar “#general | Amigos”?")).toBeTruthy();
    expect(useApps.getState().windows).toHaveLength(4);
    await fireEvent.press(dlg.getByText("Cerrar"));
    await act(async () => {});
    expect(useApps.getState().windows.map((w) => w.id)).not.toContain("w_3");
  });

  it("Todo abre el menú completo de esa ventana", async () => {
    await renderScreen(<AppsTab />);
    await open("chrome");
    await fireEvent.press(screen.getByLabelText("Todas las opciones de chrome"));
    const sheet = within(screen.getByTestId("window-sheet"));
    expect(sheet.getByText("YouTube — Age of Empires")).toBeTruthy();
    for (const a of ["Traer al frente", "Maximizar", "Pantalla completa", "Minimizar", "Cerrar ventana"]) expect(sheet.getByText(a)).toBeTruthy();
  });

  it("si la PC no deja traerla al frente, se ve el motivo", async () => {
    useApps.setState({ demo: false });
    setAppsBridge({ command: (async () => ({ ok: false, reason: "focus_denied" })) as never, query: () => null });
    await renderScreen(<AppsTab />);
    await open("chrome");
    await fireEvent.press(screen.getByLabelText("Traer chrome al frente"));
    await act(async () => {});
    expect(screen.getByText(/Windows no dejó traerla al frente/)).toBeTruthy();
  });

  it("si la ventana desaparece con el menú abierto, se cierra con un aviso", async () => {
    await renderScreen(<AppsTab />);
    await open("chrome");
    await fireEvent.press(screen.getByLabelText("Todas las opciones de chrome"));
    await act(async () => useApps.setState({ windows: useApps.getState().windows.filter((w) => w.id !== "w_2") }));
    expect(screen.queryByTestId("window-sheet")).toBeNull();
    expect(screen.getByText("Esa ventana se cerró en la PC.")).toBeTruthy();
  });

  it("vacía: lo dice y ofrece ir a Escenas, donde ahora se abre todo", async () => {
    useApps.setState({ windows: [] });
    await renderScreen(<AppsTab />);
    expect(within(screen.getByTestId("windows-empty")).getByText("Abrí algo desde Escenas.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Ir a Escenas"));
    expect(mockNavigate).toHaveBeenCalledWith("/deck");
  });

  it("cargando: muestra el esqueleto", async () => {
    useApps.setState({ windowsLoaded: false });
    await renderScreen(<AppsTab />);
    expect(screen.getByTestId("windows-loading")).toBeTruthy();
  });

  it("sin conexión: las tarjetas se ven apagadas y no se despliegan; la tira ofrece Reintentar", async () => {
    useConn.setState({ status: "offline", snapshot: null, lastError: null });
    await renderScreen(<AppsTab />);
    await open("chrome");
    expect(screen.queryByTestId("app-actions")).toBeNull();
    await fireEvent.press(screen.getByText("Reintentar"));
    expect(client.retry).toHaveBeenCalledTimes(1);
  });
});
