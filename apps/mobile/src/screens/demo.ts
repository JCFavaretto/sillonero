import type { Foreground, Monitor } from "@proyecto-e/protocol";
import { useScreens } from "./store";

/** La PC de Jay: izquierdo, principal y la tele (apagada). Solo para la demo de desarrollo. */
export const DEMO_MONITORS: Monitor[] = [
  {
    id: "m_DemoMonitorUno01",
    index: 1,
    nickname: null,
    name: "DELL U2412M",
    connector: "displayport",
    enabled: true,
    primary: false,
    bounds: { x: 0, y: 0, w: 1920, h: 1080 },
    lastBounds: { x: 0, y: 0, w: 1920, h: 1080 },
    resolution: { w: 1920, h: 1080 },
    canDisable: true,
    blockedBy: null,
    busy: false,
  },
  {
    id: "m_DemoMonitorDos02",
    index: 2,
    nickname: null,
    name: "LG 27GL850",
    connector: "displayport",
    enabled: true,
    primary: true,
    bounds: { x: 1920, y: 0, w: 2560, h: 1440 },
    lastBounds: { x: 1920, y: 0, w: 2560, h: 1440 },
    resolution: { w: 2560, h: 1440 },
    canDisable: false,
    blockedBy: "primary",
    busy: false,
  },
  {
    id: "m_DemoMonitorTres3",
    index: null,
    nickname: "Tele living",
    name: "Samsung TV",
    connector: "hdmi",
    enabled: false,
    primary: false,
    bounds: null,
    lastBounds: { x: 4480, y: 0, w: 3840, h: 2160 },
    resolution: null,
    canDisable: false,
    blockedBy: null,
    busy: false,
  },
];

export const DEMO_FOREGROUND: Foreground = {
  title: "PLAN.md — proyecto-e — Visual Studio Code",
  app: "Code.exe",
  monitorId: "m_DemoMonitorDos02",
};

/** Solo en desarrollo ("Ver demo"): carga pantallas de mentira, sin agente. */
export function loadScreensDemo(): void {
  useScreens.setState({
    monitors: DEMO_MONITORS.map((m) => ({ ...m })),
    foreground: { ...DEMO_FOREGROUND },
    error: null,
    demo: true,
  });
}
