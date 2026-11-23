import * as fs from "node:fs";
import * as path from "node:path";

// R10.4 (docs/PLAN.md 8.6.0, riesgo "rutas largas"): con pnpm, las rutas de CMake de las librerías nativas pasan los 260
// caracteres de Windows y ninja falla con "build.ninja still dirty". El plugin manda el build nativo a una carpeta corta.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyShortNativeDir, SHORT_NATIVE_DIR } = require("../plugins/withShortNativeDir.js") as {
  applyShortNativeDir: (gradle: string) => string;
  SHORT_NATIVE_DIR: string;
};

const template = fs.readFileSync(path.join(__dirname, "fixtures", "settings.gradle.txt"), "utf8");

describe("applyShortNativeDir", () => {
  const out = applyShortNativeDir(template);

  it("manda el build de CMake de cada librería Android a una carpeta corta", () => {
    expect(SHORT_NATIVE_DIR.length).toBeLessThan(16);
    expect(out).toContain("buildStagingDirectory");
    expect(out).toContain(SHORT_NATIVE_DIR);
    expect(out).toContain("com.android.library");
    expect(out).toContain("com.android.application"); // el módulo app también compila C++ (codegen de gesture-handler)
  });

  it("se engancha antes de que cada proyecto se configure (en el build.gradle raíz ya es tarde)", () => {
    expect(out).toContain("gradle.beforeProject");
  });

  it("deja el resto del archivo igual y es idempotente", () => {
    expect(out.startsWith(template)).toBe(true);
    expect(applyShortNativeDir(out)).toBe(out);
  });
});
