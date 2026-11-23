import { act, fireEvent, screen } from "@testing-library/react-native";
import { DecksSettings } from "@/components/DecksSettings";
import { buildArchive } from "@/decks/archive";
import { createDeck, emptyDecks, type DecksData } from "@/decks/model";
import { createMemoryStorage } from "@/decks/storage";
import { decksActions, decksSaved, initialDecks, setDecksStorage, setIdGenerator, useDecks } from "@/decks/store";
import { initI18n } from "@/i18n";
import { renderScreen } from "./screenHelpers";

// D105 y D106: Ajustes → Decks (animar imágenes, exportar, importar).

const mockShare = jest.fn();
const mockPick = jest.fn();
jest.mock("@/decks/backupIo", () => ({ shareText: (...a: unknown[]) => mockShare(...a), pickText: () => mockPick() }));
jest.mock("@/storage/prefs", () => ({ loadDecksPrefs: async () => ({ animate: true, lastExport: null }), saveDecksPrefs: jest.fn() }));

let n = 0;
beforeAll(() => initI18n("es"));
beforeEach(async () => {
  n = 0;
  jest.clearAllMocks();
  useDecks.setState(initialDecks, true);
  setIdGenerator((p) => `${p}_s${++n}`);
  setDecksStorage(createMemoryStorage());
  await decksActions.load("Principal");
  await decksSaved();
});
afterEach(() => setDecksStorage(null));

describe("Ajustes · Decks", () => {
  it("dice que nunca se exportó; Exportar comparte el archivo y después muestra la fecha", async () => {
    await renderScreen(<DecksSettings />);
    expect(screen.getByText("Nunca exportaste. Si perdés el celu, se pierden.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("decks-export"));
    await act(async () => {});
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare.mock.calls[0]![0]).toMatch(/^decks-\d{4}-\d{2}-\d{2}\.json$/);
    expect(screen.getByText(/^Última vez: \d{2}\/\d{2}\/\d{4}$/)).toBeTruthy();
  });

  it("si no se pudo compartir, lo dice", async () => {
    mockShare.mockRejectedValueOnce(new Error("no"));
    await renderScreen(<DecksSettings />);
    await fireEvent.press(screen.getByTestId("decks-export"));
    await act(async () => {});
    expect(screen.getByText("No se pudo armar el archivo.")).toBeTruthy();
  });

  it("el interruptor de animar apaga y prende las imágenes animadas", async () => {
    await renderScreen(<DecksSettings />);
    expect(useDecks.getState().animate).toBe(true);
    await fireEvent(screen.getByLabelText("Animar imágenes"), "valueChange", false);
    expect(useDecks.getState().animate).toBe(false);
  });

  const archive = async () => {
    let d = createDeck(emptyDecks(), "Del otro celu", "d_x") as DecksData;
    d = { ...d };
    return buildArchive(d, createMemoryStorage(), new Date());
  };

  it("Importar: lee el archivo, dice qué trae y deja sumar", async () => {
    mockPick.mockResolvedValue(await archive());
    await renderScreen(<DecksSettings />);
    await fireEvent.press(screen.getByTestId("decks-import"));
    await act(async () => {});
    expect(screen.getByText("El archivo tiene 1 decks y 0 teclas. Este celu ya tiene 1.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("import-add"));
    await act(async () => {});
    expect(useDecks.getState().data!.decks.map((d) => d.name)).toEqual(["Principal", "Del otro celu"]);
    expect(screen.getByText("Listo: se sumaron 1 decks.")).toBeTruthy();
  });

  it("Importar con Reemplazar deja solo lo del archivo", async () => {
    mockPick.mockResolvedValue(await archive());
    await renderScreen(<DecksSettings />);
    await fireEvent.press(screen.getByTestId("decks-import"));
    await act(async () => {});
    await fireEvent.press(screen.getByTestId("import-replace"));
    await act(async () => {});
    expect(useDecks.getState().data!.decks.map((d) => d.name)).toEqual(["Del otro celu"]);
  });

  it("un archivo que no sirve no cambia nada y se explica", async () => {
    mockPick.mockResolvedValue("esto no es un archivo de decks");
    await renderScreen(<DecksSettings />);
    await fireEvent.press(screen.getByTestId("decks-import"));
    await act(async () => {});
    expect(screen.getByText("No es un archivo de decks, o está dañado. No se cambió nada.")).toBeTruthy();
    expect(useDecks.getState().data!.decks.map((d) => d.name)).toEqual(["Principal"]);
  });

  it("cancelar el selector no muestra ningún error", async () => {
    mockPick.mockResolvedValue(null);
    await renderScreen(<DecksSettings />);
    await fireEvent.press(screen.getByTestId("decks-import"));
    await act(async () => {});
    expect(screen.queryByText(/No es un archivo|No se pudo/)).toBeNull();
    expect(screen.queryByTestId("import-sheet")).toBeNull();
  });
});
