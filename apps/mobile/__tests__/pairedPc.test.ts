import { deletePairedPc, loadPairedPc, savePairedPc } from "@/storage/pairedPc";
import type { PairedPc } from "@/connection/types";

const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockMem.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockMem.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockMem.delete(k)),
}));

const pc: PairedPc = {
  v: 2,
  host: "192.168.100.5",
  port: 47800,
  pcName: "DESKTOP-PSB9K0R",
  pcPublicKey: "P".repeat(43),
  devicePrivateKey: "K".repeat(43),
  deviceId: "3f2b8c1e-5d4a-4b7e-9c3a-1f2e3d4c5b6a",
  pairedAt: "2026-11-06T12:00:00.000Z",
};

beforeEach(() => mockMem.clear());

describe("pairedPc (v2)", () => {
  it("sin nada guardado devuelve null y no hay nada que actualizar", async () => {
    expect(await loadPairedPc()).toEqual({ pc: null, upgraded: false });
  });

  it("guarda y lee la misma PC", async () => {
    await savePairedPc(pc);
    expect(await loadPairedPc()).toEqual({ pc, upgraded: false });
    expect(mockMem.has("pairedPc.v2")).toBe(true);
  });

  it("guarda una PC con el emparejamiento sin terminar (deviceId y fecha en null)", async () => {
    const pending = { ...pc, deviceId: null, pairedAt: null };
    await savePairedPc(pending);
    expect((await loadPairedPc()).pc).toEqual(pending);
  });

  it("borra", async () => {
    await savePairedPc(pc);
    await deletePairedPc();
    expect(await loadPairedPc()).toEqual({ pc: null, upgraded: false });
  });

  it("si lo guardado es JSON roto: devuelve null y lo borra", async () => {
    mockMem.set("pairedPc.v2", "{roto");
    expect((await loadPairedPc()).pc).toBeNull();
    expect(mockMem.has("pairedPc.v2")).toBe(false);
  });

  it.each([
    ["falta la clave privada", { ...pc, devicePrivateKey: undefined }],
    ["clave de largo incorrecto", { ...pc, pcPublicKey: "corta" }],
    ["puerto inválido", { ...pc, port: 80 }],
    ["versión desconocida", { ...pc, v: 3 }],
    ["campo extra (por ejemplo un token viejo)", { ...pc, token: "x" }],
    ["deviceId que no es uuid", { ...pc, deviceId: "123" }],
  ])("si no pasa el esquema (%s): devuelve null y lo borra", async (_n, bad) => {
    mockMem.set("pairedPc.v2", JSON.stringify(bad));
    expect((await loadPairedPc()).pc).toBeNull();
    expect(mockMem.has("pairedPc.v2")).toBe(false);
  });

  it("si había un emparejamiento de B1 (v1, con token): se borra y se avisa que hay que volver a emparejar", async () => {
    mockMem.set("pairedPc.v1", JSON.stringify({ v: 1, host: "192.168.100.5", port: 47800, pcName: "PC", deviceId: "x", token: "t", pairedAt: "x" }));
    expect(await loadPairedPc()).toEqual({ pc: null, upgraded: true });
    expect(mockMem.has("pairedPc.v1")).toBe(false);
    expect(await loadPairedPc()).toEqual({ pc: null, upgraded: false }); // el aviso se da una sola vez
  });

  it("si hay v2 y también un v1 viejo: gana el v2 y el v1 se borra", async () => {
    await savePairedPc(pc);
    mockMem.set("pairedPc.v1", "{}");
    expect(await loadPairedPc()).toEqual({ pc, upgraded: false });
    expect(mockMem.has("pairedPc.v1")).toBe(false);
  });
});
