import { linkFromClipboard, normalizeUrl, siteOf, stripScheme } from "@/links";

describe("normalizeUrl: no hace falta escribir https://", () => {
  it("agrega https:// solo", () => {
    expect(normalizeUrl("youtube.com")).toBe("https://youtube.com");
    expect(normalizeUrl("  www.twitch.tv/directory?a=1&b=2 ")).toBe("https://www.twitch.tv/directory?a=1&b=2");
    expect(normalizeUrl("music.youtube.com/watch?v=abc")).toBe("https://music.youtube.com/watch?v=abc");
  });
  it("si lo escribe o lo pega con https://, queda igual (no se duplica)", () => {
    expect(normalizeUrl("https://youtube.com")).toBe("https://youtube.com");
    expect(normalizeUrl("HTTPS://youtube.com")).toBe("HTTPS://youtube.com");
  });
  it("un http:// escrito a propósito se respeta", () => {
    expect(normalizeUrl("http://192.168.0.5:8080/panel")).toBe("http://192.168.0.5:8080/panel");
  });
  it("sirve localhost y una IP con puerto", () => {
    expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000");
    expect(normalizeUrl("192.168.0.5:8096")).toBe("https://192.168.0.5:8096");
  });
  it("rechaza lo que no parece un sitio o no es seguro", () => {
    const bads = ["", "   ", "hola", "dos palabras.com", "file:///C:/x", "javascript:alert(1)", "ftp://a.com", "a..", "https://", "https://a.com\\x", "user@a.com", "a.com/ruta con espacio"];
    for (const bad of bads) expect([bad, normalizeUrl(bad)]).toEqual([bad, null]);
  });
});

describe("stripScheme y siteOf", () => {
  it("el campo muestra la dirección sin https://", () => {
    expect(stripScheme("https://www.youtube.com/watch?v=1")).toBe("www.youtube.com/watch?v=1");
    expect(stripScheme("HTTPS://a.com")).toBe("a.com");
    expect(stripScheme("http://a.com")).toBe("http://a.com"); // solo se esconde el https
    expect(stripScheme("youtube.com")).toBe("youtube.com");
  });
  it("siteOf saca el sitio con o sin esquema", () => {
    expect(siteOf("https://www.youtube.com/x")).toBe("youtube.com");
    expect(siteOf("twitch.tv/directory")).toBe("twitch.tv");
    expect(siteOf("localhost:3000/a")).toBe("localhost");
  });
});

describe("linkFromClipboard: ofrece lo copiado solo si es un link", () => {
  it("un link copiado se ofrece, completo", () => {
    expect(linkFromClipboard("https://www.youtube.com/watch?v=dQw4w9WgXcQ\n")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(linkFromClipboard("twitch.tv/directory")).toBe("https://twitch.tv/directory");
  });
  it("un texto cualquiera, vacío o muy largo no se ofrece", () => {
    expect(linkFromClipboard("")).toBeNull();
    expect(linkFromClipboard("comprar leche y pan")).toBeNull();
    expect(linkFromClipboard("una palabra")).toBeNull();
    expect(linkFromClipboard("3.14159")).toBeNull();
    expect(linkFromClipboard("https://a.com/" + "x".repeat(2100))).toBeNull();
  });
});
