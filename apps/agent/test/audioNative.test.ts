import { afterAll, describe, expect, it } from "vitest";
import { systemClock } from "../src/platform/clock";
import { createAudioClient } from "../src/platform/win/audioClient";
import { AUDIO_HOST_SCRIPT, spawnAudioHost } from "../src/platform/win/audioSpawn";
import { MemLogger } from "./fakes";

// El hijo de audio REAL (PowerShell + C#), solo en Windows y SOLO LEYENDO: no cambia volumen, silencio ni salida.
describe.runIf(process.platform === "win32")("Audio de Windows real (solo lectura)", () => {
  const client = createAudioClient({ spawn: () => spawnAudioHost("powershell.exe", AUDIO_HOST_SCRIPT), clock: systemClock, log: new MemLogger() });
  afterAll(() => client.stop());

  it("arranca y dice qué funciones andan (booleanos)", async () => {
    const r = await client.ready();
    expect(typeof r.defaultOutput).toBe("boolean");
    expect(typeof r.appRouting).toBe("boolean");
  }, 30_000);

  it("lista al menos una salida activa con volumen y la predeterminada entre ellas", async () => {
    const s = await client.snapshot();
    expect(s.outputs.length).toBeGreaterThanOrEqual(1);
    for (const o of s.outputs) {
      expect(o.winId).toMatch(/^\{0\.0\.0\.00000000\}\./);
      expect(o.volume).toBeGreaterThanOrEqual(0);
      expect(o.volume).toBeLessThanOrEqual(1);
    }
    if (s.defaultWinId) expect(s.outputs.some((o) => o.winId === s.defaultWinId)).toBe(true);
    expect(Array.isArray(s.sessions)).toBe(true);
    expect(Array.isArray(s.media)).toBe(true);
  }, 30_000);

  it("una salida o un proceso que no existen se rechazan sin tocar nada", async () => {
    await expect(client.setOutputVolume("{0.0.0.00000000}.{00000000-0000-0000-0000-000000000000}", 0.5)).rejects.toThrow(/not_found/);
    await expect(client.setAppVolume([2_000_000_000], 0.5)).rejects.toThrow(/not_found/);
  }, 30_000);
});
