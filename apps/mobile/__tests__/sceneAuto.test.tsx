import { fireEvent, screen, within } from "@testing-library/react-native";
import SceneEditor from "@/app/scenes/[id]";
import ScenesScreen from "@/app/scenes/index";
import { setAppsBridge } from "@/apps/commands";
import { loadAppsDemo } from "@/apps/demo";
import { resetIcons } from "@/apps/icons";
import { initialApps, useApps } from "@/apps/store";
import { hotkeyText, isReserved, takenByScenes } from "@/apps/sceneAuto";
import { useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { initI18n } from "@/i18n";
import { loadScreensDemo } from "@/screens/demo";
import { initialScreens, useScreens } from "@/screens/store";
import { PC, SNAPSHOT, renderScreen } from "./screenHelpers";

let mockLandscape = false;
let mockParam = "new";
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, navigate: jest.fn() }),
  useLocalSearchParams: () => ({ id: mockParam }),
}));
jest.mock("@/haptics", () => ({ tap: jest.fn() }));
jest.mock("@/connection", () => ({
  client: { retry: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));

beforeAll(() => {
  initI18n("es");
});
beforeEach(() => {
  mockLandscape = false;
  mockParam = "new";
  jest.clearAllMocks();
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  useApps.setState(initialApps, true);
  useScreens.setState(initialScreens, true);
  setAppsBridge(null);
  resetIcons();
  loadScreensDemo();
  loadAppsDemo();
});

const scene = (id: string) => useApps.getState().library!.scenes.find((s) => s.id === id)!;
const orientations = [["vertical", false], ["apaisado", true]] as const;

describe("sceneAuto (lógica pura)", () => {
  it("reconoce las teclas con dueño y arma el texto del atajo", () => {
    expect(isReserved("T")).toBe(true);
    expect(isReserved("4")).toBe(true);
    expect(isReserved("J")).toBe(false);
    expect(isReserved("0")).toBe(false);
    expect(hotkeyText("J")).toBe("Ctrl+Alt+J");
  });

  it("takenByScenes ignora la escena que se está editando", () => {
    const scenes = [
      { id: "s_A", name: "Uno", hotkey: "J" as const },
      { id: "s_B", name: "Dos", hotkey: "K" as const },
      { id: "s_C", name: "Tres" },
    ];
    expect([...takenByScenes(scenes, "s_A")]).toEqual([["K", "Dos"]]);
    expect([...takenByScenes(scenes, null)]).toEqual([["J", "Uno"], ["K", "Dos"]]);
  });
});

describe.each(orientations)("Escena · atajo y disparador · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });

  it("el editor muestra las dos filas: sin valores dicen 'Ninguno' y 'Solo a mano'", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    expect(screen.getByText("En la PC")).toBeTruthy();
    expect(within(screen.getByTestId("row-hotkey")).getByText("Ninguno ›")).toBeTruthy();
    expect(within(screen.getByTestId("row-trigger")).getByText("Solo a mano ›")).toBeTruthy();
  });

  it("elegir un atajo lo guarda con la escena", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByTestId("row-hotkey"));
    const sheet = within(screen.getByTestId("hotkey-sheet"));
    await fireEvent.press(sheet.getByTestId("hotkey-J"));
    expect(sheet.getByText("Ctrl+Alt+J")).toBeTruthy();
    await fireEvent.press(sheet.getByText("Listo"));
    expect(within(screen.getByTestId("row-hotkey")).getByText("Ctrl+Alt+J ›")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Guardar"));
    expect(scene("s_DemoJuego00").hotkey).toBe("J");
  });

  it("una tecla con dueño no se elige y dice de quién es", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByTestId("row-hotkey"));
    const sheet = within(screen.getByTestId("hotkey-sheet"));
    await fireEvent.press(sheet.getByTestId("hotkey-4"));
    expect(sheet.getByText("Ctrl+Alt+4 ya es “pantalla completa”. Elegí otra tecla.")).toBeTruthy();
    expect(sheet.getByLabelText("Listo").props.accessibilityState.disabled).toBe(true); // nada elegido
    await fireEvent.press(sheet.getByTestId("hotkey-T"));
    expect(sheet.getByText(/“prender o apagar la tele”/)).toBeTruthy();
  });

  it("la tecla de otra escena tampoco, pero la propia sí", async () => {
    useApps.setState({ library: { ...useApps.getState().library!, scenes: useApps.getState().library!.scenes.map((s) => (s.id === "s_DemoTrabajo" ? { ...s, hotkey: "K" as const } : s.id === "s_DemoJuego00" ? { ...s, hotkey: "J" as const } : s)) } });
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByTestId("row-hotkey"));
    const sheet = within(screen.getByTestId("hotkey-sheet"));
    await fireEvent.press(sheet.getByTestId("hotkey-K"));
    expect(sheet.getByText("Ctrl+Alt+K ya es la escena “Trabajo”. Elegí otra tecla.")).toBeTruthy();
    await fireEvent.press(sheet.getByTestId("hotkey-J")); // la suya: se puede dejar
    expect(sheet.getByText(/Libre/)).toBeTruthy();
  });

  it("'Sin atajo' lo quita", async () => {
    useApps.setState({ library: { ...useApps.getState().library!, scenes: useApps.getState().library!.scenes.map((s) => (s.id === "s_DemoJuego00" ? { ...s, hotkey: "J" as const } : s)) } });
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    expect(within(screen.getByTestId("row-hotkey")).getByText("Ctrl+Alt+J ›")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("row-hotkey"));
    await fireEvent.press(within(screen.getByTestId("hotkey-sheet")).getByText("Sin atajo"));
    await fireEvent.press(screen.getByLabelText("Guardar"));
    expect(scene("s_DemoJuego00").hotkey).toBeUndefined();
  });

  it("disparador 'al iniciar el agente'", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByTestId("row-trigger"));
    const sheet = within(screen.getByTestId("trigger-sheet"));
    await fireEvent.press(sheet.getByTestId("trigger-agentStart"));
    await fireEvent.press(sheet.getByText("Listo"));
    expect(within(screen.getByTestId("row-trigger")).getByText("Al iniciar el agente ›")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Guardar"));
    expect(scene("s_DemoJuego00").trigger).toEqual({ type: "agentStart" });
  });

  it("disparador 'al prender una pantalla' pide elegir cuál y la guarda", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByTestId("row-trigger"));
    const sheet = within(screen.getByTestId("trigger-sheet"));
    await fireEvent.press(sheet.getByTestId("trigger-displayOn"));
    expect(sheet.getByLabelText("Listo").props.accessibilityState.disabled).toBe(true); // falta elegir la pantalla
    await fireEvent.press(sheet.getByTestId("display-m_DemoMonitorTres3"));
    await fireEvent.press(sheet.getByText("Listo"));
    await fireEvent.press(screen.getByLabelText("Guardar"));
    expect(scene("s_DemoJuego00").trigger).toEqual({ type: "displayOn", displayId: "m_DemoMonitorTres3" });
  });

  it("'Solo a mano' saca el disparador", async () => {
    useApps.setState({ library: { ...useApps.getState().library!, scenes: useApps.getState().library!.scenes.map((s) => (s.id === "s_DemoJuego00" ? { ...s, trigger: { type: "agentStart" as const } } : s)) } });
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByTestId("row-trigger"));
    const sheet = within(screen.getByTestId("trigger-sheet"));
    await fireEvent.press(sheet.getByTestId("trigger-manual"));
    await fireEvent.press(sheet.getByText("Listo"));
    await fireEvent.press(screen.getByLabelText("Guardar"));
    expect(scene("s_DemoJuego00").trigger).toBeUndefined();
  });

  it("cambiar solo el atajo cuenta como cambio: salir pide confirmación", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByTestId("row-hotkey"));
    await fireEvent.press(within(screen.getByTestId("hotkey-sheet")).getByTestId("hotkey-J"));
    await fireEvent.press(within(screen.getByTestId("hotkey-sheet")).getByText("Listo"));
    await fireEvent.press(screen.getByLabelText("Volver"));
    expect(screen.getByText("¿Salir sin guardar?")).toBeTruthy();
  });

  it("la lista muestra las insignias del atajo y del disparador", async () => {
    useApps.setState({
      library: {
        ...useApps.getState().library!,
        scenes: useApps.getState().library!.scenes.map((s) =>
          s.id === "s_DemoJuego00" ? { ...s, hotkey: "J" as const, trigger: { type: "displayOn" as const, displayId: "m_DemoMonitorTres3" } } : s,
        ),
      },
    });
    await renderScreen(<ScenesScreen />);
    expect(screen.getByText("Ctrl+Alt+J")).toBeTruthy();
    expect(screen.getByText(/^⟳ al prender /)).toBeTruthy();
  });
});
