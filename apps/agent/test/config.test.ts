import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_CONFIG_VERSION, defaultConfig, migrate, parseConfig } from "../src/config/schema";
import { ConfigReadOnlyError, createConfigStore } from "../src/config/store";
import { generateIdentity } from "../src/config/identity";
import { FakeRandom, MemFs, MemLogger } from "./fakes";

const DIR = join("data", "proyecto-e");
const PATH = join(DIR, "agent.json");
const BAK = `${PATH}.bak`;
const V1_BAK = `${PATH}.v1.bak`;
const EMPTY_AUDIO = { outputs: {}, known: {}, disable: { defaultOutput: false, appRouting: false } };

const DEVICE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Pixel de Jay",
  platform: "android" as const,
  publicKey: "D".repeat(43),
  pairedAt: "2026-11-06T12:00:00.000Z",
  lastSeenAt: null,
};

function setup() {
  const fs = new MemFs();
  const log = new MemLogger();
  const store = createConfigStore({ fs, log, dataDir: DIR });
  return { fs, log, store };
}

describe("defaultConfig", () => {
  it("arranca con el remoto apagado, puertos por defecto y sin dispositivos", () => {
    expect(defaultConfig()).toEqual({
      version: 6,
      remote: { enabled: false, port: 47800, adminPort: 47801, preferredInterface: null },
      identity: null,
      devices: [],
      monitors: { known: [] },
      library: { launchers: [], scenes: [], deck: [] },
      deckSeeded: false,
      audio: EMPTY_AUDIO,
      input: { enabled: true },
      hotkeys: { enabled: true, tvMonitorId: null },
    });
  });

  it("devuelve una copia nueva cada vez", () => {
    const a = defaultConfig();
    a.devices.push(DEVICE);
    expect(defaultConfig().devices).toEqual([]);
  });
});

describe("parseConfig", () => {
  it("completa los defaults de remote y de devices", () => {
    const res = parseConfig({ version: 6, remote: {} });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toEqual(defaultConfig());
  });

  it("rechaza puertos fuera de rango, clave pública mal formada y plataformas raras", () => {
    expect(parseConfig({ version: 6, remote: { port: 80 } }).success).toBe(false);
    expect(parseConfig({ version: 6, remote: { adminPort: 70000 } }).success).toBe(false);
    expect(parseConfig({ version: 6, remote: {}, devices: [{ ...DEVICE, publicKey: "corta" }] }).success).toBe(false);
    expect(parseConfig({ version: 6, remote: {}, devices: [{ ...DEVICE, platform: "windows" }] }).success).toBe(false);
  });

  it("un dispositivo ya no guarda token: un tokenHash sobrante se rechaza", () => {
    expect(parseConfig({ version: 6, remote: {}, devices: [{ ...DEVICE, tokenHash: "sha256:" + "a".repeat(64) }] }).success).toBe(false);
  });

  it("la identidad tiene que ser un par de claves de 32 bytes, o null", () => {
    const id = generateIdentity(new FakeRandom());
    expect(parseConfig({ version: 6, remote: {}, identity: id }).success).toBe(true);
    expect(parseConfig({ version: 6, remote: {}, identity: { ...id, privateKey: "corta" } }).success).toBe(false);
    expect(parseConfig({ version: 6, remote: {}, identity: { publicKey: id.publicKey } }).success).toBe(false);
  });

  it("los monitores conocidos guardan apodo y última posición; tope de 32", () => {
    const m = { id: "m_AbCdEfGhIjKlMnOp", nickname: "Tele living", lastName: "Samsung TV", lastBounds: { x: 0, y: 0, w: 1, h: 1 }, lastSeenAt: "2026-11-07T12:00:00.000Z" };
    expect(parseConfig({ version: 6, remote: {}, monitors: { known: [m] } }).success).toBe(true);
    expect(parseConfig({ version: 6, remote: {}, monitors: { known: Array(33).fill(m) } }).success).toBe(false);
    expect(parseConfig({ version: 6, remote: {}, monitors: { known: [{ ...m, nickname: "a".repeat(33) }] } }).success).toBe(false);
  });
});

describe("migrate", () => {
  it("una config vigente queda igual", () => {
    const raw = { version: CURRENT_CONFIG_VERSION, remote: {} };
    expect(migrate(raw)).toEqual(raw);
  });

  it("v1 → v2: se borran los dispositivos (sus tokens viajaron en claro), se conserva el remoto y se suma lo nuevo", () => {
    const v1 = { version: 1, remote: { enabled: true, port: 50000, adminPort: 50001, preferredInterface: "Wi-Fi 2" }, devices: [{ ...DEVICE, tokenHash: "sha256:" + "a".repeat(64) }] };
    const v2 = migrate(v1);
    expect(v2).toMatchObject({ version: 6, remote: v1.remote, devices: [], identity: null, monitors: { known: [] } });
    expect(parseConfig(v2).success).toBe(true);
  });

  it("v2 → v4: se suma la biblioteca y el audio vacíos y no se pierde nada (celus, identidad, pantallas)", () => {
    const id = { publicKey: "A".repeat(43), privateKey: "B".repeat(43) };
    const known = { id: "m_AAAAAAAAAAAAAAAA", nickname: "Tele", lastName: "TV", lastBounds: null, lastSeenAt: "2026-11-07T10:00:00.000Z" };
    const v2 = { version: 2, remote: { enabled: true }, identity: id, devices: [DEVICE], monitors: { known: [known] } };
    const v3 = migrate(v2) as Record<string, unknown>;
    expect(v3).toMatchObject({ version: 6, identity: id, devices: [DEVICE], monitors: { known: [known] }, library: { launchers: [], scenes: [], deck: [] }, audio: EMPTY_AUDIO });
    expect(parseConfig(v3).success).toBe(true);
  });

  it("una biblioteca inválida (p. ej. un link file:) se descarta SOLA: no se pierden celus ni identidad", () => {
    const bad = { id: "l_AAAAAAAAAA", name: "x", target: { kind: "url", url: "file:///C:/x" }, iconKey: null };
    const id = { publicKey: "A".repeat(43), privateKey: "B".repeat(43) };
    const r = parseConfig({ version: 6, remote: {}, identity: id, devices: [DEVICE], library: { launchers: [bad], scenes: [], deck: [] } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.library).toEqual({ launchers: [], scenes: [], deck: [] });
      expect(r.data.devices).toHaveLength(1);
      expect(r.data.identity).toEqual(id);
    }
  });

  it("v3 → v4: se suma el audio vacío y no se pierde nada (celus, identidad, pantallas, biblioteca)", () => {
    const id = { publicKey: "A".repeat(43), privateKey: "B".repeat(43) };
    const library = { launchers: [], scenes: [], deck: [{ kind: "bringAll" }] };
    const v3 = { version: 3, remote: { enabled: true }, identity: id, devices: [DEVICE], monitors: { known: [] }, library };
    const v4 = migrate(v3) as Record<string, unknown>;
    expect(v4).toMatchObject({ version: 6, identity: id, devices: [DEVICE], library, audio: EMPTY_AUDIO });
    expect(parseConfig(v4).success).toBe(true);
  });

  it("v4 → v5: se suma la llave del Pad prendida y no se pierde nada", () => {
    const id = { publicKey: "A".repeat(43), privateKey: "B".repeat(43) };
    const audio = { outputs: { o_AAAAAAAAAAAA: { nick: "Auriculares", hidden: false } }, known: {}, disable: { defaultOutput: true, appRouting: false } };
    const v4 = { version: 4, remote: { enabled: true }, identity: id, devices: [DEVICE], monitors: { known: [] }, library: { launchers: [], scenes: [], deck: [] }, audio };
    const v5 = migrate(v4) as Record<string, unknown>;
    expect(v5).toMatchObject({ version: 6, identity: id, devices: [DEVICE], audio, input: { enabled: true } });
    expect(parseConfig(v5).success).toBe(true);
  });

  it("v5 → v6: solo sube la versión (el cifrado de la clave lo hace el store al leer)", () => {
    const id = { publicKey: "A".repeat(43), privateKey: "B".repeat(43) };
    const v5 = { version: 5, remote: { enabled: true }, identity: id, devices: [DEVICE] };
    const v6 = migrate(v5) as Record<string, unknown>;
    expect(v6).toMatchObject({ version: 6, identity: id, devices: [DEVICE] });
    expect(parseConfig(v6).success).toBe(true);
  });

  it("input: la llave se puede apagar y un valor inválido se descarta SOLO (vuelve a prendida, no se pierden celus)", () => {
    const off = parseConfig({ version: 6, remote: {}, input: { enabled: false } });
    expect(off.success && off.data.input).toEqual({ enabled: false });
    const bad = parseConfig({ version: 6, remote: {}, devices: [DEVICE], input: { enabled: "no", extra: 1 } });
    expect(bad.success).toBe(true);
    if (bad.success) {
      expect(bad.data.input).toEqual({ enabled: true });
      expect(bad.data.devices).toHaveLength(1);
    }
  });

  it("hotkeys: la llave y la tele se guardan; un valor inválido se descarta SOLO (no se pierden celus)", () => {
    const ok = parseConfig({ version: 6, remote: {}, hotkeys: { enabled: false, tvMonitorId: "m_abcdefghijklmnop" } });
    expect(ok.success && ok.data.hotkeys).toEqual({ enabled: false, tvMonitorId: "m_abcdefghijklmnop" });
    const bad = parseConfig({ version: 6, remote: {}, devices: [DEVICE], hotkeys: { enabled: "no", tvMonitorId: 3, extra: 1 } });
    expect(bad.success).toBe(true);
    if (bad.success) {
      expect(bad.data.hotkeys).toEqual({ enabled: true, tvMonitorId: null });
      expect(bad.data.devices).toHaveLength(1);
    }
    const old = parseConfig({ version: 6, remote: {} });
    expect(old.success && old.data.hotkeys).toEqual({ enabled: true, tvMonitorId: null });
  });

  it("audio: apodos, ocultas, salidas conocidas e interruptores de D29 y D30", () => {
    const audio = {
      outputs: { o_AAAAAAAAAAAA: { nick: "Parlantes", hidden: false }, o_BBBBBBBBBBBB: { nick: null, hidden: true } },
      known: { o_AAAAAAAAAAAA: { name: "Altavoces (Realtek)", kind: "speakers" } },
      disable: { defaultOutput: true, appRouting: false },
    };
    const r = parseConfig({ version: 6, remote: {}, audio });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.audio).toEqual(audio);
  });

  it("un audio inválido se descarta SOLO: no se pierden celus ni identidad (como la biblioteca)", () => {
    const id = { publicKey: "A".repeat(43), privateKey: "B".repeat(43) };
    const bad = { outputs: { "{0.0.0.00000000}.{x}": { nick: "x", hidden: false } }, known: {}, disable: { defaultOutput: false, appRouting: false } };
    const r = parseConfig({ version: 6, remote: {}, identity: id, devices: [DEVICE], audio: bad });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.audio).toEqual(EMPTY_AUDIO);
      expect(r.data.devices).toHaveLength(1);
      expect(r.data.identity).toEqual(id);
    }
  });

  it("aplica las migraciones en orden, de la versión del archivo a la vigente", () => {
    const steps = [
      (r: Record<string, unknown>) => ({ ...r, version: 2, a: true }),
      (r: Record<string, unknown>) => ({ ...r, version: 3, b: true }),
    ];
    expect(migrate({ version: 1 }, steps, 3)).toEqual({ version: 3, a: true, b: true });
    expect(migrate({ version: 2 }, steps, 3)).toEqual({ version: 3, b: true });
  });
});

describe("config store · load", () => {
  it("sin archivo: defaults con el remoto apagado y no escribe nada", async () => {
    const { fs, store } = setup();
    const res = await store.load();
    expect(res.status).toBe("missing");
    expect(res.config).toEqual(defaultConfig());
    expect(res.config.remote.enabled).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it("archivo válido: lo devuelve tal cual", async () => {
    const { fs, store } = setup();
    const saved = { ...defaultConfig(), remote: { ...defaultConfig().remote, enabled: true }, identity: generateIdentity(new FakeRandom()), devices: [DEVICE] };
    fs.files.set(PATH, JSON.stringify(saved));
    const res = await store.load();
    expect(res.status).toBe("ok");
    expect(res.config).toEqual(saved);
  });

  it("JSON roto: copia a .bak, defaults y log", async () => {
    const { fs, log, store } = setup();
    fs.files.set(PATH, "{ esto no es json");
    const res = await store.load();
    expect(res.status).toBe("recovered");
    expect(res.config).toEqual(defaultConfig());
    expect(fs.files.get(BAK)).toBe("{ esto no es json");
    expect(log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("no cumple el esquema: copia a .bak y defaults", async () => {
    const { fs, store } = setup();
    const bad = JSON.stringify({ version: 6, remote: { port: "47800" } });
    fs.files.set(PATH, bad);
    const res = await store.load();
    expect(res.status).toBe("recovered");
    expect(res.config).toEqual(defaultConfig());
    expect(fs.files.get(BAK)).toBe(bad);
  });

  it("sin version (o version que no es entero) cuenta como corrupto", async () => {
    for (const bad of [JSON.stringify({ remote: {} }), JSON.stringify({ version: "1" }), "[]", "null", "42"]) {
      const { fs, store } = setup();
      fs.files.set(PATH, bad);
      const res = await store.load();
      expect(res.status).toBe("recovered");
      expect(fs.files.get(BAK)).toBe(bad);
    }
  });

  it("el .bak nuevo pisa al anterior", async () => {
    const { fs, store } = setup();
    fs.files.set(BAK, "viejo");
    fs.files.set(PATH, "roto");
    await store.load();
    expect(fs.files.get(BAK)).toBe("roto");
  });

  it("un agent.json v1: se migra, se avisa y queda una copia .v1.bak con el original", async () => {
    const { fs, log, store } = setup();
    const v1 = JSON.stringify({ version: 1, remote: { enabled: true }, devices: [{ ...DEVICE, tokenHash: "sha256:" + "a".repeat(64) }] });
    fs.files.set(PATH, v1);
    const res = await store.load();
    expect(res.status).toBe("ok");
    expect(res.migratedFrom).toBe(1);
    expect(res.config).toMatchObject({ version: 6, devices: [], remote: { enabled: true }, identity: null });
    expect(fs.files.get(V1_BAK)).toBe(v1);
    expect(fs.files.has(BAK)).toBe(false);
    expect(log.entries.some((e) => e.msg.includes("migr"))).toBe(true);
  });

  it("un agent.json v2: se migra a v4 y queda una copia .v2.bak", async () => {
    const { fs, store } = setup();
    const v2 = JSON.stringify({ version: 2, remote: { enabled: true }, devices: [DEVICE] });
    fs.files.set(PATH, v2);
    const res = await store.load();
    expect(res.migratedFrom).toBe(2);
    expect(res.config.devices).toHaveLength(1);
    expect(res.config.library).toEqual({ launchers: [], scenes: [], deck: [] });
    expect(fs.files.get(`${PATH}.v2.bak`)).toBe(v2);
  });

  it("un agent.json v4: se migra a v5 con la llave del Pad prendida y queda una copia .v4.bak", async () => {
    const { fs, store } = setup();
    const v4 = JSON.stringify({ version: 4, remote: { enabled: true }, devices: [DEVICE] });
    fs.files.set(PATH, v4);
    const res = await store.load();
    expect(res.migratedFrom).toBe(4);
    expect(res.config.devices).toHaveLength(1);
    expect(res.config.input).toEqual({ enabled: true });
    expect(fs.files.get(`${PATH}.v4.bak`)).toBe(v4);
  });

  it("un agent.json v3: se migra a v5 con el audio vacío y queda una copia .v3.bak", async () => {
    const { fs, store } = setup();
    const v3 = JSON.stringify({ version: 3, remote: { enabled: true }, devices: [DEVICE], library: { launchers: [], scenes: [], deck: [{ kind: "identify" }] } });
    fs.files.set(PATH, v3);
    const res = await store.load();
    expect(res.migratedFrom).toBe(3);
    expect(res.config.devices).toHaveLength(1);
    expect(res.config.library.deck).toEqual([{ kind: "identify" }]);
    expect(res.config.audio).toEqual(EMPTY_AUDIO);
    expect(fs.files.get(`${PATH}.v3.bak`)).toBe(v3);
  });

  it("un agent.json vigente no se marca como migrado ni deja copias", async () => {
    const { fs, store } = setup();
    fs.files.set(PATH, JSON.stringify(defaultConfig()));
    const res = await store.load();
    expect(res.migratedFrom).toBeNull();
    expect(fs.files.has(V1_BAK)).toBe(false);
  });

  it("version mayor a la conocida: no pisa nada y arranca con el remoto apagado", async () => {
    const { fs, store } = setup();
    const future = JSON.stringify({ version: 99, remote: { enabled: true }, devices: [DEVICE], extra: 1 });
    fs.files.set(PATH, future);
    const res = await store.load();
    expect(res.status).toBe("newer_version");
    expect(res.config.remote.enabled).toBe(false);
    expect(res.config.devices).toEqual([]);
    expect(fs.files.get(PATH)).toBe(future);
    expect(fs.files.has(BAK)).toBe(false);
  });

  it("con version mayor, save() se niega para no pisar el archivo del futuro", async () => {
    const { fs, store } = setup();
    const future = JSON.stringify({ version: 99 });
    fs.files.set(PATH, future);
    await store.load();
    await expect(store.save(defaultConfig())).rejects.toBeInstanceOf(ConfigReadOnlyError);
    expect(fs.files.get(PATH)).toBe(future);
  });
});

describe("config store · save", () => {
  it("guarda JSON legible y se vuelve a leer igual", async () => {
    const { fs, store } = setup();
    const cfg = { ...defaultConfig(), devices: [DEVICE] };
    await store.save(cfg);
    expect(fs.files.get(PATH)).toContain("\n  "); // indentado
    expect((await store.load()).config).toEqual(cfg);
  });

  it("si la escritura falla, el archivo anterior queda intacto y el error sube", async () => {
    const { fs, store } = setup();
    await store.save(defaultConfig());
    const before = fs.files.get(PATH);
    fs.failNextWrite();
    await expect(store.save({ ...defaultConfig(), devices: [DEVICE] })).rejects.toThrow();
    expect(fs.files.get(PATH)).toBe(before);
    expect(fs.files.has(`${PATH}.tmp`)).toBe(false);
  });

  it("no escribe una config inválida", async () => {
    const { fs, store } = setup();
    const invalid = { ...defaultConfig(), devices: [{ ...DEVICE, publicKey: "plana" }] };
    await expect(store.save(invalid)).rejects.toThrow();
    expect(fs.files.has(PATH)).toBe(false);
  });

  it("dos saves seguidos se aplican en orden", async () => {
    const { store } = setup();
    const a = { ...defaultConfig(), remote: { ...defaultConfig().remote, port: 50000 } };
    const b = { ...defaultConfig(), remote: { ...defaultConfig().remote, port: 50001 } };
    await Promise.all([store.save(a), store.save(b)]);
    expect((await store.load()).config.remote.port).toBe(50001);
  });
});

describe("generateIdentity", () => {
  it("genera un par X25519 de 32 bytes en base64url (43 caracteres), y la pública sale de la privada", async () => {
    const id = generateIdentity(new FakeRandom(3));
    expect(id.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(id.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(id.publicKey).not.toBe(id.privateKey);
    const { identityToKeyPair } = await import("../src/config/identity");
    const kp = identityToKeyPair(id);
    const { bytesToBase64Url } = await import("@proyecto-e/protocol");
    expect(bytesToBase64Url(kp.publicKey)).toBe(id.publicKey);
  });

  it("dos llamadas con azar distinto dan identidades distintas", () => {
    expect(generateIdentity(new FakeRandom(1)).publicKey).not.toBe(generateIdentity(new FakeRandom(2)).publicKey);
  });
});
