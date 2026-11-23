import * as fs from "node:fs";
import * as path from "node:path";

// R10.2 (docs/PLAN.md 8.6.0, D63): el build.gradle que genera `expo prebuild` firma el release con la clave de
// depuración. El plugin lo cambia por la clave propia, que se lee de las propiedades de Gradle (nunca del repo).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyReleaseSigning } = require("../plugins/withReleaseSigning.js") as { applyReleaseSigning: (gradle: string) => string };

const template = fs.readFileSync(path.join(__dirname, "fixtures", "build.gradle.txt"), "utf8");

describe("applyReleaseSigning", () => {
  const out = applyReleaseSigning(template);

  it("crea el signingConfig release leyendo las propiedades de Gradle", () => {
    expect(out).toMatch(/signingConfigs \{\s*(\/\/[^\n]*\s*)?release \{/);
    for (const key of ["PROYECTOE_STORE_FILE", "PROYECTOE_STORE_PASSWORD", "PROYECTOE_KEY_ALIAS", "PROYECTOE_KEY_PASSWORD"]) {
      expect(out).toContain(`findProperty('${key}')`);
    }
  });

  it("el buildType release usa la clave propia, no la de depuración", () => {
    const release = out.slice(out.indexOf("buildTypes {"));
    const releaseBlock = release.slice(release.indexOf("release {"));
    expect(releaseBlock).toMatch(/signingConfig signingConfigs\.release/);
    expect(releaseBlock.slice(0, releaseBlock.indexOf("proguardFiles"))).not.toMatch(/signingConfigs\.debug/);
    // el de depuración sigue firmando el debug
    expect(release.slice(0, release.indexOf("release {"))).toMatch(/signingConfig signingConfigs\.debug/);
  });

  it("no escribe ninguna contraseña ni ruta en el archivo", () => {
    // la única contraseña escrita a mano es la del template de depuración ('android'); la de release es una propiedad
    expect(out).not.toMatch(/(storePassword|keyPassword)\s+['"](?!android['"])/);
    expect(out).not.toMatch(/storeFile file\(['"](?!debug\.keystore)/);
  });

  it("es idempotente: aplicarlo dos veces no duplica nada", () => {
    expect(applyReleaseSigning(out)).toBe(out);
  });

  it("falla claro si el build.gradle cambió de forma y no se puede aplicar", () => {
    expect(() => applyReleaseSigning("android { }")).toThrow(/signingConfigs/);
  });
});
