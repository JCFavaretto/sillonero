import { columnsFor, isLandscape, menuModeFor } from "@/layout/rules";

describe("columnsFor", () => {
  it.each([
    [360, 3],
    [479, 3],
    [480, 4],
    [699, 4],
    [700, 5],
    [800, 5],
    [1200, 5],
  ])("deck con ancho %i → %i columnas", (width, cols) => {
    expect(columnsFor(width, "deck")).toBe(cols);
  });

  it.each([
    [360, 1],
    [599, 1],
    [600, 2],
    [800, 2],
  ])("list con ancho %i → %i columnas", (width, cols) => {
    expect(columnsFor(width, "list")).toBe(cols);
  });

  it("con un ancho raro devuelve el mínimo", () => {
    expect(columnsFor(0, "deck")).toBe(3);
    expect(columnsFor(NaN, "list")).toBe(1);
    expect(columnsFor(-50, "deck")).toBe(3);
  });
});

describe("isLandscape", () => {
  it("es apaisado cuando el ancho supera al alto", () => {
    expect(isLandscape(800, 360)).toBe(true);
    expect(isLandscape(360, 800)).toBe(false);
  });
  it("un cuadrado cuenta como vertical", () => {
    expect(isLandscape(500, 500)).toBe(false);
  });
});

describe("menuModeFor", () => {
  it("barra abajo en vertical; en apaisado el menú se esconde y se abre con un botón", () => {
    expect(menuModeFor(false)).toBe("bottom-bar");
    expect(menuModeFor(true)).toBe("drawer");
  });
});
