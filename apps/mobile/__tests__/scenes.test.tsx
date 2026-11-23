import { fireEvent, screen, within } from "@testing-library/react-native";
import SceneEditor from "@/app/scenes/[id]";
import ScenesScreen from "@/app/scenes/index";
import { setAppsBridge } from "@/apps/commands";
import { loadAppsDemo } from "@/apps/demo";
import { resetIcons } from "@/apps/icons";
import { initialApps, useApps } from "@/apps/store";
import { useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { initI18n } from "@/i18n";
import { loadScreensDemo } from "@/screens/demo";
import { initialScreens, useScreens } from "@/screens/store";
import { PC, SNAPSHOT, hasRowAncestor, renderScreen } from "./screenHelpers";

let mockLandscape = false;
let mockParam = "new";
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, navigate: jest.fn() }),
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

const orientations = [["vertical", false], ["apaisado", true]] as const;

describe.each(orientations)("Escenas · lista · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });

  it("muestra cada escena con su resumen; en apaisado, en dos columnas", async () => {
    await renderScreen(<ScenesScreen />);
    expect(screen.getByRole("header", { name: "Escenas" })).toBeTruthy();
    expect(screen.getByText("Trabajo")).toBeTruthy();
    expect(screen.getByText("Juego")).toBeTruthy();
    expect(screen.getByText("3 pasos · Pantallas: 1 cambio")).toBeTruthy();
    expect(hasRowAncestor(screen.getByTestId("play-s_DemoTrabajo"))).toBe(true); // la fila de la tarjeta
  });

  it("▶ ejecuta y abre el progreso con cada paso", async () => {
    await renderScreen(<ScenesScreen />);
    await fireEvent.press(screen.getByTestId("play-s_DemoJuego00"));
    const sheet = within(screen.getByTestId("run-sheet"));
    expect(sheet.getByText("Juego listo")).toBeTruthy();
    expect(sheet.getAllByText("listo")).toHaveLength(3);
    await fireEvent.press(sheet.getByText("Listo"));
    expect(screen.queryByTestId("run-sheet")).toBeNull();
  });

  it("con pasos fallidos el resultado lo dice y ofrece editar la escena", async () => {
    useApps.setState({ demo: false });
    setAppsBridge({ command: (async () => ({ ok: false, reason: "failed", steps: ["failed", "ok", "partial"] })) as never, query: () => null });
    await renderScreen(<ScenesScreen />);
    await fireEvent.press(screen.getByTestId("play-s_DemoJuego00"));
    const sheet = within(screen.getByTestId("run-sheet"));
    expect(sheet.getByText("Juego terminó con problemas")).toBeTruthy();
    expect(sheet.getByText("falló")).toBeTruthy();
    expect(sheet.getByText("abierta, sin ubicar")).toBeTruthy();
    await fireEvent.press(sheet.getByText("Editar escena"));
    expect(mockPush).toHaveBeenCalledWith("/scenes/s_DemoJuego00");
  });

  it("otra escena corriendo: avisa y no abre el progreso", async () => {
    useApps.setState({ demo: false, run: { runId: "r", sceneId: "s_DemoTrabajo", steps: ["running", "wait"], reasons: [null, null], finished: false } });
    await renderScreen(<ScenesScreen />);
    await fireEvent.press(screen.getByTestId("play-s_DemoJuego00"));
    expect(screen.getByText("Ya hay una escena corriendo (Trabajo). Esperá a que termine.")).toBeTruthy();
  });

  it("Editar y + Nueva navegan al editor", async () => {
    await renderScreen(<ScenesScreen />);
    await fireEvent.press(screen.getAllByText("Editar")[0]!);
    expect(mockPush).toHaveBeenCalledWith("/scenes/s_DemoTrabajo");
    await fireEvent.press(screen.getByText("+ Nueva"));
    expect(mockPush).toHaveBeenCalledWith("/scenes/new");
  });

  it("sin escenas: tarjeta vacía", async () => {
    useApps.setState({ library: { ...useApps.getState().library!, scenes: [], deck: [] } });
    await renderScreen(<ScenesScreen />);
    expect(screen.getByTestId("scenes-empty")).toBeTruthy();
    expect(screen.getByText("Todavía no hay escenas")).toBeTruthy();
  });
});

describe.each(orientations)("Escenas · editor · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });

  it("escena nueva: sin pasos, Guardar deshabilitado hasta tener nombre y un paso", async () => {
    await renderScreen(<SceneEditor />);
    expect(screen.getByRole("header", { name: "Nueva escena" })).toBeTruthy();
    expect(screen.getByText(/Agregá el primer paso/)).toBeTruthy();
    expect(screen.getByLabelText("Guardar").props.accessibilityState.disabled).toBe(true);
  });

  it("arma una escena: nombre + paso de pantallas + paso de app con zona, y la guarda", async () => {
    await renderScreen(<SceneEditor />);
    await fireEvent.changeText(screen.getByLabelText("Nombre"), "Modo sillón");

    // paso 1: pantallas
    await fireEvent.press(screen.getByText("+ Paso"));
    await fireEvent.press(screen.getByTestId("type-screens"));
    await fireEvent.press(screen.getByTestId("pick-m_DemoMonitorTres3")); // no tocar → prender
    await fireEvent.press(within(screen.getByTestId("step-sheet")).getByText("Listo"));
    expect(screen.getByText("Pantallas: 1 cambio")).toBeTruthy();

    // paso 2: abrir app con zona
    await fireEvent.press(screen.getByText("+ Paso"));
    await fireEvent.press(screen.getByTestId("type-app"));
    await fireEvent.press(within(screen.getByTestId("result-Discord")).getByText("Elegir"));
    await fireEvent.press(screen.getByTestId("zone-right"));
    await fireEvent.press(within(screen.getByTestId("step-sheet")).getByText("Listo"));
    expect(screen.getByText("Abrir Discord")).toBeTruthy();

    // paso 3: juntar todo (se agrega directo)
    await fireEvent.press(screen.getByText("+ Paso"));
    await fireEvent.press(screen.getByTestId("type-bringAll"));
    expect(screen.getByText("Juntar todo en la principal")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Guardar"));
    const saved = useApps.getState().library!.scenes.find((s) => s.name === "Modo sillón")!;
    expect(saved.steps).toHaveLength(3);
    expect(saved.steps[0]).toEqual({ kind: "screens", monitors: [{ monitorId: "m_DemoMonitorTres3", enabled: true }] });
    expect(saved.steps[1]).toMatchObject({ kind: "open", target: { kind: "app", appId: "Discord" }, place: { zone: "right" } });
    expect(mockBack).toHaveBeenCalled();
  });

  it("un link con dirección inválida no deja avanzar", async () => {
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByText("+ Paso"));
    await fireEvent.press(screen.getByTestId("type-link"));
    await fireEvent.changeText(screen.getByLabelText("Dirección"), "javascript:alert(1)");
    expect(within(screen.getByTestId("step-sheet")).getByLabelText("Listo").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText("Dirección"), "https://youtu.be/x");
    expect(within(screen.getByTestId("step-sheet")).getByLabelText("Listo").props.accessibilityState.disabled).toBe(false);
  });

  it("editar una escena existente: mover, quitar y editar pasos; Probar guarda y ejecuta", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    expect(screen.getByRole("header", { name: "Editar escena" })).toBeTruthy();
    expect(screen.getByText("Abrir Discord")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Subir el paso 3"));
    await fireEvent.press(screen.getByLabelText("Quitar el paso 1"));
    await fireEvent.press(screen.getByText("Probar"));
    const saved = useApps.getState().library!.scenes.find((s) => s.id === "s_DemoJuego00")!;
    expect(saved.steps).toHaveLength(2);
    expect(saved.steps[0]).toMatchObject({ kind: "open", name: "YouTube" }); // el 3 subió al lugar del 2 y el 1 se fue
    expect(screen.getByTestId("run-sheet")).toBeTruthy();
  });

  it("salir con cambios pide confirmación; sin cambios sale directo", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByLabelText("Volver"));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(screen.getByLabelText("Nombre"), "Otro nombre");
    await fireEvent.press(screen.getByLabelText("Volver"));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText("¿Salir sin guardar?")).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("confirm-dialog")).getByText("Salir"));
    expect(mockBack).toHaveBeenCalledTimes(2);
  });

  it("borrar pide confirmación y la saca del Inicio", async () => {
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByText("Borrar escena"));
    expect(screen.getByText("¿Borrar la escena “Juego”?")).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("confirm-dialog")).getByText("Borrar"));
    const lib = useApps.getState().library!;
    expect(lib.scenes.map((s) => s.id)).not.toContain("s_DemoJuego00");
    expect(lib.deck.some((d) => d.kind === "scene" && d.id === "s_DemoJuego00")).toBe(false);
  });

  it("si la PC rechaza guardar (app que ya no está), muestra el motivo y se queda", async () => {
    useApps.setState({ demo: false });
    setAppsBridge({ command: (async () => ({ ok: false, reason: "not_allowed" })) as never, query: () => null });
    mockParam = "s_DemoJuego00";
    await renderScreen(<SceneEditor />);
    await fireEvent.changeText(screen.getByLabelText("Nombre"), "Juego 2");
    await fireEvent.press(screen.getByLabelText("Guardar"));
    expect(screen.getByText("Esa app ya no está en la lista de la PC.")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("pasos topeados: con 12 pasos no se puede agregar otro", async () => {
    mockParam = "s_DemoJuego00";
    const lib = useApps.getState().library!;
    useApps.setState({ library: { ...lib, scenes: lib.scenes.map((s) => (s.id === "s_DemoJuego00" ? { ...s, steps: Array.from({ length: 12 }, () => ({ kind: "bringAll" as const })) } : s)) } });
    await renderScreen(<SceneEditor />);
    expect(screen.getByLabelText("+ Paso").props.accessibilityState.disabled).toBe(true);
  });
});
