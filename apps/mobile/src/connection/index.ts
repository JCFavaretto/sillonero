import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { deletePairedPc, loadPairedPc, savePairedPc } from "@/storage/pairedPc";
import { createClient, type SocketLike } from "./client";
import { setCommandSender } from "@/screens/commands";
import { setAppsBridge } from "@/apps/commands";
import { forgetUnresolved, resetIcons } from "@/apps/icons";
import { applyExtra } from "@/apps/store";
import { applyAudio } from "@/audio/store";
import { applyBrowser } from "@/browser/store";
import { applyPad, usePad } from "@/pad/store";
import { forgetUnresolvedArt, resetArt } from "@/audio/art";
import { applyScreensState } from "@/screens/store";
import { useConn } from "./store";

/** El cliente de verdad. Los tests usan `createClient` con dependencias falsas. */
export const client = createClient({
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  storage: { load: loadPairedPc, save: savePairedPc, remove: deletePairedPc },
  clock: {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  random: Math.random,
  randomBytes: (n) => Crypto.getRandomBytes(n),
  newId: () => Crypto.randomUUID(),
  appVersion: Constants.expoConfig?.version ?? "0.0.0",
  platform: Platform.OS === "ios" ? "ios" : "android",
  onState: (state) => useConn.setState(state, true),
  onScreens: applyScreensState,
  onLatency: (ms) => usePad.getState().addLatency(ms),
  onExtra: (m) => {
    applyExtra(m);
    applyAudio(m);
    applyBrowser(m);
    applyPad(m);
    if (m === null) {
      resetIcons(); // otra PC, otros íconos
      resetArt();
    } else if (m.type === "windows.snapshot") {
      forgetUnresolved(); // sesión nueva: lo que se pidió y no llegó se vuelve a pedir
      forgetUnresolvedArt();
    }
  },
});

// La pestaña Pantallas manda sus comandos por este cliente.
setCommandSender(client.sendCommand as never);
// Apps, Escenas e Inicio también: comandos con respuesta y preguntas (búsqueda de apps, íconos).
setAppsBridge({ command: client.sendCommand, query: client.query, fire: client.fire, measure: client.measure });

export { useConn };
