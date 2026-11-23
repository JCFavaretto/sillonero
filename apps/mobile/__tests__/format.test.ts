import { formatGB, formatUptime } from "@/format";

describe("formatUptime", () => {
  it.each([
    [0, "menos de 1 min"],
    [59, "menos de 1 min"],
    [60, "1 min"],
    [3599, "59 min"],
    [3600, "1 h"],
    [8100, "2 h 15 min"],
    [86_400, "1 d"],
    [90_000, "1 d 1 h"],
    [183_600, "2 d 3 h"],
  ])("%i s → %s", (sec, text) => {
    expect(formatUptime(sec)).toBe(text);
  });

  it("las unidades se pueden cambiar (i18n)", () => {
    const en = { day: "day", hour: "hr", minute: "m", lessThanMinute: "under 1 m" };
    expect(formatUptime(183_600, en)).toBe("2 day 3 hr");
    expect(formatUptime(8100, en)).toBe("2 hr 15 m");
    expect(formatUptime(5, en)).toBe("under 1 m");
  });

  it("valores inválidos dan 0", () => {
    expect(formatUptime(-5)).toBe("menos de 1 min");
    expect(formatUptime(NaN)).toBe("menos de 1 min");
  });
});

describe("formatGB", () => {
  it("usa una cifra decimal con coma", () => {
    expect(formatGB(10_500_000_000)).toBe("9,8");
    expect(formatGB(17_179_869_184)).toBe("16,0");
    expect(formatGB(0)).toBe("0,0");
  });
});

import { formatDate } from "@/format";

describe("formatDate", () => {
  it("da día/mes/año", () => {
    expect(formatDate("2026-11-06T12:00:00.000Z")).toBe("06/11/2026");
    expect(formatDate("2026-01-05T12:00:00.000Z")).toBe("05/01/2026");
  });
  it("con texto inválido devuelve vacío", () => {
    expect(formatDate("ayer")).toBe("");
  });
});
