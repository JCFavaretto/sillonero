import { describe, expect, it } from "vitest";
import { planOrder } from "../src/screens/arrange";

// Tres pantallas como las de Jay: la tele a la izquierda, la principal en el medio y otra a la derecha.
const TELE = { id: "tele", primary: false, enabled: true, bounds: { x: -1920, y: 0, w: 1920, h: 1080 } };
const PRIN = { id: "prin", primary: true, enabled: true, bounds: { x: 0, y: 0, w: 1920, h: 1080 } };
const DER = { id: "der", primary: false, enabled: true, bounds: { x: 1920, y: 0, w: 1920, h: 1080 } };
const OFF = { id: "off", primary: false, enabled: false, bounds: null };

describe("planOrder", () => {
  it("el mismo orden que ya tienen deja todo en su lugar", () => {
    const p = planOrder([TELE, PRIN, DER], ["tele", "prin", "der"])!;
    expect(p.get("tele")).toEqual({ x: -1920, y: 0 });
    expect(p.get("prin")).toEqual({ x: 0, y: 0 });
    expect(p.get("der")).toEqual({ x: 1920, y: 0 });
  });

  it("mandar la tele a la derecha de todo: la principal sigue en (0,0)", () => {
    const p = planOrder([TELE, PRIN, DER], ["prin", "der", "tele"])!;
    expect(p.get("prin")).toEqual({ x: 0, y: 0 });
    expect(p.get("der")).toEqual({ x: 1920, y: 0 });
    expect(p.get("tele")).toEqual({ x: 3840, y: 0 });
  });

  it("la principal en el medio de las tres: una a cada lado", () => {
    const p = planOrder([TELE, PRIN, DER], ["der", "prin", "tele"])!;
    expect(p.get("der")).toEqual({ x: -1920, y: 0 });
    expect(p.get("prin")).toEqual({ x: 0, y: 0 });
    expect(p.get("tele")).toEqual({ x: 1920, y: 0 });
  });

  it("la principal a la izquierda de todo: las demás van a su derecha", () => {
    const p = planOrder([TELE, PRIN, DER], ["prin", "tele", "der"])!;
    expect(p.get("prin")).toEqual({ x: 0, y: 0 });
    expect(p.get("tele")).toEqual({ x: 1920, y: 0 });
    expect(p.get("der")).toEqual({ x: 3840, y: 0 });
  });

  it("con anchos distintos, cada una empieza donde termina la anterior (sin huecos ni solapes)", () => {
    const grande = { ...DER, id: "grande", bounds: { x: 1920, y: 0, w: 2560, h: 1440 } };
    const p = planOrder([TELE, PRIN, grande], ["grande", "tele", "prin"])!;
    expect(p.get("grande")).toEqual({ x: -4480, y: 0 }); // 2560 + 1920 a la izquierda de la principal
    expect(p.get("tele")).toEqual({ x: -1920, y: 0 });
    expect(p.get("prin")).toEqual({ x: 0, y: 0 });
  });

  it("conserva el desnivel vertical de cada pantalla respecto de la principal", () => {
    const alta = { ...TELE, bounds: { x: -1920, y: -300, w: 1920, h: 1080 } };
    const p = planOrder([alta, PRIN, DER], ["prin", "der", "tele"])!;
    expect(p.get("tele")).toEqual({ x: 3840, y: -300 });
    expect(p.get("prin")!.y).toBe(0);
  });

  it("las apagadas no cuentan y no aparecen en el resultado", () => {
    const p = planOrder([TELE, PRIN, OFF], ["prin", "tele"])!;
    expect([...p.keys()].sort()).toEqual(["prin", "tele"]);
  });

  it.each([
    ["falta una pantalla prendida", ["prin", "tele"]],
    ["sobra una desconocida", ["prin", "tele", "der", "otra"]],
    ["una apagada", ["prin", "tele", "der", "off"]],
    ["repetida", ["prin", "prin", "tele"]],
    ["vacío", []],
  ])("orden inválido (%s) → null", (_n, order) => {
    expect(planOrder([TELE, PRIN, DER, OFF], order)).toBeNull();
  });

  it("sin pantalla principal entre las prendidas → null (Windows siempre la tiene en 0,0)", () => {
    expect(planOrder([{ ...PRIN, primary: false }, TELE], ["tele", "prin"])).toBeNull();
  });

  it("una sola pantalla: el orden trivial no cambia nada", () => {
    const p = planOrder([PRIN], ["prin"])!;
    expect(p.get("prin")).toEqual({ x: 0, y: 0 });
  });
});
