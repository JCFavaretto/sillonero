import { describe, expect, it } from "vitest";
import { buttonBuffer, INPUT_SIZE, keysBuffer, moveAbsBuffer, textBuffer, wheelBuffer } from "../src/platform/win/inputBuffers";

const u32 = (b: Buffer, o: number) => b.readUInt32LE(o);

describe("INPUT de 40 bytes (x64)", () => {
  it("el mouse absoluto: tipo 0, dx/dy en 8 y 12, flags MOVE|ABSOLUTE|VIRTUALDESK en 20", () => {
    const b = moveAbsBuffer(1000, 65535);
    expect(b.length).toBe(INPUT_SIZE);
    expect(u32(b, 0)).toBe(0);
    expect(b.readInt32LE(8)).toBe(1000);
    expect(b.readInt32LE(12)).toBe(65535);
    expect(u32(b, 20)).toBe(0x0001 | 0x8000 | 0x4000);
  });

  it("rechaza coordenadas fuera de 0–65535 y decimales", () => {
    expect(() => moveAbsBuffer(-1, 0)).toThrow();
    expect(() => moveAbsBuffer(65536, 0)).toThrow();
    expect(() => moveAbsBuffer(1.5, 0)).toThrow();
  });

  it("clic izquierdo = abajo y arriba en el mismo buffer; down y up van solos", () => {
    const click = buttonBuffer("left", "click");
    expect(click.length).toBe(2 * INPUT_SIZE);
    expect(u32(click, 20)).toBe(0x0002);
    expect(u32(click, INPUT_SIZE + 20)).toBe(0x0004);
    expect(u32(buttonBuffer("left", "down"), 20)).toBe(0x0002);
    expect(u32(buttonBuffer("left", "up"), 20)).toBe(0x0004);
    expect(u32(buttonBuffer("right", "click"), 20)).toBe(0x0008);
    expect(u32(buttonBuffer("right", "click"), INPUT_SIZE + 20)).toBe(0x0010);
  });

  it("clic del medio (la rueda): MIDDLEDOWN 0x20 y MIDDLEUP 0x40", () => {
    const b = buttonBuffer("middle", "click");
    expect(b.length).toBe(2 * INPUT_SIZE);
    expect(u32(b, 20)).toBe(0x0020);
    expect(u32(b, INPUT_SIZE + 20)).toBe(0x0040);
  });

  it("rueda: WHEEL vertical y HWHEEL horizontal, con signo", () => {
    const v = wheelBuffer(0, -120);
    expect(v.length).toBe(INPUT_SIZE);
    expect(u32(v, 20)).toBe(0x0800);
    expect(v.readInt32LE(16)).toBe(-120);
    const both = wheelBuffer(60, 30);
    expect(both.length).toBe(2 * INPUT_SIZE);
    expect(u32(both, 20)).toBe(0x0800);
    expect(u32(both, INPUT_SIZE + 20)).toBe(0x1000);
    expect(wheelBuffer(0, 0).length).toBe(0);
    expect(() => wheelBuffer(0, 5000)).toThrow();
  });

  it("teclas: tipo 1, wVk en 8, flags en 12 (KEYUP = 2, EXTENDED = 1)", () => {
    const b = keysBuffer([[0x25, false, true], [0x25, true, true], [0x41, false, false]]);
    expect(b.length).toBe(3 * INPUT_SIZE);
    expect(u32(b, 0)).toBe(1);
    expect(b.readUInt16LE(8)).toBe(0x25);
    expect(u32(b, 12)).toBe(0x1);
    expect(u32(b, INPUT_SIZE + 12)).toBe(0x3);
    expect(u32(b, 2 * INPUT_SIZE + 12)).toBe(0);
  });

  it("rechaza un código de tecla fuera de 1–254", () => {
    expect(() => keysBuffer([[0, false, false]])).toThrow();
    expect(() => keysBuffer([[255, false, false]])).toThrow();
  });

  it("texto: wVk 0, wScan = la unidad, flags UNICODE (4) y UNICODE|KEYUP (6)", () => {
    const b = textBuffer([0xf1, 0xd83d]);
    expect(b.length).toBe(4 * INPUT_SIZE);
    expect(b.readUInt16LE(8)).toBe(0);
    expect(b.readUInt16LE(10)).toBe(0xf1);
    expect(u32(b, 12)).toBe(0x4);
    expect(u32(b, INPUT_SIZE + 12)).toBe(0x6);
    expect(b.readUInt16LE(2 * INPUT_SIZE + 10)).toBe(0xd83d);
  });

  it("rechaza una unidad de texto fuera de 0–0xFFFF", () => {
    expect(() => textBuffer([0x10000])).toThrow();
    expect(() => textBuffer([-1])).toThrow();
  });
});
