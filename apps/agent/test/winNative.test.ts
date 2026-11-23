import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { systemClock } from "../src/platform/clock";
import { createNativeClient, type HostChild, type HostReply, type HostRequest } from "../src/platform/win/nativeClient";
import { buildMonitors } from "../src/screens/model";
import { MemLogger } from "./fakes";

// Prueba con Windows de verdad: lanza el proceso hijo real (koffi + user32) y solo LEE.
// Se saltea en otros sistemas. No cambia ninguna configuración de pantallas ni mueve ventanas.

function spawnReal(): HostChild {
  const cp = fork(fileURLToPath(new URL("../src/platform/win/host.ts", import.meta.url)), [], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  return {
    send: (m: HostRequest) => void cp.send(m),
    kill: () => void cp.kill(),
    onMessage: (cb) => void cp.on("message", (m) => cb(m as HostReply)),
    onExit: (cb) => {
      cp.on("exit", (code) => cb(`code ${code}`));
      cp.on("error", (e) => cb(String(e)));
    },
  };
}

describe.runIf(process.platform === "win32")("Windows real (solo lectura)", () => {
  const client = createNativeClient({ spawn: spawnReal, clock: systemClock, log: new MemLogger(), timeoutMs: 15_000 });
  afterAll(() => client.stop());

  it("lista al menos una pantalla prendida, con posición, y una sola principal", async () => {
    const raw = await client.displays.list();
    const active = raw.filter((d) => d.active);
    expect(active.length).toBeGreaterThanOrEqual(1);
    for (const d of active) {
      expect(d.bounds).not.toBeNull();
      expect(d.bounds!.w).toBeGreaterThan(0);
      expect(d.devicePath).not.toBe("");
    }
    expect(raw.filter((d) => d.primary)).toHaveLength(1);
    // y el modelo puro arma pantallas válidas con eso
    const monitors = buildMonitors(raw);
    expect(monitors.filter((m) => m.enabled).map((m) => m.index)).toEqual(active.map((_, i) => i + 1));
  }, 30_000);

  it("B3: lista las ventanas de usuario con título, .exe y ruta; solo una con foco como máximo", async () => {
    const list = await client.windows.list();
    expect(list.length).toBeGreaterThan(0);
    for (const w of list) {
      expect(w.title.trim()).not.toBe("");
      expect(w.handle).toMatch(/^0x[0-9a-f]+$/);
      expect(["Progman", "WorkerW", "Shell_TrayWnd"]).not.toContain(w.className);
    }
    expect(list.filter((w) => w.focused).length).toBeLessThanOrEqual(1);
    expect(list.some((w) => /\.exe$/i.test(w.exePath))).toBe(true);
  }, 30_000);

  it("cada pantalla prendida trae su área de trabajo (sin la barra de tareas), que entra en la pantalla", async () => {
    for (const d of (await client.displays.list()).filter((x) => x.active)) {
      const wa = d.workArea;
      const b = d.bounds!;
      expect(wa).not.toBeNull();
      expect(wa!.w).toBeGreaterThan(0);
      expect(wa!.x).toBeGreaterThanOrEqual(b.x);
      expect(wa!.y).toBeGreaterThanOrEqual(b.y);
      expect(wa!.x + wa!.w).toBeLessThanOrEqual(b.x + b.w);
      expect(wa!.y + wa!.h).toBeLessThanOrEqual(b.y + b.h);
    }
  }, 30_000);

  it("la ventana activa se lee sin error (puede no haber ninguna)", async () => {
    const win = await client.windows.foreground();
    if (win) {
      expect(win.handle).toMatch(/^0x[0-9a-f]+$/);
      expect(win.rect.w).toBeGreaterThanOrEqual(0);
      expect(["normal", "maximized", "minimized"]).toContain(win.state);
    }
  }, 30_000);

  it("el segundo pedido reutiliza el mismo proceso (rápido)", async () => {
    const t0 = Date.now();
    await client.displays.list();
    expect(Date.now() - t0).toBeLessThan(1_000);
  }, 30_000);
});
