import { describe, expect, it } from "vitest";
import { createCatalog } from "../src/apps/catalog";
import { createIcons } from "../src/apps/icons";
import { iconKeyFor } from "../src/apps/windowsModel";
import { FakeCatalog, FakeClock, FakeIconExtractor, MemFs } from "./fakes";

function catalogSetup() {
  const source = new FakeCatalog();
  const clock = new FakeClock();
  return { source, clock, catalog: createCatalog({ source, clock }) };
}

describe("catalog", () => {
  it("saca desinstaladores y documentos, y deja el resto", async () => {
    const { catalog } = catalogSetup();
    const names = (await catalog.search("")).items.map((i) => i.name);
    expect(names).toEqual(["Calculadora", "Cursor", "Discord"]);
  });
  it("busca sin acentos ni mayúsculas, primero los que empiezan y después los que contienen", async () => {
    const { source, catalog } = catalogSetup();
    source.apps.push({ appId: "x.cal", name: "Cámara" }, { appId: "x.ex", name: "Excel calc" });
    expect((await catalog.search("CAL")).items.map((i) => i.name)).toEqual(["Calculadora", "Excel calc"]);
    expect((await catalog.search("camara")).items.map((i) => i.name)).toEqual(["Cámara"]);
  });
  it("tope de 40 resultados con el total", async () => {
    const { source, catalog } = catalogSetup();
    source.apps = Array.from({ length: 60 }, (_, i) => ({ appId: "id" + i, name: "App " + String(i).padStart(2, "0") }));
    const r = await catalog.search("app");
    expect(r.items).toHaveLength(40);
    expect(r.total).toBe(60);
  });
  it("cada app trae una IconKey válida derivada de su appId", async () => {
    const { catalog } = catalogSetup();
    const [first] = (await catalog.search("cursor")).items;
    expect(first!.iconKey).toBe(iconKeyFor("Anysphere.Cursor"));
  });
  it("has() solo da true para lo que está en el catálogo (el celu no puede inventar un appId)", async () => {
    const { catalog } = catalogSetup();
    expect(await catalog.has("Anysphere.Cursor")).toBe(true);
    expect(await catalog.has("C:\\Windows\\System32\\cmd.exe")).toBe(false);
    expect(await catalog.has("C:\\Program Files\\Stremio\\Uninstall.exe")).toBe(false); // filtrado
  });
  it("cachea 10 minutos y después vuelve a leer", async () => {
    const { source, clock, catalog } = catalogSetup();
    await catalog.search("");
    await catalog.search("a");
    expect(source.reads).toBe(1);
    clock.advance(10 * 60_000 + 1);
    await catalog.search("a");
    expect(source.reads).toBe(2);
  });
  it("si falla la lectura, rechaza y no cachea el error; con caché vieja, la sigue usando", async () => {
    const { source, clock, catalog } = catalogSetup();
    source.failNext();
    await expect(catalog.search("")).rejects.toThrow();
    expect((await catalog.search("")).total).toBe(3);
    clock.advance(11 * 60_000);
    source.failNext();
    expect((await catalog.search("")).total).toBe(3);
  });
});

describe("icons", () => {
  const DIR = "data/icons";
  function setup() {
    const fs = new MemFs();
    const extractor = new FakeIconExtractor(fs);
    const icons = createIcons({ extractor, fs, dir: DIR });
    return { fs, extractor, icons };
  }
  const K1 = iconKeyFor("a");
  const K2 = iconKeyFor("b");

  it("una clave que no se registró da null (nunca se saca un ícono de algo que el agente no ofreció)", async () => {
    const { icons, extractor } = setup();
    expect(await icons.get([K1])).toEqual([{ key: K1, png: null }]);
    expect(extractor.calls).toHaveLength(0);
  });
  it("extrae las que faltan en una sola tanda y las lee del disco", async () => {
    const { icons, extractor } = setup();
    icons.register(K1, "shell:AppsFolder\\A");
    icons.register(K2, "C:\\b.exe");
    const out = await icons.get([K1, K2]);
    expect(out).toEqual([{ key: K1, png: "iVBORw0KGgo=" }, { key: K2, png: "iVBORw0KGgo=" }]);
    expect(extractor.calls).toHaveLength(1);
    await icons.get([K1]);
    expect(extractor.calls).toHaveLength(1); // ya estaba en la caché
  });
  it("si no sale el ícono da null y no insiste en cada pedido... pero lo reintenta una vez más tarde", async () => {
    const { icons, extractor } = setup();
    extractor.missing.add(K1);
    icons.register(K1, "x");
    expect((await icons.get([K1]))[0]!.png).toBeNull();
    expect((await icons.get([K1]))[0]!.png).toBeNull();
    expect(extractor.calls).toHaveLength(1);
  });
  it("un PNG de más de ~16 KB se descarta", async () => {
    const fs = new MemFs();
    const icons = createIcons({ extractor: new FakeIconExtractor(fs, "A".repeat(23_000)), fs, dir: DIR });
    icons.register(K1, "x");
    expect((await icons.get([K1]))[0]!.png).toBeNull();
  });
  it("ignora contenido que no es base64", async () => {
    const fs = new MemFs();
    const icons = createIcons({ extractor: new FakeIconExtractor(fs, "<script>"), fs, dir: DIR });
    icons.register(K1, "x");
    expect((await icons.get([K1]))[0]!.png).toBeNull();
  });
  it("sin extractor, solo sirve lo que ya está en disco", async () => {
    const fs = new MemFs();
    await fs.writeFileAtomic(`${DIR}/${K1}.b64`, "QUJD");
    const icons = createIcons({ fs, dir: DIR });
    icons.register(K1, "x");
    expect(await icons.get([K1, K2])).toEqual([{ key: K1, png: "QUJD" }, { key: K2, png: null }]);
  });
});
