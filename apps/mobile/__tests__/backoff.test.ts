import { nextDelay } from "@/connection/backoff";

describe("nextDelay", () => {
  const fixed = (x: number) => () => x;

  it("crece 1, 2, 4, 8, 16 y 30 s (con jitter en el medio: 0,8 + 0,4 × 0,5 = 1)", () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => nextDelay(n, fixed(0.5)))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000,
    ]);
  });

  it("nunca pasa de 30 s de base, por más intentos que haya", () => {
    expect(nextDelay(6, fixed(0.5))).toBe(30000);
    expect(nextDelay(50, fixed(0.5))).toBe(30000);
    expect(nextDelay(1000, fixed(0.5))).toBe(30000);
  });

  it("el jitter va de 0,8 a 1,2 veces la base", () => {
    expect(nextDelay(0, fixed(0))).toBe(800);
    expect(nextDelay(0, fixed(1))).toBe(1200);
    expect(nextDelay(3, fixed(0))).toBe(6400);
    expect(nextDelay(3, fixed(1))).toBe(9600);
  });

  it("devuelve enteros (milisegundos)", () => {
    expect(Number.isInteger(nextDelay(2, fixed(0.37)))).toBe(true);
  });

  it("con intentos negativos o raros, se comporta como el primero", () => {
    expect(nextDelay(-3, fixed(0.5))).toBe(1000);
    expect(nextDelay(NaN, fixed(0.5))).toBe(1000);
  });
});
