// Lógica pura de `pnpm apk` (R10.2, docs/PLAN.md 8.6.0). Sin procesos ni disco: se prueba en __tests__/apkLib.test.ts.
const path = require("node:path");

const SIGNING_PROPS = ["PROYECTOE_STORE_FILE", "PROYECTOE_STORE_PASSWORD", "PROYECTOE_KEY_ALIAS", "PROYECTOE_KEY_PASSWORD"];
const ACCEPTED_JDK = [17, 21];

function parseJavaMajor(output) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(output);
  if (!m) return null;
  const first = Number(m[1]);
  return first === 1 ? Number(m[2]) : first; // "1.8.0" es Java 8
}

function missingSigningProps(text) {
  const present = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(\S.*)$/.exec(line);
    if (m) present.add(m[1]);
  }
  return SIGNING_PROPS.filter((p) => !present.has(p));
}

/** Letra de unidad corta para `subst` (rutas largas de Windows, D60). */
function pickFreeDrive(used) {
  const taken = new Set(used.map((u) => u.toUpperCase()));
  for (const letter of ["X", "Y", "Z", "W", "V", "U"]) if (!taken.has(letter)) return letter;
  return null;
}

function diagnose(i) {
  const problems = [];
  if (i.javaOutput === null) {
    problems.push("Falta el JDK 17: instalalo (por ejemplo `winget install Microsoft.OpenJDK.17`) y abrí una terminal nueva.");
  } else {
    const major = parseJavaMajor(i.javaOutput);
    if (major === null || !ACCEPTED_JDK.includes(major)) {
      problems.push(`Se necesita JDK 17 (o 21) y hay ${major === null ? "una versión que no reconozco" : `la ${major}`}.`);
    }
  }
  if (!i.androidHome) {
    problems.push("Falta la variable ANDROID_HOME (el Android SDK; por defecto %LOCALAPPDATA%\\Android\\Sdk).");
  } else if (!i.androidHomeHasPlatforms) {
    problems.push("El Android SDK no tiene plataformas instaladas: instalá platform-tools, platforms;android-36, build-tools, ndk y cmake con sdkmanager.");
  }
  if (!i.keystoreExists) {
    problems.push("Falta la clave de firma (keystore) en %USERPROFILE%\\.proyecto-e\\. Se genera con `keytool`; guardá una copia: sin ella no se puede actualizar la app.");
  }
  if (i.gradlePropertiesText === null) {
    problems.push("Falta ~/.gradle/gradle.properties con PROYECTOE_STORE_FILE, PROYECTOE_STORE_PASSWORD, PROYECTOE_KEY_ALIAS y PROYECTOE_KEY_PASSWORD.");
  } else {
    const missing = missingSigningProps(i.gradlePropertiesText);
    if (missing.length) problems.push(`Faltan en ~/.gradle/gradle.properties: ${missing.join(", ")}.`);
  }
  return problems;
}

/** Si JAVA_HOME / ANDROID_HOME no están, usa las carpetas de la instalación guiada (sin tocar las variables del sistema). */
function resolveToolEnv({ env, home, localAppData, exists }) {
  const out = {};
  const jdk = path.win32.join(home, '.proyecto-e', 'tools', 'jdk');
  const sdk = path.win32.join(localAppData, 'Android', 'Sdk');
  if (env.JAVA_HOME) out.JAVA_HOME = env.JAVA_HOME;
  else if (exists(path.win32.join(jdk, 'bin', 'java.exe'))) out.JAVA_HOME = jdk;
  const androidHome = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (androidHome) out.ANDROID_HOME = androidHome;
  else if (exists(path.win32.join(sdk, 'platforms'))) out.ANDROID_HOME = sdk;
  return out;
}

/** El wrapper de Gradle corta la descarga a los 10 s; el servidor a veces tarda más en empezar. */
function raiseWrapperTimeout(props) {
  const m = /^networkTimeout=(\d+)\s*$/m.exec(props);
  if (!m) return props + (props.endsWith("\n") ? "" : "\n") + "networkTimeout=120000\n";
  return Number(m[1]) >= 120000 ? props : props.replace(m[0], "networkTimeout=120000");
}

/** Si services.gradle.org no responde, el wrapper puede usar un zip ya bajado y verificado (file:///). */
function useLocalDistribution(props, zipPath) {
  const uri = "file\\:///" + zipPath.replace(/\\/g, "/");
  return props.replace(/^distributionUrl=.*$/m, "distributionUrl=" + uri);
}

/** Rutas largas de Windows (pnpm + CMake pasan los 260 caracteres): el build se hace en una copia en una carpeta corta. */
const MIRROR_EXCLUDED_DIRS = ["node_modules", "android", "ios", ".git", "dist", "scratch", "docs", "prototipo-ahk", ".expo"];
function mirrorCopyArgs(src, dst) {
  return [src, dst, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/XD", ...MIRROR_EXCLUDED_DIRS];
}
/** La copia se instala con node_modules plano (hoisted): sin la carpeta .pnpm las rutas de CMake entran en los 260 caracteres. */
const MIRROR_WORKSPACE_EXTRA = "\nnodeLinker: hoisted\n"; // pnpm 12 lee esto de pnpm-workspace.yaml, no de .npmrc

/** robocopy: 0 a 7 es éxito (distintos "se copió algo"), 8 o más es error. */
const robocopyOk = (code) => code >= 0 && code < 8;

function outputApkPath(androidDir) {
  return path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
}

module.exports = { SIGNING_PROPS, parseJavaMajor, missingSigningProps, pickFreeDrive, diagnose, outputApkPath, resolveToolEnv, raiseWrapperTimeout, useLocalDistribution, mirrorCopyArgs, robocopyOk, MIRROR_WORKSPACE_EXTRA };
