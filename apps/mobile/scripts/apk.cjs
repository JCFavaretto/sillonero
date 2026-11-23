// `pnpm apk` (R10.2, docs/PLAN.md 8.6.0, D60): genera la APK de release firmada, sin Expo Go ni Metro.
//   pnpm apk            → revisa el entorno, copia el código a una carpeta corta, prebuild, Gradle y deja dist/proyecto-e.apk
//   pnpm apk --doctor   → solo revisa qué falta
// Las claves y contraseñas viven FUERA del repo (~/.gradle/gradle.properties y %USERPROFILE%\.proyecto-e\).
//
// Por qué se compila en una copia (C:\pe): con pnpm, las rutas de CMake de react-native-worklets y compañía pasan los
// 260 caracteres de Windows y ninja falla. En una carpeta corta entran. `subst` no sirve: Expo ve dos raíces distintas.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { diagnose, outputApkPath, resolveToolEnv, raiseWrapperTimeout, useLocalDistribution, mirrorCopyArgs, robocopyOk, MIRROR_WORKSPACE_EXTRA } = require("./apkLib.cjs");

const mobileDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(mobileDir, "..", "..");
const distDir = path.join(repoRoot, "dist");
const buildRoot = process.env.PROYECTO_E_BUILD_DIR || "C:\\pb";
const keystorePath = path.join(os.homedir(), ".proyecto-e", "proyecto-e-release.keystore");
const gradlePropsPath = path.join(os.homedir(), ".gradle", "gradle.properties");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} terminó con código ${r.status}`);
}

function javaOutput() {
  const r = spawnSync("java", ["-version"], { encoding: "utf8", shell: false });
  if (r.error) return null;
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

function inspect() {
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || null;
  return diagnose({
    javaOutput: javaOutput(),
    androidHome,
    androidHomeHasPlatforms: !!androidHome && fs.existsSync(path.join(androidHome, "platforms")),
    keystoreExists: fs.existsSync(keystorePath),
    gradlePropertiesText: fs.existsSync(gradlePropsPath) ? fs.readFileSync(gradlePropsPath, "utf8") : null,
  });
}

function useLocalTools() {
  const found = resolveToolEnv({ env: process.env, home: os.homedir(), localAppData: process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), exists: fs.existsSync });
  Object.assign(process.env, found);
  if (found.JAVA_HOME) process.env.PATH = path.join(found.JAVA_HOME, "bin") + path.delimiter + process.env.PATH;
}

function main() {
  useLocalTools();
  const problems = inspect();
  if (problems.length) {
    console.error("No se puede armar la APK todavía:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  if (process.argv.includes("--doctor")) {
    console.log("Entorno listo: JDK, Android SDK, clave y propiedades de firma en orden.");
    return;
  }

  // 1. Copia del código a una carpeta corta (sin node_modules, que se instala allá).
  const r = spawnSync("robocopy", mirrorCopyArgs(repoRoot, buildRoot), { stdio: "inherit" });
  if (r.error || !robocopyOk(r.status ?? 99)) throw new Error(`robocopy falló (código ${r.status})`);
  fs.appendFileSync(path.join(buildRoot, "pnpm-workspace.yaml"), MIRROR_WORKSPACE_EXTRA);
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--filter", "@proyecto-e/mobile..."], { cwd: buildRoot, shell: true });

  // 2. Prebuild + Gradle en la copia.
  const cwd = path.join(buildRoot, "apps", "mobile");
  run("npx", ["expo", "prebuild", "--platform", "android", "--no-install", "--clean"], { cwd, shell: true, env: { ...process.env, CI: "1" } });
  const androidDir = path.join(cwd, "android");
  const wrapperProps = path.join(androidDir, "gradle", "wrapper", "gradle-wrapper.properties");
  let props = raiseWrapperTimeout(fs.readFileSync(wrapperProps, "utf8"));
  // Plan B si services.gradle.org no responde: un zip de Gradle ya bajado y verificado (sha256 oficial) en tools/.
  const localGradle = path.join(os.homedir(), ".proyecto-e", "tools", "dl", "gradle-9.4.1-bin.zip");
  if (/gradle-9\.4\.1-bin\.zip/.test(props) && fs.existsSync(localGradle)) props = useLocalDistribution(props, localGradle);
  fs.writeFileSync(wrapperProps, props);
  const gradlew = process.platform === "win32" ? ".\\gradlew.bat" : "./gradlew";
  run(gradlew, ["assembleRelease"], { cwd: androidDir, shell: true });

  // 3. Entrega.
  fs.mkdirSync(distDir, { recursive: true });
  const target = path.join(distDir, "proyecto-e.apk");
  fs.copyFileSync(outputApkPath(androidDir), target);
  console.log(`\nListo: ${target} (${Math.round(fs.statSync(target).size / 1024 / 1024)} MB)`);
  console.log("Pasala al celu (cable, Drive) e instalala. Recordá tener copia de la clave de firma:", keystorePath);
}

main();
