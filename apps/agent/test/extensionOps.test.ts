import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createBridge } from "../../extension/lib/bridge.js";
import { OpError, createOps } from "../../extension/lib/ops.js";
import { flattenBookmarks, hostOf, toTab, toTabs } from "../../extension/lib/tabs.js";

const search = readFileSync(new URL("./fixtures/yt-search.html", import.meta.url), "utf8");
const watch = readFileSync(new URL("./fixtures/yt-watch.html", import.meta.url), "utf8");
const VID = "yAtew9dZX_E";
const LIST = "PLOHoVaTp8R7dfrJW5pumS0iD_dhlXKv17";

describe("pestañas: lo que viaja al agente", () => {
  it("hostOf quita el www y devuelve vacío si no es una dirección", () => {
    expect(hostOf("https://www.instagram.com/p/abc?x=1")).toBe("instagram.com");
    expect(hostOf("nada")).toBe("");
  });

  it("toTab manda título y sitio, nunca la dirección completa", () => {
    const t = toTab({ id: 4, windowId: 2, title: "Instagram", url: "https://www.instagram.com/direct/secreto?token=1", active: true, audible: false });
    expect(t).toEqual({ id: 4, windowId: 2, title: "Instagram", host: "instagram.com", active: true, audible: false, pinned: false });
    expect(JSON.stringify(t)).not.toContain("secreto");
  });

  it("recorta títulos largos, ignora el incógnito y lo que no tiene id", () => {
    expect(toTab({ id: 1, title: "x".repeat(500), url: "https://a.com" })!.title).toHaveLength(120);
    expect(toTab({ id: 1, incognito: true, url: "https://a.com" })).toBeNull();
    expect(toTab({ title: "sin id" })).toBeNull();
    expect(toTab({ id: -1 })).toBeNull();
    expect(toTab({ id: 3, url: "chrome://extensions" })!.host).toBe("navegador");
  });

  it("toTabs ordena por ventana y posición, y no pasa de 60", () => {
    const tabs = [
      { id: 3, windowId: 2, index: 0, url: "https://c.com" },
      { id: 1, windowId: 1, index: 1, url: "https://a.com" },
      { id: 2, windowId: 1, index: 0, url: "https://b.com" },
    ];
    expect(toTabs(tabs).map((t: { id: number }) => t.id)).toEqual([2, 1, 3]);
    expect(toTabs(Array.from({ length: 90 }, (_, i) => ({ id: i, windowId: 1, index: i, url: "https://a.com" })))).toHaveLength(60);
  });
});

describe("marcadores", () => {
  const tree = [
    { id: "0", title: "", children: [
      { id: "1", title: "Barra de marcadores", children: [
        { id: "10", title: "YouTube", url: "https://www.youtube.com/" },
        { id: "11", title: "Recetas", children: [{ id: "110", title: "Pizza", url: "https://pizza.com/masa" }] },
        { id: "12", title: "Peligroso", url: "javascript:alert(1)" },
        { id: "13", title: "", url: "https://sinnombre.com" },
      ] },
      { id: "2", title: "Otros", children: [{ id: "20", title: "Archivo", url: "file:///C:/x.txt" }] },
    ] },
  ];
  it("aplana el árbol con el nombre de la carpeta de cada uno y solo deja direcciones http(s)", () => {
    expect(flattenBookmarks(tree)).toEqual([
      { kind: "bookmark", id: "10", title: "YouTube", subtitle: "Barra de marcadores", url: "https://www.youtube.com/" },
      { kind: "bookmark", id: "110", title: "Pizza", subtitle: "Recetas", url: "https://pizza.com/masa" },
      { kind: "bookmark", id: "13", title: "sinnombre.com", subtitle: "Barra de marcadores", url: "https://sinnombre.com" },
    ]);
  });
  it("no pasa de 80", () => {
    const many = [{ id: "0", title: "", children: Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1), title: "m" + i, url: "https://a.com/" + i })) }];
    expect(flattenBookmarks(many)).toHaveLength(80);
  });
});

/** Un Chrome de mentira que anota todo lo que se le pide. */
function fakeChrome(tabs: Record<number, { url: string; title?: string }> = {}) {
  const calls: unknown[][] = [];
  const log = (name: string) => async (...a: unknown[]) => void calls.push([name, ...a]);
  const scripted: { result?: unknown } = {};
  const chrome = {
    tabs: {
      get: async (id: number) => tabs[id] ?? null,
      update: log("tabs.update"),
      remove: log("tabs.remove"),
      reload: log("tabs.reload"),
      create: log("tabs.create"),
      query: async () => Object.entries(tabs).map(([id, t]) => ({ id: Number(id), windowId: 1, index: Number(id), ...t })),
    },
    windows: { create: log("windows.create") },
    sessions: { restore: log("sessions.restore") },
    bookmarks: { getTree: async () => [{ id: "0", title: "", children: [{ id: "1", title: "Barra", url: "https://a.com" }] }] },
    scripting: {
      executeScript: async (req: { world: string; func: { name: string }; args: unknown[]; target: { tabId: number } }) => {
        calls.push(["script", req.world, req.func.name, req.args, req.target.tabId]);
        return [{ result: scripted.result }];
      },
    },
  };
  return { chrome, calls, scripted };
}
const okFetch = (html: string) => (async () => ({ ok: true, status: 200, text: async () => html })) as unknown as typeof fetch;

describe("operaciones: nada trae una ventana al frente", () => {
  it("activar una pestaña cambia solo la pestaña, no enfoca la ventana", async () => {
    const { chrome, calls } = fakeChrome();
    await createOps(chrome, okFetch("")).act({ op: "tab.activate", tabId: 7 });
    expect(calls).toEqual([["tabs.update", 7, { active: true }]]);
  });

  it("cerrar, recargar, reabrir y abrir", async () => {
    const { chrome, calls } = fakeChrome();
    const ops = createOps(chrome, okFetch(""));
    await ops.act({ op: "tab.close", tabId: 1 });
    await ops.act({ op: "tab.reload", tabId: 2 });
    await ops.act({ op: "tab.reopen" });
    await ops.act({ op: "tab.open", url: "https://a.com", mode: "tab" });
    await ops.act({ op: "tab.open", url: "https://b.com", mode: "window" });
    expect(calls).toEqual([["tabs.remove", 1], ["tabs.reload", 2], ["sessions.restore"], ["tabs.create", { url: "https://a.com" }], ["windows.create", { url: "https://b.com" }]]);
  });

  it("yt.play toca el video con el reproductor de la página, en el mundo MAIN y sin recargar", async () => {
    const { chrome, calls, scripted } = fakeChrome({ 5: { url: `https://www.youtube.com/watch?v=${VID}&list=${LIST}` } });
    scripted.result = { ok: true };
    await createOps(chrome, okFetch("")).act({ op: "yt.play", tabId: 5, videoId: VID, listId: LIST, index: 62 });
    expect(calls).toEqual([["script", "MAIN", "pagePlay", [VID, LIST, 62], 5]]);
  });

  it("si el reproductor no contesta, navega esa pestaña (sin activarla)", async () => {
    const { chrome, calls, scripted } = fakeChrome({ 5: { url: `https://www.youtube.com/watch?v=aaaaaaaaaaa&list=${LIST}` } });
    scripted.result = { ok: false, why: "no_api" };
    await createOps(chrome, okFetch("")).act({ op: "yt.play", tabId: 5, videoId: VID, listId: LIST, index: 3 });
    expect(calls[1]).toEqual(["tabs.update", 5, { url: `https://www.youtube.com/watch?v=${VID}&list=${LIST}` }]);
    expect(JSON.stringify(calls[1])).not.toContain("active");
  });

  it("nunca inyecta nada en una pestaña que no es de YouTube", async () => {
    const { chrome, calls } = fakeChrome({ 9: { url: "https://banco.com/cuenta" } });
    const ops = createOps(chrome, okFetch(""));
    await expect(ops.act({ op: "yt.play", tabId: 9, videoId: VID })).rejects.toBeInstanceOf(OpError);
    await expect(ops.query({ kind: "ytm.queue", tabId: 9 })).rejects.toBeInstanceOf(OpError);
    await expect(ops.act({ op: "ytm.play", tabId: 9, index: 0 })).rejects.toBeInstanceOf(OpError);
    await expect(ops.act({ op: "yt.play", tabId: 404, videoId: VID })).rejects.toBeInstanceOf(OpError); // ya no existe
    expect(calls).toEqual([]);
  });

  it("poner una lista: en la pestaña de YouTube que suena, o en una nueva sin activar", async () => {
    const { chrome, calls } = fakeChrome({ 5: { url: `https://www.youtube.com/watch?v=${VID}` } });
    const ops = createOps(chrome, okFetch(""));
    await ops.act({ op: "yt.playList", listId: "PLabc123", tabId: 5 });
    await ops.act({ op: "yt.playList", listId: "RD5jaT_8hy3Vg" });
    expect(calls).toEqual([
      ["tabs.update", 5, { url: "https://www.youtube.com/watch?list=PLabc123" }],
      ["tabs.create", { url: "https://www.youtube.com/watch?v=5jaT_8hy3Vg&list=RD5jaT_8hy3Vg", active: false }],
    ]);
  });

  it("YouTube Music: tocar un tema de la cola (o avisar si no se pudo)", async () => {
    const { chrome, calls, scripted } = fakeChrome({ 6: { url: "https://music.youtube.com/watch?v=" + VID } });
    scripted.result = { ok: true };
    const ops = createOps(chrome, okFetch(""));
    await ops.act({ op: "ytm.play", tabId: 6, index: 4 });
    expect(calls[0]).toEqual(["script", "MAIN", "pageMusicPlay", [4], 6]);
    scripted.result = { ok: false };
    await expect(ops.act({ op: "ytm.play", tabId: 6, index: 4 })).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("preguntas", () => {
  it("marcadores", async () => {
    const { chrome } = fakeChrome();
    expect(await createOps(chrome, okFetch("")).query({ kind: "bookmarks" })).toEqual([{ kind: "bookmark", id: "1", title: "Barra", subtitle: "", url: "https://a.com" }]);
  });

  it("buscar: arma la dirección con el texto escapado y lee los resultados", async () => {
    const { chrome } = fakeChrome();
    const urls: string[] = [];
    const fetchFn = (async (u: string) => (urls.push(u), { ok: true, status: 200, text: async () => search })) as unknown as typeof fetch;
    const items = await createOps(chrome, fetchFn).query({ kind: "yt.search", text: "lofi & chill/1" });
    expect(urls[0]).toBe("https://www.youtube.com/results?search_query=lofi%20%26%20chill%2F1&hl=es");
    expect(items.length).toBeGreaterThan(5);
  });

  it("la cola de una lista: pide la página de ese video con su lista", async () => {
    const { chrome } = fakeChrome({ 5: { url: `https://www.youtube.com/watch?v=${VID}&list=${LIST}&index=61` } });
    const urls: string[] = [];
    const fetchFn = (async (u: string) => (urls.push(u), { ok: true, status: 200, text: async () => watch })) as unknown as typeof fetch;
    const items = await createOps(chrome, fetchFn).query({ kind: "yt.queue", tabId: 5 });
    expect(urls[0]).toBe(`https://www.youtube.com/watch?v=${VID}&list=${LIST}&hl=es`);
    expect(items).toHaveLength(80);
    expect(items.find((i: { current: boolean }) => i.current)).toMatchObject({ id: VID, index: 60 });
  });

  it("un video suelto: la cola es solo lo que suena", async () => {
    const { chrome } = fakeChrome({ 5: { url: `https://www.youtube.com/watch?v=${VID}`, title: "Mi video - YouTube" } });
    expect(await createOps(chrome, okFetch("")).query({ kind: "yt.queue", tabId: 5 })).toEqual([{ kind: "video", id: VID, title: "Mi video", current: true, index: 0 }]);
  });

  it("una pestaña de YouTube que no está en un video (inicio, búsqueda) no tiene cola", async () => {
    const { chrome } = fakeChrome({ 5: { url: "https://www.youtube.com/" } });
    await expect(createOps(chrome, okFetch("")).query({ kind: "yt.queue", tabId: 5 })).rejects.toMatchObject({ code: "unreadable" });
  });

  it("mis listas: Me gusta y Ver más tarde van primero, y no se repiten", async () => {
    const page = `<script>var ytInitialData = ${JSON.stringify({ x: [{ gridPlaylistRenderer: { playlistId: "PLzzzzzz", title: { simpleText: "Mi lista" } } }, { gridPlaylistRenderer: { playlistId: "WL", title: { simpleText: "Ver más tarde" } } }] })};</script>`;
    const { chrome } = fakeChrome();
    const items = await createOps(chrome, okFetch(page)).query({ kind: "yt.lists" });
    expect(items.map((i: { id: string }) => i.id)).toEqual(["LL", "WL", "PLzzzzzz"]);
  });

  it("si YouTube no contesta o cambió el formato, la falla es 'unreadable'", async () => {
    const { chrome } = fakeChrome();
    const bad = (async () => ({ ok: false, status: 429, text: async () => "" })) as unknown as typeof fetch;
    await expect(createOps(chrome, bad).query({ kind: "yt.search", text: "x" })).rejects.toMatchObject({ code: "unreadable" });
    await expect(createOps(chrome, okFetch("<html>otra cosa</html>")).query({ kind: "yt.search", text: "x" })).rejects.toMatchObject({ code: "unreadable" });
    const boom = (async () => {
      throw new Error("red caída");
    }) as unknown as typeof fetch;
    await expect(createOps(chrome, boom).query({ kind: "yt.lists" })).rejects.toMatchObject({ code: "unreadable" });
  });
});

// ── La conexión ──
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

describe("bridge: la conexión con el agente", () => {
  const make = (onRequest: (r: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>) => {
    FakeSocket.all = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const opened: unknown[] = [];
    const bridge = createBridge({
      url: "ws://127.0.0.1:47802/?k=t",
      WebSocketImpl: FakeSocket,
      setTimeoutFn: (fn: () => void, ms: number) => timers.push({ fn, ms }),
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
      onOpen: (send: (m: object) => void) => opened.push(send),
      onRequest,
    });
    return { bridge, timers, opened };
  };

  it("se conecta, avisa que abrió y contesta cada pedido con su id", async () => {
    const { bridge, opened } = make(async () => ({ ok: true, data: [1, 2] }));
    bridge.start();
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe("ws://127.0.0.1:47802/?k=t");
    ws.open();
    expect(opened).toHaveLength(1);
    ws.onmessage!({ data: JSON.stringify({ t: "req", id: 9, cmd: "query", body: { kind: "bookmarks" } }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(ws.sent[0]!)).toEqual({ t: "res", id: 9, ok: true, data: [1, 2] });
  });

  it("un pedido que revienta se contesta como falla (nunca queda colgado) y lo raro se ignora", async () => {
    const { bridge } = make(async () => {
      throw new Error("boom");
    });
    bridge.start();
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.onmessage!({ data: "no es json" });
    ws.onmessage!({ data: JSON.stringify({ t: "otra" }) });
    ws.onmessage!({ data: JSON.stringify({ t: "req", id: "texto" }) });
    ws.onmessage!({ data: JSON.stringify({ t: "req", id: 3, cmd: "act", body: {} }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ t: "res", id: 3, ok: false, error: "failed" }]);
  });

  it("si se cae, reconecta con pausas cada vez más largas, y al conectar vuelve a empezar", () => {
    const { bridge, timers } = make(async () => ({ ok: true }));
    bridge.start();
    for (let i = 0; i < 6; i++) {
      FakeSocket.all.at(-1)!.close();
      timers.at(-1)!.fn();
    }
    expect(timers.map((t) => t.ms)).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 30_000]);
    FakeSocket.all.at(-1)!.open();
    FakeSocket.all.at(-1)!.close();
    expect(timers.at(-1)!.ms).toBe(1_000);
  });

  it("no abre dos conexiones a la vez", () => {
    const { bridge } = make(async () => ({ ok: true }));
    bridge.start();
    bridge.ensure();
    bridge.ensure();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("stop deja de reconectar", () => {
    const { bridge, timers } = make(async () => ({ ok: true }));
    bridge.start();
    bridge.stop();
    expect(timers).toHaveLength(0);
    expect(bridge.isOpen()).toBe(false);
  });
});
