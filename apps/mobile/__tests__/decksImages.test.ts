import { MAX_ANIMATED_BYTES, STATIC_SIZE, detectAnimated, squareCrop } from "@/decks/imageMath";

// D105: la imagen fija se recorta cuadrada al centro y se reduce; la animada (GIF o WebP) se guarda tal cual, con tope de peso.

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** Un GIF mínimo con `frames` cuadros: cabecera + (extensión de control de gráfico + descriptor de imagen) por cuadro. */
const gif = (frames: number) =>
  Uint8Array.from([...ascii("GIF89a"), 1, 0, 1, 0, 0, 0, 0, ...Array.from({ length: frames }, () => [0x21, 0xf9, 0x04, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 4, 1, 0]).flat(), 0x3b]);
const webp = (anim: boolean) => Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(anim ? "VP8X" : "VP8 "), 10, 0, 0, 0, anim ? 2 : 0, 0, 0, 0, 0, 0, 0, 0, ...(anim ? ascii("ANIM") : []), 0, 0, 0, 0]);

describe("detectAnimated", () => {
  it("un GIF con varios cuadros es animado; con uno solo es una imagen fija", () => {
    expect(detectAnimated(gif(3), "image/gif")).toBe(true);
    expect(detectAnimated(gif(2), "image/gif")).toBe(true);
    expect(detectAnimated(gif(1), "image/gif")).toBe(false);
  });

  it("un WebP animado tiene el bloque ANIM; uno fijo no", () => {
    expect(detectAnimated(webp(true), "image/webp")).toBe(true);
    expect(detectAnimated(webp(false), "image/webp")).toBe(false);
  });

  it("un JPG o un PNG nunca es animado, aunque los bytes se parezcan", () => {
    expect(detectAnimated(gif(5), "image/jpeg")).toBe(false);
    expect(detectAnimated(webp(true), "image/png")).toBe(false);
    expect(detectAnimated(new Uint8Array(), undefined)).toBe(false);
  });

  it("se reconoce por los bytes si el tipo no viene", () => {
    expect(detectAnimated(gif(3), undefined)).toBe(true);
    expect(detectAnimated(webp(true), undefined)).toBe(true);
  });

  it("un archivo cortado o vacío no rompe", () => {
    expect(detectAnimated(Uint8Array.from(ascii("GIF89a")), "image/gif")).toBe(false);
    expect(detectAnimated(new Uint8Array(3), "image/webp")).toBe(false);
  });
});

describe("squareCrop: el cuadrado del centro", () => {
  it("una foto horizontal pierde los costados; una vertical, arriba y abajo", () => {
    expect(squareCrop(4000, 3000)).toEqual({ originX: 500, originY: 0, width: 3000, height: 3000 });
    expect(squareCrop(3000, 4000)).toEqual({ originX: 0, originY: 500, width: 3000, height: 3000 });
  });

  it("una imagen ya cuadrada no se recorta; los números son enteros", () => {
    expect(squareCrop(512, 512)).toEqual({ originX: 0, originY: 0, width: 512, height: 512 });
    expect(squareCrop(101, 100)).toEqual({ originX: 0, originY: 0, width: 100, height: 100 });
  });

  it("medidas raras no rompen", () => {
    expect(squareCrop(0, 0)).toEqual({ originX: 0, originY: 0, width: 1, height: 1 });
    expect(squareCrop(Number.NaN, 10)).toEqual({ originX: 0, originY: 0, width: 1, height: 1 });
  });
});

describe("topes", () => {
  it("la imagen fija se guarda a 256 px y la animada pesa hasta 2 MB", () => {
    expect(STATIC_SIZE).toBe(256);
    expect(MAX_ANIMATED_BYTES).toBe(2 * 1024 * 1024);
  });
});
