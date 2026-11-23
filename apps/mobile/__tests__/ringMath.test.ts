import { angleToVolume, dotAngle, inRingBand, lerpColor, volumeToDots } from "@/audio/ring";

const S = 200; // el anillo mide 200 y su centro está en (100, 100)

describe("angleToVolume: el ángulo del dedo se vuelve volumen (arco de 270°, hueco abajo)", () => {
  it("arriba del todo (12 en punto) es la mitad", () => {
    expect(angleToVolume(100, 10, S)).toBe(50);
  });
  it("a las 9 en punto es 17 y a las 3 en punto es 83 (−90° y +90° sobre un arco de −135° a +135°)", () => {
    expect(angleToVolume(10, 100, S)).toBe(17);
    expect(angleToVolume(190, 100, S)).toBe(83);
  });
  it("el comienzo del arco (abajo a la izquierda, a 135°) es 0 y el final (abajo a la derecha) es 100", () => {
    expect(angleToVolume(100 - 70.7, 100 + 70.7, S)).toBe(0);
    expect(angleToVolume(100 + 70.7, 100 + 70.7, S)).toBe(100);
  });
  it("en el hueco de abajo se pega al extremo más cercano, sin saltar de un lado al otro", () => {
    expect(angleToVolume(95, 190, S)).toBe(0); // un poco a la izquierda del centro de abajo
    expect(angleToVolume(105, 190, S)).toBe(100); // un poco a la derecha
    expect(angleToVolume(60, 160, S)).toBe(0);
  });
  it("siempre entero entre 0 y 100", () => {
    for (let x = 0; x <= S; x += 13) for (let y = 0; y <= S; y += 13) {
      const v = angleToVolume(x, y, S);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe("inRingBand: solo se agarra el anillo, no la carátula del medio", () => {
  it("el borde del anillo sí, el centro no", () => {
    expect(inRingBand(100, 8, S)).toBe(true);
    expect(inRingBand(192, 100, S)).toBe(true);
    expect(inRingBand(100, 100, S)).toBe(false);
    expect(inRingBand(100, 60, S)).toBe(false); // sobre la carátula
  });
  it("un poco pasado el borde también cuenta (el dedo no es preciso)", () => {
    expect(inRingBand(100, -6, S)).toBe(true);
  });
  it("muy lejos no", () => {
    expect(inRingBand(100, -60, S)).toBe(false);
  });
});

describe("dotAngle y volumeToDots", () => {
  it("el primer punto está a -135° y el último a +135°", () => {
    expect(dotAngle(0, 54)).toBeCloseTo(-135);
    expect(dotAngle(53, 54)).toBeCloseTo(135);
  });
  it("el volumen se vuelve cantidad de puntos prendidos (0 a N)", () => {
    expect(volumeToDots(0, 54)).toBe(0);
    expect(volumeToDots(100, 54)).toBe(54);
    expect(volumeToDots(50, 54)).toBe(27);
  });
});

describe("lerpColor", () => {
  it("va del ámbar al coral", () => {
    expect(lerpColor("#F5A524", "#FF6B4A", 0)).toBe("#f5a524");
    expect(lerpColor("#F5A524", "#FF6B4A", 1)).toBe("#ff6b4a");
    expect(lerpColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
