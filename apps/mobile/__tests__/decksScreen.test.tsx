import { act, fireEvent, screen, within } from "@testing-library/react-native";
import DeckTab from "@/app/(tabs)/deck";
import { setAppsBridge } from "@/apps/commands";
import { loadAppsDemo } from "@/apps/demo";
import { initialApps, useApps } from "@/apps/store";
import { useConn } from "@/connection";
import { initialState } from "@/connection/machine";
import { DEMO_AUDIO, loadAudioDemo } from "@/audio/demo";
import { setAudioDemo } from "@/audio/demoFlag";
import { initDecks } from "@/decks/init";
import type { DeckSlot } from "@/decks/model";
import { createMemoryStorage } from "@/decks/storage";
import { decksActions, decksSaved, initialDecks, setDecksStorage, setIdGenerator, useDecks } from "@/decks/store";
import { initI18n } from "@/i18n";
import { initialScreens, useScreens } from "@/screens/store";
import { loadScreensDemo } from "@/screens/demo";
import { PC, SNAPSHOT, renderScreen } from "./screenHelpers";

// F3 (docs/PLAN.md 8.8, D103 a D107): la pestaña Escenas como decks que viven en el celu.

let mockLandscape = false;
jest.mock("@/layout/useLayout", () => ({
  useLayout: () => ({ width: mockLandscape ? 800 : 360, height: mockLandscape ? 360 : 800, isLandscape: mockLandscape }),
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, navigate: jest.fn(), back: jest.fn() }) }));
jest.mock("@/haptics", () => ({ tap: jest.fn() }));
jest.mock("@/connection", () => ({ client: { retry: jest.fn() }, useConn: jest.requireActual("@/connection/store").useConn }));
const mockPickSound = jest.fn();
jest.mock("@/decks/soundIo", () => ({ pickSoundFile: (...a: unknown[]) => mockPickSound(...a) }));
const mockPickImage = jest.fn();
jest.mock("@/decks/images", () => ({ pickDeckImage: (...a: unknown[]) => mockPickImage(...a) }));

let calls: [string, unknown][] = [];
const bridge = () =>
  setAppsBridge({
    command: (async (type: string, payload: unknown) => {
      calls.push([type, payload]);
      return { ok: true };
    }) as never,
    query: () => null,
  });

const slot = (id: string, label: string, action: DeckSlot["action"], image: DeckSlot["image"] = null): DeckSlot => ({ id, label, action, image });
let storage = createMemoryStorage();
let n = 0;

beforeAll(() => initI18n("es"));
beforeEach(async () => {
  mockLandscape = false;
  jest.clearAllMocks();
  calls = [];
  n = 0;
  setIdGenerator((p) => `${p}_t${++n}`);
  useConn.setState({ ...initialState, pc: PC, status: "online", snapshot: SNAPSHOT }, true);
  useApps.setState(initialApps, true);
  useScreens.setState(initialScreens, true);
  useDecks.setState(initialDecks, true);
  setAppsBridge(null);
  setAudioDemo(true);
  loadScreensDemo();
  loadAppsDemo();
  storage = createMemoryStorage();
  setDecksStorage(storage);
});
afterEach(() => setDecksStorage(null));

/** Arranca con un deck "Principal" (ya mudado: sin diálogo) y estas teclas. */
async function boot(slots: DeckSlot[] = [], extra?: () => void) {
  await initDecks("Principal");
  const id = useDecks.getState().currentId!;
  decksActions.mutate((d) => ({ ...d, migrated: "none" }));
  slots.forEach((s, i) => decksActions.setSlot(id, i, s));
  extra?.();
  await decksSaved();
  return id;
}
const SCENE = slot("k_scene", "Trabajo", { kind: "scene", id: "s_DemoTrabajo" });
const LINK = slot("k_link", "Twitch", { kind: "link", url: "https://twitch.tv/directory", open: "window" });
const APP = slot("k_app", "Discord", { kind: "app", appId: "Discord" });
const renderDecks = async () => {
  await renderScreen(<DeckTab />);
  await act(async () => {});
};

describe.each([["vertical", false], ["apaisado", true]] as const)("Decks · %s", (_n, landscape) => {
  beforeEach(() => {
    mockLandscape = landscape;
  });

  it("muestra el deck con sus teclas; vertical: título Escenas y tira de nombres; apaisado: el nombre del deck es el título", async () => {
    await boot([SCENE, LINK]);
    decksActions.createDeck("Stream");
    decksActions.select(useDecks.getState().data!.decks[0]!.id);
    await renderDecks();
    expect(screen.getByText("Trabajo")).toBeTruthy();
    expect(screen.getByText("Twitch")).toBeTruthy();
    if (landscape) {
      expect(screen.getByText("Principal ▾")).toBeTruthy();
      expect(screen.queryByTestId("chip-d_t1")).toBeNull();
    } else {
      expect(screen.getByRole("header", { name: "Escenas" })).toBeTruthy();
      expect(screen.getByText("Stream")).toBeTruthy();
    }
  });

  it("un toque en una escena la corre en la PC; en un link o una app manda target.run SIN guardarlos", async () => {
    await boot([LINK, APP]);
    useApps.setState({ demo: false });
    bridge();
    await renderDecks();
    await fireEvent.press(screen.getByText("Twitch"));
    await fireEvent.press(screen.getByText("Discord"));
    await act(async () => {});
    expect(calls).toEqual([
      ["target.run", { target: { kind: "url", url: "https://twitch.tv/directory", open: "window" } }],
      ["target.run", { target: { kind: "app", appId: "Discord" } }],
    ]);
  });

  it("un link en pestaña (lo común) no manda el campo `open`", async () => {
    await boot([slot("k_a", "Mail", { kind: "link", url: "https://mail.example.com" })]);
    useApps.setState({ demo: false });
    bridge();
    await renderDecks();
    await fireEvent.press(screen.getByText("Mail"));
    await act(async () => {});
    expect(calls).toEqual([["target.run", { target: { kind: "url", url: "https://mail.example.com" } }]]);
  });

  it("tocar una escena la ejecuta y la tecla se enciende mientras corre", async () => {
    await boot([SCENE]);
    await renderDecks();
    await fireEvent.press(screen.getByText("Trabajo"));
    await act(async () => {});
    expect(useApps.getState().run?.sceneId).toBe("s_DemoTrabajo");
  });

  it("una escena que ya no existe en la PC queda gris y explica por qué al tocarla", async () => {
    await boot([slot("k_gone", "Vieja", { kind: "scene", id: "s_Borrada00" })]);
    await renderDecks();
    await fireEvent.press(screen.getByText("No disponible"));
    expect(screen.getByText("Esa tecla apunta a algo que ya no existe. Quitala desde Editar.")).toBeTruthy();
    expect(useApps.getState().run).toBeNull();
  });

  it("sin conexión: aviso arriba y ninguna tecla responde; las que son del celu igual se ven", async () => {
    await boot([LINK]);
    useApps.setState({ demo: false });
    bridge();
    useConn.setState({ status: "offline", snapshot: null, lastError: null });
    await renderDecks();
    expect(screen.getByText("Sin conexión con la PC. Se muestra lo último que llegó.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Twitch"));
    await act(async () => {});
    expect(calls).toEqual([]);
  });

  it("Escenas de la PC lleva a la lista y su editor", async () => {
    await boot([]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("scenes-link"));
    expect(mockPush).toHaveBeenCalledWith("/scenes");
  });
});

describe("Decks · editar", () => {
  it("Editar muestra las herramientas y la × de cada tecla; Listo sale", async () => {
    await boot([SCENE, LINK]);
    await renderDecks();
    expect(screen.queryByTestId("edit-tools")).toBeNull();
    await fireEvent.press(screen.getByTestId("edit-start"));
    const tools = within(screen.getByTestId("edit-tools"));
    for (const l of ["Grilla 3×4", "Nombre", "Decks", "Escenas"]) expect(tools.getByText(l)).toBeTruthy();
    expect(screen.getByTestId("slot-0-remove")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("edit-done"));
    expect(screen.queryByTestId("edit-tools")).toBeNull();
  });

  it("en edición, tocar una tecla no la ejecuta: abre su hoja", async () => {
    await boot([LINK]);
    useApps.setState({ demo: false });
    bridge();
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(screen.getByTestId("slot-0"));
    expect(screen.getByTestId("key-sheet")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("la hoja de la tecla: renombrar se guarda al instante", async () => {
    await boot([LINK]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(screen.getByTestId("slot-0"));
    const input = screen.getByTestId("key-name");
    await fireEvent.changeText(input, "Mi stream");
    await fireEvent(input, "endEditing");
    await decksSaved();
    expect(useDecks.getState().data!.decks[0]!.slots[0]!.label).toBe("Mi stream");
    expect(JSON.parse((await storage.readIndex())!).decks[0].slots[0].label).toBe("Mi stream");
  });

  it("quitar una tecla pide confirmar con su nombre; cancelar no la toca", async () => {
    await boot([LINK]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(screen.getByTestId("slot-0-remove"));
    expect(screen.getByText("¿Quitar la tecla «Twitch»?")).toBeTruthy();
    await fireEvent.press(screen.getByText("Cancelar"));
    expect(useDecks.getState().data!.decks[0]!.slots[0]).not.toBeNull();
    await fireEvent.press(screen.getByTestId("slot-0-remove"));
    await fireEvent.press(screen.getByText("Quitar"));
    expect(useDecks.getState().data!.decks[0]!.slots[0]).toBeNull();
  });

  it("mover: se elige la tecla, se toca el destino y se intercambian (sin arrastrar)", async () => {
    await boot([SCENE, LINK]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(screen.getByTestId("slot-0"));
    await fireEvent.press(screen.getByTestId("key-move"));
    expect(screen.getByTestId("moving-bar")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("slot-5"));
    const slots = useDecks.getState().data!.decks[0]!.slots;
    expect(slots[0]).toBeNull();
    expect(slots[5]!.id).toBe("k_scene");
    expect(screen.queryByTestId("moving-bar")).toBeNull();
  });
});

describe("Decks · agregar una tecla", () => {
  it("un lugar vacío ofrece qué hace: de la PC, o un link o una app que se guardan en el celu", async () => {
    await boot([]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("slot-0"));
    const sheet = within(screen.getByTestId("chooser-sheet"));
    expect(sheet.getByText("De la PC")).toBeTruthy();
    expect(sheet.getByText("Link o app")).toBeTruthy();
  });

  it("Link: se escribe, se elige cómo abrir y la tecla queda en ESE lugar, guardada en el celu y no en la PC", async () => {
    await boot([]);
    useApps.setState({ demo: false });
    bridge();
    await renderDecks();
    await fireEvent.press(screen.getByTestId("slot-2"));
    await fireEvent.press(screen.getByTestId("chooser-target"));
    const sheet = within(screen.getByTestId("add-launcher-sheet"));
    await fireEvent.press(sheet.getByText("Link"));
    await act(async () => {});
    await fireEvent.changeText(sheet.getByLabelText("Dirección"), "twitch.tv/directory");
    await fireEvent.press(sheet.getByText("Ventana"));
    await fireEvent.press(sheet.getByLabelText("Agregar"));
    await act(async () => {});
    const s = useDecks.getState().data!.decks[0]!.slots[2]!;
    expect(s.action).toEqual({ kind: "link", url: "https://twitch.tv/directory", open: "window" });
    expect(calls.some(([t]) => t === "launcher.add")).toBe(false);
    expect(screen.queryByTestId("add-launcher-sheet")).toBeNull();
  });

  it("De la PC: una acción elegida (Traer todo) ocupa el lugar tocado", async () => {
    await boot([]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("slot-1"));
    await fireEvent.press(screen.getByTestId("chooser-pc"));
    await fireEvent.press(within(screen.getByTestId("add-row-bring")).getByText("Agregar"));
    expect(useDecks.getState().data!.decks[0]!.slots[1]!.action).toEqual({ kind: "bringAll" });
  });

  it("Qué hace en una tecla que ya está cambia la acción pero conserva su imagen y su nombre", async () => {
    await boot([slot("k_a", "Mi tecla", { kind: "link", url: "https://a.com" }, { file: "k_a.jpg", animated: false })]);
    await storage.writeImage("k_a.jpg", "AAAA");
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(screen.getByTestId("slot-0"));
    await fireEvent.press(screen.getByTestId("key-does"));
    await fireEvent.press(screen.getByTestId("chooser-pc"));
    await fireEvent.press(within(screen.getByTestId("add-row-bring")).getByText("Agregar"));
    const s = useDecks.getState().data!.decks[0]!.slots[0]!;
    expect(s.action).toEqual({ kind: "bringAll" });
    expect(s.image?.file).toBe("k_a.jpg");
    expect(s.label).toBe("Mi tecla");
  });
});

describe("Decks · grilla y lista de decks", () => {
  it("la grilla: achicar avisa qué teclas quedan afuera y no las borra", async () => {
    const keys = Array.from({ length: 12 }, (_, i) => slot(`k_${i}`, `T${i}`, { kind: "bringAll" }));
    await boot(keys);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(within(screen.getByTestId("edit-tools")).getByText("Grilla 3×4"));
    await fireEvent.press(screen.getByTestId("rows-less"));
    expect(screen.getByTestId("grid-overflow")).toBeTruthy();
    expect(screen.getByText("Achicar igual")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("grid-apply"));
    const deck = useDecks.getState().data!.decks[0]!;
    expect(deck.rows).toBe(3);
    expect(deck.extra).toHaveLength(3);
  });

  it("los límites de la grilla: no baja de 2 columnas ni sube de 5", async () => {
    await boot([]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(within(screen.getByTestId("edit-tools")).getByText("Grilla 3×4"));
    await fireEvent.press(screen.getByTestId("cols-less"));
    expect(screen.getByTestId("cols-less").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId("cols-more"));
    await fireEvent.press(screen.getByTestId("cols-more"));
    await fireEvent.press(screen.getByTestId("cols-more"));
    expect(screen.getByTestId("cols-more").props.accessibilityState.disabled).toBe(true);
  });

  it("la lista: crear un deck nuevo salta a él; borrar pide confirmar y no deja borrar el último", async () => {
    await boot([]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(within(screen.getByTestId("edit-tools")).getByText("Decks"));
    expect(screen.getByText("Decks · 1 de 32")).toBeTruthy();
    const firstId = useDecks.getState().data!.decks[0]!.id;
    expect(screen.getByTestId(`deck-delete-${firstId}`).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId("deck-create"));
    await fireEvent.changeText(screen.getByTestId("deck-name"), "Stream");
    await fireEvent.press(screen.getByTestId("deck-name-save"));
    expect(useDecks.getState().data!.decks.map((d) => d.name)).toEqual(["Principal", "Stream"]);
    await fireEvent.press(screen.getByTestId(`deck-delete-${useDecks.getState().data!.decks[1]!.id}`));
    expect(screen.getByText("¿Borrar el deck «Stream»?")).toBeTruthy();
    await fireEvent.press(screen.getByText("Borrar deck"));
    expect(useDecks.getState().data!.decks).toHaveLength(1);
  });

  it("Nombre abre la lista ya renombrando el deck de ahora", async () => {
    await boot([]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(within(screen.getByTestId("edit-tools")).getByText("Nombre"));
    await fireEvent.changeText(screen.getByTestId("deck-name"), "Juegos");
    await fireEvent.press(screen.getByTestId("deck-name-save"));
    expect(useDecks.getState().data!.decks[0]!.name).toBe("Juegos");
  });

  it("tocar el nombre de otro deck en la tira lo pone a la vista", async () => {
    await boot([]);
    decksActions.createDeck("Stream");
    decksActions.select(useDecks.getState().data!.decks[0]!.id);
    await renderDecks();
    await fireEvent.press(screen.getByText("Stream"));
    expect(useDecks.getState().currentId).toBe(useDecks.getState().data!.decks[1]!.id);
  });
});

describe("Decks · imágenes", () => {
  it("Elegir guarda la imagen en el celu y la tecla la usa; Sin imagen la saca y borra el archivo", async () => {
    await boot([LINK]);
    mockPickImage.mockResolvedValue({ ok: true, base64: "AAAA", ext: "jpg", animated: false });
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(screen.getByTestId("slot-0"));
    await fireEvent.press(screen.getByTestId("key-pick"));
    await act(async () => {});
    await decksSaved();
    const img = useDecks.getState().data!.decks[0]!.slots[0]!.image!;
    expect(img.animated).toBe(false);
    expect(await storage.readImage(img.file)).toBe("AAAA");
    await fireEvent.press(screen.getByTestId("key-noimage"));
    await decksSaved();
    expect(useDecks.getState().data!.decks[0]!.slots[0]!.image).toBeNull();
    expect(await storage.listImages()).toEqual([]);
  });

  it("una imagen animada se marca GIF", async () => {
    await boot([slot("k_g", "Alertas", { kind: "bringAll" }, { file: "k_g.gif", animated: true })]);
    await storage.writeImage("k_g.gif", "R0lG");
    await renderDecks();
    expect(screen.getByText("GIF")).toBeTruthy();
  });

  it("el permiso de fotos y el archivo animado demasiado grande se explican", async () => {
    await boot([LINK]);
    mockPickImage.mockResolvedValueOnce({ ok: false, reason: "permission" });
    await renderDecks();
    await fireEvent.press(screen.getByTestId("edit-start"));
    await fireEvent.press(screen.getByTestId("slot-0"));
    await fireEvent.press(screen.getByTestId("key-pick"));
    await act(async () => {});
    expect(screen.getByText("Dejá que la app vea tus fotos desde los Ajustes del celu.")).toBeTruthy();
    mockPickImage.mockResolvedValueOnce({ ok: false, reason: "tooBig", bytes: 6.4 * 1048576 });
    await fireEvent.press(screen.getByTestId("key-pick"));
    await act(async () => {});
    expect(screen.getByText("Pesa 6.4 MB y el tope es 2 MB. Elegí otra más liviana o usá una imagen fija.")).toBeTruthy();
    expect(screen.getByText("Usar el primer cuadro")).toBeTruthy();
  });
});

describe("Decks · la mudanza (D107)", () => {
  it("la primera vez copia las teclas del Inicio y los lanzadores a decks y ofrece borrarlos de la PC", async () => {
    await initDecks("Principal");
    await renderDecks();
    expect(useDecks.getState().data!.decks.map((d) => d.name)).toEqual(["Principal", "Abrir"]);
    expect(useDecks.getState().data!.migrated).toBe("copied");
    expect(screen.getByText("Tus teclas ahora viven en el celu")).toBeTruthy();
  });

  it("Borrar de la PC quita los lanzadores y las teclas del Inicio de la PC; las escenas no se tocan", async () => {
    await initDecks("Principal");
    useApps.setState({ demo: false });
    bridge();
    await renderDecks();
    await fireEvent.press(screen.getByTestId("migration-delete"));
    await act(async () => {});
    expect(calls.filter(([t]) => t === "launcher.remove")).toHaveLength(3);
    expect(calls).toContainEqual(["deck.set", { items: [] }]);
    expect(calls.some(([t]) => t === "scene.remove")).toBe(false);
  });

  it("Después deja todo como está y el diálogo se cierra", async () => {
    await initDecks("Principal");
    await renderDecks();
    await fireEvent.press(screen.getByTestId("migration-later"));
    expect(screen.queryByTestId("migration-dialog")).toBeNull();
    expect(useApps.getState().library!.launchers).toHaveLength(3);
  });

  it("no se vuelve a copiar la segunda vez", async () => {
    await initDecks("Principal");
    await renderDecks();
    const before = useDecks.getState().data!.decks.length;
    useApps.setState({ library: { ...useApps.getState().library! } });
    await act(async () => {});
    expect(useDecks.getState().data!.decks).toHaveLength(before);
  });
});

describe("Decks · tecla de sonido (F4a)", () => {
  beforeEach(() => {
    loadAudioDemo();
    mockPickSound.mockReset();
  });
  const OUT0 = () => DEMO_AUDIO.outputs[0]!.id;
  const OUT1 = () => DEMO_AUDIO.outputs[1]!.id;

  it("el chooser ofrece Sonido; elegir archivo, salida y volumen crea la tecla y deja el archivo en el celu", async () => {
    await boot([]);
    mockPickSound.mockResolvedValue({ ok: true, name: "Aplausos", ext: "wav", base64: "AAAA" });
    await renderDecks();
    await fireEvent.press(screen.getByTestId("slot-3"));
    await fireEvent.press(screen.getByTestId("chooser-sound"));
    const sheet = within(screen.getByTestId("sound-sheet"));
    expect(sheet.getByTestId("sound-use").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(sheet.getByTestId("sound-pick"));
    await act(async () => {});
    await fireEvent.press(screen.getByTestId(`sound-out-${OUT1()}`));
    await fireEvent.press(screen.getByTestId("sound-vol-more"));
    await fireEvent.press(screen.getByTestId("sound-use"));
    await decksSaved();
    const s = useDecks.getState().data!.decks[0]!.slots[3]!;
    expect(s.label).toBe("Aplausos");
    expect(s.action).toMatchObject({ kind: "sound", outputId: OUT1(), volume: 60 });
    const file = (s.action as { file: string }).file;
    expect(file).toMatch(/^s_sound_.+\.wav$/);
    expect(await storage.readImage(file)).toBe("AAAA");
  });

  it("Probar toca el sonido por la salida elegida (mandándolo a la PC si hace falta)", async () => {
    await boot([]);
    mockPickSound.mockResolvedValue({ ok: true, name: "Ding", ext: "mp3", base64: "AAAA" });
    useApps.setState({ demo: false });
    setAudioDemo(false);
    let has = false;
    setAppsBridge({
      command: (async (type: string, payload: unknown) => {
        calls.push([type, payload]);
        if (type === "sound.put") has = true;
        return type === "sound.play" && !has ? { ok: false, reason: "not_found" } : { ok: true };
      }) as never,
      query: () => null,
    });
    await renderDecks();
    await fireEvent.press(screen.getByTestId("slot-0"));
    await fireEvent.press(screen.getByTestId("chooser-sound"));
    await fireEvent.press(screen.getByTestId("sound-pick"));
    await act(async () => {});
    await fireEvent.press(screen.getByTestId(`sound-out-${OUT0()}`));
    await fireEvent.press(screen.getByTestId("sound-test"));
    await act(async () => {});
    expect(calls.map(([t]) => t)).toEqual(["sound.play", "sound.put", "sound.play"]);
    expect((calls[2]![1] as { outputId: string }).outputId).toBe(OUT0());
  });

  it("un archivo que no es un sonido, o muy pesado, se explica y no se guarda", async () => {
    await boot([]);
    await renderDecks();
    await fireEvent.press(screen.getByTestId("slot-0"));
    await fireEvent.press(screen.getByTestId("chooser-sound"));
    mockPickSound.mockResolvedValueOnce({ ok: false, reason: "type" });
    await fireEvent.press(screen.getByTestId("sound-pick"));
    await act(async () => {});
    expect(screen.getByText("Ese archivo no es un sonido (mp3, wav, ogg o m4a).")).toBeTruthy();
    mockPickSound.mockResolvedValueOnce({ ok: false, reason: "tooBig" });
    await fireEvent.press(screen.getByTestId("sound-pick"));
    await act(async () => {});
    expect(screen.getByText("Pesa más de 400 KB. Elegí uno más corto o de menor calidad.")).toBeTruthy();
    expect(await storage.listImages()).toEqual([]);
  });

  it("cerrar sin usar borra el archivo que se había guardado para probar", async () => {
    await boot([]);
    mockPickSound.mockResolvedValue({ ok: true, name: "Ding", ext: "wav", base64: "AAAA" });
    await renderDecks();
    await fireEvent.press(screen.getByTestId("slot-0"));
    await fireEvent.press(screen.getByTestId("chooser-sound"));
    await fireEvent.press(screen.getByTestId("sound-pick"));
    await act(async () => {});
    expect(await storage.listImages()).toHaveLength(1);
    await fireEvent.press(screen.getByTestId("sound-close"));
    await act(async () => {});
    expect(await storage.listImages()).toEqual([]);
  });

  it("tocar la tecla manda sound.play por la salida elegida; si la salida no está conectada, queda gris y lo explica", async () => {
    const action = { kind: "sound" as const, file: "s_sound_aaaaaa.wav", outputId: OUT0(), volume: 40 };
    await boot([slot("k_snd", "Ding", action)]);
    await storage.writeImage("s_sound_aaaaaa.wav", "AAAA");
    useApps.setState({ demo: false });
    setAudioDemo(false);
    bridge();
    await renderDecks();
    await fireEvent.press(screen.getByText("Ding"));
    await act(async () => {});
    expect(calls).toEqual([["sound.play", { id: "s_sound_aaaaaa", ext: "wav", outputId: OUT0(), volume: 40 }]]);
  });

  it("sin la salida conectada la tecla queda gris", async () => {
    const action = { kind: "sound" as const, file: "s_sound_aaaaaa.wav", outputId: "o_ZZZZZZZZZZZZ", volume: 40 };
    await boot([slot("k_snd", "Ding", action)]);
    await renderDecks();
    await fireEvent.press(screen.getByText("Ding"));
    expect(screen.getByText("Esa tecla apunta a algo que ya no existe. Quitala desde Editar.")).toBeTruthy();
  });
});
