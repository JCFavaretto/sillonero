import { describe, expect, it } from "vitest";
import { DEFAULT_ADMIN_PORT } from "@proyecto-e/protocol";

describe("agent smoke", () => {
  it("resuelve @proyecto-e/protocol desde el workspace", () => {
    expect(DEFAULT_ADMIN_PORT).toBe(47801);
  });
});
