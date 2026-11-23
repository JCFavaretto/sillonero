import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWindowsCatalog, createWindowsIconExtractor, launchArgs } from "../src/platform/win/appsNative";
import { iconKeyFor } from "../src/apps/windowsModel";

describe("launchArgs: lo único que llega a spawn", () => {
  it("app: un solo argumento shell:AppsFolder\\<AppID>", () => {
    expect(launchArgs.app("Anysphere.Cursor")).toEqual(["shell:AppsFolder\\Anysphere.Cursor"]);
    expect(launchArgs.app("C:\\Games\\a b\\x.exe")).toEqual(["shell:AppsFolder\\C:\\Games\\a b\\x.exe"]);
  });
  it("link: rundll32 con la URL como UN argumento (el & no se interpreta)", () => {
    expect(launchArgs.url("https://youtu.be/x?a=1&b=2")).toEqual(["url.dll,FileProtocolHandler", "https://youtu.be/x?a=1&b=2"]);
  });
});

// Solo lectura sobre la PC real: lista las apps del menú Inicio y saca un ícono de notepad.exe.
describe.runIf(process.platform === "win32")("Windows real: catálogo e íconos", () => {
  it("el catálogo trae apps con appId y nombre", async () => {
    const apps = await createWindowsCatalog().list();
    expect(apps.length).toBeGreaterThan(0);
    expect(apps[0]).toEqual({ appId: expect.any(String), name: expect.any(String) });
  }, 30_000);

  it("saca el ícono de notepad.exe como PNG en base64", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pe-icons-"));
    try {
      const exe = (process.env.SystemRoot ?? "C:\\Windows") + "\\System32\\notepad.exe";
      const key = iconKeyFor(exe);
      await createWindowsIconExtractor().extract(
        [
          { key, parsing: exe },
          { key: "i_AAAAAAAAAAAAAAAA", parsing: "C:\\no\\existe.exe" },
        ],
        dir,
      );
      expect(existsSync(join(dir, key + ".b64"))).toBe(true);
      expect(Buffer.from(readFileSync(join(dir, key + ".b64"), "utf8"), "base64").subarray(1, 4).toString()).toBe("PNG");
      expect(existsSync(join(dir, "i_AAAAAAAAAAAAAAAA.b64"))).toBe(false); // el que falla queda sin archivo
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
