import { describe, expect, it } from "vitest";
import { zoneRect } from "../src/scenes/zones";

const work = { x: 0, y: 0, w: 1921, h: 1041 }; // área impar a propósito
const bounds = { x: 0, y: 0, w: 1921, h: 1081 };

describe("zoneRect", () => {
  it("keep no mueve nada", () => {
    expect(zoneRect("keep", work, bounds)).toBeNull();
  });
  it("full maximiza; fullscreen estira a todo el monitor sin bordes", () => {
    expect(zoneRect("full", work, bounds)).toMatchObject({ maximize: true, fullscreen: false });
    expect(zoneRect("fullscreen", work, bounds)).toEqual({ rect: bounds, maximize: false, fullscreen: true });
  });
  it("las mitades cubren el área sin huecos aunque sea impar", () => {
    const l = zoneRect("left", work, bounds)!.rect;
    const r = zoneRect("right", work, bounds)!.rect;
    expect(l.x + l.w).toBe(r.x);
    expect(r.x + r.w).toBe(work.x + work.w);
    expect(l.h).toBe(work.h);
    const t = zoneRect("top", work, bounds)!.rect;
    const b = zoneRect("bottom", work, bounds)!.rect;
    expect(t.y + t.h).toBe(b.y);
    expect(b.y + b.h).toBe(work.y + work.h);
  });
  it("los cuartos son 4 rectángulos que no se pisan y cubren todo", () => {
    const q = (["tl", "tr", "bl", "br"] as const).map((z) => zoneRect(z, work, bounds)!.rect);
    expect(q.reduce((a, r) => a + r.w * r.h, 0)).toBe(work.w * work.h);
    expect(q[0]).toMatchObject({ x: 0, y: 0 });
    expect(q[3]!.x + q[3]!.w).toBe(work.w);
    expect(q[3]!.y + q[3]!.h).toBe(work.h);
  });
  it("con origen negativo (pantalla a la izquierda del escritorio)", () => {
    const w = { x: -1920, y: 0, w: 1920, h: 1040 };
    expect(zoneRect("right", w, { ...w, h: 1080 })!.rect).toEqual({ x: -960, y: 0, w: 960, h: 1040 });
  });
});
