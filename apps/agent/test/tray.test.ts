import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createTrayHook, type TrayHookLike } from "../src/platform/tray";
import type { TrayMenuItem } from "../src/ports";
import { MemLogger } from "./fakes";

class FakeTrayHook extends EventEmitter {
  calls: [string, ...unknown[]][] = [];
  failStart = false;
  async start() {
    this.calls.push(["start"]);
    if (this.failStart) throw new Error("no binary");
  }
  async setIcon(p: string) {
    this.calls.push(["setIcon", p]);
  }
  async setTooltip(t: string) {
    this.calls.push(["setTooltip", t]);
  }
  async setMenu(t: unknown) {
    this.calls.push(["setMenu", t]);
  }
  async quit() {
    this.calls.push(["quit"]);
    setImmediate(() => this.emit("exit", 0));
  }
  destroy() {
    this.calls.push(["destroy"]);
  }
}

const ITEMS: TrayMenuItem[] = [
  { id: "open", label: "Abrir panel" },
  { id: "remoteToggle", label: "Remoto", checked: false },
  { id: "quit", label: "Salir" },
];

function setup() {
  const hook = new FakeTrayHook();
  const log = new MemLogger();
  const tray = createTrayHook({ iconPath: "C:/icon.png", log, factory: () => hook as unknown as TrayHookLike });
  return { hook, log, tray };
}

describe("tray · iniciar con Windows (B6.2)", () => {
  it("es un item marcable y su check llega a onClick con el id", async () => {
    const { hook, tray } = setup();
    const clicks: string[] = [];
    tray.onClick((id) => clicks.push(id));
    await tray.start({ tooltip: "x", items: [ITEMS[0]!, { id: "autostartToggle", label: "Iniciar con Windows", checked: true }, ITEMS[2]!] });
    expect(hook.calls[3]?.[1]).toContainEqual({ type: "check", id: "autostartToggle", title: "Iniciar con Windows", checked: true });
    hook.emit("check", "autostartToggle", false);
    expect(clicks).toEqual(["autostartToggle"]);
  });
});

describe("tray · cortar control remoto (B6.1)", () => {
  it("el item cutInput va en el menú como item común y su clic llega con el id", async () => {
    const { hook, tray } = setup();
    const clicks: string[] = [];
    tray.onClick((id) => clicks.push(id));
    await tray.start({ tooltip: "x", items: [...ITEMS.slice(0, 2), { id: "cutInput", label: "Cortar control remoto · Ctrl+Alt+Esc" }, ITEMS[2]!] });
    expect(hook.calls[3]?.[1]).toContainEqual({ type: "item", id: "cutInput", title: "Cortar control remoto · Ctrl+Alt+Esc" });
    hook.emit("click", "cutInput");
    expect(clicks).toEqual(["cutInput"]);
  });
});

describe("tray (adaptador de tray-hook)", () => {
  it("start: arranca el daemon, pone ícono, tooltip y menú con separador antes de Salir", async () => {
    const { hook, tray } = setup();
    await tray.start({ tooltip: "Proyecto E", items: ITEMS });
    expect(hook.calls.map((c) => c[0])).toEqual(["start", "setIcon", "setTooltip", "setMenu"]);
    expect(hook.calls[1]).toEqual(["setIcon", "C:/icon.png"]);
    expect(hook.calls[3]?.[1]).toEqual([
      { type: "item", id: "open", title: "Abrir panel" },
      { type: "check", id: "remoteToggle", title: "Remoto", checked: false },
      { type: "separator", id: "sep" },
      { type: "item", id: "quit", title: "Salir" },
    ]);
  });

  it("los clics de items y de checks llegan a onClick con el id", async () => {
    const { hook, tray } = setup();
    const clicks: string[] = [];
    tray.onClick((id) => clicks.push(id));
    await tray.start({ tooltip: "x", items: ITEMS });
    hook.emit("click", "open");
    hook.emit("check", "remoteToggle", true);
    hook.emit("click", "desconocido");
    expect(clicks).toEqual(["open", "remoteToggle"]);
  });

  it("setItems refresca el menú entero (con el check nuevo)", async () => {
    const { hook, tray } = setup();
    await tray.start({ tooltip: "x", items: ITEMS });
    hook.calls.length = 0;
    tray.setItems(ITEMS.map((i) => (i.id === "remoteToggle" ? { ...i, checked: true } : i)));
    await new Promise((r) => setImmediate(r));
    expect(hook.calls).toHaveLength(1);
    const template = hook.calls[0]?.[1] as { id: string; checked?: boolean }[];
    expect(template.find((t) => t.id === "remoteToggle")?.checked).toBe(true);
  });

  it("setItems antes de start no toca el daemon", () => {
    const { hook, tray } = setup();
    tray.setItems(ITEMS);
    expect(hook.calls).toEqual([]);
  });

  it("si el daemon no arranca, start rechaza (el agente sigue sin bandeja)", async () => {
    const { hook, tray } = setup();
    hook.failStart = true;
    await expect(tray.start({ tooltip: "x", items: ITEMS })).rejects.toThrow("no binary");
  });

  it("los errores del daemon se loguean y no tiran el proceso", async () => {
    const { hook, log, tray } = setup();
    await tray.start({ tooltip: "x", items: ITEMS });
    expect(() => hook.emit("error", new Error("boom"))).not.toThrow();
    expect(log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("stop: pide salir, espera que el daemon termine y lo destruye; es idempotente", async () => {
    const { hook, tray } = setup();
    await tray.start({ tooltip: "x", items: ITEMS });
    await tray.stop();
    await tray.stop();
    expect(hook.calls.filter((c) => c[0] === "quit")).toHaveLength(1);
    expect(hook.calls.at(-1)).toEqual(["destroy"]);
  });

  it("stop sin start no hace nada", async () => {
    const { hook, tray } = setup();
    await tray.stop();
    expect(hook.calls).toEqual([]);
  });
});
