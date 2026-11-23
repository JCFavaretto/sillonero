import type { CatalogApp, Library, WindowInfo } from "@proyecto-e/protocol";
import { useApps } from "./store";

/** Datos de mentira para "Ver demo" (solo desarrollo): ventanas, lanzadores, escenas e Inicio de la PC de Jay. */

export const DEMO_WINDOWS: WindowInfo[] = [
  { id: "w_1", title: "proyecto-e — PLAN.md", app: "Code", iconKey: "i_DemoIconCode0001", monitorId: "m_DemoMonitorDos02", state: "normal", focused: true },
  { id: "w_2", title: "YouTube — Age of Empires", app: "chrome", iconKey: "i_DemoIconChrome001", monitorId: "m_DemoMonitorUno01", state: "normal", focused: false },
  { id: "w_3", title: "#general | Amigos", app: "Discord", iconKey: "i_DemoIconDiscord01", monitorId: "m_DemoMonitorUno01", state: "maximized", focused: false },
  { id: "w_4", title: "Spotify Premium", app: "Spotify", iconKey: "i_DemoIconSpotify01", monitorId: null, state: "minimized", focused: false },
];

export const DEMO_LIBRARY: Library = {
  launchers: [
    { id: "l_DemoDiscord", name: "Discord", target: { kind: "app", appId: "Discord" }, iconKey: "i_DemoIconDiscord01" },
    { id: "l_DemoSpotify", name: "Spotify", target: { kind: "app", appId: "Spotify" }, iconKey: "i_DemoIconSpotify01" },
    { id: "l_DemoYouTube", name: "YouTube", target: { kind: "url", url: "https://www.youtube.com" }, iconKey: null },
  ],
  scenes: [
    {
      id: "s_DemoTrabajo",
      name: "Trabajo",
      steps: [
        { kind: "open", target: { kind: "app", appId: "Code" }, name: "VS Code", iconKey: "i_DemoIconCode0001", place: { monitorId: "m_DemoMonitorUno01", zone: "left" } },
        { kind: "bringAll" },
      ],
    },
    {
      id: "s_DemoJuego00",
      name: "Juego",
      steps: [
        { kind: "screens", monitors: [{ monitorId: "m_DemoMonitorTres3", enabled: true }] },
        { kind: "open", target: { kind: "app", appId: "Discord" }, name: "Discord", iconKey: "i_DemoIconDiscord01", place: { monitorId: "m_DemoMonitorUno01", zone: "right" } },
        { kind: "open", target: { kind: "url", url: "https://www.youtube.com" }, name: "YouTube", iconKey: null, place: { monitorId: "m_DemoMonitorTres3", zone: "fullscreen" } },
      ],
    },
  ],
  deck: [
    { kind: "scene", id: "s_DemoTrabajo" },
    { kind: "scene", id: "s_DemoJuego00" },
    { kind: "monitorToggle", monitorId: "m_DemoMonitorTres3" },
    { kind: "bringAll" },
    { kind: "identify" },
    { kind: "launcher", id: "l_DemoDiscord" },
    { kind: "launcher", id: "l_DemoSpotify" },
  ],
};

export const DEMO_CATALOG: CatalogApp[] = [
  { appId: "Calculadora", name: "Calculadora", iconKey: "i_DemoIconCalc00001" },
  { appId: "Cursor", name: "Cursor", iconKey: "i_DemoIconCursor001" },
  { appId: "Discord", name: "Discord", iconKey: "i_DemoIconDiscord01" },
  { appId: "Spotify", name: "Spotify", iconKey: "i_DemoIconSpotify01" },
  { appId: "Visual Studio Code", name: "Visual Studio Code", iconKey: "i_DemoIconCode0001" },
];

/** Solo en desarrollo ("Ver demo"): carga ventanas y biblioteca de mentira, sin agente. */
export function loadAppsDemo(): void {
  useApps.setState({
    windows: DEMO_WINDOWS.map((w) => ({ ...w })),
    windowsLoaded: true,
    library: structuredClone(DEMO_LIBRARY),
    icons: {},
    run: null,
    error: null,
    demo: true,
  });
}
