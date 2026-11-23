import type { AudioState } from "@proyecto-e/protocol";
import { appIdFor, outputIdFor } from "../src/audio/model";
export { outputIdFor };
import { createAudioService } from "../src/audio/service";
import { emptyAudioConfig, type AudioConfig } from "../src/config/schema";
import type { RawOutput, RawSession } from "../src/ports";
import { FakeAudio, FakeClock, FakeMediaKeys, MemLogger } from "./fakes";

export const HYPER = "{0.0.0.00000000}.{ac5e7cd6-f17f-412f-9e42-9c3a070138e5}";
export const REALTEK = "{0.0.0.00000000}.{a5e5c614-b9b1-45f4-81fa-f75f82fccb0a}";
export const CHROME = "C:\Program Files\Google\Chrome\Application\chrome.exe";
const out = (winId: string, o: Partial<RawOutput> = {}): RawOutput => ({ winId, name: winId === HYPER ? "HyperX" : "Realtek", formFactor: 1, volume: 0.46, muted: false, ...o });
export const ses = (o: Partial<RawSession> = {}): RawSession => ({ pid: 100, exePath: CHROME, winOutputId: HYPER, volume: 1, muted: false, peak: 0, routedWinId: null, ...o });

export const OUT_H = outputIdFor(HYPER);
export const OUT_R = outputIdFor(REALTEK);
export const APP_CHROME = appIdFor(CHROME);

/** Un servicio de audio con dos salidas (HyperX predeterminada y Realtek) y Chrome sonando en la HyperX. */
export function setup(opts: { audio?: boolean; config?: Partial<AudioConfig>; saveFails?: boolean } = {}) {
  const audio = new FakeAudio();
  audio.raw = { outputs: [out(HYPER), out(REALTEK)], sessions: [ses()], defaultWinId: HYPER, media: [] };
  const keys = new FakeMediaKeys();
  const clock = new FakeClock(1_000_000);
  const log = new MemLogger();
  let config: AudioConfig = { ...emptyAudioConfig(), ...opts.config };
  const saved: AudioConfig[] = [];
  const service = createAudioService({
    audio: opts.audio === false ? undefined : audio,
    mediaKeys: keys,
    config: {
      get: () => config,
      save: async (next) => {
        if (opts.saveFails) throw new Error("disco lleno");
        saved.push(next);
        config = next;
      },
    },
    clock,
    log,
  });
  const updates: AudioState[] = [];
  service.subscribe((s) => updates.push(s));
  return { audio, keys, clock, log, service, updates, saved, config: () => config };
}
