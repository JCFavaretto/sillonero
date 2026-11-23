import type { ScreensState } from "@proyecto-e/protocol";
import { screensActions } from "@/screens/actions";
import { DEMO_MONITORS, loadScreensDemo } from "@/screens/demo";
import { applyScreensState, initialScreens, useScreens } from "@/screens/store";

const REAL: ScreensState = { monitors: [{ ...DEMO_MONITORS[0]!, name: "REAL" }], foreground: null };

beforeEach(() => useScreens.setState({ ...initialScreens }, true));

describe("applyScreensState", () => {
  it("guarda las pantallas de la PC y apaga el modo demo", () => {
    loadScreensDemo();
    expect(useScreens.getState().demo).toBe(true);
    applyScreensState(REAL);
    const s = useScreens.getState();
    expect(s.monitors.map((m) => m.name)).toEqual(["REAL"]);
    expect(s.demo).toBe(false);
    expect(s.error).toBeNull();
  });

  it("null borra todo", () => {
    applyScreensState(REAL);
    applyScreensState(null);
    expect(useScreens.getState()).toEqual(initialScreens);
  });

  it("con datos reales los botones no inventan cambios: las acciones locales no hacen nada", () => {
    applyScreensState(REAL);
    screensActions.setEnabled(REAL.monitors[0]!.id, false);
    screensActions.rename(REAL.monitors[0]!.id, "Otro");
    expect(useScreens.getState().monitors[0]).toMatchObject({ enabled: true, nickname: null });
  });
});
