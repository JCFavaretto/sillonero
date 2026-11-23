import * as fs from "node:fs";
import * as path from "node:path";

// R10 (docs/PLAN.md 8.6.0): la APK instalable depende de esta config. Si algo de acá cambia sin querer,
// la app no conecta con la PC (tráfico en claro), no escanea el QR o pierde la identidad.
interface PluginProps { android: { usesCleartextTraffic: boolean; buildArchs: string[] } }
interface AppJson { name: string; orientation: string; android: { package: string; versionCode: number }; plugins: unknown[] }
const app = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app.json"), "utf8")).expo as AppJson;

const pluginConfig = (name: string): PluginProps | null => {
  const entry = app.plugins.find((p) => (Array.isArray(p) ? p[0] === name : p === name));
  if (!entry) return null;
  return Array.isArray(entry) ? (entry[1] as PluginProps) : null;
};

describe("app.json para la APK", () => {
  it("tiene un package de Android fijo (D62)", () => {
    expect(app.android.package).toBe("com.jfavarettodev.proyectoe");
  });

  it("tiene un versionCode entero positivo", () => {
    expect(Number.isInteger(app.android.versionCode)).toBe(true);
    expect(app.android.versionCode).toBeGreaterThan(0);
  });

  it("permite tráfico en claro (ws:// por la LAN, D61) y arma solo arm64 y x86_64 (D64)", () => {
    const props = pluginConfig("expo-build-properties");
    expect(props).not.toBeNull();
    expect(props!.android.usesCleartextTraffic).toBe(true);
    expect(props!.android.buildArchs).toEqual(["arm64-v8a", "x86_64"]);
  });

  it("mantiene la cámara del QR, la rotación libre y el nombre", () => {
    expect(app.orientation).toBe("default");
    expect(app.name).toBe("Sillonero");
    // expo-camera agrega el permiso CAMERA al manifest por autolinking; el plugin pone el texto de iOS.
    const deps = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).dependencies;
    expect(deps["expo-camera"]).toBeDefined();
    expect(deps["expo-build-properties"]).toBeDefined();
  });

  it("no pide permisos que la app no usa (micrófono, superponer, almacenamiento)", () => {
    const blocked = (app.android as unknown as { blockedPermissions: string[] }).blockedPermissions;
    for (const p of ["RECORD_AUDIO", "SYSTEM_ALERT_WINDOW", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE"]) {
      expect(blocked).toContain(`android.permission.${p}`);
    }
    expect(blocked).not.toContain("android.permission.CAMERA"); // la cámara del QR sí
    expect(blocked).not.toContain("android.permission.INTERNET");
  });

  it("firma el release con la clave propia (plugin de D63)", () => {
    expect(app.plugins).toContain("./plugins/withReleaseSigning.js");
  });

  it("no lleva claves ni contraseñas de firma en la config", () => {
    const text = JSON.stringify(app);
    expect(text).not.toMatch(/password|keystore|storePassword/i);
  });
});
