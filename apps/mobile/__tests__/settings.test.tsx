import { fireEvent, screen } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import SettingsScreen from "@/app/settings";
import { client, useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { formatDate } from "@/format";
import { initI18n } from "@/i18n";
import es from "@/i18n/es.json";
import { PC, hasRowAncestor, renderScreen } from "./screenHelpers";

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), back: mockBack }) }));

jest.mock("@/connection", () => ({
  client: { forget: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));

beforeAll(() => {
  initI18n("es");
});
beforeEach(() => {
  mockLandscape = false;
  jest.clearAllMocks();
  useConn.setState({ ...initialState, status: "online", pc: PC }, true);
});

/** Toca "Olvidar" y devuelve los botones del diálogo de confirmación. */
async function openForgetDialog() {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await fireEvent.press(screen.getByText("Olvidar"));
  expect(alert).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = alert.mock.calls[0] as [string, string, AlertButton[]];
  return { title, message, buttons };
}

describe("Ajustes · conexión", () => {
  it("muestra la PC, su dirección y la fecha de emparejamiento", async () => {
    await renderScreen(<SettingsScreen />);
    expect(screen.getByText("Ajustes")).toBeTruthy();
    expect(screen.getByText("Conexión")).toBeTruthy();
    expect(screen.getByText("PC-DE-JAY")).toBeTruthy();
    expect(screen.getByText("192.168.100.5:47800")).toBeTruthy();
    expect(screen.getByText(`Emparejada el ${formatDate(PC.pairedAt!)}`)).toBeTruthy();
  });

  it("sin conexión aclara que Olvidar no le avisa a la PC (hay que revocar a mano)", async () => {
    useConn.setState({ status: "offline" });
    await renderScreen(<SettingsScreen />);
    expect(screen.getByText(es.settings.forgetNote)).toBeTruthy();
    expect(screen.queryByText(es.settings.forgetNoteOnline)).toBeNull();
  });

  it("en línea aclara que la PC se entera y borra el dispositivo", async () => {
    await renderScreen(<SettingsScreen />);
    expect(screen.getByText(es.settings.forgetNoteOnline)).toBeTruthy();
    expect(screen.queryByText(es.settings.forgetNote)).toBeNull();
  });

  it("el botón de volver vuelve a la pantalla anterior", async () => {
    await renderScreen(<SettingsScreen />);
    await fireEvent.press(screen.getByLabelText("Volver"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe("Ajustes · Olvidar", () => {
  it("pide confirmación con el nombre de la PC y todavía no olvida", async () => {
    await renderScreen(<SettingsScreen />);
    const { title, message, buttons } = await openForgetDialog();
    expect(title).toBe("Olvidar");
    expect(message).toBe("¿Olvidar PC-DE-JAY? Vas a tener que escanear el QR de nuevo.");
    expect(buttons.map((b) => b.text)).toEqual(["Cancelar", "Olvidar"]);
    expect(client.forget).not.toHaveBeenCalled();
  });

  it("confirmar llama a client.forget (que lleva a Conectar)", async () => {
    await renderScreen(<SettingsScreen />);
    const { buttons } = await openForgetDialog();
    const confirm = buttons.find((b) => b.text === "Olvidar");
    expect(confirm?.style).toBe("destructive");
    confirm?.onPress?.();
    expect(client.forget).toHaveBeenCalledTimes(1);
  });

  it("cancelar no olvida nada", async () => {
    await renderScreen(<SettingsScreen />);
    const { buttons } = await openForgetDialog();
    const cancel = buttons.find((b) => b.text === "Cancelar");
    expect(cancel?.style).toBe("cancel");
    cancel?.onPress?.();
    expect(client.forget).not.toHaveBeenCalled();
  });

  it("sin PC guardada no pregunta nada ni rompe", async () => {
    useConn.setState({ pc: null });
    await renderScreen(<SettingsScreen />);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await fireEvent.press(screen.getByText("Olvidar"));
    expect(alert).not.toHaveBeenCalled();
  });
});

describe("Ajustes · apaisado", () => {
  it("vertical: las columnas van una debajo de otra", async () => {
    await renderScreen(<SettingsScreen />);
    expect(hasRowAncestor(screen.getByText("Conexión"))).toBe(false);
  });

  it("apaisado: las dos columnas van en fila y siguen todos los datos", async () => {
    mockLandscape = true;
    await renderScreen(<SettingsScreen />);
    expect(hasRowAncestor(screen.getByText("Conexión"))).toBe(true);
    expect(screen.getByText("PC-DE-JAY")).toBeTruthy();
    expect(screen.getByText("192.168.100.5:47800")).toBeTruthy();
    expect(screen.getByText(es.settings.forgetNoteOnline)).toBeTruthy();
  });

  it("apaisado: Olvidar sigue pidiendo confirmación", async () => {
    mockLandscape = true;
    await renderScreen(<SettingsScreen />);
    const { buttons } = await openForgetDialog();
    buttons.find((b) => b.text === "Olvidar")?.onPress?.();
    expect(client.forget).toHaveBeenCalledTimes(1);
  });
});
