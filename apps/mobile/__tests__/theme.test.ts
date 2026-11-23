import { colors, fonts, motion, radius, type } from "@/theme";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("theme tokens (boceto diseno/01)", () => {
  it("uses the approved palette", () => {
    expect(colors.background).toBe("#17161D");
    expect(colors.accent).toBe("#F5A524");
    expect(colors.ok).toBe("#3DD6A3");
  });
  it.each([
    ["text on background", colors.text, colors.background],
    ["muted on background", colors.muted, colors.background],
    ["muted on surface", colors.muted, colors.surface],
    ["accent on background", colors.accent, colors.background],
    ["accentText on accent", colors.accentText, colors.accent],
    ["danger on dangerBg", colors.danger, colors.dangerBg],
  ])("passes AA contrast: %s", (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("defines fonts, radii and motion", () => {
    expect(fonts.display).toContain("Condensed");
    expect(fonts.mono).toContain("Mono");
    expect(radius.key).toBe(14);
    expect(radius.sheet).toBe(24);
    expect(motion).toMatchObject({ fast: 120, base: 220, slow: 300 });
    expect(type.data.fontFamily).toBe(fonts.mono);
  });
});
