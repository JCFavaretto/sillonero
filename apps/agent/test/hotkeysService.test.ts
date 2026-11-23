import { describe, expect, it } from "vitest";
import { HOTKEYS } from "../src/hotkeys/model";
import { createHotkeyService } from "../src/hotkeys/service";
import type { HotkeyAction } from "../src/hotkeys/model";
import { FakeHotkeys, MemLogger } from "./fakes";

const idOf = (label: string) => HOTKEYS.find((h) => h.label === label)!.id;
const vkOf = (label: string) => HOTKEYS.find((h) => h.label === label)!.vk;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(opts: { enabled?: boolean; run?: (a: HotkeyAction) => Promise<unknown> } = {}) {
  const hotkeys = new FakeHotkeys();
  const log = new MemLogger();
  const ran: HotkeyAction[] = [];
  const saved: boolean[] = [];
  let enabled = opts.enabled ?? true;
  const service = createHotkeyService({
    hotkeys,
    log,
    run: opts.run ?? (async (a) => void ran.push(a)),
    config: {
      enabled: () => enabled,
      async setEnabled(on) {
        enabled = on;
        saved.push(on);
      },
    },
  });
  return { hotkeys, log, ran, saved, service };
}

describe("servicio de atajos", () => {
  it("al arrancar registra toda la tabla", async () => {
    const { hotkeys, service } = setup();
    await service.start();
    expect(hotkeys.registered.map((r) => r.vk).sort()).toEqual(HOTKEYS.map((h) => h.vk).sort());
    expect(service.state().keys.every((k) => k.status === "active")).toBe(true);
    expect(service.state().available).toBe(true);
  });

  it("cada id corre la acción de su tecla", async () => {
    const { hotkeys, ran, service } = setup();
    await service.start();
    hotkeys.press(idOf("T"));
    hotkeys.press(idOf("2"));
    hotkeys.press(idOf("6"));
    await flush();
    expect(ran).toEqual([{ kind: "tv" }, { kind: "moveActive", index: 2 }, { kind: "media", key: "playPause" }]);
  });

  it("una tecla ocupada por otro programa se marca y las demás siguen (criterio 2)", async () => {
    const { hotkeys, ran, log, service } = setup();
    hotkeys.occupied.add(vkOf("T"));
    await service.start();
    const st = service.state();
    expect(st.keys.find((k) => k.label === "T")!.status).toBe("busy");
    expect(st.keys.filter((k) => k.status === "active")).toHaveLength(HOTKEYS.length - 1);
    expect(log.entries.some((e) => e.level === "warn")).toBe(true);
    hotkeys.press(idOf("M"));
    await flush();
    expect(ran).toEqual([{ kind: "panel" }]);
  });

  it("apagar la llave global libera todo menos Ctrl+Alt+Esc (criterio 3)", async () => {
    const { hotkeys, saved, service } = setup();
    await service.start();
    await service.setEnabled(false);
    expect(saved).toEqual([false]);
    expect(hotkeys.registered.map((r) => r.vk)).toEqual([vkOf("Esc")]);
    const st = service.state();
    expect(st.enabled).toBe(false);
    expect(st.keys.find((k) => k.label === "T")!.status).toBe("off");
    expect(st.keys.find((k) => k.label === "Esc")!.status).toBe("active");
  });

  it("con la llave apagada, cortar el Pad sigue andando y lo demás no hace nada", async () => {
    const { hotkeys, ran, service } = setup({ enabled: false });
    await service.start();
    hotkeys.press(idOf("Esc"));
    hotkeys.press(idOf("T")); // ni siquiera está registrado
    await flush();
    expect(ran).toEqual([{ kind: "cutPad" }]);
  });

  it("si un aviso viejo llega con la llave apagada, el servicio igual lo ignora", async () => {
    const { hotkeys, ran, service } = setup();
    await service.start();
    await service.setEnabled(false);
    // el hijo pudo haber mandado el aviso justo antes de soltar
    (hotkeys as unknown as { cb: (id: number) => void }).cb(idOf("T"));
    await flush();
    expect(ran).toEqual([]);
  });

  it("volver a prender registra todo de nuevo", async () => {
    const { hotkeys, service } = setup();
    await service.start();
    await service.setEnabled(false);
    await service.setEnabled(true);
    expect(hotkeys.registered).toHaveLength(HOTKEYS.length);
  });

  it("stop() suelta todo y no atiende más avisos (criterio 3)", async () => {
    const { hotkeys, ran, service } = setup();
    await service.start();
    await service.stop();
    expect(hotkeys.stopped).toBe(true);
    expect(hotkeys.registered).toEqual([]);
    (hotkeys as unknown as { cb: (id: number) => void }).cb(idOf("Esc"));
    await flush();
    expect(ran).toEqual([]);
  });

  it("si la acción falla se anota y el servicio sigue", async () => {
    const { hotkeys, log, service } = setup({
      run: async () => {
        throw new Error("boom");
      },
    });
    await service.start();
    hotkeys.press(idOf("T"));
    await flush();
    expect(log.entries.some((e) => e.level === "warn" && JSON.stringify(e).includes("boom"))).toBe(true);
    hotkeys.press(idOf("M"));
    await flush();
    expect(service.state().available).toBe(true);
  });

  it("no repite una acción mientras la misma sigue corriendo", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const { hotkeys, service } = setup({
      run: async () => {
        calls++;
        await gate;
      },
    });
    await service.start();
    hotkeys.press(idOf("T"));
    hotkeys.press(idOf("T"));
    await flush();
    expect(calls).toBe(1);
    release();
    await flush();
    hotkeys.press(idOf("T"));
    await flush();
    expect(calls).toBe(2);
  });

  it("cuando el hijo se relanza, el estado se vuelve a leer (una tecla que otro programa ocupó mientras tanto aparece busy)", async () => {
    const { hotkeys, service } = setup();
    await service.start();
    expect(service.state().keys.find((k) => k.label === "T")!.status).toBe("active");
    hotkeys.occupied.add(vkOf("T"));
    hotkeys.restore();
    await flush();
    expect(service.state().keys.find((k) => k.label === "T")!.status).toBe("busy");
  });

  it("si el hijo no puede registrar nada, queda todo en 'failed' sin romper el arranque", async () => {
    const { hotkeys, service } = setup();
    hotkeys.failSet = new Error("hijo caído");
    await expect(service.start()).resolves.toBeUndefined();
    const st = service.state();
    expect(st.keys.every((k) => k.status === "failed")).toBe(true);
  });

  it("sin hijo disponible lo dice el estado", async () => {
    const { hotkeys, service } = setup();
    hotkeys.isAvailable = false;
    expect(service.state().available).toBe(false);
  });

  it("avisa a quien escucha cada vez que cambia el estado", async () => {
    const { service } = setup();
    const seen: boolean[] = [];
    service.subscribe((s) => seen.push(s.enabled));
    await service.start();
    await service.setEnabled(false);
    expect(seen.at(-1)).toBe(false);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it("si guardar la llave falla, rechaza y no toca los registros", async () => {
    const hotkeys = new FakeHotkeys();
    const service = createHotkeyService({
      hotkeys,
      log: new MemLogger(),
      run: async () => undefined,
      config: {
        enabled: () => true,
        async setEnabled() {
          throw new Error("disco lleno");
        },
      },
    });
    await service.start();
    await expect(service.setEnabled(false)).rejects.toThrow("disco lleno");
    expect(hotkeys.registered).toHaveLength(HOTKEYS.length);
  });
});

describe("servicio de atajos · escenas (B6.3)", () => {
  const scenes = [
    { id: "s_AAAAAAAAAA", name: "Juego", hotkey: "J" as const },
    { id: "s_BBBBBBBBBB", name: "Trabajo", hotkey: "K" as const },
  ];
  const vkJ = 0x4a;
  const vkK = 0x4b;

  it("registra las teclas de las escenas y al apretar corre esa escena", async () => {
    const { hotkeys, ran, service } = setup();
    await service.setScenes(scenes);
    await service.start();
    expect(hotkeys.registered.map((r) => r.vk)).toEqual(expect.arrayContaining([vkJ, vkK]));
    const idJ = hotkeys.registered.find((r) => r.vk === vkJ)!.id;
    hotkeys.press(idJ);
    await flush();
    expect(ran).toEqual([{ kind: "scene", sceneId: "s_AAAAAAAAAA" }]);
  });

  it("el estado lista las de escenas con el nombre de la escena", async () => {
    const { service } = setup();
    await service.setScenes(scenes);
    await service.start();
    const k = service.state().keys.find((x) => x.label === "J")!;
    expect(k).toMatchObject({ status: "active", scene: { id: "s_AAAAAAAAAA", name: "Juego" } });
  });

  it("una tecla de escena ocupada por otro programa se marca busy y no molesta a las demás", async () => {
    const { hotkeys, service } = setup();
    hotkeys.occupied.add(vkK);
    await service.setScenes(scenes);
    await service.start();
    const st = service.state().keys;
    expect(st.find((x) => x.label === "K")!.status).toBe("busy");
    expect(st.find((x) => x.label === "J")!.status).toBe("active");
  });

  it("cambiar las escenas con el servicio andando suelta las viejas y registra las nuevas", async () => {
    const { hotkeys, service } = setup();
    await service.setScenes(scenes);
    await service.start();
    await service.setScenes([scenes[1]!]);
    const vks = hotkeys.registered.map((r) => r.vk);
    expect(vks).toContain(vkK);
    expect(vks).not.toContain(vkJ);
  });

  it("con la llave global apagada las teclas de escena se sueltan también", async () => {
    const { hotkeys, service } = setup();
    await service.setScenes(scenes);
    await service.start();
    await service.setEnabled(false);
    expect(hotkeys.registered.map((r) => r.vk)).toEqual([vkOf("Esc")]);
  });

  it("un aviso de escena con la llave apagada no corre nada", async () => {
    const { hotkeys, ran, service } = setup({ enabled: false });
    await service.setScenes(scenes);
    await service.start();
    const idJ = 100 + 9; // el id que usaría J si estuviera registrada
    (hotkeys as unknown as { cb: (id: number) => void }).cb(idJ);
    await flush();
    expect(ran).toEqual([]);
  });
});
