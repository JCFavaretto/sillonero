import { boxFromScan } from "@/components/qrBox";

const p = (x: number, y: number) => ({ x, y });

describe("boxFromScan", () => {
  it("usa los puntos de las esquinas (orden de Android)", () => {
    const box = boxFromScan({ cornerPoints: [p(100, 50), p(200, 52), p(198, 150), p(102, 148)] });
    expect(box).toEqual({ x: 100, y: 50, width: 100, height: 100 });
  });

  it("es independiente del orden de las esquinas (iOS)", () => {
    const box = boxFromScan({ cornerPoints: [p(102, 148), p(198, 150), p(100, 50), p(200, 52)] });
    expect(box).toEqual({ x: 100, y: 50, width: 100, height: 100 });
  });

  it("suma un margen si se pide", () => {
    const box = boxFromScan({ cornerPoints: [p(100, 50), p(200, 50), p(200, 150), p(100, 150)] }, 10);
    expect(box).toEqual({ x: 90, y: 40, width: 120, height: 120 });
  });

  it("sin puntos usa bounds", () => {
    const box = boxFromScan({ cornerPoints: [], bounds: { origin: p(10, 20), size: { width: 80, height: 60 } } });
    expect(box).toEqual({ x: 10, y: 20, width: 80, height: 60 });
  });

  it("si no hay nada usable devuelve null", () => {
    expect(boxFromScan({})).toBeNull();
    expect(boxFromScan({ cornerPoints: [] })).toBeNull();
    expect(boxFromScan({ cornerPoints: [], bounds: { origin: p(0, 0), size: { width: 0, height: 0 } } })).toBeNull();
    expect(boxFromScan({ cornerPoints: [p(5, 5), p(5, 5), p(5, 5), p(5, 5)] })).toBeNull();
  });

  it("descarta valores que no son números", () => {
    expect(boxFromScan({ cornerPoints: [p(NaN, 1), p(2, 2), p(3, 3), p(4, 4)] })).toBeNull();
    expect(boxFromScan({ bounds: { origin: p(0, 0), size: { width: Infinity, height: 10 } } })).toBeNull();
  });
});
