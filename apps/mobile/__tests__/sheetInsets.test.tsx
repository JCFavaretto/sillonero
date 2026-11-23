import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Sheet } from "@/components/Sheet";
import { AppText } from "@/components/ui";
import { initI18n } from "@/i18n";

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));

beforeAll(() => initI18n("es"));

const withInsets = (insets: { top: number; left: number; right: number; bottom: number }) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets }}>
    <Sheet onClose={() => undefined}>
      <AppText>contenido</AppText>
    </Sheet>
  </SafeAreaProvider>
);

describe("las hojas no se dibujan debajo de la barra de Android (atrás, inicio, recientes)", () => {
  it("en vertical, la hoja pegada abajo suma el alto de la barra a su relleno de abajo", async () => {
    mockLandscape = false;
    await render(withInsets({ top: 0, left: 0, right: 0, bottom: 48 }));
    const style = StyleSheet.flatten(screen.getByTestId("sheet").props.style) as { paddingBottom: number };
    expect(style.paddingBottom).toBeGreaterThanOrEqual(48 + 16);
  });

  it("sin barra (gestos), queda el relleno de siempre", async () => {
    mockLandscape = false;
    await render(withInsets({ top: 0, left: 0, right: 0, bottom: 0 }));
    const style = StyleSheet.flatten(screen.getByTestId("sheet").props.style) as { paddingBottom: number };
    expect(style.paddingBottom).toBe(16);
  });

  it("en apaisado la barra queda de costado: el fondo de la hoja se corre del borde", async () => {
    mockLandscape = true;
    await render(withInsets({ top: 0, left: 0, right: 56, bottom: 0 }));
    const sheet = screen.getByTestId("sheet");
    let p = sheet.parent as { props?: { style?: unknown }; parent: unknown } | null;
    let found = false;
    while (p) {
      const s = StyleSheet.flatten(p.props?.style as never) as { paddingRight?: number } | undefined;
      if (s?.paddingRight === 56) found = true;
      p = p.parent as typeof p;
    }
    expect(found).toBe(true);
  });
});
