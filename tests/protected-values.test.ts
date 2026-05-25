import { describe, it, expect } from "bun:test";
import type { ProtectedValue, ProtectedRecord } from "../models/protected-value.model";

describe("ProtectedValue types", () => {
  it("can assign a protected value", () => {
    const pv: ProtectedValue = { type: "protected", value: "ENC:v1:abc" };
    expect(pv.type).toBe("protected");
  });

  it("can assign an env value with prefix", () => {
    const pv: ProtectedValue = { type: "env", value: "MY_TOKEN", prefix: "Bearer " };
    expect(pv.type).toBe("env");
  });

  it("can build a ProtectedRecord", () => {
    const rec: ProtectedRecord = {
      Authorization: { type: "env", value: "API_TOKEN", prefix: "Bearer " },
      Accept: "application/json",
    };
    expect(rec.Accept).toBe("application/json");
  });
});
