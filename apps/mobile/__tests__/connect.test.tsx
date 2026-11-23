import { act, fireEvent, screen } from "@testing-library/react-native";
import { BackHandler, Linking } from "react-native";
import ConnectScreen from "@/app/connect";
import { client, useConn } from "@/connection";
import { initialState, type ErrorKey } from "@/connection/machine";
import es from "@/i18n/es.json";
import { initI18n } from "@/i18n";
import { hasRowAncestor, renderScreen } from "./screenHelpers";

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));

jest.mock("@/connection", () => ({
  client: { pair: jest.fn(), cancelPair: jest.fn(), retry: jest.fn(), forget: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));

jest.mock("expo-device", () => ({ deviceName: "Pixel de Jay" }));

let mockPermission: { granted: boolean } | null = { granted: true };
const mockRequestPermission = jest.fn();
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [mockPermission, mockRequestPermission],
}));

// El escáner real se prueba aparte (qrScanner.test.tsx): acá es un botón que "lee" un texto.
const mockQrText = "pe1:texto-del-qr";
jest.mock("@/components/QrScanner", () => {
  const React = jest.requireActual("react");
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    QrScanner: ({ onScan }: { onScan: (t: string) => void }) =>
      React.createElement(Pressable, { testID: "scanner", onPress: () => onScan(mockQrText) }, React.createElement(Text, null, "cámara")),
  };
});

beforeAll(() => {
  initI18n("es");
});
beforeEach(() => {
  mockLandscape = false;
  mockPermission = { granted: true };
  mockRequestPermission.mockReset();
  jest.clearAllMocks();
  useConn.setState(initialState, true);
});

const startScan = async () => {
  await fireEvent.press(screen.getByText("Escanear QR"));
};

describe("Conectar · pantalla inicial", () => {
  it("explica cómo emparejar y ofrece escanear", async () => {
    await renderScreen(<ConnectScreen />);
    expect(screen.getByText("Conectar")).toBeTruthy();
    expect(screen.getByText(es.connect.help)).toBeTruthy();
    expect(screen.getByText("Escanear QR")).toBeTruthy();
    expect(screen.getByText(es.connect.localOnly)).toBeTruthy();
  });

  it("sin aviso previo no muestra ningún error", async () => {
    await renderScreen(<ConnectScreen />);
    expect(screen.queryByText(es.errors.revoked)).toBeNull();
    expect(screen.queryByText(es.connect.camera.denied)).toBeNull();
  });
});

describe("Conectar · escanear", () => {
  it("con permiso de cámara muestra el escáner", async () => {
    await renderScreen(<ConnectScreen />);
    await startScan();
    expect(screen.getByTestId("scanner")).toBeTruthy();
    expect(screen.getByText("Escaneá el QR")).toBeTruthy();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it("sin permiso lo pide, y si lo dan, escanea", async () => {
    mockPermission = { granted: false };
    mockRequestPermission.mockResolvedValue({ granted: true });
    await renderScreen(<ConnectScreen />);
    await startScan();
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("scanner")).toBeTruthy();
  });

  it("si niegan el permiso explica y ofrece abrir los ajustes", async () => {
    mockPermission = null;
    mockRequestPermission.mockResolvedValue({ granted: false });
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    await renderScreen(<ConnectScreen />);
    await startScan();
    expect(await screen.findByText(es.connect.camera.denied)).toBeTruthy();
    expect(screen.queryByTestId("scanner")).toBeNull();
    await fireEvent.press(screen.getByText(es.connect.camera.openSettings));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("un QR leído llama a client.pair con el nombre del celu y cierra el escáner", async () => {
    await renderScreen(<ConnectScreen />);
    await startScan();
    await fireEvent.press(screen.getByTestId("scanner"));
    expect(client.pair).toHaveBeenCalledTimes(1);
    expect(client.pair).toHaveBeenCalledWith("pe1:texto-del-qr", "Pixel de Jay");
    expect(screen.queryByTestId("scanner")).toBeNull();
  });

  it("el botón Atrás de Android cierra la cámara en vez de salir de la app", async () => {
    let onBack: (() => boolean) | null = null;
    const remove = jest.fn();
    jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_: string, cb: () => boolean) => {
      onBack = cb;
      return { remove };
    }) as never);
    await renderScreen(<ConnectScreen />);
    expect(onBack).toBeNull(); // sin cámara no interfiere con Atrás
    await startScan();
    expect(onBack).not.toBeNull();
    await act(async () => {
      expect(onBack!()).toBe(true); // consumido: la app no se cierra
    });
    expect(screen.queryByTestId("scanner")).toBeNull();
    expect(screen.getByText("Escanear QR")).toBeTruthy();
    expect(remove).toHaveBeenCalled();
  });

  it("Cancelar vuelve a la pantalla inicial sin emparejar", async () => {
    await renderScreen(<ConnectScreen />);
    await startScan();
    await fireEvent.press(screen.getByText("Cancelar"));
    expect(screen.queryByTestId("scanner")).toBeNull();
    expect(screen.getByText("Escanear QR")).toBeTruthy();
    expect(client.pair).not.toHaveBeenCalled();
  });
});

describe("Conectar · errores", () => {
  const CASES: [ErrorKey, string][] = [
    ["errors.qr.not_ours", es.errors.qr.not_ours],
    ["errors.qr.bad_format", es.errors.qr.bad_format],
    ["errors.qr.host_not_private", es.errors.qr.host_not_private],
    ["errors.qr.expired", es.errors.qr.expired],
    ["errors.pair.rejected", es.errors.pair.rejected],
    ["errors.pair.timeout", es.errors.pair.timeout],
    ["errors.pair.invalid_code", es.errors.pair.invalid_code],
    ["errors.pair.busy", es.errors.pair.busy],
    ["errors.revoked", es.errors.revoked],
    ["errors.authFailed", es.errors.authFailed],
    ["errors.incompatible", es.errors.incompatible],
    ["errors.rateLimited", es.errors.rateLimited],
    ["errors.notPrivate", es.errors.notPrivate],
    ["errors.unreachable", es.errors.unreachable],
    ["errors.protocol", es.errors.protocol],
  ];

  it.each(CASES)("%s se muestra con su texto", async (key, text) => {
    useConn.setState({ lastError: key });
    await renderScreen(<ConnectScreen />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("después de un error se puede volver a escanear", async () => {
    useConn.setState({ lastError: "errors.pair.rejected" });
    await renderScreen(<ConnectScreen />);
    await startScan();
    expect(screen.getByTestId("scanner")).toBeTruthy();
  });
});

describe("Conectar · esperando a la PC", () => {
  const pending = { host: "192.168.100.5", port: 47800, name: "PC-DE-JAY", code: "c".repeat(22), pcPublicKey: "P".repeat(43), devicePrivateKey: "K".repeat(43), deviceName: "Pixel de Jay" };

  it("fase waitingPc: 'Confirmá en la PC…' con el nombre de la PC, y Cancelar", async () => {
    useConn.setState({ status: "pairing", pairing: { phase: "waitingPc" }, pendingPair: pending });
    await renderScreen(<ConnectScreen />);
    expect(screen.getByText("Confirmá en la PC…")).toBeTruthy();
    expect(screen.getByText("PC-DE-JAY pregunta si te deja entrar.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Cancelar"));
    expect(client.cancelPair).toHaveBeenCalledTimes(1);
  });

  it("fase sent: 'Conectando…' todavía sin pedir confirmación", async () => {
    useConn.setState({ status: "pairing", pairing: { phase: "sent" }, pendingPair: pending });
    await renderScreen(<ConnectScreen />);
    expect(screen.getByText("Conectando…")).toBeTruthy();
    expect(screen.queryByText("Confirmá en la PC…")).toBeNull();
  });

  it("si el estado cambia mientras se espera, la pantalla se actualiza", async () => {
    useConn.setState({ status: "pairing", pairing: { phase: "sent" }, pendingPair: pending });
    await renderScreen(<ConnectScreen />);
    await act(async () => {
      useConn.setState({ pairing: { phase: "waitingPc" } });
    });
    expect(screen.getByText("Confirmá en la PC…")).toBeTruthy();
  });
});

describe("Conectar · apaisado", () => {
  it("en vertical las columnas van una debajo de otra", async () => {
    await renderScreen(<ConnectScreen />);
    expect(hasRowAncestor(screen.getByText(es.connect.help))).toBe(false);
  });

  it("en apaisado la pantalla inicial pone las columnas en fila", async () => {
    mockLandscape = true;
    await renderScreen(<ConnectScreen />);
    expect(screen.getByText(es.connect.help)).toBeTruthy();
    expect(screen.getByText(es.connect.localOnly)).toBeTruthy();
    expect(hasRowAncestor(screen.getByText(es.connect.help))).toBe(true);
  });

  it("escanear funciona en apaisado", async () => {
    mockLandscape = true;
    await renderScreen(<ConnectScreen />);
    await startScan();
    expect(screen.getByTestId("scanner")).toBeTruthy();
    expect(screen.getByText(es.connect.scanHint)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("scanner"));
    expect(client.pair).toHaveBeenCalledTimes(1);
  });

  it("esperar a la PC se ve en apaisado", async () => {
    mockLandscape = true;
    useConn.setState({
      status: "pairing",
      pairing: { phase: "waitingPc" },
      pendingPair: { host: "192.168.100.5", port: 47800, name: "PC-DE-JAY", code: "c".repeat(22), pcPublicKey: "P".repeat(43), devicePrivateKey: "K".repeat(43), deviceName: "Pixel" },
    });
    await renderScreen(<ConnectScreen />);
    expect(screen.getByText("Confirmá en la PC…")).toBeTruthy();
    expect(hasRowAncestor(screen.getByText("Confirmá en la PC…"))).toBe(true);
  });
});
