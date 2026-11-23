import { describe, expect, it } from "vitest";
import { buildRunCommand, createAutostart, RUN_KEY, RUN_NAME, type RegRunner } from "../src/platform/autostart";
import { parseArgs } from "../src/cli";

class FakeReg {
  calls: { file: string; args: string[] }[] = [];
  value: string | null = null;
  failNext: string | null = null;
  readonly run: RegRunner = async (file, args) => {
    this.calls.push({ file, args });
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      return { code: 1, stdout: "", stderr: err };
    }
    const op = args[0];
    if (op === "add") {
      this.value = args[args.indexOf("/d") + 1] ?? null;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (op === "delete") {
      const had = this.value !== null;
      this.value = null;
      return had ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "ERROR: no se encontró" };
    }
    if (op === "query") {
      return this.value === null
        ? { code: 1, stdout: "", stderr: "ERROR: no se encontró" }
        : { code: 0, stdout: `\r\n${RUN_KEY}\r\n    ${RUN_NAME}    REG_SZ    ${this.value}\r\n\r\n`, stderr: "" };
    }
    return { code: 2, stdout: "", stderr: "?" };
  };
}

const COMMAND = '"C:\\Program Files\\nodejs\\node.exe" "C:\\Apps\\Proyecto E\\agent.mjs" --background';

describe("buildRunCommand", () => {
  it("pone cada parte entre comillas y suma --background", () => {
    expect(buildRunCommand("C:\\Program Files\\nodejs\\node.exe", ["--import", "x.mjs", "C:\\Apps\\Proyecto E\\agent.mjs"])).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" "--import" "x.mjs" "C:\\Apps\\Proyecto E\\agent.mjs" --background',
    );
  });

  it("rechaza comillas y % (no se arma un comando con inyección)", () => {
    expect(() => buildRunCommand('C:\\a"b\\node.exe', [])).toThrow();
    expect(() => buildRunCommand("C:\\%PATH%\\node.exe", [])).toThrow();
    expect(() => buildRunCommand("C:\\node.exe", ["a\nb"])).toThrow();
  });
});

describe("autostart (reg.exe, por usuario)", () => {
  it("lee 'apagado' si la entrada no existe", async () => {
    const reg = new FakeReg();
    const a = createAutostart({ run: reg.run, command: COMMAND });
    expect(await a.read()).toEqual({ enabled: false });
    expect(reg.calls[0]).toEqual({ file: expect.stringMatching(/reg\.exe$/i), args: ["query", RUN_KEY, "/v", RUN_NAME] });
  });

  it("activar crea la entrada con el comando entre comillas, sin shell, y se puede leer", async () => {
    const reg = new FakeReg();
    const a = createAutostart({ run: reg.run, command: COMMAND });
    await a.set(true);
    expect(reg.calls[0]!.args).toEqual(["add", RUN_KEY, "/v", RUN_NAME, "/t", "REG_SZ", "/d", COMMAND, "/f"]);
    expect(await a.read()).toEqual({ enabled: true });
  });

  it("desactivar borra la entrada; borrar una que no existe no es error", async () => {
    const reg = new FakeReg();
    const a = createAutostart({ run: reg.run, command: COMMAND });
    await a.set(true);
    await a.set(false);
    expect(reg.value).toBeNull();
    await expect(a.set(false)).resolves.toBeUndefined();
  });

  it("si reg.exe falla al escribir, rechaza con el motivo", async () => {
    const reg = new FakeReg();
    const a = createAutostart({ run: reg.run, command: COMMAND });
    reg.failNext = "Acceso denegado";
    await expect(a.set(true)).rejects.toThrow(/Acceso denegado/);
  });

  it("el nombre de la entrada se puede cambiar (para las pruebas con ProyectoE-Test)", async () => {
    const reg = new FakeReg();
    const a = createAutostart({ run: reg.run, command: COMMAND, name: "ProyectoE-Test" });
    await a.set(true);
    expect(reg.calls[0]!.args).toContain("ProyectoE-Test");
    expect(reg.calls[0]!.args).not.toContain(RUN_NAME);
  });
});

describe("parseArgs", () => {
  it("--background evita abrir el panel", () => {
    expect(parseArgs(["node", "main.ts"])).toEqual({ background: false, smoke: false });
    expect(parseArgs(["node", "main.ts", "--background"])).toEqual({ background: true, smoke: false });
  });
});
