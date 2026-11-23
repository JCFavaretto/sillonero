/* eslint-disable @typescript-eslint/no-require-imports -- config plugin de Expo: tiene que ser CommonJS */
// Config plugin (R10.4, docs/PLAN.md 8.6.0): en Windows con pnpm, las rutas del build nativo (CMake) de
// react-native-screens, worklets, etc. pasan los 260 caracteres y ninja falla ("build.ninja still dirty").
// Se manda el directorio de trabajo de CMake de cada librería Android a una carpeta corta.
// Va en settings.gradle (beforeProject): en el build.gradle raíz ya es tarde, AGP ya leyó el valor.
const { withSettingsGradle } = require("expo/config-plugins");

const SHORT_NATIVE_DIR = "C:/pc";
const MARK = "// proyecto-e: build nativo en una carpeta corta (plugins/withShortNativeDir.js)";

const SNIPPET = `
${MARK}
gradle.beforeProject { p ->
  ['com.android.library', 'com.android.application'].each { id ->
    p.pluginManager.withPlugin(id) {
      p.android.externalNativeBuild.cmake.buildStagingDirectory = new File("${SHORT_NATIVE_DIR}/\${p.name}")
    }
  }
}
`;

function applyShortNativeDir(gradle) {
  if (gradle.includes(MARK)) return gradle;
  return gradle + (gradle.endsWith("\n") ? "" : "\n") + SNIPPET;
}

function withShortNativeDir(config) {
  return withSettingsGradle(config, (cfg) => {
    cfg.modResults.contents = applyShortNativeDir(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withShortNativeDir;
module.exports.applyShortNativeDir = applyShortNativeDir;
module.exports.SHORT_NATIVE_DIR = SHORT_NATIVE_DIR;
