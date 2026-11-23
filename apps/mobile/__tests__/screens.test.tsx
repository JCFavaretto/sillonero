import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import ScreensTab from "@/app/(tabs)/screens";
import { client, useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { initI18n } from "@/i18n";
import { DEMO_FOREGROUND, DEMO_MONITORS, loadScreensDemo } from "@/screens/demo";
import { setCommandSender } from "@/screens/commands";
import { applyScreensState, initialScreens, useScreens } from "@/screens/store";
import { PC, SNAPSHOT, hasRowAncestor, renderScreen } from "./screenHelpers";

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
jest.mock("@/connection", () => ({
  client: { retry: jest.fn() },
  useConn: jest.requireActual("@/connection/store").useConn,
}));

beforeAll(() => {
  initI18n("es");
});
const mockSend = jest.fn();
beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ ok: true });
  setCommandSender(mockSend);
  mockLandscape = false;
  jest.clearAllMocks();
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  useScreens.setState({ ...initialScreens }, true);
  loadScreensDemo();
});

const patchMonitor = (id: string, patch: Record<string, unknown>) =>
  act(async () => {
    useScreens.setState({
      monitors: useScreens.getState().monitors.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  });
const pick = (id: string) => fireEvent.press(screen.getByTestId(`map-mon-${id}`));
const TELE = DEMO_MONITORS.find((m) => m.nickname === "Tele living")!;
const PRINCIPAL = DEMO_MONITORS.find((m) => m.primary)!;

describe("Pantallas · datos", () => {
  it("lista las 3 pantallas con apodo o nombre, resolución y conector", async () => {
    await renderScreen(<ScreensTab />);
    expect(screen.getByRole("header", { name: "Pantallas" })).toBeTruthy();
    expect(screen.getAllByText("Tele living").length).toBeGreaterThan(0);
    // el panel muestra la elegida (la de la ventana activa: la principal) y cada ficha su resolución
    expect(screen.getByText(/2560×1440 · DisplayPort/)).toBeTruthy();
    await pick(TELE.id);
    expect(screen.getByText(/3840×2160 · HDMI/)).toBeTruthy();
  });

  it("el mapa dibuja una caja por pantalla con su número", async () => {
    await renderScreen(<ScreensTab />);
    expect(screen.getAllByTestId(/^map-mon-/, { includeHiddenElements: true }).length).toBe(3);
  });

  it("la principal lleva ★ y su interruptor está deshabilitado con la leyenda", async () => {
    await renderScreen(<ScreensTab />);
    expect(screen.getByText(/es la principal, no se apaga/)).toBeTruthy();
    await pick(PRINCIPAL.id);
    const sw = screen.getByRole("switch", { name: new RegExp(PRINCIPAL.name) });
    expect(sw.props.accessibilityState?.disabled ?? sw.props.disabled).toBeTruthy();
  });

  it("la única prendida dice por qué no se apaga", async () => {
    await renderScreen(<ScreensTab />);
    await patchMonitor(PRINCIPAL.id, { blockedBy: "last_active", canDisable: false });
    expect(await screen.findByText(/es la única prendida/)).toBeTruthy();
  });

  it("una apagada se marca como apagada", async () => {
    await renderScreen(<ScreensTab />);
    await pick(TELE.id);
    expect(screen.getByText(/HDMI · apagada/)).toBeTruthy();
  });
});

describe("Pantallas · elegir una pantalla", () => {
  it("al abrir queda elegida la de la ventana activa; tocar otra mueve el panel y la marca", async () => {
    await renderScreen(<ScreensTab />);
    expect(screen.getByTestId(`map-mon-${DEMO_FOREGROUND.monitorId}`).props.accessibilityState.selected).toBe(true);
    await pick(TELE.id);
    expect(screen.getByTestId(`map-mon-${TELE.id}`).props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId(`map-mon-${DEMO_FOREGROUND.monitorId}`).props.accessibilityState.selected).toBe(false);
    expect(screen.getByRole("switch", { name: /Tele living/ })).toBeTruthy();
  });

  it("si la elegida se desenchufa vuelve a la de la ventana activa", async () => {
    await renderScreen(<ScreensTab />);
    await pick(TELE.id);
    await act(async () => {
      useScreens.setState({ monitors: useScreens.getState().monitors.filter((m) => m.id !== TELE.id) });
    });
    expect(screen.getByTestId(`map-mon-${DEMO_FOREGROUND.monitorId}`).props.accessibilityState.selected).toBe(true);
  });

  it("la principal lleva la etiqueta 'principal' en el mapa", async () => {
    await renderScreen(<ScreensTab />);
    expect(screen.getAllByText("principal").length).toBe(1);
  });

  it("el panel tiene Renombrar y abre la hoja con el apodo de la elegida", async () => {
    await renderScreen(<ScreensTab />);
    await pick(TELE.id);
    await fireEvent.press(screen.getByRole("button", { name: "Renombrar" }));
    expect(screen.getByDisplayValue("Tele living")).toBeTruthy();
  });
});

describe("Pantallas · interruptores", () => {
  it("apagar una pantalla (demo) la deja apagada", async () => {
    await renderScreen(<ScreensTab />);
    const first = DEMO_MONITORS.find((m) => m.canDisable && m.enabled)!;
    await pick(first.id);
    await fireEvent(screen.getByRole("switch", { name: new RegExp(first.name) }), "valueChange", false);
    expect(useScreens.getState().monitors.find((m) => m.id === first.id)?.enabled).toBe(false);
  });

  it("cambiando: muestra 'Prendiendo…' y no deja tocar ese interruptor", async () => {
    await renderScreen(<ScreensTab />);
    await patchMonitor(TELE.id, { busy: true });
    await pick(TELE.id);
    expect(await screen.findByText(/Prendiendo…/)).toBeTruthy();
    await pick(TELE.id);
    const sw = screen.getByRole("switch", { name: /Tele living/ });
    expect(sw.props.accessibilityState?.disabled ?? sw.props.disabled).toBeTruthy();
  });

  it("muestra el error del último comando", async () => {
    await renderScreen(<ScreensTab />);
    await act(async () => {
      useScreens.setState({ error: "screens.error.failed" });
    });
    expect(await screen.findByText(/No se pudo completar/)).toBeTruthy();
  });
});

describe("Pantallas · ventana activa", () => {
  it("muestra el título de la ventana, la dibuja en su pantalla y ofrece mandarla a la elegida", async () => {
    await renderScreen(<ScreensTab />);
    expect(screen.getByText(DEMO_FOREGROUND.title)).toBeTruthy();
    expect(screen.getByTestId(`map-window-${DEMO_FOREGROUND.monitorId}`)).toBeTruthy();
    expect(screen.getAllByTestId(/^map-window-/).length).toBe(1);
    const izq = DEMO_MONITORS.find((m) => m.enabled && m.id !== DEMO_FOREGROUND.monitorId)!;
    await pick(izq.id);
    const b = screen.getByRole("button", { name: "Mandar la ventana activa acá" });
    expect(Boolean(b.props.accessibilityState?.disabled ?? b.props.disabled)).toBe(false);
  });

  it("a una pantalla apagada no se le manda la ventana: el botón queda deshabilitado", async () => {
    await renderScreen(<ScreensTab />);
    await pick(TELE.id);
    const b = screen.getByRole("button", { name: "Mandar la ventana activa acá" });
    expect(Boolean(b.props.accessibilityState?.disabled ?? b.props.disabled)).toBe(true);
  });

  it("el botón de la pantalla donde ya está queda deshabilitado", async () => {
    await renderScreen(<ScreensTab />);
    const here = DEMO_MONITORS.find((m) => m.id === DEMO_FOREGROUND.monitorId)!;
    await pick(here.id);
    const btn = screen.getByRole("button", { name: "La ventana activa ya está acá" });
    expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeTruthy();
  });

  it("mover (demo) cambia la pantalla de la ventana", async () => {
    await renderScreen(<ScreensTab />);
    const other = DEMO_MONITORS.find((m) => m.enabled && m.id !== DEMO_FOREGROUND.monitorId)!;
    await pick(other.id);
    await fireEvent.press(screen.getByRole("button", { name: "Mandar la ventana activa acá" }));
    expect(useScreens.getState().foreground?.monitorId).toBe(other.id);
  });

  it("sin ventana activa lo dice y no hay botones Mover", async () => {
    await renderScreen(<ScreensTab />);
    await act(async () => {
      useScreens.setState({ foreground: null });
    });
    expect(await screen.findByText("No hay ventana activa")).toBeTruthy();
    const b = screen.getByRole("button", { name: "Mandar la ventana activa acá" });
    expect(Boolean(b.props.accessibilityState?.disabled ?? b.props.disabled)).toBe(true);
    expect(screen.queryByTestId(/^map-window-/)).toBeNull();
  });
});

describe("Pantallas · renombrar", () => {
  const openSheet = async () => {
    await renderScreen(<ScreensTab />);
    await fireEvent(screen.getByTestId(`map-mon-${TELE.id}`), "longPress");
  };

  it("el toque largo abre la hoja con el apodo actual", async () => {
    await openSheet();
    expect(screen.getByText("Apodo de la pantalla")).toBeTruthy();
    expect(screen.getByText("Es la de 3840×2160 · HDMI")).toBeTruthy();
    expect(screen.getByDisplayValue("Tele living")).toBeTruthy();
  });

  it("guardar cambia el apodo y cierra la hoja", async () => {
    await openSheet();
    await fireEvent.changeText(screen.getByDisplayValue("Tele living"), "Tele del cuarto");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull());
    expect(useScreens.getState().monitors.find((m) => m.id === TELE.id)?.nickname).toBe("Tele del cuarto");
  });

  it("Guardar está deshabilitado si no cambió", async () => {
    await openSheet();
    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save.props.accessibilityState?.disabled ?? save.props.disabled).toBeTruthy();
  });

  it("el campo no pasa de 32 caracteres y muestra el contador", async () => {
    await openSheet();
    expect(screen.getByDisplayValue("Tele living").props.maxLength).toBe(32);
    expect(screen.getByText("11/32")).toBeTruthy();
  });

  it("Quitar apodo solo aparece si ya tenía uno, y lo borra", async () => {
    await openSheet();
    await fireEvent.press(screen.getByRole("button", { name: "Quitar apodo" }));
    await waitFor(() => expect(useScreens.getState().monitors.find((m) => m.id === TELE.id)?.nickname).toBeNull());
  });

  it("sin apodo no hay 'Quitar apodo' y el campo sugiere el nombre del monitor", async () => {
    await renderScreen(<ScreensTab />);
    const sinApodo = DEMO_MONITORS.find((m) => m.nickname === null)!;
    await fireEvent(screen.getByTestId(`map-mon-${sinApodo.id}`), "longPress");
    expect(screen.queryByRole("button", { name: "Quitar apodo" })).toBeNull();
    expect(screen.getByPlaceholderText(sinApodo.name)).toBeTruthy();
  });

  it("Cancelar cierra sin cambiar nada", async () => {
    await openSheet();
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(useScreens.getState().monitors.find((m) => m.id === TELE.id)?.nickname).toBe("Tele living");
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });
});

describe("Pantallas · sin conexión", () => {
  it("todo deshabilitado, aviso y botón Reintentar", async () => {
    useConn.setState({ status: "offline" });
    await renderScreen(<ScreensTab />);
    expect(screen.getByText("Sin conexión")).toBeTruthy();
    for (const sw of screen.getAllByRole("switch")) expect(sw.props.accessibilityState?.disabled ?? sw.props.disabled).toBeTruthy();
    await fireEvent.press(screen.getByText("Reintentar"));
    expect(client.retry).toHaveBeenCalledTimes(1);
  });

  it("sin pantallas todavía (conectando) no rompe", async () => {
    useScreens.setState({ ...initialScreens }, true);
    useConn.setState({ status: "connecting" });
    await renderScreen(<ScreensTab />);
    expect(screen.getByText("Conectando…")).toBeTruthy();
  });
});

describe("Pantallas · Identificar (R7)", () => {
  const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean }; disabled?: boolean } }) =>
    Boolean(el.props.accessibilityState?.disabled ?? el.props.disabled);

  it("con la PC de verdad le pide monitor.identify", async () => {
    applyScreensState({ monitors: DEMO_MONITORS.map((m) => ({ ...m })), foreground: { ...DEMO_FOREGROUND } });
    await renderScreen(<ScreensTab />);
    await fireEvent.press(screen.getByRole("button", { name: "Identificar" }));
    expect(mockSend).toHaveBeenCalledWith("monitor.identify", {});
  });

  it("mientras la PC contesta queda deshabilitado (no se manda dos veces)", async () => {
    applyScreensState({ monitors: DEMO_MONITORS.map((m) => ({ ...m })), foreground: { ...DEMO_FOREGROUND } });
    let finish!: (v: { ok: true }) => void;
    mockSend.mockReturnValue(new Promise((r) => (finish = r)));
    await renderScreen(<ScreensTab />);
    await fireEvent.press(screen.getByRole("button", { name: "Identificar" }));
    expect(isDisabled(screen.getByRole("button", { name: "Identificar" }))).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Identificar" }));
    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(isDisabled(screen.getByRole("button", { name: "Identificar" }))).toBe(false));
  });

  it.each([
    ["busy", "La PC está terminando otro cambio. Esperá un momento."],
    ["failed", "No se pudo completar el cambio. Probá de nuevo."],
    ["unsupported", "Esto no está disponible en tu PC."],
  ])("si la PC no puede (%s) se muestra el motivo", async (reason, text) => {
    applyScreensState({ monitors: DEMO_MONITORS.map((m) => ({ ...m })), foreground: { ...DEMO_FOREGROUND } });
    mockSend.mockResolvedValueOnce({ ok: false, reason });
    await renderScreen(<ScreensTab />);
    await fireEvent.press(screen.getByRole("button", { name: "Identificar" }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("en la demo no manda nada (no hay PC)", async () => {
    await renderScreen(<ScreensTab />);
    await fireEvent.press(screen.getByRole("button", { name: "Identificar" }));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sin conexión no está el botón: se muestra el estado", async () => {
    useConn.setState({ status: "offline" });
    await renderScreen(<ScreensTab />);
    const b = screen.getByRole("button", { name: "Identificar" });
    expect(Boolean(b.props.accessibilityState?.disabled ?? b.props.disabled)).toBe(true);
  });
});

describe("Pantallas · apaisado", () => {
  it("mapa a un lado y panel al otro (en fila)", async () => {
    mockLandscape = true;
    await renderScreen(<ScreensTab />);
    expect(hasRowAncestor(screen.getByTestId("map-box", { includeHiddenElements: true }))).toBe(true);
    expect(hasRowAncestor(screen.getByRole("button", { name: "Identificar" }))).toBe(true);
  });

  it("en vertical todo va en columna", async () => {
    await renderScreen(<ScreensTab />);
    expect(hasRowAncestor(screen.getByTestId("map-box", { includeHiddenElements: true }))).toBe(false);
  });

  it("la hoja de renombrar también abre en apaisado", async () => {
    mockLandscape = true;
    await renderScreen(<ScreensTab />);
    await fireEvent(screen.getByTestId(`map-mon-${TELE.id}`), "longPress");
    expect(within(screen.getByTestId("rename-sheet")).getByRole("button", { name: "Guardar" })).toBeTruthy();
  });
});

describe("Pantallas · datos reales de la PC", () => {
  beforeEach(() => {
    applyScreensState({ monitors: DEMO_MONITORS.map((m) => ({ ...m })), foreground: { ...DEMO_FOREGROUND } });
  });
  const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean }; disabled?: boolean } }) =>
    Boolean(el.props.accessibilityState?.disabled ?? el.props.disabled);

  it("muestra las pantallas y la ventana activa que manda la PC", async () => {
    await renderScreen(<ScreensTab />);
    expect(screen.getAllByTestId(/^map-mon-/, { includeHiddenElements: true }).length).toBe(3);
    expect(screen.getByText(DEMO_FOREGROUND.title)).toBeTruthy();
  });

  it("los interruptores de prender/apagar ya están conectados (R5); la principal sigue bloqueada", async () => {
    await renderScreen(<ScreensTab />);
    await pick(PRINCIPAL.id);
    expect(isDisabled(screen.getByRole("switch", { name: new RegExp(PRINCIPAL.name) }))).toBe(true);
    await pick(TELE.id);
    expect(isDisabled(screen.getByRole("switch", { name: /Tele living/ }))).toBe(false);
  });

  it("los botones Mover ya están conectados (R6): el de la pantalla donde está la ventana sigue bloqueado", async () => {
    await renderScreen(<ScreensTab />);
    const here = DEMO_MONITORS.find((m) => m.id === DEMO_FOREGROUND.monitorId)!;
    const other = DEMO_MONITORS.find((m) => m.enabled && m.id !== here.id)!;
    await pick(here.id);
    expect(isDisabled(screen.getByRole("button", { name: "La ventana activa ya está acá" }))).toBe(true);
    await pick(other.id);
    expect(isDisabled(screen.getByRole("button", { name: "Mandar la ventana activa acá" }))).toBe(false);
  });

  it("renombrar sí está conectado (R4): el toque largo abre la hoja y se promete en el texto de ayuda", async () => {
    await renderScreen(<ScreensTab />);
    expect(screen.getByText(/mantenela apretada/)).toBeTruthy();
    await fireEvent(screen.getByTestId(`map-mon-${TELE.id}`), "longPress");
    expect(screen.getByTestId("rename-sheet")).toBeTruthy();
  });
});

describe("Pantallas · renombrar con la PC de verdad (R4)", () => {
  beforeEach(() => {
    applyScreensState({ monitors: DEMO_MONITORS.map((m) => ({ ...m })), foreground: { ...DEMO_FOREGROUND } });
  });
  const open = async (id = TELE.id) => {
    await renderScreen(<ScreensTab />);
    await fireEvent(screen.getByTestId(`map-mon-${id}`), "longPress");
  };
  const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean }; disabled?: boolean } }) =>
    Boolean(el.props.accessibilityState?.disabled ?? el.props.disabled);

  it("Guardar le manda monitor.rename a la PC y cierra la hoja cuando contesta que sí", async () => {
    await open();
    await fireEvent.changeText(screen.getByDisplayValue("Tele living"), "Tele del cuarto");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(mockSend).toHaveBeenCalledWith("monitor.rename", { monitorId: TELE.id, nickname: "Tele del cuarto" });
    await waitFor(() => expect(screen.queryByTestId("rename-sheet")).toBeNull());
  });

  it("el apodo no se cambia en el celu: lo manda la PC (screens.update); acá no se toca el estado", async () => {
    await open();
    await fireEvent.changeText(screen.getByDisplayValue("Tele living"), "Otro");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByTestId("rename-sheet")).toBeNull());
    expect(useScreens.getState().monitors.find((m) => m.id === TELE.id)?.nickname).toBe("Tele living");
  });

  it("Quitar apodo manda nickname null", async () => {
    await open();
    await fireEvent.press(screen.getByRole("button", { name: "Quitar apodo" }));
    expect(mockSend).toHaveBeenCalledWith("monitor.rename", { monitorId: TELE.id, nickname: null });
  });

  it("mientras espera la respuesta, los botones quedan deshabilitados (no se manda dos veces)", async () => {
    let finish!: (v: { ok: true }) => void;
    mockSend.mockReturnValue(new Promise((r) => (finish = r)));
    await open();
    await fireEvent.changeText(screen.getByDisplayValue("Tele living"), "Otro");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(isDisabled(screen.getByRole("button", { name: "Guardar" }))).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(screen.queryByTestId("rename-sheet")).toBeNull());
  });

  it("si la PC no pudo: la hoja se queda, muestra el error y el botón pasa a Reintentar sin perder lo escrito", async () => {
    mockSend.mockResolvedValueOnce({ ok: false, reason: "failed" });
    await open();
    await fireEvent.changeText(screen.getByDisplayValue("Tele living"), "Tele del cuarto");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/No se pudo completar el cambio/)).toBeTruthy();
    expect(screen.getByDisplayValue("Tele del cuarto")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(mockSend).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByTestId("rename-sheet")).toBeNull());
  });

  it.each([
    ["timeout", /no contestó a tiempo/],
    ["offline", /No hay conexión con la PC/],
    ["not_found", /ya no está conectada/],
  ])("motivo %s → texto en español", async (reason, text) => {
    mockSend.mockResolvedValueOnce({ ok: false, reason });
    await open();
    await fireEvent.changeText(screen.getByDisplayValue("Tele living"), "Otro");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("mientras guarda no se puede cerrar la hoja tocando el fondo: si la PC falla, se ve el error", async () => {
    let finish!: (v: { ok: false; reason: string }) => void;
    mockSend.mockReturnValue(new Promise((r) => (finish = r)));
    await open();
    await fireEvent.changeText(screen.getByDisplayValue("Tele living"), "Otro");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    await fireEvent.press(screen.getAllByLabelText("Cancelar")[0]!); // tocar el fondo
    expect(screen.getByTestId("rename-sheet")).toBeTruthy();
    await act(async () => finish({ ok: false, reason: "failed" }));
    expect(await screen.findByText(/No se pudo completar/)).toBeTruthy();
  });

  it("si la pantalla desaparece mientras la hoja está abierta (se desenchufó), la hoja se cierra", async () => {
    await open();
    expect(screen.getByTestId("rename-sheet")).toBeTruthy();
    await act(async () => {
      applyScreensState({ monitors: DEMO_MONITORS.filter((m) => m.id !== TELE.id).map((m) => ({ ...m })), foreground: null });
    });
    await waitFor(() => expect(screen.queryByTestId("rename-sheet")).toBeNull());
  });

  it("el campo del apodo tiene nombre para TalkBack (no solo el placeholder)", async () => {
    await open();
    expect(screen.getByLabelText("Apodo de la pantalla")).toBeTruthy();
  });

  it("Cancelar cierra sin mandar nada", async () => {
    await open();
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.queryByTestId("rename-sheet")).toBeNull();
  });

  it("sin conexión no se puede abrir la hoja", async () => {
    useConn.setState({ status: "offline" });
    await open();
    expect(screen.queryByTestId("rename-sheet")).toBeNull();
  });
});

describe("Pantallas · prender y apagar con la PC de verdad (R5)", () => {
  const IZQ = DEMO_MONITORS.find((m) => m.canDisable && m.enabled)!;
  const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean }; disabled?: boolean } }) =>
    Boolean(el.props.accessibilityState?.disabled ?? el.props.disabled);
  const sw = (re: RegExp) => screen.getByRole("switch", { name: re });

  beforeEach(() => {
    applyScreensState({ monitors: DEMO_MONITORS.map((m) => ({ ...m })), foreground: { ...DEMO_FOREGROUND } });
  });

  it("apagar una pantalla manda monitor.setEnabled enabled:false", async () => {
    await renderScreen(<ScreensTab />);
    await pick(IZQ.id);
    await fireEvent(sw(new RegExp(IZQ.name)), "valueChange", false);
    expect(mockSend).toHaveBeenCalledWith("monitor.setEnabled", { monitorId: IZQ.id, enabled: false });
  });

  it("prender la tele manda enabled:true", async () => {
    await renderScreen(<ScreensTab />);
    await pick(TELE.id);
    await fireEvent(sw(/Tele living/), "valueChange", true);
    expect(mockSend).toHaveBeenCalledWith("monitor.setEnabled", { monitorId: TELE.id, enabled: true });
  });

  it("el celu no cambia el interruptor por su cuenta: espera lo que diga la PC", async () => {
    await renderScreen(<ScreensTab />);
    await pick(IZQ.id);
    await fireEvent(sw(new RegExp(IZQ.name)), "valueChange", false);
    expect(useScreens.getState().monitors.find((m) => m.id === IZQ.id)?.enabled).toBe(true);
  });

  it("mientras la PC cambia la pantalla (busy) el interruptor queda bloqueado con 'Prendiendo…'", async () => {
    await renderScreen(<ScreensTab />);
    await act(async () => {
      applyScreensState({
        monitors: DEMO_MONITORS.map((m) => (m.id === TELE.id ? { ...m, busy: true } : { ...m })),
        foreground: { ...DEMO_FOREGROUND },
      });
    });
    await pick(TELE.id);
    expect(await screen.findByText(/Prendiendo…/)).toBeTruthy();
    await pick(TELE.id);
    expect(isDisabled(sw(/Tele living/))).toBe(true);
  });

  it("si la PC dice que no (la principal): se muestra el motivo en español", async () => {
    mockSend.mockResolvedValueOnce({ ok: false, reason: "primary" });
    await renderScreen(<ScreensTab />);
    await pick(IZQ.id);
    await fireEvent(sw(new RegExp(IZQ.name)), "valueChange", false);
    expect(await screen.findByText("Es la principal: no se puede apagar.")).toBeTruthy();
  });

  it.each([
    ["last_active", "Es la única pantalla prendida: no se puede apagar."],
    ["failed", "No se pudo completar el cambio. Probá de nuevo."],
    ["busy", "La PC está terminando otro cambio. Esperá un momento."],
    ["timeout", "La PC no contestó a tiempo."],
    ["offline", "No hay conexión con la PC."],
  ])("motivo %s → '%s'", async (reason, text) => {
    mockSend.mockResolvedValueOnce({ ok: false, reason });
    await renderScreen(<ScreensTab />);
    await pick(IZQ.id);
    await fireEvent(sw(new RegExp(IZQ.name)), "valueChange", false);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("un cambio que salió bien borra el error anterior", async () => {
    mockSend.mockResolvedValueOnce({ ok: false, reason: "failed" }).mockResolvedValueOnce({ ok: true });
    await renderScreen(<ScreensTab />);
    await pick(IZQ.id);
    await fireEvent(sw(new RegExp(IZQ.name)), "valueChange", false);
    expect(await screen.findByText(/No se pudo completar/)).toBeTruthy();
    await pick(IZQ.id);
    await fireEvent(sw(new RegExp(IZQ.name)), "valueChange", false);
    await waitFor(() => expect(screen.queryByText(/No se pudo completar/)).toBeNull());
  });

  it("sin conexión los interruptores siguen bloqueados", async () => {
    useConn.setState({ status: "offline" });
    await renderScreen(<ScreensTab />);
    for (const s of screen.getAllByRole("switch")) expect(isDisabled(s)).toBe(true);
  });
});

describe("Pantallas · mover la ventana activa con la PC de verdad (R6)", () => {
  const HERE = DEMO_MONITORS.find((m) => m.id === DEMO_FOREGROUND.monitorId)!;
  const OTHER = DEMO_MONITORS.find((m) => m.enabled && m.id !== HERE.id)!;

  beforeEach(() => {
    applyScreensState({ monitors: DEMO_MONITORS.map((m) => ({ ...m })), foreground: { ...DEMO_FOREGROUND } });
  });

  it("Mover a N manda window.moveActive con la pantalla elegida (no la ventana: la PC usa la activa)", async () => {
    await renderScreen(<ScreensTab />);
    await pick(OTHER.id);
    await fireEvent.press(screen.getByRole("button", { name: "Mandar la ventana activa acá" }));
    expect(mockSend).toHaveBeenCalledWith("window.moveActive", { monitorId: OTHER.id });
  });

  it("el celu no cambia la pantalla de la ventana por su cuenta: lo dice la PC", async () => {
    await renderScreen(<ScreensTab />);
    await pick(OTHER.id);
    await fireEvent.press(screen.getByRole("button", { name: "Mandar la ventana activa acá" }));
    expect(useScreens.getState().foreground?.monitorId).toBe(HERE.id);
  });

  it.each([
    ["no_window", "No hay una ventana para mover."],
    ["elevated", "Esa ventana no se deja mover (corre como administrador)."],
    ["failed", "No se pudo completar el cambio. Probá de nuevo."],
    ["busy", "La PC está terminando otro cambio. Esperá un momento."],
    ["timeout", "La PC no contestó a tiempo."],
  ])("motivo %s → '%s'", async (reason, text) => {
    mockSend.mockResolvedValueOnce({ ok: false, reason });
    await renderScreen(<ScreensTab />);
    await pick(OTHER.id);
    await fireEvent.press(screen.getByRole("button", { name: "Mandar la ventana activa acá" }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("si salió bien se borra el error anterior", async () => {
    mockSend.mockResolvedValueOnce({ ok: false, reason: "failed" }).mockResolvedValueOnce({ ok: true });
    await renderScreen(<ScreensTab />);
    await pick(OTHER.id);
    await fireEvent.press(screen.getByRole("button", { name: "Mandar la ventana activa acá" }));
    expect(await screen.findByText(/No se pudo completar/)).toBeTruthy();
    await pick(OTHER.id);
    await fireEvent.press(screen.getByRole("button", { name: "Mandar la ventana activa acá" }));
    await waitFor(() => expect(screen.queryByText(/No se pudo completar/)).toBeNull());
  });

  it("sin conexión los botones Mover quedan bloqueados", async () => {
    useConn.setState({ status: "offline" });
    await renderScreen(<ScreensTab />);
    for (const m of DEMO_MONITORS.filter((x) => x.enabled)) {
      await pick(m.id);
      const b = screen.getByRole("button", { name: /Mandar la ventana activa acá|ya está acá/ });
      expect(Boolean(b.props.accessibilityState?.disabled ?? b.props.disabled)).toBe(true);
    }
  });
});

describe("Pantallas · ordenar (ampliación de B2)", () => {
  const ON = DEMO_MONITORS.filter((m) => m.enabled);
  const real = () => applyScreensState({ monitors: DEMO_MONITORS.map((m) => ({ ...m })), foreground: { ...DEMO_FOREGROUND } });
  const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean }; disabled?: boolean } }) =>
    Boolean(el.props.accessibilityState?.disabled ?? el.props.disabled);
  const open = async () => {
    await renderScreen(<ScreensTab />);
    await fireEvent.press(screen.getByRole("button", { name: "Ordenar" }));
  };

  it("el botón Ordenar está con la PC conectada y 2 o más pantallas prendidas", async () => {
    real();
    await renderScreen(<ScreensTab />);
    expect(screen.getByRole("button", { name: "Ordenar" })).toBeTruthy();
  });

  it("no está con una sola pantalla prendida ni sin conexión", async () => {
    applyScreensState({ monitors: [DEMO_MONITORS[0]!].map((m) => ({ ...m })), foreground: null });
    await renderScreen(<ScreensTab />);
    expect(screen.queryByRole("button", { name: "Ordenar" })).toBeNull();
  });

  it("la hoja muestra las pantallas prendidas de izquierda a derecha, con las flechas en los bordes deshabilitadas", async () => {
    real();
    await open();
    expect(screen.getByTestId("order-sheet")).toBeTruthy();
    const names = ON.map((m) => m.nickname ?? m.name);
    for (const n of names) expect(screen.getAllByText(new RegExp(n)).length).toBeGreaterThan(0);
    expect(isDisabled(screen.getByRole("button", { name: `Mover ${names[0]} a la izquierda` }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: `Mover ${names.at(-1)} a la derecha` }))).toBe(true);
  });

  it("Aplicar está deshabilitado hasta que se cambia algo", async () => {
    real();
    await open();
    expect(isDisabled(screen.getByRole("button", { name: "Aplicar" }))).toBe(true);
  });

  it("mover a la derecha cambia el orden y Aplicar le manda a la PC la lista nueva", async () => {
    real();
    await open();
    const first = ON[0]!;
    await fireEvent.press(screen.getByRole("button", { name: `Mover ${first.nickname ?? first.name} a la derecha` }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));
    expect(mockSend).toHaveBeenCalledWith("monitor.setOrder", { order: [ON[1]!.id, ON[0]!.id, ...ON.slice(2).map((m) => m.id)] });
    await waitFor(() => expect(screen.queryByTestId("order-sheet")).toBeNull());
  });

  it("volver a dejar el orden original vuelve a deshabilitar Aplicar", async () => {
    real();
    await open();
    const a = ON[0]!.nickname ?? ON[0]!.name;
    await fireEvent.press(screen.getByRole("button", { name: `Mover ${a} a la derecha` }));
    await fireEvent.press(screen.getByRole("button", { name: `Mover ${a} a la izquierda` }));
    expect(isDisabled(screen.getByRole("button", { name: "Aplicar" }))).toBe(true);
  });

  it("si la PC no puede: la hoja queda abierta con el error y el botón pasa a Reintentar", async () => {
    real();
    mockSend.mockResolvedValueOnce({ ok: false, reason: "failed" });
    await open();
    await fireEvent.press(screen.getByRole("button", { name: `Mover ${ON[0]!.nickname ?? ON[0]!.name} a la derecha` }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByText(/No se pudo completar/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(mockSend).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByTestId("order-sheet")).toBeNull());
  });

  it("mientras aplica no se puede cerrar ni mandar dos veces", async () => {
    real();
    let finish!: (v: { ok: true }) => void;
    mockSend.mockReturnValue(new Promise((r) => (finish = r)));
    await open();
    await fireEvent.press(screen.getByRole("button", { name: `Mover ${ON[0]!.nickname ?? ON[0]!.name} a la derecha` }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));
    expect(isDisabled(screen.getByRole("button", { name: "Aplicar" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Cancelar" }))).toBe(true);
    await fireEvent.press(screen.getAllByLabelText("Cancelar")[0]!); // tocar el fondo
    expect(screen.getByTestId("order-sheet")).toBeTruthy();
    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(screen.queryByTestId("order-sheet")).toBeNull());
  });

  it("Cancelar cierra sin mandar nada", async () => {
    real();
    await open();
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.queryByTestId("order-sheet")).toBeNull();
  });

  it("en la demo se aplica local: cambia el orden y los números", async () => {
    await renderScreen(<ScreensTab />);
    await fireEvent.press(screen.getByRole("button", { name: "Ordenar" }));
    const first = ON[0]!;
    await fireEvent.press(screen.getByRole("button", { name: `Mover ${first.nickname ?? first.name} a la derecha` }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(screen.queryByTestId("order-sheet")).toBeNull());
    expect(mockSend).not.toHaveBeenCalled();
    expect(useScreens.getState().monitors.find((m) => m.id === first.id)?.index).toBe(2);
  });

  it("si una pantalla desaparece mientras la hoja está abierta (se apagó), la hoja se cierra", async () => {
    real();
    await open();
    await act(async () => {
      applyScreensState({ monitors: DEMO_MONITORS.filter((m) => m.id !== ON[1]!.id).map((m) => ({ ...m })), foreground: null });
    });
    await waitFor(() => expect(screen.queryByTestId("order-sheet")).toBeNull());
  });
});
