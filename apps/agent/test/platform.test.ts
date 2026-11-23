import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrowser } from "../src/platform/browser";
import { systemClock } from "../src/platform/clock";
import { createFileSystem } from "../src/platform/fs";
import { createNetInfo } from "../src/platform/netinfo";
import { cryptoRandom } from "../src/platform/random";
import { createSystemInfo } from "../src/platform/sysinfo";
import { FakeClock, MemFs } from "./fakes";

describe("FileSystem real (carpeta temporal)", () => {
  let dir: string;
  const fs = createFileSystem();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pe-agent-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("readFile devuelve null si no existe y el texto si existe", async () => {
    const p = join(dir, "a.txt");
    expect(await fs.readFile(p)).toBeNull();
    await writeFile(p, "hola");
    expect(await fs.readFile(p)).toBe("hola");
  });

  it("writeFileAtomic escribe, pisa y no deja el .tmp", async () => {
    const p = join(dir, "agent.json");
    await fs.writeFileAtomic(p, "uno");
    await fs.writeFileAtomic(p, "dos");
    expect(await readFile(p, "utf8")).toBe("dos");
    expect(await readdir(dir)).toEqual(["agent.json"]);
  });

  it("writeFileAtomic crea las carpetas que falten", async () => {
    const p = join(dir, "sub", "deep", "agent.json");
    await fs.writeFileAtomic(p, "x");
    expect(await readFile(p, "utf8")).toBe("x");
  });

  it("mkdirp, appendFile, size, copyFile y rename", async () => {
    const sub = join(dir, "logs");
    await fs.mkdirp(sub);
    await fs.mkdirp(sub); // idempotente
    const log = join(sub, "agent.log");
    expect(await fs.size(log)).toBeNull();
    await fs.appendFile(log, "ab");
    await fs.appendFile(log, "cd");
    expect(await fs.size(log)).toBe(4);
    await fs.copyFile(log, join(sub, "copy.log"));
    await fs.rename(log, join(sub, "agent.log.1"));
    expect(await fs.readFile(log)).toBeNull();
    expect(await fs.readFile(join(sub, "agent.log.1"))).toBe("abcd");
    expect(await fs.readFile(join(sub, "copy.log"))).toBe("abcd");
  });

  it("rename pisa el destino si ya existe (rotación del log)", async () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    await writeFile(a, "nuevo");
    await writeFile(b, "viejo");
    await fs.rename(a, b);
    expect(await readFile(b, "utf8")).toBe("nuevo");
  });

  it("readFile propaga errores que no son ENOENT", async () => {
    // Leer una carpeta como archivo da EISDIR.
    await expect(fs.readFile(dir)).rejects.toThrow();
  });
});

describe("MemFs (fake)", () => {
  it("failNextWrite falla una vez y deja el original intacto", async () => {
    const fs = new MemFs();
    await fs.writeFileAtomic("/a", "original");
    fs.failNextWrite();
    await expect(fs.writeFileAtomic("/a", "nuevo")).rejects.toThrow();
    expect(await fs.readFile("/a")).toBe("original");
    await fs.writeFileAtomic("/a", "nuevo");
    expect(await fs.readFile("/a")).toBe("nuevo");
  });
});

describe("FakeClock (fake)", () => {
  it("dispara timeouts e intervals en orden al avanzar", () => {
    const clock = new FakeClock(0);
    const calls: string[] = [];
    clock.setTimeout(() => calls.push("t300"), 300);
    clock.setInterval(() => calls.push(`i@${clock.now()}`), 100);
    clock.advance(350);
    expect(calls).toEqual(["i@100", "i@200", "t300", "i@300"]);
    expect(calls.filter((c) => c.startsWith("i@"))).toEqual(["i@100", "i@200", "i@300"]);
    expect(calls).toContain("t300");
    expect(clock.now()).toBe(350);
  });

  it("clear cancela y pendingTimers cuenta", () => {
    const clock = new FakeClock(0);
    let fired = 0;
    const h = clock.setTimeout(() => fired++, 10);
    expect(clock.pendingTimers()).toBe(1);
    clock.clear(h);
    clock.advance(100);
    expect(fired).toBe(0);
    expect(clock.pendingTimers()).toBe(0);
  });
});

describe("Clock real", () => {
  it("now() es epoch ms y los timers se pueden cancelar", async () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(50);
    let fired = false;
    const h = systemClock.setTimeout(() => (fired = true), 5);
    systemClock.clear(h);
    await new Promise((r) => setTimeout(r, 30));
    expect(fired).toBe(false);
    let ticks = 0;
    const i = systemClock.setInterval(() => ticks++, 5);
    await new Promise((r) => setTimeout(r, 40));
    systemClock.clear(i);
    expect(ticks).toBeGreaterThan(0);
  });
});

describe("Random real", () => {
  it("bytes(n) da n bytes distintos cada vez y uuid() tiene forma de uuid", () => {
    const a = cryptoRandom.bytes(32);
    const b = cryptoRandom.bytes(32);
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(cryptoRandom.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("NetInfo real", () => {
  it("aplana os.networkInterfaces() con el nombre de cada interfaz", () => {
    const net = createNetInfo(() => ({
      "Wi-Fi": [
        { address: "192.168.1.5", netmask: "255.255.255.0", family: "IPv4", mac: "aa:bb", internal: false, cidr: "192.168.1.5/24" },
        { address: "fe80::1", netmask: "ffff::", family: "IPv6", mac: "aa:bb", internal: false, cidr: "fe80::1/64", scopeid: 1 },
      ],
      Loopback: undefined,
    }));
    expect(net.list()).toEqual([
      { name: "Wi-Fi", address: "192.168.1.5", family: "IPv4", internal: false, mac: "aa:bb", netmask: "255.255.255.0" },
      { name: "Wi-Fi", address: "fe80::1", family: "IPv6", internal: false, mac: "aa:bb", netmask: "ffff::" },
    ]);
  });

  it("con os real devuelve una lista (puede estar vacía)", () => {
    expect(Array.isArray(createNetInfo().list())).toBe(true);
  });
});

describe("SystemInfo real", () => {
  it("suma los tiempos de todos los núcleos", () => {
    const sys = createSystemInfo({
      cpus: () => [
        { times: { user: 10, nice: 0, sys: 5, idle: 80, irq: 5 } },
        { times: { user: 20, nice: 0, sys: 10, idle: 60, irq: 10 } },
      ],
    });
    expect(sys.cpuTimes()).toEqual({ idle: 140, total: 200 });
  });

  it("hostname, uptime y memoria vienen de os", () => {
    const sys = createSystemInfo();
    expect(sys.hostname().length).toBeGreaterThan(0);
    expect(sys.uptimeSec()).toBeGreaterThan(0);
    expect(sys.memTotal()).toBeGreaterThan(0);
    expect(sys.memFree()).toBeLessThanOrEqual(sys.memTotal());
  });
});

describe("Browser real", () => {
  it("abre la URL con cmd /c start y no usa shell", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const browser = createBrowser(
      (cmd, args) => {
        calls.push({ cmd, args });
        return Promise.resolve();
      },
      { comspec: "C:\Windows\System32\cmd.exe" },
    );
    await browser.open("http://127.0.0.1:47801/?k=abc_DEF-123");
    expect(calls).toEqual([
      { cmd: "C:\Windows\System32\cmd.exe", args: ["/c", "start", "", "http://127.0.0.1:47801/?k=abc_DEF-123"] },
    ]);
  });

  it("por defecto usa ComSpec (ruta absoluta de cmd.exe) y no el cmd del directorio actual", async () => {
    const calls: string[] = [];
    const browser = createBrowser((cmd) => {
      calls.push(cmd);
      return Promise.resolve();
    });
    await browser.open("http://127.0.0.1:47801/");
    expect(calls[0]).toBe(process.env.ComSpec ?? "cmd.exe");
  });

  it.each([
    "file:///c:/windows/system32/calc.exe",
    "javascript:alert(1)",
    "http://127.0.0.1:47801/ & calc",
    "http://127.0.0.1:47801/?a=1&b=2",
    "http://127.0.0.1/\"x",
    "http://127.0.0.1/%PATH%",
    "no es una url",
  ])("rechaza %s", async (url) => {
    const calls: unknown[] = [];
    const browser = createBrowser(() => {
      calls.push(1);
      return Promise.resolve();
    });
    await expect(browser.open(url)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
