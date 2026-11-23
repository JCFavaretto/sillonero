import { describe, expect, it } from "vitest";
import type { Library, Step } from "@proyecto-e/protocol";
import { createCatalog } from "../src/apps/catalog";
import { createIcons } from "../src/apps/icons";
import { createLibraryService } from "../src/apps/library";
import { iconKeyFor } from "../src/apps/windowsModel";
import { FakeCatalog, FakeClock, FakeRandom, MemFs, MemLogger } from "./fakes";

const MON = "m_DemoMonitorUno01";
const CURSOR = "Anysphere.Cursor";
const OUT = "o_AAAAAAAAAAAA";

function setup(initial: Library = { launchers: [], scenes: [], deck: [] }, opts: { seenOutputs?: string[] | null } = {}) {
  let lib = initial;
  const saved: Library[] = [];
  let failNext = false;
  const remembered: string[] = [];
  const source = new FakeCatalog();
  const fs = new MemFs();
  const icons = createIcons({ fs, dir: "icons" });
  const registered: [string, string][] = [];
  const realRegister = icons.register.bind(icons);
  icons.register = (k, p) => (registered.push([k, p]), realRegister(k, p));
  const service = createLibraryService({
    store: {
      get: () => lib,
      save: async (next) => {
        if (failNext) {
          failNext = false;
          throw new Error("disco lleno");
        }
        lib = next;
        saved.push(next);
      },
    },
    catalog: createCatalog({ source, clock: new FakeClock() }),
    icons,
    random: new FakeRandom(),
    log: new MemLogger(),
    audio: opts.seenOutputs === null ? undefined : { remember: async (id: string) => (remembered.push(id), (opts.seenOutputs ?? [OUT]).includes(id)) },
  });
  return { remembered, service, saved, registered, get lib() { return lib; }, failSave: () => (failNext = true) };
}
const openStep = (appId: string, over: object = {}): Step => ({ kind: "open", target: { kind: "app", appId }, name: "App", iconKey: null, place: null, ...over }) as Step;

describe("library: lanzadores", () => {
  it("agrega una app del catálogo con su nombre e ícono, y registra de dónde sale el ícono", async () => {
    const t = setup();
    const r = await t.service.addLauncher({ kind: "app", appId: CURSOR }, null);
    expect(r.ok).toBe(true);
    const l = t.lib.launchers[0]!;
    expect(l).toMatchObject({ name: "Cursor", target: { kind: "app", appId: CURSOR }, iconKey: iconKeyFor(CURSOR) });
    expect(l.id).toMatch(/^l_[A-Za-z0-9_-]{10}$/);
    expect(t.registered).toContainEqual([iconKeyFor(CURSOR), "shell:AppsFolder\\" + CURSOR]);
  });
  it("un appId que no está en el catálogo se rechaza (el celu no puede inventar rutas)", async () => {
    const t = setup();
    for (const appId of ["C:\\Windows\\System32\\cmd.exe", "calc", "C:\\Program Files\\Stremio\\Uninstall.exe"]) {
      expect(await t.service.addLauncher({ kind: "app", appId }, null)).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(t.lib.launchers).toEqual([]);
  });
  it("links: el nombre por defecto es el sitio sin www; sin ícono", async () => {
    const t = setup();
    await t.service.addLauncher({ kind: "url", url: "https://www.youtube.com/watch?v=1&t=2" }, null);
    expect(t.lib.launchers[0]).toMatchObject({ name: "youtube.com", iconKey: null, target: { kind: "url", url: "https://www.youtube.com/watch?v=1&t=2" } });
  });
  it("el nombre que elige Jay se respeta", async () => {
    const t = setup();
    await t.service.addLauncher({ kind: "app", appId: CURSOR }, "Mi editor");
    expect(t.lib.launchers[0]!.name).toBe("Mi editor");
  });
  it("tope de 40 lanzadores → limit", async () => {
    const t = setup();
    for (let i = 0; i < 40; i++) await t.service.addLauncher({ kind: "url", url: `https://a${i}.com` }, null);
    expect(await t.service.addLauncher({ kind: "url", url: "https://otra.com" }, null)).toEqual({ ok: false, reason: "limit" });
  });
  it("renombrar y quitar; quitar también lo saca del Inicio", async () => {
    const t = setup();
    await t.service.addLauncher({ kind: "app", appId: CURSOR }, null);
    const id = t.lib.launchers[0]!.id;
    await t.service.setDeck([{ kind: "launcher", id }, { kind: "identify" }]);
    expect(await t.service.renameLauncher(id, "Cur")).toEqual({ ok: true });
    expect(t.lib.launchers[0]!.name).toBe("Cur");
    expect(await t.service.removeLauncher(id)).toEqual({ ok: true });
    expect(t.lib.launchers).toEqual([]);
    expect(t.lib.deck).toEqual([{ kind: "identify" }]);
    expect(await t.service.removeLauncher(id)).toEqual({ ok: false, reason: "not_found" });
    expect(await t.service.renameLauncher(id, "x")).toEqual({ ok: false, reason: "not_found" });
  });
  it("avisa a los que escuchan con cada cambio, y no queda a medias si falla el guardado", async () => {
    const t = setup();
    const seen: number[] = [];
    t.service.subscribe((l) => seen.push(l.launchers.length));
    await t.service.addLauncher({ kind: "app", appId: CURSOR }, null);
    t.failSave();
    expect(await t.service.addLauncher({ kind: "url", url: "https://a.com" }, null)).toEqual({ ok: false, reason: "failed" });
    expect(t.service.state().launchers).toHaveLength(1);
    expect(seen).toEqual([1]);
  });
});

describe("library: escenas", () => {
  it("una escena nueva recibe id y guarda sus pasos; el ícono lo pone el agente, no el celu", async () => {
    const t = setup();
    const r = await t.service.saveScene({ name: "Juego", steps: [openStep(CURSOR, { iconKey: "i_ZZZZZZZZZZZZZZZZ" }), { kind: "bringAll" }] });
    expect(r.ok).toBe(true);
    const s = t.lib.scenes[0]!;
    expect(s.id).toMatch(/^s_[A-Za-z0-9_-]{10}$/);
    expect(s.steps[0]).toMatchObject({ iconKey: iconKeyFor(CURSOR) });
  });
  it("un paso con una app fuera del catálogo se rechaza", async () => {
    const t = setup();
    expect(await t.service.saveScene({ name: "Mala", steps: [openStep("C:\\Windows\\cmd.exe")] })).toEqual({ ok: false, reason: "not_allowed" });
    expect(t.lib.scenes).toEqual([]);
  });
  it("editar una escena existente la reemplaza; un id que no existe es not_found", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Uno", steps: [{ kind: "bringAll" }] });
    const id = t.lib.scenes[0]!.id;
    expect(await t.service.saveScene({ id, name: "Dos", steps: [{ kind: "bringAll" }, { kind: "bringAll" }] })).toEqual({ ok: true });
    expect(t.lib.scenes).toHaveLength(1);
    expect(t.lib.scenes[0]).toMatchObject({ id, name: "Dos" });
    expect(await t.service.saveScene({ id: "s_AAAAAAAAAA", name: "x", steps: [{ kind: "bringAll" }] })).toEqual({ ok: false, reason: "not_found" });
  });
  it("tope de 24 escenas → limit", async () => {
    const t = setup();
    for (let i = 0; i < 24; i++) await t.service.saveScene({ name: "E" + i, steps: [{ kind: "bringAll" }] });
    expect(await t.service.saveScene({ name: "otra", steps: [{ kind: "bringAll" }] })).toEqual({ ok: false, reason: "limit" });
  });
  it("borrar una escena la saca del Inicio", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Uno", steps: [{ kind: "bringAll" }] });
    const id = t.lib.scenes[0]!.id;
    await t.service.setDeck([{ kind: "scene", id }]);
    expect(await t.service.removeScene(id)).toEqual({ ok: true });
    expect(t.lib.deck).toEqual([]);
    expect(await t.service.removeScene(id)).toEqual({ ok: false, reason: "not_found" });
  });
  it("las escenas guardan una copia: quitar el lanzador no rompe una escena que abre esa app", async () => {
    const t = setup();
    await t.service.addLauncher({ kind: "app", appId: CURSOR }, null);
    await t.service.saveScene({ name: "Uno", steps: [openStep(CURSOR)] });
    await t.service.removeLauncher(t.lib.launchers[0]!.id);
    expect(t.lib.scenes[0]!.steps).toHaveLength(1);
  });
});

describe("library: tamaño", () => {
  it("si la biblioteca se pasa de 48 KB (cabe en un mensaje de 60 KB), se rechaza con limit y no se guarda", async () => {
    const t = setup();
    const steps = Array.from({ length: 12 }, () => ({ kind: "open", target: { kind: "url", url: "https://example.com/" + "a".repeat(1500) }, name: "x", iconKey: null, place: null }) as Step);
    let last: { ok: boolean; reason?: string } = { ok: true };
    let saved = 0;
    for (let i = 0; i < 24 && last.ok; i++) {
      last = await t.service.saveScene({ name: "E" + i, steps });
      if (last.ok) saved++;
    }
    expect(last).toEqual({ ok: false, reason: "limit" });
    expect(saved).toBeGreaterThan(0);
    expect(JSON.stringify(t.lib).length).toBeLessThanOrEqual(48_000);
  });
});

describe("library: Inicio", () => {
  it("guarda el orden; ids que no existen → not_found; monitorToggle e identify no necesitan nada", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Uno", steps: [{ kind: "bringAll" }] });
    const id = t.lib.scenes[0]!.id;
    expect(await t.service.setDeck([{ kind: "monitorToggle", monitorId: MON }, { kind: "scene", id }, { kind: "bringAll" }, { kind: "identify" }])).toEqual({ ok: true });
    expect(t.lib.deck).toHaveLength(4);
    expect(await t.service.setDeck([{ kind: "scene", id: "s_AAAAAAAAAA" }])).toEqual({ ok: false, reason: "not_found" });
    expect(await t.service.setDeck([{ kind: "launcher", id: "l_AAAAAAAAAA" }])).toEqual({ ok: false, reason: "not_found" });
    expect(t.lib.deck).toHaveLength(4); // no se pisó
  });
  it("sin repetidos de la misma escena o lanzador", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Uno", steps: [{ kind: "bringAll" }] });
    const id = t.lib.scenes[0]!.id;
    await t.service.setDeck([{ kind: "scene", id }, { kind: "scene", id }]);
    expect(t.lib.deck).toEqual([{ kind: "scene", id }]);
  });
  it("al arrancar registra los íconos de lo que ya estaba guardado", () => {
    const t = setup({
      launchers: [{ id: "l_AAAAAAAAAA", name: "Cursor", target: { kind: "app", appId: CURSOR }, iconKey: iconKeyFor(CURSOR) }],
      scenes: [],
      deck: [],
    });
    expect(t.registered).toContainEqual([iconKeyFor(CURSOR), "shell:AppsFolder\\" + CURSOR]);
  });
});

describe("library: bytes y cambios nulos", () => {
  it("el tope se mide en bytes UTF-8: nombres y links con caracteres no ASCII ocupan más", async () => {
    const t = setup();
    const kanji = "漢".repeat(32); // 32 caracteres = 96 bytes
    const steps = Array.from({ length: 12 }, () => ({ kind: "open", target: { kind: "url", url: "https://example.com/" + "a".repeat(1500) }, name: kanji, iconKey: null, place: null }) as Step);
    let last: { ok: boolean; reason?: string } = { ok: true };
    for (let i = 0; i < 24 && last.ok; i++) last = await t.service.saveScene({ name: kanji, steps });
    expect(last).toEqual({ ok: false, reason: "limit" });
    expect(Buffer.byteLength(JSON.stringify(t.lib), "utf8")).toBeLessThanOrEqual(40_000);
  });
  it("guardar lo mismo no reescribe el disco ni avisa a nadie", async () => {
    const t = setup();
    await t.service.addLauncher({ kind: "url", url: "https://a.com" }, null);
    const id = t.lib.launchers[0]!.id;
    const seen: number[] = [];
    t.service.subscribe((l) => seen.push(l.launchers.length));
    const before = t.saved.length;
    expect(await t.service.renameLauncher(id, t.lib.launchers[0]!.name)).toEqual({ ok: true });
    expect(t.saved).toHaveLength(before);
    expect(seen).toEqual([]);
  });
});

describe("library: audio (B4)", () => {
  it("un paso de audio con una salida que el agente vio se guarda y la anota entre las conocidas", async () => {
    const t = setup();
    const r = await t.service.saveScene({ name: "Sillón", steps: [{ kind: "audio", outputId: OUT, makeDefault: true, volume: 30 }] });
    expect(r).toEqual({ ok: true });
    expect(t.lib.scenes[0]!.steps).toEqual([{ kind: "audio", outputId: OUT, makeDefault: true, volume: 30 }]);
    expect(t.remembered).toEqual([OUT]);
  });
  it("una salida que nunca se vio → not_found, y no se guarda nada", async () => {
    const t = setup(undefined, { seenOutputs: [] });
    expect(await t.service.saveScene({ name: "x", steps: [{ kind: "audio", outputId: OUT, makeDefault: true, volume: null }] })).toEqual({ ok: false, reason: "not_found" });
    expect(t.saved).toEqual([]);
  });
  it("sin servicio de audio (otro sistema) → audio_unavailable", async () => {
    const t = setup(undefined, { seenOutputs: null });
    expect(await t.service.saveScene({ name: "x", steps: [{ kind: "audio", outputId: OUT, makeDefault: true, volume: null }] })).toEqual({ ok: false, reason: "audio_unavailable" });
  });
  it("las teclas de Media, volumen y silencio entran al Inicio sin más", async () => {
    const t = setup();
    const items = [{ kind: "media", key: "playPause" }, { kind: "volume", delta: 5 }, { kind: "volume", delta: -5 }, { kind: "mute" }] as const;
    expect(await t.service.setDeck([...items])).toEqual({ ok: true });
    expect(t.lib.deck).toEqual(items);
  });
  it("una tecla de salida con una salida conocida entra; con una desconocida → not_found", async () => {
    const t = setup();
    expect(await t.service.setDeck([{ kind: "output", outputId: OUT }])).toEqual({ ok: true });
    expect(t.lib.deck).toEqual([{ kind: "output", outputId: OUT }]);
    const u = setup(undefined, { seenOutputs: [] });
    expect(await u.service.setDeck([{ kind: "output", outputId: OUT }])).toEqual({ ok: false, reason: "not_found" });
  });
  it("una misma tecla de audio no va dos veces", async () => {
    const t = setup();
    await t.service.setDeck([{ kind: "mute" }, { kind: "mute" }, { kind: "volume", delta: 5 }, { kind: "volume", delta: 5 }, { kind: "media", key: "next" }, { kind: "media", key: "next" }, { kind: "output", outputId: OUT }, { kind: "output", outputId: OUT }]);
    expect(t.lib.deck).toEqual([{ kind: "mute" }, { kind: "volume", delta: 5 }, { kind: "media", key: "next" }, { kind: "output", outputId: OUT }]);
  });
});

describe("library: atajo y disparador de escena (B6.3)", () => {
  const STEPS: Step[] = [{ kind: "bringAll" }];

  it("guarda el atajo y el disparador de una escena nueva", async () => {
    const t = setup();
    expect(await t.service.saveScene({ name: "Juego", steps: STEPS, hotkey: "J", trigger: { type: "agentStart" } })).toEqual({ ok: true });
    expect(t.lib.scenes[0]).toMatchObject({ name: "Juego", hotkey: "J", trigger: { type: "agentStart" } });
  });

  it("sin atajo ni disparador la escena no trae esos campos (como antes)", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Plana", steps: STEPS });
    expect(Object.keys(t.lib.scenes[0]!).sort()).toEqual(["id", "name", "steps"]);
  });

  it("dos escenas no pueden tener el mismo atajo", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Uno", steps: STEPS, hotkey: "J" });
    expect(await t.service.saveScene({ name: "Dos", steps: STEPS, hotkey: "J" })).toEqual({ ok: false, reason: "hotkey_taken" });
    expect(t.lib.scenes).toHaveLength(1);
  });

  it("editar una escena puede conservar su propio atajo", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Uno", steps: STEPS, hotkey: "J" });
    const id = t.lib.scenes[0]!.id;
    expect(await t.service.saveScene({ id, name: "Uno bis", steps: STEPS, hotkey: "J" })).toEqual({ ok: true });
    expect(t.lib.scenes[0]).toMatchObject({ name: "Uno bis", hotkey: "J" });
  });

  it("un draft sin los campos deja como estaban (un celu viejo no los borra); null los quita", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Uno", steps: STEPS, hotkey: "K", trigger: { type: "agentStart" } });
    const id = t.lib.scenes[0]!.id;
    await t.service.saveScene({ id, name: "Uno", steps: [...STEPS, ...STEPS] });
    expect(t.lib.scenes[0]).toMatchObject({ hotkey: "K", trigger: { type: "agentStart" } });
    await t.service.saveScene({ id, name: "Uno", steps: STEPS, hotkey: null, trigger: null });
    expect("hotkey" in t.lib.scenes[0]!).toBe(false);
    expect("trigger" in t.lib.scenes[0]!).toBe(false);
  });

  it("el disparador displayOn se guarda con el id de la pantalla", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Tele", steps: STEPS, trigger: { type: "displayOn", displayId: MON } });
    expect(t.lib.scenes[0]!.trigger).toEqual({ type: "displayOn", displayId: MON });
  });

  it("borrar la escena libera su atajo", async () => {
    const t = setup();
    await t.service.saveScene({ name: "Uno", steps: STEPS, hotkey: "J" });
    await t.service.removeScene(t.lib.scenes[0]!.id);
    expect(await t.service.saveScene({ name: "Dos", steps: STEPS, hotkey: "J" })).toEqual({ ok: true });
  });
});
