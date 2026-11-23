// R10.2 (docs/PLAN.md 8.6.0): lógica pura del script `pnpm apk`. El script real solo llama a estas funciones y a procesos.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require("../scripts/apkLib.cjs") as {
  parseJavaMajor: (out: string) => number | null;
  missingSigningProps: (gradlePropertiesText: string) => string[];
  pickFreeDrive: (used: string[]) => string | null;
  diagnose: (i: DiagnoseInput) => string[];
  outputApkPath: (root: string) => string;
  mirrorCopyArgs: (src: string, dst: string) => string[];
  robocopyOk: (code: number) => boolean;
  MIRROR_WORKSPACE_EXTRA: string;
  raiseWrapperTimeout: (props: string) => string;
  useLocalDistribution: (props: string, zipPath: string) => string;
  resolveToolEnv: (i: { env: Record<string, string | undefined>; home: string; localAppData: string; exists: (p: string) => boolean }) => Record<string, string>;
};
interface DiagnoseInput {
  javaOutput: string | null;
  androidHome: string | null;
  androidHomeHasPlatforms: boolean;
  keystoreExists: boolean;
  gradlePropertiesText: string | null;
}
const ok: DiagnoseInput = {
  javaOutput: 'openjdk version "17.0.12" 2024-07-16',
  androidHome: "C:\\Users\\x\\AppData\\Local\\Android\\Sdk",
  androidHomeHasPlatforms: true,
  keystoreExists: true,
  gradlePropertiesText: "PROYECTOE_STORE_FILE=C:/k.keystore\nPROYECTOE_STORE_PASSWORD=a\nPROYECTOE_KEY_ALIAS=b\nPROYECTOE_KEY_PASSWORD=c\n",
};

describe("parseJavaMajor", () => {
  it("lee la versión mayor de `java -version`", () => {
    expect(lib.parseJavaMajor('openjdk version "17.0.12" 2024-07-16')).toBe(17);
    expect(lib.parseJavaMajor('java version "21.0.1"')).toBe(21);
    expect(lib.parseJavaMajor('openjdk version "1.8.0_402"')).toBe(8);
  });
  it("devuelve null si no entiende la salida", () => {
    expect(lib.parseJavaMajor("hola")).toBeNull();
  });
});

describe("missingSigningProps", () => {
  it("lista las propiedades de firma que faltan o están vacías", () => {
    expect(lib.missingSigningProps(ok.gradlePropertiesText!)).toEqual([]);
    expect(lib.missingSigningProps("PROYECTOE_STORE_FILE=x\nPROYECTOE_KEY_ALIAS=\n# PROYECTOE_KEY_PASSWORD=z")).toEqual([
      "PROYECTOE_STORE_PASSWORD",
      "PROYECTOE_KEY_ALIAS",
      "PROYECTOE_KEY_PASSWORD",
    ]);
  });
});

describe("pickFreeDrive", () => {
  it("elige una letra libre de las altas y null si no hay", () => {
    expect(lib.pickFreeDrive(["C", "D"])).toBe("X");
    expect(lib.pickFreeDrive(["X"])).toBe("Y");
    expect(lib.pickFreeDrive(["X", "Y", "Z", "W", "V", "U"])).toBeNull();
  });
});

describe("diagnose", () => {
  it("todo en orden: sin problemas", () => {
    expect(lib.diagnose(ok)).toEqual([]);
  });
  it("avisa de cada cosa que falta, con qué hacer", () => {
    const problems = lib.diagnose({ javaOutput: null, androidHome: null, androidHomeHasPlatforms: false, keystoreExists: false, gradlePropertiesText: null });
    expect(problems.join("\n")).toMatch(/JDK/);
    expect(problems.join("\n")).toMatch(/ANDROID_HOME/);
    expect(problems.join("\n")).toMatch(/keystore/i);
    expect(problems.join("\n")).toMatch(/gradle\.properties/);
  });
  it("rechaza un JDK que no sea 17 o 21", () => {
    expect(lib.diagnose({ ...ok, javaOutput: 'openjdk version "11.0.2"' }).join("\n")).toMatch(/JDK 17/);
  });
});

describe("resolveToolEnv", () => {
  const home = "C:\\Users\\x";
  const local = "C:\\Users\\x\\AppData\\Local";
  const exists = (set: string[]) => (p: string) => set.includes(p.replace(/\//g, "\\"));

  it("usa las variables del entorno si ya están", () => {
    const r = lib.resolveToolEnv({ env: { JAVA_HOME: "J", ANDROID_HOME: "A" }, home, localAppData: local, exists: exists([]) });
    expect(r).toEqual({ JAVA_HOME: "J", ANDROID_HOME: "A" });
  });
  it("si faltan, usa las carpetas que deja la instalación (sin tocar las variables del sistema)", () => {
    const r = lib.resolveToolEnv({
      env: {},
      home,
      localAppData: local,
      exists: exists(["C:\\Users\\x\\.proyecto-e\\tools\\jdk\\bin\\java.exe", "C:\\Users\\x\\AppData\\Local\\Android\\Sdk\\platforms"]),
    });
    expect(r.JAVA_HOME).toBe("C:\\Users\\x\\.proyecto-e\\tools\\jdk");
    expect(r.ANDROID_HOME).toBe("C:\\Users\\x\\AppData\\Local\\Android\\Sdk");
  });
  it("si no hay nada, no inventa rutas", () => {
    expect(lib.resolveToolEnv({ env: {}, home, localAppData: local, exists: exists([]) })).toEqual({});
  });
});

describe("raiseWrapperTimeout", () => {
  it("sube el plazo de descarga del wrapper de Gradle a 2 minutos", () => {
    expect(lib.raiseWrapperTimeout("a=b\nnetworkTimeout=10000\nc=d")).toBe("a=b\nnetworkTimeout=120000\nc=d");
  });
  it("lo agrega si no estaba y no toca un plazo ya mayor", () => {
    expect(lib.raiseWrapperTimeout("a=b")).toBe("a=b\nnetworkTimeout=120000\n");
    expect(lib.raiseWrapperTimeout("networkTimeout=300000")).toBe("networkTimeout=300000");
  });
});

describe("useLocalDistribution", () => {
  it("apunta el wrapper a un zip local con una URL file:///", () => {
    const props = "a=b\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip\nc=d";
    expect(lib.useLocalDistribution(props, "C:\\Users\\x\\g.zip")).toBe("a=b\ndistributionUrl=file\\:///C:/Users/x/g.zip\nc=d");
  });
});

describe("mirrorCopyArgs", () => {
  it("arma el robocopy que copia el código a una carpeta corta sin node_modules, android ni .git", () => {
    const args = lib.mirrorCopyArgs("C:\\repo", "C:\\pe");
    expect(args.slice(0, 3)).toEqual(["C:\\repo", "C:\\pe", "/MIR"]);
    const xd = args.slice(args.indexOf("/XD") + 1);
    for (const d of ["node_modules", "android", "ios", ".git", "dist", "scratch"]) expect(xd).toContain(d);
  });
  it("instala la copia con node_modules plano (hoisted) para acortar las rutas de CMake", () => {
    expect(lib.MIRROR_WORKSPACE_EXTRA).toBe("\nnodeLinker: hoisted\n");
  });
  it("trata los códigos 0 a 7 de robocopy como éxito y 8 o más como error", () => {
    expect(lib.robocopyOk(0)).toBe(true);
    expect(lib.robocopyOk(3)).toBe(true);
    expect(lib.robocopyOk(7)).toBe(true);
    expect(lib.robocopyOk(8)).toBe(false);
  });
});

describe("outputApkPath", () => {
  it("apunta al APK de release que deja Gradle", () => {
    expect(lib.outputApkPath("/x/android").replace(/\\/g, "/")).toBe("/x/android/app/build/outputs/apk/release/app-release.apk");
  });
});
