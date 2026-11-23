/* eslint-disable @typescript-eslint/no-require-imports -- config plugin de Expo: tiene que ser CommonJS */
// Config plugin (R10.2, docs/PLAN.md 8.6.0, D63): firma el release con la clave propia.
// `expo prebuild` deja el release firmado con la clave de depuración; acá se cambia por un signingConfig
// que lee la ruta y las contraseñas de las propiedades de Gradle (~/.gradle/gradle.properties).
// Nunca se escribe una contraseña ni una ruta en el archivo generado.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// proyecto-e: firma del release (plugins/withReleaseSigning.js)";

const RELEASE_SIGNING = `        ${MARK}
        release {
            def storeFilePath = findProperty('PROYECTOE_STORE_FILE')
            if (storeFilePath) {
                storeFile file(storeFilePath)
                storePassword findProperty('PROYECTOE_STORE_PASSWORD')
                keyAlias findProperty('PROYECTOE_KEY_ALIAS')
                keyPassword findProperty('PROYECTOE_KEY_PASSWORD')
            }
        }
`;

function applyReleaseSigning(gradle) {
  if (gradle.includes(MARK)) return gradle;
  const signingConfigs = /signingConfigs \{\r?\n/;
  const releaseUsesDebug = /(buildTypes \{[\s\S]*?\brelease \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!signingConfigs.test(gradle) || !releaseUsesDebug.test(gradle)) {
    throw new Error(
      "withReleaseSigning: el build.gradle generado no tiene el formato esperado (signingConfigs / buildTypes.release). Revisar el template de Expo.",
    );
  }
  return gradle.replace(signingConfigs, (m) => m + RELEASE_SIGNING).replace(releaseUsesDebug, "$1signingConfig signingConfigs.release");
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
