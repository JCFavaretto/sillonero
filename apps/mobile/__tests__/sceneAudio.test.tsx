import { act, fireEvent, screen, within } from "@testing-library/react-native";
import SceneEditor from "@/app/scenes/[id]";
import { setAppsBridge } from "@/apps/commands";
import { loadAppsDemo } from "@/apps/demo";
import { initialApps, useApps } from "@/apps/store";
import { loadAudioDemo } from "@/audio/demo";
import { setAudioDemo } from "@/audio/demoFlag";
import { initialAudio, useAudio } from "@/audio/store";
import { stepSummary } from "@/components/RunSheet";
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

beforeAll(() => initI18n("es"));
beforeEach(() => {
  mockLandscape = false;
  mockParam = "new";
  jest.clearAllMocks();
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  useApps.setState(initialApps, true);
  useScreens.setState(initialScreens, true);
  useAudio.setState({ ...initialAudio });
  setAudioDemo(false);
  setAppsBridge(null);
  loadScreensDemo();
  loadAppsDemo();
  loadAudioDemo();
});

const orientations = [["vertical", false], ["apaisado", true]] as const;
const SP = "o_DemoSpeakers";
const TV = "o_DemoTelevisi";

describe.each(orientations)("Escenas · paso de audio · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });
  const openAudio = async () => {
    await renderScreen(<SceneEditor />);
    await fireEvent.changeText(screen.getByLabelText("Nombre"), "Modo sillón");
    await fireEvent.press(screen.getByText("+ Paso"));
    await fireEvent.press(screen.getByTestId("type-audio"));
    return within(screen.getByTestId("step-sheet"));
  };

  it("la lista de tipos suma 'Audio'", async () => {
    await renderScreen(<SceneEditor />);
    await fireEvent.press(screen.getByText("+ Paso"));
    expect(within(screen.getByTestId("step-sheet")).getByText("Audio")).toBeTruthy();
  });

  it("sin nada elegido, Listo no anda: hay que elegir salida y hacer algo", async () => {
    const sheet = await openAudio();
    expect(sheet.getByLabelText("Listo").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(sheet.getByTestId("audio-out-" + TV));
    // con la salida pero sin predeterminada ni volumen: tampoco
    await fireEvent(sheet.getByLabelText("Hacerla predeterminada"), "valueChange", false);
    expect(sheet.getByLabelText("Listo").props.accessibilityState.disabled).toBe(true);
    expect(sheet.getByText("Elegí al menos una: hacerla predeterminada o poner el volumen.")).toBeTruthy();
  });

  it("la salida desconectada con apodo (la tele) se puede elegir; la oculta sin apodo no se ofrece", async () => {
    const sheet = await openAudio();
    expect(sheet.getByTestId("audio-out-" + TV)).toBeTruthy();
    expect(sheet.queryByText("Realtek Digital Output")).toBeNull();
  });

  it("arma el paso: tele, predeterminada y volumen 30; queda en el editor y se guarda", async () => {
    const sheet = await openAudio();
    await fireEvent.press(sheet.getByTestId("audio-out-" + TV));
    await fireEvent(sheet.getByLabelText("Poner el volumen"), "valueChange", true);
    // el volumen arranca en 30 y baja/sube con las acciones del deslizador
    const slider = sheet.getByTestId("step-audio-volume");
    expect(slider.props.accessibilityValue.now).toBe(30);
    await fireEvent.press(sheet.getByLabelText("Listo"));
    expect(screen.getByText("Audio → Tele · predeterminada · volumen 30")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Guardar"));
    const saved = useApps.getState().library!.scenes.find((s) => s.name === "Modo sillón")!;
    expect(saved.steps).toEqual([{ kind: "audio", outputId: TV, makeDefault: true, volume: 30 }]);
    expect(mockBack).toHaveBeenCalled();
  });

  it("solo volumen: sin predeterminada", async () => {
    const sheet = await openAudio();
    await fireEvent.press(sheet.getByTestId("audio-out-" + SP));
    await fireEvent(sheet.getByLabelText("Hacerla predeterminada"), "valueChange", false);
    await fireEvent(sheet.getByLabelText("Poner el volumen"), "valueChange", true);
    await fireEvent.press(sheet.getByLabelText("Listo"));
    expect(screen.getByText("Audio → Parlantes · volumen 30")).toBeTruthy();
  });

  it("editar un paso de audio existente entra directo a su configuración", async () => {
    await renderScreen(<SceneEditor />);
    await fireEvent.changeText(screen.getByLabelText("Nombre"), "X");
    await fireEvent.press(screen.getByText("+ Paso"));
    await fireEvent.press(screen.getByTestId("type-audio"));
    await fireEvent.press(screen.getByTestId("audio-out-" + SP));
    await fireEvent.press(within(screen.getByTestId("step-sheet")).getByLabelText("Listo"));
    await fireEvent.press(screen.getByLabelText("Editar el paso 1"));
    const sheet = within(screen.getByTestId("step-sheet"));
    expect(sheet.getByText("¿Cómo cambia el audio?")).toBeTruthy();
    expect(sheet.getByTestId("audio-out-" + SP).props.accessibilityState.selected).toBe(true);
  });

  it("si no hay audio en la PC, el tipo Audio avisa y no deja elegir", async () => {
    await act(async () => {
      useAudio.setState({ audio: { ...useAudio.getState().audio!, available: { audio: false, defaultOutput: false, appRouting: false } } });
    });
    const sheet = await openAudio();
    expect(sheet.getByText("Audio no disponible en la PC")).toBeTruthy();
    expect(sheet.queryByTestId("audio-out-" + SP)).toBeNull();
  });
});

describe("stepSummary · audio", () => {
  const t = (k: string, o?: Record<string, unknown>) => (k === "scenes.step.audioSummary" ? `Audio → ${String(o?.name)}` : k === "scenes.step.audioDefault" ? "predeterminada" : k === "scenes.step.audioVolume" ? `volumen ${String(o?.vol)}` : k);
  it("dice la salida, si la hace predeterminada y el volumen", () => {
    const outputs = [{ id: SP, name: "Altavoces", nick: "Parlantes" }];
    expect(stepSummary({ kind: "audio", outputId: SP, makeDefault: true, volume: 30 }, t, outputs as never)).toBe("Audio → Parlantes · predeterminada · volumen 30");
    expect(stepSummary({ kind: "audio", outputId: SP, makeDefault: false, volume: 30 }, t, outputs as never)).toBe("Audio → Parlantes · volumen 30");
    expect(stepSummary({ kind: "audio", outputId: "o_ZZZZZZZZZZZZ", makeDefault: true, volume: null }, t, outputs as never)).toBe("Audio → ? · predeterminada");
  });
});
