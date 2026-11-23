import { loadAudioCardOpen, saveAudioCardOpen } from "@/storage/prefs";

const mockMem = new Map<string, string>();
let mockFail = false;
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => {
    if (mockFail) throw new Error("keystore");
    return mockMem.get(k) ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (mockFail) throw new Error("keystore");
    mockMem.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => void mockMem.delete(k)),
}));

beforeEach(() => {
  mockMem.clear();
  mockFail = false;
});

describe("preferencia: tarjeta Audio del Inicio", () => {
  it("sin nada guardado, arranca desplegada", async () => {
    expect(await loadAudioCardOpen()).toBe(true);
  });
  it("recuerda lo último que eligió Jay", async () => {
    await saveAudioCardOpen(false);
    expect(await loadAudioCardOpen()).toBe(false);
    await saveAudioCardOpen(true);
    expect(await loadAudioCardOpen()).toBe(true);
  });
  it("un valor roto vuelve a desplegada", async () => {
    mockMem.set("ui.audioCardOpen.v1", "quién sabe");
    expect(await loadAudioCardOpen()).toBe(true);
  });
  it("si el almacenamiento falla, no se rompe nada: desplegada y el guardado se ignora", async () => {
    mockFail = true;
    expect(await loadAudioCardOpen()).toBe(true);
    await expect(saveAudioCardOpen(false)).resolves.toBeUndefined();
  });
});
