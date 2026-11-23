import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultBrowserExe, newWindowArgs, parseOpenCommand, parseRegValue, privateArgs } from "../src/platform/win/privateBrowsing";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

describe("privateArgs: la opción de ventana privada de cada navegador", () => {
  it("Chrome, Brave y Vivaldi usan --incognito; Edge --inprivate; Opera --private; Firefox -private-window", () => {
    expect(privateArgs(CHROME, null)).toEqual(["--incognito"]);
    expect(privateArgs("C:\\x\\brave.exe", null)).toEqual(["--incognito"]);
    expect(privateArgs("C:\\x\\vivaldi.exe", null)).toEqual(["--incognito"]);
    expect(privateArgs("C:\\x\\msedge.exe", null)).toEqual(["--inprivate"]);
    expect(privateArgs("C:\\x\\opera.exe", null)).toEqual(["--private"]);
    expect(privateArgs("C:\\x\\Firefox.EXE", null)).toEqual(["-private-window"]);
  });

  it("con dirección, va como un argumento aparte (el & no se interpreta: no hay shell)", () => {
    expect(privateArgs(CHROME, "https://youtu.be/x?a=1&b=2")).toEqual(["--incognito", "https://youtu.be/x?a=1&b=2"]);
  });

  it("un programa que no es un navegador conocido, o una ruta rara, no se abre", () => {
    expect(privateArgs("C:\\Windows\\System32\\notepad.exe", null)).toBeNull();
    expect(privateArgs("chrome.exe", null)).toBeNull();
    expect(privateArgs("\\\\servidor\\x\\chrome.exe", null)).toBeNull();
    expect(privateArgs('C:\\x\\chrome.exe" --otra', null)).toBeNull();
  });
});

describe("newWindowArgs: ventana nueva y común", () => {
  it("los navegadores Chromium usan --new-window y Firefox -new-window, con la dirección como un argumento", () => {
    expect(newWindowArgs(CHROME, "https://a.com/?x=1&y=2")).toEqual(["--new-window", "https://a.com/?x=1&y=2"]);
    expect(newWindowArgs("C:\\x\\msedge.exe", null)).toEqual(["--new-window"]);
    expect(newWindowArgs("C:\\x\\firefox.exe", null)).toEqual(["-new-window"]);
  });
  it("lo que no es un navegador conocido no se abre", () => {
    expect(newWindowArgs("C:\\Windows\\System32\\notepad.exe", null)).toBeNull();
    expect(newWindowArgs("chrome.exe", null)).toBeNull();
  });
});

describe("leer el navegador predeterminado del registro", () => {
  it("parseOpenCommand saca el .exe, con o sin comillas", () => {
    expect(parseOpenCommand(`"${CHROME}" --single-argument %1`)).toBe(CHROME);
    expect(parseOpenCommand("C:\\Navegador\\nav.exe %1")).toBe("C:\\Navegador\\nav.exe");
    expect(parseOpenCommand("rundll32 algo.dll,Abrir %1")).toBeNull();
    expect(parseOpenCommand("")).toBeNull();
  });

  it("parseRegValue lee el valor de la salida de reg query", () => {
    expect(parseRegValue("\r\nHKEY_CURRENT_USER\\…\\UserChoice\r\n    ProgId    REG_SZ    ChromeHTML\r\n\r\n")).toBe("ChromeHTML");
    expect(parseRegValue("ERROR: no se encontró")).toBeNull();
  });

  it("une las dos consultas: ProgId y su comando", async () => {
    const calls: string[][] = [];
    const exe = await defaultBrowserExe(async (args) => {
      calls.push(args);
      return calls.length === 1 ? "    ProgId    REG_SZ    ChromeHTML\r\n" : `    (Predeterminado)    REG_SZ    "${CHROME}" --single-argument %1\r\n`;
    });
    expect(exe).toBe(CHROME);
    expect(calls[1]![1]).toBe("HKCR\\ChromeHTML\\shell\\open\\command");
  });

  it("un ProgId raro no llega a la segunda consulta; si el registro falla, null", async () => {
    let n = 0;
    expect(await defaultBrowserExe(async () => (n++, "    ProgId    REG_SZ    a\\..\\b\r\n"))).toBeNull();
    expect(n).toBe(1);
    expect(await defaultBrowserExe(async () => Promise.reject(new Error("no")))).toBeNull();
  });
});

// Solo lectura sobre la PC real.
describe.runIf(process.platform === "win32")("Windows real: navegador predeterminado", () => {
  it("devuelve un .exe que existe (o null si esta PC no tiene uno elegido)", async () => {
    const exe = await defaultBrowserExe();
    if (exe !== null) expect(existsSync(exe)).toBe(true);
  });
});
