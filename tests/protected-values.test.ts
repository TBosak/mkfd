import { describe, it, expect } from "bun:test";
import type { ProtectedValue, ProtectedRecord } from "../models/protected-value.model";
import {
  isProtectedValue,
  protectValue,
  envValue,
} from "../utilities/protected-values.utility";

const TEST_KEY = "a18c1fd2211edd76a18c1fd2211edd76";

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

describe("isProtectedValue", () => {
  it("returns true for protected type", () => {
    expect(isProtectedValue({ type: "protected", value: "ENC:abc" })).toBe(true);
  });
  it("returns true for env type", () => {
    expect(isProtectedValue({ type: "env", value: "MY_VAR" })).toBe(true);
  });
  it("returns false for a plain string", () => {
    expect(isProtectedValue("plain")).toBe(false);
  });
  it("returns false for null", () => {
    expect(isProtectedValue(null)).toBe(false);
  });
  it("returns false for object without type field", () => {
    expect(isProtectedValue({ value: "x" })).toBe(false);
  });
});

describe("protectValue", () => {
  it("returns a protected object with encrypted value", () => {
    const result = protectValue("my-secret", TEST_KEY);
    expect(result.type).toBe("protected");
    expect(result.value).not.toBe("my-secret");
    expect(typeof result.value).toBe("string");
  });
});

describe("envValue", () => {
  it("creates env reference with prefix", () => {
    const result = envValue("MY_TOKEN", "Bearer ");
    expect(result).toEqual({ type: "env", value: "MY_TOKEN", prefix: "Bearer " });
  });
  it("creates env reference without prefix", () => {
    const result = envValue("MY_TOKEN");
    expect(result).toEqual({ type: "env", value: "MY_TOKEN", prefix: undefined });
  });
});
