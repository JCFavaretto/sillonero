import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractInitialData, idsFromUrl, pageMusicPlay, pageMusicQueue, pagePlay, parseLists, parseQueue, parseSearch, playListUrl, textOf } from "../../extension/lib/youtube.js";

// Datos REALES de YouTube (bajados el 12/11/2026 y recortados): si YouTube cambia su formato, esto es lo que avisa.
const search = readFileSync(new URL("./fixtures/yt-search.html", import.meta.url), "utf8");
const watch = readFileSync(new URL("./fixtures/yt-watch.html", import.meta.url), "utf8");

describe("extractInitialData", () => {
  it("saca el JSON de la página aunque tenga llaves y comillas adentro de los textos", () => {
    const html = `<script>var ytInitialData = {"a":"un } suelto y \\" comilla","b":{"c":[1,2,{"d":"}"}]}};</script><script>var otro={"x":1}</script>`;
    expect(extractInitialData(html)).toEqual({ a: 'un } suelto y " comilla', b: { c: [1, 2, { d: "}" }] } });
  });
  it("devuelve null si no hay datos o están cortados", () => {
    expect(extractInitialData("<html>nada</html>")).toBeNull();
    expect(extractInitialData('var ytInitialData = {"a":')).toBeNull();
    expect(extractInitialData("var ytInitialData = {sin comillas};")).toBeNull();
  });
  it("lee las páginas reales", () => {
    expect(extractInitialData(search)).not.toBeNull();
    expect(extractInitialData(watch)).not.toBeNull();
  });
});

describe("textOf", () => {
  it("simpleText, runs y vacío", () => {
    expect(textOf({ simpleText: "3:42" })).toBe("3:42");
    expect(textOf({ runs: [{ text: "Hola " }, { text: "mundo" }] })).toBe("Hola mundo");
    expect(textOf(undefined)).toBe("");
    expect(textOf({ runs: [{ nada: 1 }] })).toBe("");
  });
});

describe("parseSearch con una búsqueda real", () => {
  const items = parseSearch(extractInitialData(search));
  it("trae videos con id de 11 caracteres, título y canal", () => {
    const videos = items.filter((i) => i.kind === "video");
    expect(videos.length).toBeGreaterThanOrEqual(8);
    for (const v of videos) {
      expect(v.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.subtitle.length).toBeGreaterThan(0);
    }
  });
  it("las transmisiones en vivo dicen VIVO en vez de una duración", () => {
    expect(items.some((i) => i.meta === "VIVO")).toBe(true);
  });
  it("las listas y mezclas vienen con su id y cantidad", () => {
    const list = items.find((i) => i.kind === "list");
    expect(list).toBeDefined();
    expect(list!.id).toMatch(/^[A-Za-z0-9_-]{2,64}$/);
    expect(list!.title).toContain("Mix");
  });
  it("devuelve lista vacía si la página no tiene resultados", () => {
    expect(parseSearch({})).toEqual([]);
    expect(parseSearch(null)).toEqual([]);
  });
});

describe("parseQueue con un video dentro de una lista real", () => {
  const queue = parseQueue(extractInitialData(watch))!;
  it("trae el nombre de la lista, el total y los temas con su posición real, en una ventana de 80 alrededor del actual", () => {
    expect(queue.title).toContain("KPOP");
    expect(queue.total).toBe(150);
    expect(queue.items).toHaveLength(80);
    expect(queue.items.every((i: { listId: string }) => i.listId === "PLOHoVaTp8R7dfrJW5pumS0iD_dhlXKv17")).toBe(true);
    // suena el tema 60 de la lista: la ventana empieza 10 antes y cada tema conserva su posición verdadera
    expect(queue.items[0]).toMatchObject({ kind: "video", index: 50 });
    expect(queue.items.map((i: { index: number }) => i.index)).toEqual(Array.from({ length: 80 }, (_, n) => 50 + n));
  });
  it("el que suena queda marcado, con su id y su posición", () => {
    const current = queue.items.filter((i: { current: boolean }) => i.current);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ id: "yAtew9dZX_E", index: 60 });
    expect(current[0].title.length).toBeGreaterThan(0);
  });
  it("sin lista devuelve null", () => {
    expect(parseQueue({ contents: { twoColumnWatchNextResults: {} } })).toBeNull();
  });
  it("con una lista larga toma la ventana de 80 temas alrededor del actual, sin perder la posición real", () => {
    const contents = Array.from({ length: 300 }, (_, i) => ({ playlistPanelVideoRenderer: { videoId: String(i).padStart(11, "x"), title: { simpleText: `T${i}` }, selected: i === 150 } }));
    const q = parseQueue({ contents: { twoColumnWatchNextResults: { playlist: { playlist: { playlistId: "PLabc", contents } } } } })!;
    expect(q.items).toHaveLength(80);
    expect(q.items[0]!.index).toBe(140);
    expect(q.items.find((i: { current: boolean }) => i.current)!.index).toBe(150);
  });
});

describe("parseLists (Mis listas)", () => {
  it("encuentra listas en los dos formatos de YouTube y no repite", () => {
    const data = {
      a: [{ lockupViewModel: { contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST", contentId: "PLaaaaaa", metadata: { lockupMetadataViewModel: { title: { content: "Rock" } } } } }],
      b: { deep: { gridPlaylistRenderer: { playlistId: "PLbbbbbb", title: { runs: [{ text: "Jazz" }] }, videoCount: "12" } } },
      c: [{ lockupViewModel: { contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST", contentId: "PLaaaaaa", metadata: { lockupMetadataViewModel: { title: { content: "Rock" } } } } }],
    };
    expect(parseLists(data).map((l: { id: string; title: string }) => [l.id, l.title])).toEqual([["PLaaaaaa", "Rock"], ["PLbbbbbb", "Jazz"]]);
  });
  it("nada reconocible: lista vacía", () => {
    expect(parseLists({ x: 1 })).toEqual([]);
    expect(parseLists(null)).toEqual([]);
  });
});

describe("direcciones", () => {
  it("playListUrl: una lista común usa list=; una mezcla (RD…) necesita el video", () => {
    expect(playListUrl("PLabc_1-2")).toBe("https://www.youtube.com/watch?list=PLabc_1-2");
    expect(playListUrl("RD5jaT_8hy3Vg")).toBe("https://www.youtube.com/watch?v=5jaT_8hy3Vg&list=RD5jaT_8hy3Vg");
    expect(playListUrl("LL")).toBe("https://www.youtube.com/watch?list=LL");
  });
  it("idsFromUrl solo cree en youtube.com y valida los ids", () => {
    expect(idsFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123")).toEqual({ v: "dQw4w9WgXcQ", list: "PLabc123", music: false });
    expect(idsFromUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({ music: true, list: null });
    expect(idsFromUrl("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(idsFromUrl("https://www.youtube.com/watch?v=mal&list=a b")).toEqual({ v: null, list: null, music: false });
    expect(idsFromUrl("no es una url")).toBeNull();
  });
});

describe("funciones que corren dentro de la página", () => {
  const withDoc = <T>(doc: unknown, run: () => T): T => {
    const g = globalThis as unknown as { document?: unknown };
    const before = g.document;
    g.document = doc;
    try {
      return run();
    } finally {
      g.document = before;
    }
  };

  it("pagePlay: con lista usa playVideoAt, sin lista loadVideoById, y dice por qué si no puede", () => {
    const calls: unknown[][] = [];
    const player = { playVideoAt: (...a: unknown[]) => calls.push(["at", ...a]), loadVideoById: (...a: unknown[]) => calls.push(["load", ...a]) };
    const doc = { getElementById: () => player };
    expect(withDoc(doc, () => pagePlay("dQw4w9WgXcQ", "PLabc", 3))).toEqual({ ok: true });
    expect(withDoc(doc, () => pagePlay("dQw4w9WgXcQ", null, null))).toEqual({ ok: true });
    expect(calls).toEqual([["at", 3], ["load", "dQw4w9WgXcQ"]]);
    expect(withDoc({ getElementById: () => null }, () => pagePlay("dQw4w9WgXcQ", null, null))).toEqual({ ok: false, why: "no_player" });
    expect(withDoc({ getElementById: () => ({}) }, () => pagePlay("dQw4w9WgXcQ", null, null))).toEqual({ ok: false, why: "no_api" });
  });

  it("pageMusicQueue lee la cola de YouTube Music y marca el que suena", () => {
    const row = (title: string, selected: boolean) => ({
      hasAttribute: (n: string) => n === "selected" && selected,
      querySelector: (sel: string) => ({ textContent: sel === ".song-title" ? ` ${title} ` : sel === ".byline" ? "Artista\n  • Álbum" : "3:21" }),
    });
    const doc = { querySelectorAll: () => [row("Uno", false), row("Dos", true)] };
    expect(withDoc(doc, pageMusicQueue)).toEqual([
      { kind: "track", id: "0", title: "Uno", subtitle: "Artista • Álbum", meta: "3:21", current: false, index: 0 },
      { kind: "track", id: "1", title: "Dos", subtitle: "Artista • Álbum", meta: "3:21", current: true, index: 1 },
    ]);
  });

  it("pageMusicPlay toca el botón de ese tema; si no existe, no hace nada y lo dice", () => {
    let clicked = 0;
    const doc = { querySelectorAll: () => [{ querySelector: (s: string) => (s === "ytmusic-play-button-renderer" ? { click: () => clicked++ } : null) }] };
    expect(withDoc(doc, () => pageMusicPlay(0))).toEqual({ ok: true });
    expect(clicked).toBe(1);
    expect(withDoc(doc, () => pageMusicPlay(5))).toEqual({ ok: false, why: "no_item" });
  });
});
