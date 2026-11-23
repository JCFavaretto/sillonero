import { join } from "node:path";
import { bytesToBase64Url } from "@proyecto-e/protocol";
import { describe, expect, it } from "vitest";
import { createConfigStore } from "../src/config/store";
import { CURRENT_CONFIG_VERSION, defaultConfig, type AgentConfig } from "../src/config/schema";
import { FakeSecret, MemFs, MemLogger } from "./fakes";

// B6.4 (docs/PLAN.md D73): la clave privada de la PC se guarda cifrada con la cuenta de Windows (DPAPI).

const DIR = "data";
const PATH = join(DIR, "agent.json");
const PRIVATE = bytesToBase64Url(new Uint8Array(32).fill(7));
const PUBLIC = bytesToBase64Url(new Uint8Array(32).fill(9));
const DEVICE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Pixel de Jay",
  platform: "android" as const,
  publicKey: "C".repeat(43),
  pairedAt: "2026-11-06T12:00:00.000Z",
  lastSeenAt: null,
};
const v5File = () => JSON.stringify({ version: 5, remote: { enabled: true }, identity: { publicKey: PUBLIC, privateKey: PRIVATE }, devices: [DEVICE], monitors: { known: [] } });

function setup(opts: { withSecret?: boolean } = {}) {
  const fs = new MemFs();
  const log = new MemLogger();
  const secret = new FakeSecret();
  const store = createConfigStore({ fs, log, dataDir: DIR, ...(opts.withSecret === false ? {} : { secret }) });
  return { fs, log, secret, store };
}
const withIdentity = (): AgentConfig => ({ ...defaultConfig(), identity: { publicKey: PUBLIC, privateKey: PRIVATE }, devices: [DEVICE] });
interface DiskFile {
  version: number;
  identity: { publicKey?: string; privateKey?: string; privateKeyProtected?: string };
  devices: unknown[];
}
const onDisk = (fs: MemFs) => JSON.parse(fs.files.get(PATH) ?? "null") as DiskFile;

describe("agent.json v6: la clave privada cifrada con DPAPI", () => {
  it("la versión actual es la 6", () => {
    expect(CURRENT_CONFIG_VERSION).toBe(6);
  });

  it("guardar escribe privateKeyProtected y la clave en claro no aparece en el archivo", async () => {
    const { fs, store } = setup();
    await store.save(withIdentity());
    const raw = fs.files.get(PATH)!;
    expect(raw).not.toContain(PRIVATE);
    const id = onDisk(fs).identity;
    expect(id.publicKey).toBe(PUBLIC);
    expect(id.privateKey).toBeUndefined();
    expect(typeof id.privateKeyProtected).toBe("string");
  });

  it("al leer, la clave vuelve igual a como se guardó (los celus siguen emparejados)", async () => {
    const { store } = setup();
    await store.save(withIdentity());
    const r = await store.load();
    expect(r.status).toBe("ok");
    expect(r.config.identity).toEqual({ publicKey: PUBLIC, privateKey: PRIVATE });
    expect(r.config.devices).toEqual([DEVICE]);
  });

  it("sin identidad no hay nada que cifrar", async () => {
    const { fs, store } = setup();
    await store.save(defaultConfig());
    expect(onDisk(fs).identity).toBeNull();
    expect((await store.load()).config.identity).toBeNull();
  });
});

describe("migración v5 → v6", () => {
  it("cifra la clave existente SIN cambiarla, conserva celus y reescribe el archivo enseguida", async () => {
    const { fs, store } = setup();
    fs.files.set(PATH, v5File());
    const r = await store.load();
    expect(r.migratedFrom).toBe(5);
    expect(r.config.identity).toEqual({ publicKey: PUBLIC, privateKey: PRIVATE });
    expect(r.config.devices).toEqual([DEVICE]);
    const file = onDisk(fs);
    expect(file.version).toBe(6);
    expect(file.identity.privateKey).toBeUndefined();
    expect(fs.files.get(PATH)).not.toContain(PRIVATE);
    // y se puede volver a leer
    expect((await store.load()).config.identity?.privateKey).toBe(PRIVATE);
  });

  it("la copia .v5.bak no trae la clave en claro (se cifra antes de copiar) pero sí todo lo demás", async () => {
    const { fs, store } = setup();
    fs.files.set(PATH, v5File());
    await store.load();
    const bak = fs.files.get(`${PATH}.v5.bak`)!;
    expect(bak).toBeDefined();
    expect(bak).not.toContain(PRIVATE);
    const parsed = JSON.parse(bak) as DiskFile;
    expect(parsed.version).toBe(5);
    expect(parsed.identity.privateKeyProtected).toBeDefined();
    expect(parsed.devices).toHaveLength(1);
  });

  it("si DPAPI falla al migrar, no se toca nada: el archivo sigue igual y no se pisa después", async () => {
    const { fs, log, secret, store } = setup();
    secret.failProtect = true;
    const original = v5File();
    fs.files.set(PATH, original);
    const r = await store.load();
    expect(r.config.identity?.privateKey).toBe(PRIVATE); // sigue andando en memoria
    expect(fs.files.get(PATH)).toBe(original);
    expect(fs.files.has(`${PATH}.v5.bak`)).toBe(false);
    expect(log.entries.some((e) => e.level === "error")).toBe(true);
    await expect(store.save(r.config)).rejects.toThrow(); // solo lectura: no se escribe una clave en claro ni se pierde la original
    expect(fs.files.get(PATH)).toBe(original);
  });

  it("si lo cifrado no se puede volver a abrir igual, tampoco se toca nada (verificación de ida y vuelta)", async () => {
    const { fs, secret, store } = setup();
    secret.corrupt = true;
    const original = v5File();
    fs.files.set(PATH, original);
    await store.load();
    expect(fs.files.get(PATH)).toBe(original);
  });
});

describe("copias viejas con la clave en claro (revisión de seguridad)", () => {
  it("al migrar con éxito, las copias de fases anteriores (.bak, .v1 a .v4) quedan con la clave cifrada, no en claro", async () => {
    const { fs, store } = setup();
    fs.files.set(PATH, v5File());
    for (const name of ["agent.json.bak", "agent.json.v3.bak", "agent.json.v4.bak"]) fs.files.set(join(DIR, name), v5File());
    fs.files.set(join(DIR, "agent.json.v2.bak"), "esto no es JSON"); // no se toca lo que no se entiende
    await store.load();
    for (const name of ["agent.json.bak", "agent.json.v3.bak", "agent.json.v4.bak"]) {
      const text = fs.files.get(join(DIR, name))!;
      expect(text, name).not.toContain(PRIVATE);
      expect(text, name).toContain("privateKeyProtected");
    }
    expect(fs.files.get(join(DIR, "agent.json.v2.bak"))).toBe("esto no es JSON");
  });

  it("un v6 con la clave en claro se rechaza y la copia .bak que queda tampoco la trae en claro", async () => {
    const { fs, store } = setup();
    fs.files.set(PATH, JSON.stringify({ version: 6, remote: {}, identity: { publicKey: PUBLIC, privateKey: PRIVATE } }));
    await store.load();
    expect(fs.files.get(PATH + ".bak")).toBeDefined();
    expect(fs.files.get(PATH + ".bak")).not.toContain(PRIVATE);
  });
});

describe("archivos que no se aceptan o no se pueden abrir", () => {
  it("un v6 con la clave en claro se rechaza (se guarda copia y se arranca de fábrica)", async () => {
    const { fs, store } = setup();
    fs.files.set(PATH, JSON.stringify({ version: 6, remote: {}, identity: { publicKey: PUBLIC, privateKey: PRIVATE } }));
    const r = await store.load();
    expect(r.status).toBe("recovered");
    expect(r.config.identity).toBeNull();
  });

  it("si Windows no puede abrir la clave (otra cuenta, perfil restaurado) NO inventa una: avisa y no pisa el archivo", async () => {
    const { fs, secret, store } = setup();
    await store.save(withIdentity());
    const written = fs.files.get(PATH)!;
    secret.failUnprotect = true;
    const r = await store.load();
    expect(r.status).toBe("identity_unreadable");
    expect(r.config.identity).toBeNull();
    await expect(store.save(r.config)).rejects.toThrow(); // solo lectura hasta que Jay confirme
    expect(fs.files.get(PATH)).toBe(written);
  });

  it("confirmar la pérdida guarda una copia del archivo y deja escribir de nuevo", async () => {
    const { fs, secret, store } = setup();
    await store.save(withIdentity());
    const written = fs.files.get(PATH)!;
    secret.failUnprotect = true;
    await store.load();
    await store.acknowledgeLostIdentity();
    expect(fs.files.get(`${PATH}.identity-lost.bak`)).toBe(written);
    await expect(store.save(defaultConfig())).resolves.toBeUndefined();
  });

  it("una segunda pérdida no pisa la copia de la primera (cada una tiene su archivo)", async () => {
    const { fs, secret, store } = setup();
    await store.save(withIdentity());
    const first = fs.files.get(PATH)!;
    secret.failUnprotect = true;
    await store.load();
    await store.acknowledgeLostIdentity();
    // la segunda vez el archivo es otro (la clave nueva, cifrada)
    secret.failUnprotect = false;
    await store.save({ ...withIdentity(), identity: { publicKey: PUBLIC, privateKey: bytesToBase64Url(new Uint8Array(32).fill(3)) } });
    const second = fs.files.get(PATH)!;
    secret.failUnprotect = true;
    await store.load();
    await store.acknowledgeLostIdentity();
    expect(fs.files.get(PATH + ".identity-lost.bak")).toBe(first);
    expect(fs.files.get(PATH + ".identity-lost.bak.2")).toBe(second);
  });

  it("acknowledgeLostIdentity sin una pérdida real no hace nada", async () => {
    const { fs, store } = setup();
    await store.save(withIdentity());
    await store.load();
    await store.acknowledgeLostIdentity();
    expect(fs.files.has(`${PATH}.identity-lost.bak`)).toBe(false);
  });
});

describe("sin DPAPI (desarrollo fuera de Windows)", () => {
  it("la clave queda en claro y se lee igual que antes", async () => {
    const { fs, store } = setup({ withSecret: false });
    await store.save(withIdentity());
    expect(onDisk(fs).identity.privateKey).toBe(PRIVATE);
    expect((await store.load()).config.identity?.privateKey).toBe(PRIVATE);
  });

  it("un archivo con la clave protegida no se puede leer sin DPAPI: no se pisa", async () => {
    const withS = setup();
    await withS.store.save(withIdentity());
    const noS = createConfigStore({ fs: withS.fs, log: new MemLogger(), dataDir: DIR });
    expect((await noS.load()).status).toBe("identity_unreadable");
  });
});
