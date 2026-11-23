import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LandscapeMenu } from "@/components/LandscapeMenu";
import { initI18n } from "@/i18n";

const mockNavigate = jest.fn();
let mockPath = "/";
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mockNavigate }),
  usePathname: () => mockPath,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const METRICS = { frame: { x: 0, y: 0, width: 800, height: 360 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const renderMenu = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

beforeAll(() => {
  initI18n("es");
});
beforeEach(() => {
  mockNavigate.mockClear();
  mockPath = "/";
});

describe("LandscapeMenu", () => {
  it("empieza cerrado: solo se ve el botón para abrir", async () => {
    await renderMenu(<LandscapeMenu />);
    expect(screen.getByLabelText("Abrir menú")).toBeTruthy();
    expect(screen.queryByText("Pantallas")).toBeNull();
  });

  it("al tocar el botón se abre y muestra las 5 secciones", async () => {
    await renderMenu(<LandscapeMenu />);
    await fireEvent.press(screen.getByLabelText("Abrir menú"));
    for (const label of ["Escenas", "Pantallas", "Apps", "Audio", "Pad"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText("Cerrar menú")).toBeTruthy();
  });

  it("elegir una sección navega y cierra el menú", async () => {
    await renderMenu(<LandscapeMenu />);
    await fireEvent.press(screen.getByLabelText("Abrir menú"));
    await fireEvent.press(screen.getByText("Audio"));
    expect(mockNavigate).toHaveBeenCalledWith("/audio");
    expect(screen.queryByText("Pantallas")).toBeNull();
  });

  it("Apps navega a la raíz (es la pantalla inicial, D94) y Escenas a su pestaña", async () => {
    mockPath = "/audio";
    await renderMenu(<LandscapeMenu />);
    await fireEvent.press(screen.getByLabelText("Abrir menú"));
    await fireEvent.press(screen.getByText("Apps"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
    await fireEvent.press(screen.getByLabelText("Abrir menú"));
    await fireEvent.press(screen.getByText("Escenas"));
    expect(mockNavigate).toHaveBeenCalledWith("/deck");
  });

  it("el mismo botón ☰ cierra el menú", async () => {
    await renderMenu(<LandscapeMenu />);
    await fireEvent.press(screen.getByLabelText("Abrir menú"));
    await fireEvent.press(screen.getByLabelText("Cerrar menú"));
    expect(screen.queryByText("Pantallas")).toBeNull();
    expect(screen.getByLabelText("Abrir menú")).toBeTruthy();
  });

  it("tocar fuera del panel (el fondo oscuro) lo cierra sin navegar", async () => {
    await renderMenu(<LandscapeMenu />);
    await fireEvent.press(screen.getByLabelText("Abrir menú"));
    await fireEvent.press(screen.getByTestId("menu-backdrop"));
    expect(screen.queryByText("Pantallas")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("marca la sección actual como seleccionada", async () => {
    mockPath = "/";
    await renderMenu(<LandscapeMenu />);
    await fireEvent.press(screen.getByLabelText("Abrir menú"));
    expect(screen.getByRole("button", { name: "Apps", selected: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Audio", selected: true })).toBeNull();
  });
});
