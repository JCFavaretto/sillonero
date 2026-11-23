import { describe, expect, it } from "vitest";
import { DEFAULT_WS_PORT, PROTOCOL_VERSION } from "../src/index";

describe("protocol smoke", () => {
  it("expone la versión y el puerto por defecto", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(DEFAULT_WS_PORT).toBe(47800);
  });
});
