import type { AudioState } from "@proyecto-e/protocol";
import { setAudioDemo } from "./demoFlag";
import { initialAudio, useAudio } from "./store";

// Datos de mentira para "Ver demo" (las pantallas se pueden ver y probar sin la PC).

const HP = "o_DemoHeadphon";
const SP = "o_DemoSpeakers";
const TV = "o_DemoTelevisi";
const DIG = "o_DemoDigitalo";

export const DEMO_AUDIO: AudioState = {
  available: { audio: true, defaultOutput: true, appRouting: true },
  outputs: [
    { id: HP, name: "Altavoces (HyperX Cloud Flight Wireless)", nick: "Auriculares", kind: "headphones", state: "active", isDefault: true, volume: 46, muted: false, hidden: false },
    { id: SP, name: "Altavoces (Realtek High Definition Audio)", nick: "Parlantes", kind: "speakers", state: "active", isDefault: false, volume: 40, muted: false, hidden: false },
    { id: TV, name: "LG TV (NVIDIA High Definition Audio)", nick: "Tele", kind: "tv", state: "unavailable", isDefault: false, volume: null, muted: false, hidden: false },
    { id: DIG, name: "Realtek Digital Output", nick: null, kind: "digital", state: "active", isDefault: false, volume: 100, muted: false, hidden: true },
  ],
  apps: [
    { id: "a_DemoSpotify1", name: "Spotify", iconKey: null, outputIds: [HP], volume: 60, muted: false, sounding: true, routed: null },
    { id: "a_DemoChrome01", name: "chrome", iconKey: null, outputIds: [HP], volume: 100, muted: false, sounding: false, routed: null },
    { id: "a_DemoDiscord1", name: "Discord", iconKey: null, outputIds: [SP], volume: 80, muted: false, sounding: false, routed: SP },
  ],
  media: {
    sessions: [
      { id: "m_DemoSpotify1", app: "Spotify", iconKey: null, title: "Nombre del tema", artist: "Artista", status: "playing", controls: { prev: true, playPause: true, next: true }, artKey: null },
      { id: "m_DemoChrome01", app: "chrome", iconKey: null, title: "Título del video de YouTube", artist: "Canal", status: "paused", controls: { prev: false, playPause: true, next: false }, artKey: null },
    ],
    targetId: "m_DemoSpotify1",
    chosen: false,
  },
};

export function loadAudioDemo(): void {
  useAudio.setState({ ...initialAudio, audio: structuredClone(DEMO_AUDIO), audioAt: Date.now() });
  setAudioDemo(true);
}

/** Al conectarse de verdad la demo se apaga. */
export function endAudioDemo(): void {
  setAudioDemo(false);
}
