import type { Monitor } from "@proyecto-e/protocol";
import { mapLayout } from "@/screens/mapLayout";

const base: Monitor = {
  id: "m_0000000000000000",
  index: 1,
  nickname: null,
  name: "Pantalla",
  connector: "hdmi",
  enabled: true,
  primary: false,
  bounds: { x: 0, y: 0, w: 1920, h: 1080 },
  lastBounds: { x: 0, y: 0, w: 1920, h: 1080 },
  resolution: { w: 1920, h: 1080 },
  canDisable: true,
  blockedBy: null,
  busy: false,
};
const mon = (over: Partial<Monitor>): Monitor => ({ ...base, ...over });
const BOX = { width: 300, height: 130 };

describe("mapLayout", () => {
  it("sin pantallas no dibuja nada", () => {
    expect(mapLayout([], BOX)).toEqual([]);
  });

  it("una sola pantalla: entra en la caja y queda centrada", () => {
    const [r] = mapLayout([mon({})], BOX);
    expect(r).toBeDefined();
    expect(r!.left).toBeGreaterThanOrEqual(0);
    expect(r!.top).toBeGreaterThanOrEqual(0);
    expect(r!.left + r!.width).toBeLessThanOrEqual(BOX.width);
    expect(r!.top + r!.height).toBeLessThanOrEqual(BOX.height);
    expect(r!.left + r!.width / 2).toBeCloseTo(BOX.width / 2, 0);
  });

  it("conserva la proporción real de cada pantalla", () => {
    const [r] = mapLayout([mon({ bounds: { x: 0, y: 0, w: 3840, h: 2160 } })], BOX);
    expect(r!.width / r!.height).toBeCloseTo(16 / 9, 1);
  });

  it("dos pantallas lado a lado mantienen el orden y la escala relativa", () => {
    const a = mon({ id: "m_aaaaaaaaaaaaaaaa", bounds: { x: 0, y: 0, w: 1920, h: 1080 } });
    const b = mon({ id: "m_bbbbbbbbbbbbbbbb", index: 2, bounds: { x: 1920, y: 0, w: 2560, h: 1440 } });
    const [ra, rb] = mapLayout([a, b], BOX);
    expect(rb!.left).toBeGreaterThan(ra!.left + ra!.width - 1);
    expect(rb!.width / ra!.width).toBeCloseTo(2560 / 1920, 1);
    expect(rb!.left + rb!.width).toBeLessThanOrEqual(BOX.width);
  });

  it("una apagada se dibuja en su lastBounds y marcada como apagada", () => {
    const on = mon({ id: "m_aaaaaaaaaaaaaaaa" });
    const off = mon({
      id: "m_bbbbbbbbbbbbbbbb",
      index: null,
      enabled: false,
      bounds: null,
      lastBounds: { x: 1920, y: 0, w: 3840, h: 2160 },
    });
    const [ron, roff] = mapLayout([on, off], BOX);
    expect(ron!.off).toBe(false);
    expect(roff!.off).toBe(true);
    expect(roff!.left).toBeGreaterThan(ron!.left);
  });

  it("una sin ninguna posición conocida no se dibuja (queda solo en la lista)", () => {
    const sinPos = mon({ id: "m_cccccccccccccccc", index: null, enabled: false, bounds: null, lastBounds: null });
    expect(mapLayout([mon({}), sinPos], BOX).map((r) => r.id)).toEqual([base.id]);
  });

  it("monitores en vertical o con coordenadas negativas también entran", () => {
    const izq = mon({ id: "m_aaaaaaaaaaaaaaaa", bounds: { x: -1080, y: -400, w: 1080, h: 1920 } });
    const der = mon({ id: "m_bbbbbbbbbbbbbbbb", bounds: { x: 0, y: 0, w: 2560, h: 1440 } });
    for (const r of mapLayout([izq, der], BOX)) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(BOX.width);
      expect(r.top + r.height).toBeLessThanOrEqual(BOX.height);
    }
  });

  it("una caja inválida (0 o NaN) no rompe", () => {
    expect(mapLayout([mon({})], { width: 0, height: 0 })).toEqual([]);
    expect(mapLayout([mon({})], { width: NaN, height: 100 })).toEqual([]);
  });
});
