import { isBrowser, shortcutRows, siteOf } from "@/apps/profiles";

describe("perfiles de app, nivel básico", () => {
  it("reconoce los navegadores por el nombre del programa, sin importar mayúsculas", () => {
    for (const a of ["chrome", "Chrome", "msedge", "firefox", "brave", "opera", "vivaldi"]) expect(isBrowser(a)).toBe(true);
    for (const a of ["Code", "Spotify", "Discord", ""]) expect(isBrowser(a)).toBe(false);
  });

  it("saca el sitio del título de la ventana", () => {
    expect(siteOf("lofi hip hop radio - YouTube - Google Chrome")).toBe("youtube");
    expect(siteOf("YouTube — Age of Empires")).toBe("youtube");
    expect(siteOf("Nombre del tema - YouTube Music - Google Chrome")).toBe("youtubeMusic");
    expect(siteOf("Instagram - Google Chrome")).toBeNull();
  });

  it("un navegador tiene su fila de atajos; con YouTube a la vista, la de YouTube va primero", () => {
    expect(shortcutRows("chrome", "Instagram - Google Chrome").map((r) => r.id)).toEqual(["player", "browser"]);
    expect(shortcutRows("chrome", "Instagram - Google Chrome")[0]!.buttons.map((b) => b.shortcut)).toEqual(["mediaBack", "mediaForward", "mediaMute", "mediaFullscreen"]);
    const rows = shortcutRows("chrome", "Video - YouTube - Google Chrome");
    expect(rows.map((r) => r.id)).toEqual(["youtube", "browser"]);
    expect(rows[0]!.buttons.map((b) => b.shortcut)).toEqual(["ytBack10", "ytForward10", "ytFullscreen", "ytCaptions"]);
    expect(rows[1]!.buttons.map((b) => b.shortcut)).toEqual(["back", "forward", "reload", "newTab"]);
  });

  it("la fila genérica de reproductor solo se ofrece si suena algo en esa ventana (no escribe a ciegas en un campo de texto)", () => {
    expect(shortcutRows("chrome", "Gmail - Google Chrome", false).map((r) => r.id)).toEqual(["browser"]);
    expect(shortcutRows("chrome", "Video - Google Chrome", true).map((r) => r.id)).toEqual(["player", "browser"]);
  });

  it("una app que no es navegador no tiene atajos (todavía)", () => {
    expect(shortcutRows("Spotify", "Spotify Premium")).toEqual([]);
    expect(shortcutRows("Code", "YouTube.tsx - proyecto")).toEqual([]);
  });
});
