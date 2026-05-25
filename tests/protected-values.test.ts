import { describe, it, expect } from "bun:test";
import type { ProtectedValue, ProtectedRecord } from "../models/protected-value.model";
import {
  isProtectedValue,
  protectValue,
  envValue,
  resolveProtectedValue,
  resolveProtectedValues,
  maskProtectedValues,
  preserveMaskedProtectedValues,
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

describe("resolveProtectedValue", () => {
  it("decrypts a protected value back to plaintext", () => {
    const pv = protectValue("my-secret", TEST_KEY);
    expect(resolveProtectedValue(pv, TEST_KEY)).toBe("my-secret");
  });

  it("resolves an env value with prefix", () => {
    process.env.TEST_RESOLVE_TOKEN = "abc123";
    const pv = envValue("TEST_RESOLVE_TOKEN", "Bearer ");
    expect(resolveProtectedValue(pv, TEST_KEY)).toBe("Bearer abc123");
    delete process.env.TEST_RESOLVE_TOKEN;
  });

  it("resolves an env value without prefix", () => {
    process.env.TEST_PLAIN_TOKEN = "xyz";
    const pv = envValue("TEST_PLAIN_TOKEN");
    expect(resolveProtectedValue(pv, TEST_KEY)).toBe("xyz");
    delete process.env.TEST_PLAIN_TOKEN;
  });

  it("throws when env var is missing", () => {
    delete process.env.MISSING_VAR;
    expect(() => resolveProtectedValue(envValue("MISSING_VAR"), TEST_KEY)).toThrow(
      "Missing environment variable: MISSING_VAR",
    );
  });
});

describe("resolveProtectedValues", () => {
  it("passes plain strings through unchanged", () => {
    expect(resolveProtectedValues("plain", { encryptionKey: TEST_KEY })).toBe("plain");
  });

  it("resolves a top-level ProtectedValue", () => {
    const pv = protectValue("top-secret", TEST_KEY);
    expect(resolveProtectedValues(pv, { encryptionKey: TEST_KEY })).toBe("top-secret");
  });

  it("resolves protected values nested inside an object", () => {
    process.env.TEST_HEADER_TOKEN = "token-value";
    const input = {
      Accept: "application/json",
      Authorization: envValue("TEST_HEADER_TOKEN", "Bearer "),
    };
    const result = resolveProtectedValues(input, { encryptionKey: TEST_KEY });
    expect(result.Accept).toBe("application/json");
    expect(result.Authorization).toBe("Bearer token-value");
    delete process.env.TEST_HEADER_TOKEN;
  });

  it("resolves protected values inside arrays", () => {
    process.env.TEST_ARR_TOKEN = "arr-value";
    const input = ["plain", envValue("TEST_ARR_TOKEN")];
    const result = resolveProtectedValues(input, { encryptionKey: TEST_KEY });
    expect(result[0]).toBe("plain");
    expect(result[1]).toBe("arr-value");
    delete process.env.TEST_ARR_TOKEN;
  });
});

describe("maskProtectedValues", () => {
  it("replaces protected value's value with ********", () => {
    const pv = protectValue("real-secret", TEST_KEY);
    const masked = maskProtectedValues(pv) as { type: string; value: string };
    expect(masked.type).toBe("protected");
    expect(masked.value).toBe("********");
  });

  it("masks nested protected values in objects", () => {
    const input = { Authorization: protectValue("token", TEST_KEY), Accept: "text/html" };
    const masked = maskProtectedValues(input) as typeof input;
    expect((masked.Authorization as { value: string }).value).toBe("********");
    expect(masked.Accept).toBe("text/html");
  });

  it("leaves plain strings untouched", () => {
    expect(maskProtectedValues("plain")).toBe("plain");
  });

  it("masks inside arrays", () => {
    const input = [protectValue("secret", TEST_KEY), "plain"];
    const masked = maskProtectedValues(input) as Array<unknown>;
    expect((masked[0] as { value: string }).value).toBe("********");
    expect(masked[1]).toBe("plain");
  });
});

describe("preserveMaskedProtectedValues", () => {
  it("restores original ciphertext when incoming value is ********", () => {
    const original = protectValue("real-secret", TEST_KEY);
    const incoming = { type: "protected" as const, value: "********" };
    const result = preserveMaskedProtectedValues(incoming, original);
    expect(result).toEqual(original);
  });

  it("keeps new ciphertext when incoming is not ********", () => {
    const original = protectValue("old-secret", TEST_KEY);
    const newPv = protectValue("new-secret", TEST_KEY);
    const result = preserveMaskedProtectedValues(newPv, original);
    expect(result).toEqual(newPv);
  });

  it("works recursively on objects", () => {
    const existing = { Authorization: protectValue("real-token", TEST_KEY) };
    const incoming = { Authorization: { type: "protected" as const, value: "********" } };
    const result = preserveMaskedProtectedValues(incoming, existing) as typeof existing;
    expect((result.Authorization as { value: string }).value).toBe(
      (existing.Authorization as { value: string }).value,
    );
  });

  it("passes through plain strings unchanged", () => {
    expect(preserveMaskedProtectedValues("plain", "old")).toBe("plain");
  });

  it("returns the masked sentinel when existing is undefined (new field, no prior value)", () => {
    const incoming = { type: "protected" as const, value: "********" };
    const result = preserveMaskedProtectedValues(incoming, undefined as any);
    expect((result as { value: string }).value).toBe("********");
  });
});
