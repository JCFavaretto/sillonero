import { clockText, positionAt } from "@/audio/progress";

// D97: la PC manda por dónde iba cuando armó el mensaje; el celu avanza la barra solo mientras reproduce.
const T = { positionMs: 60_000, durationMs: 243_000, rate: 1 };

describe("positionAt: por dónde va ahora", () => {
  it("reproduciendo: suma el tiempo que pasó desde que llegó el dato, por la velocidad", () => {
    expect(positionAt(T, true, 0)).toBe(60_000);
    expect(positionAt(T, true, 5_000)).toBe(65_000);
    expect(positionAt({ ...T, rate: 2 }, true, 5_000)).toBe(70_000);
  });

  it("en pausa no avanza", () => {
    expect(positionAt(T, false, 60_000)).toBe(60_000);
  });

  it("no pasa del final ni baja de cero, aunque el reloj del celu salte", () => {
    expect(positionAt(T, true, 999_999)).toBe(243_000);
    expect(positionAt(T, true, -5_000)).toBe(60_000);
  });
});

describe("clockText: minutos y segundos", () => {
  it("menos de una hora: m:ss", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(82_000)).toBe("1:22");
    expect(clockText(59_999)).toBe("0:59");
    expect(clockText(600_000)).toBe("10:00");
  });

  it("una hora o más: h:mm:ss", () => {
    expect(clockText(3_600_000)).toBe("1:00:00");
    expect(clockText(3_723_000)).toBe("1:02:03");
  });

  it("valores raros no rompen", () => {
    expect(clockText(-1)).toBe("0:00");
    expect(clockText(Number.NaN)).toBe("0:00");
  });
});
