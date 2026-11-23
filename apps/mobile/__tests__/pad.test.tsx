import { act, fireEvent, screen } from "@testing-library/react-native";
import PadTab from "@/app/(tabs)/pad";
import { setAppsBridge } from "@/apps/commands";
import { useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { initI18n } from "@/i18n";
import { initialPad, usePad } from "@/pad/store";
import { DEFAULT_SETTINGS } from "@/pad/controller";
import { PC, SNAPSHOT, hasRowAncestor, renderScreen } from "./screenHelpers";

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
jest.mock("@/haptics", () => ({ tap: jest.fn(), bump: jest.fn(), tick: jest.fn() }));
jest.mock("expo-keep-awake", () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual<typeof import("react")>("react").useEffect(cb, [cb]),
}));
jest.mock("@/connection", () => ({
  client: { retry: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const STATE = { available: true, enabled: true, elevated: false, holding: { left: false, alt: false } };
let calls: Array<[string, unknown]> = [];
let fired: Array<[string, unknown]> = [];
let result: { ok: true } | { ok: false; reason: string } = { ok: true };

function bridge() {
  setAppsBridge({
    command: (async (type: string, payload: unknown) => {
      calls.push([type, payload]);
      return result;
    }) as never,
    query: () => null,
    fire: ((type: string, payload: unknown) => {
      fired.push([type, payload]);
      return true;
    }) as never,
    measure: jest.fn(),
  });
}
const flush = async (ms = 0) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

beforeAll(() => {
  initI18n("es");
  jest.useFakeTimers();
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  mockLandscape = false;
  calls = [];
  fired = [];
  result = { ok: true };
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  usePad.setState({ ...initialPad, state: STATE, settings: DEFAULT_SETTINGS, settingsLoaded: true });
  bridge();
});

describe("Pad · puertas", () => {
  it("sin conexión: explica y no muestra el touchpad", async () => {
    useConn.setState({ ...initialState, pc: PC, status: "offline" }, true);
    await renderScreen(<PadTab />);
    expect(screen.getByTestId("pad-gate-offline")).toBeTruthy();
    expect(screen.getByText("Sin conexión con la PC")).toBeTruthy();
    expect(screen.queryByTestId("touchpad")).toBeNull();
  });

  it("esperando el primer estado de la PC", async () => {
    usePad.setState({ state: null });
    await renderScreen(<PadTab />);
    expect(screen.getByTestId("pad-gate-loading")).toBeTruthy();
  });

  it("llave apagada en la PC: dice dónde se prende", async () => {
    usePad.setState({ state: { ...STATE, enabled: false } });
    await renderScreen(<PadTab />);
    expect(screen.getByTestId("pad-gate-disabled")).toBeTruthy();
    expect(screen.getByText(/Mouse y teclado remotos/)).toBeTruthy();
    expect(screen.getByText("Apagado en la PC")).toBeTruthy();
  });

  it("sin entrada de Windows en esta PC", async () => {
    usePad.setState({ state: { ...STATE, available: false } });
    await renderScreen(<PadTab />);
    expect(screen.getByTestId("pad-gate-unavailable")).toBeTruthy();
  });

  it("no hay botón para tomar el control ni pedir permiso: emparejado = usa todo", async () => {
    await renderScreen(<PadTab />);
    expect(screen.queryByText(/Tomar el control/i)).toBeNull();
    expect(screen.queryByText(/permiso/i)).toBeNull();
    expect(screen.getByText("Control activo")).toBeTruthy();
  });
});

describe.each([["vertical", false], ["apaisado", true]] as const)("Pad · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });

  it("muestra el touchpad grande, la barra de clic, las tres pestañas y 'Soltar todo'", async () => {
    await renderScreen(<PadTab />);
    expect(screen.getByTestId("touchpad")).toBeTruthy();
    expect(screen.getByTestId("click-left")).toBeTruthy();
    expect(screen.getByTestId("click-right")).toBeTruthy();
    expect(screen.getByTestId("click-lock")).toBeTruthy();
    for (const id of ["touch", "keyboard", "shortcuts"]) expect(screen.getByTestId(`seg-${id}`)).toBeTruthy();
    expect(screen.getByText("Soltar todo")).toBeTruthy();
    // en apaisado el contenido y la columna de controles van en fila
    expect(hasRowAncestor(screen.getByTestId("touchpad"))).toBe(landscape);
  });

  it("la latencia aparece en la esquina y avisa 'Wi-Fi lento'", async () => {
    await renderScreen(<PadTab />);
    expect(screen.getByText("— ms", { includeHiddenElements: true })).toBeTruthy();
    await act(async () => {
      for (const v of [18, 18, 18]) usePad.getState().addLatency(v);
    });
    expect(screen.getByText("18 ms", { includeHiddenElements: true })).toBeTruthy();
    await act(async () => {
      usePad.getState().resetLatency();
      for (const v of [140, 140, 140]) usePad.getState().addLatency(v);
    });
    expect(screen.getByText("140 ms · Wi-Fi lento", { includeHiddenElements: true })).toBeTruthy();
  });

  it("los clics de la barra mandan pad.button", async () => {
    await renderScreen(<PadTab />);
    await fireEvent.press(screen.getByTestId("click-left"));
    await fireEvent.press(screen.getByTestId("click-right"));
    await flush();
    expect(calls).toEqual([
      ["pad.button", { button: "left", action: "click" }],
      ["pad.button", { button: "right", action: "click" }],
    ]);
  });

  it("el botón de la rueda manda el clic del medio", async () => {
    await renderScreen(<PadTab />);
    await fireEvent.press(screen.getByTestId("click-middle"));
    await flush();
    expect(calls).toEqual([["pad.button", { button: "middle", action: "click" }]]);
  });

  it("ajustes y 'Soltar todo' están arriba: el touchpad y la barra de clic llegan hasta abajo", async () => {
    await renderScreen(<PadTab />);
    expect(screen.getByTestId("pad-settings-open")).toBeTruthy();
    expect(screen.getByTestId("pad-release")).toBeTruthy();
  });

  it("el candado deja el clic apretado y al tocarlo otra vez lo suelta", async () => {
    await renderScreen(<PadTab />);
    await fireEvent.press(screen.getByTestId("click-lock"));
    await flush();
    expect(calls.at(-1)).toEqual(["pad.button", { button: "left", action: "down" }]);
    expect(screen.getByText("Clic izq. mantenido")).toBeTruthy();
    // mientras está apretado avisa cada segundo (si no, la PC lo suelta a los 3 s)
    fired = [];
    await flush(2_100);
    expect(fired.filter(([t, p]) => t === "pad.move" && (p as { dx: number }).dx === 0).length).toBeGreaterThanOrEqual(2);
    await fireEvent.press(screen.getByTestId("click-lock"));
    await flush();
    expect(calls.at(-1)).toEqual(["pad.button", { button: "left", action: "up" }]);
    expect(screen.getByText("Clic izq.")).toBeTruthy();
  });

  it("'Soltar todo' manda pad.release y apaga el candado", async () => {
    await renderScreen(<PadTab />);
    await fireEvent.press(screen.getByTestId("click-lock"));
    await flush();
    await fireEvent.press(screen.getByTestId("pad-release"));
    await flush();
    expect(calls.some(([t]) => t === "pad.release")).toBe(true);
    expect(usePad.getState().lock).toBe(false);
  });

  it("un error de la PC se ve (la ventana de administrador no deja escribir)", async () => {
    result = { ok: false, reason: "input_blocked" };
    await renderScreen(<PadTab />);
    await fireEvent.press(screen.getByTestId("seg-shortcuts"));
    await fireEvent.press(screen.getByTestId("shortcut-copy"));
    await flush();
    expect(screen.getByText(/ventana activa es de administrador/)).toBeTruthy();
  });

  it("si la ventana del frente es de administrador lo avisa", async () => {
    usePad.setState({ state: { ...STATE, elevated: true } });
    await renderScreen(<PadTab />);
    expect(screen.getByText(/ventana del frente es de administrador/)).toBeTruthy();
  });

  it("los ajustes se abren, se cambian y se guardan", async () => {
    await renderScreen(<PadTab />);
    await fireEvent.press(screen.getByTestId("pad-settings-open"));
    expect(screen.getByTestId("pad-settings")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("sens-more"));
    expect(usePad.getState().settings.sensitivity).toBeCloseTo(1.5, 5);
    await fireEvent(screen.getByTestId("natural"), "valueChange", false);
    expect(usePad.getState().settings.naturalScroll).toBe(false);
    await fireEvent.press(screen.getByText("Restablecer"));
    expect(usePad.getState().settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe.each([["vertical", false], ["apaisado", true]] as const)("Pad · teclado · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });
  const open = async () => {
    await renderScreen(<PadTab />);
    await fireEvent.press(screen.getByTestId("seg-keyboard"));
  };

  it("lo que se escribe se escribe en la PC al instante; corregir borra lo justo", async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId("pad-field"), "lofi hip");
    await flush(60);
    expect(calls).toEqual([["pad.type", { backspaces: 0, text: "lofi hip" }]]);
    calls = [];
    await fireEvent.changeText(screen.getByTestId("pad-field"), "lofi hop");
    await flush(60);
    expect(calls).toEqual([["pad.type", { backspaces: 2, text: "op" }]]);
  });

  it("Enviar aprieta Enter y vacía el campo", async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId("pad-field"), "jazz");
    await flush(60);
    calls = [];
    await fireEvent.press(screen.getByTestId("pad-send"));
    await flush();
    expect(calls).toEqual([["pad.key", { key: "enter", mods: [] }]]);
    expect(screen.getByTestId("pad-field").props.value).toBe("");
  });

  it("Vaciar limpia el campo sin tocar la PC", async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId("pad-field"), "algo");
    await flush(60);
    calls = [];
    await fireEvent.press(screen.getByTestId("pad-clear"));
    await flush();
    expect(calls).toEqual([]);
    expect(screen.getByTestId("pad-field").props.value).toBe("");
  });

  it("Ctrl enganchado + una letra = Ctrl+letra, y el campo no cambia", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("mod-ctrl"));
    expect(usePad.getState().mods.ctrl).toBe("once");
    await fireEvent.changeText(screen.getByTestId("pad-field"), "l");
    await flush(60);
    expect(calls).toEqual([["pad.key", { key: "l", mods: ["ctrl"] }]]);
    expect(screen.getByTestId("pad-field").props.value).toBe("");
    expect(usePad.getState().mods.ctrl).toBe("off");
  });

  it("dos toques seguidos en un modificador lo dejan fijo", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("mod-shift"));
    await fireEvent.press(screen.getByTestId("mod-shift"));
    expect(usePad.getState().mods.shift).toBe("locked");
    expect(screen.getByTestId("mod-shift-locked")).toBeTruthy();
  });

  it("las teclas especiales mandan pad.key, con lo enganchado", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("mod-ctrl"));
    await fireEvent(screen.getByTestId("key-left"), "pressIn");
    await fireEvent(screen.getByTestId("key-left"), "pressOut");
    await flush();
    expect(calls).toEqual([["pad.key", { key: "left", mods: ["ctrl"] }]]);
  });

  it("mantener una flecha la repite (después de 400 ms, 10 por segundo) y soltar la corta", async () => {
    await open();
    await fireEvent(screen.getByTestId("key-right"), "pressIn");
    await flush(400 + 500);
    const n = calls.filter(([t]) => t === "pad.key").length;
    expect(n).toBeGreaterThanOrEqual(5);
    await fireEvent(screen.getByTestId("key-right"), "pressOut");
    calls = [];
    await flush(1_000);
    expect(calls).toEqual([]);
  });

  it("una tecla que no se repite (Esc) sale una sola vez aunque se mantenga", async () => {
    await open();
    await fireEvent(screen.getByTestId("key-esc"), "pressIn");
    await flush(2_000);
    await fireEvent(screen.getByTestId("key-esc"), "pressOut");
    expect(calls.filter(([t]) => t === "pad.key")).toHaveLength(1);
  });

  it("la tira de touchpad solo está en vertical", async () => {
    await open();
    expect(screen.queryAllByTestId("touchpad").length).toBe(landscape ? 0 : 1);
  });
});

describe("Pad · atajos y Alt+Tab", () => {
  const open = async () => {
    await renderScreen(<PadTab />);
    await fireEvent.press(screen.getByTestId("seg-shortcuts"));
  };

  it("cada atajo manda su nombre (nunca teclas)", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("shortcut-addressBar"));
    await fireEvent.press(screen.getByTestId("shortcut-ytPlayPause"));
    await flush();
    expect(calls).toEqual([
      ["pad.shortcut", { name: "addressBar" }],
      ["pad.shortcut", { name: "ytPlayPause" }],
    ]);
  });

  it("los cuatro grupos y las combinaciones a la vista", async () => {
    await open();
    for (const g of ["VENTANAS", "NAVEGADOR", "YOUTUBE", "EDITAR"]) expect(screen.getByText(g)).toBeTruthy();
    expect(screen.getByText("Ctrl+L")).toBeTruthy();
    expect(screen.getByText("Alt+Tab")).toBeTruthy();
  });

  it("Alt+Tab: abre el panel, ◀ ▶ mueven, Elegir suelta", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("shortcut-altTab"));
    await flush();
    await act(async () => usePad.setState({ state: { ...STATE, holding: { left: false, alt: true } } })); // la PC confirma que Alt quedó apretado
    expect(calls.at(-1)).toEqual(["pad.altTab", { step: "start" }]);
    expect(screen.getByTestId("alttab")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("alttab-next"));
    await fireEvent.press(screen.getByTestId("alttab-prev"));
    await flush();
    expect(calls.slice(-2)).toEqual([["pad.altTab", { step: "next" }], ["pad.altTab", { step: "prev" }]]);
    await fireEvent.press(screen.getByTestId("alttab-commit"));
    await flush();
    expect(calls.at(-1)).toEqual(["pad.altTab", { step: "commit" }]);
    expect(screen.queryByTestId("alttab")).toBeNull();
  });

  it("Cancelar manda cancel y vuelve a la grilla", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("shortcut-altTab"));
    await flush();
    await act(async () => usePad.setState({ state: { ...STATE, holding: { left: false, alt: true } } }));
    await fireEvent.press(screen.getByTestId("alttab-cancel"));
    await flush();
    expect(calls.at(-1)).toEqual(["pad.altTab", { step: "cancel" }]);
    expect(screen.getByTestId("shortcuts")).toBeTruthy();
  });

  it("si la PC nunca confirma que Alt quedó apretado, el panel se cierra solo a los 2,5 s", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("shortcut-altTab"));
    await flush();
    expect(screen.getByTestId("alttab")).toBeTruthy();
    await flush(2_600);
    expect(screen.queryByTestId("alttab")).toBeNull();
  });

  it("si la PC eligió sola (Alt ya no está apretado), el panel se cierra", async () => {
    await open();
    usePad.setState({ state: { ...STATE, holding: { left: false, alt: true } } });
    await fireEvent.press(screen.getByTestId("shortcut-altTab"));
    await flush();
    expect(screen.getByTestId("alttab")).toBeTruthy();
    await act(async () => usePad.setState({ state: { ...STATE, holding: { left: false, alt: false } } }));
    expect(screen.queryByTestId("alttab")).toBeNull();
  });
});
