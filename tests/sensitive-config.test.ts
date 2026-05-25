// tests/sensitive-config.test.ts
import { describe, it, expect } from "bun:test";
import { isSensitiveConfigPath, findPlainSensitiveValues } from "../utilities/sensitive-config.utility";
import { protectValue, envValue } from "../utilities/protected-values.utility";

const KEY = "a18c1fd2211edd76a18c1fd2211edd76";

describe("isSensitiveConfigPath", () => {
  it("detects Authorization", () => {
    expect(isSensitiveConfigPath("headers.Authorization")).toBe(true);
  });
  it("detects apitoken", () => {
    expect(isSensitiveConfigPath("config.apitoken")).toBe(true);
  });
  it("detects password", () => {
    expect(isSensitiveConfigPath("config.password")).toBe(true);
  });
  it("does not flag baseUrl", () => {
    expect(isSensitiveConfigPath("config.baseUrl")).toBe(false);
  });
  it("does not flag Accept", () => {
    expect(isSensitiveConfigPath("headers.Accept")).toBe(false);
  });
});

describe("findPlainSensitiveValues", () => {
  it("finds a plain Authorization header", () => {
    const findings = findPlainSensitiveValues({ Authorization: "Bearer abc" });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("Authorization");
  });

  it("returns empty for a protected Authorization header", () => {
    const findings = findPlainSensitiveValues({ Authorization: protectValue("token", KEY) });
    expect(findings).toHaveLength(0);
  });

  it("returns empty for an env Authorization header", () => {
    const findings = findPlainSensitiveValues({ Authorization: envValue("MY_TOKEN", "Bearer ") });
    expect(findings).toHaveLength(0);
  });

  it("does not flag a plain non-sensitive header", () => {
    const findings = findPlainSensitiveValues({ Accept: "application/json" });
    expect(findings).toHaveLength(0);
  });

  it("finds nested plain token field", () => {
    const findings = findPlainSensitiveValues({ config: { apiToken: "xyz" } });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("config.apiToken");
  });

  it("does not find anything in an empty object", () => {
    expect(findPlainSensitiveValues({})).toHaveLength(0);
  });
});
