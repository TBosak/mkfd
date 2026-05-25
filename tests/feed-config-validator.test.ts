import { describe, it, expect } from "bun:test";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";

function makeWS(overrides: Record<string, unknown> = {}) {
  return normalizeLoadedFeedConfig({
    feedId: "test-id",
    feedName: "Test",
    feedType: "webScraping",
    refreshTime: 5,
    config: { baseUrl: "https://example.com" },
    article: { iterator: { selector: "article" } },
    ...overrides,
  });
}

describe("validateFeedConfig — global checks", () => {
  it("passes a valid webScraping config", () => {
    const result = validateFeedConfig(makeWS());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when feedId is missing", () => {
    const result = validateFeedConfig(makeWS({ feedId: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "feedId")).toBe(true);
  });

  it("errors when feedId contains invalid characters", () => {
    const config = makeWS({ feedId: "my feed!" });
    const result = validateFeedConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "feedId")).toBe(true);
  });

  it("errors when feedName is missing", () => {
    const result = validateFeedConfig(makeWS({ feedName: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "feedName")).toBe(true);
  });

  it("errors when refreshTime is zero", () => {
    const config = { ...makeWS(), refreshTime: 0 };
    const result = validateFeedConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "refreshTime")).toBe(true);
  });
});

describe("validateFeedConfig — webScraping", () => {
  it("errors when config.baseUrl is missing", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "x", feedName: "X", feedType: "webScraping", refreshTime: 5,
      config: {}, article: { iterator: { selector: "li" } },
    });
    const result = validateFeedConfig(config);
    expect(result.errors.some((e) => e.path === "config.baseUrl")).toBe(true);
  });

  it("errors when article.iterator.selector is missing", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "x", feedName: "X", feedType: "webScraping", refreshTime: 5,
      config: { baseUrl: "https://x.com" }, article: { iterator: {} },
    });
    const result = validateFeedConfig(config);
    expect(result.errors.some((e) => e.path === "article.iterator.selector")).toBe(true);
  });
});

describe("validateFeedConfig — rest/api", () => {
  it("passes with no apiMapping.items (root-is-array behaviour)", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "r1", feedName: "REST", feedType: "rest", refreshTime: 5,
      config: { baseUrl: "https://api.com" }, apiMapping: {},
    });
    expect(validateFeedConfig(config).valid).toBe(true);
  });

  it("errors when config.baseUrl is missing for rest", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "r1", feedName: "REST", feedType: "rest", refreshTime: 5,
      config: {}, apiMapping: {},
    });
    expect(validateFeedConfig(config).valid).toBe(false);
  });
});

describe("validateFeedConfig — email", () => {
  it("errors when email host is missing", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "e1", feedName: "Email", feedType: "email", refreshTime: 5,
      config: { host: "", port: 993, user: "u", folder: "INBOX", emailCount: 10, encryptedPassword: "enc" },
    });
    const result = validateFeedConfig(config);
    expect(result.errors.some((e) => e.path === "config.host")).toBe(true);
  });

  it("errors when no password or encryptedPassword", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "e1", feedName: "Email", feedType: "email", refreshTime: 5,
      config: { host: "imap.gmail.com", port: 993, user: "u@g.com", folder: "INBOX", emailCount: 10 },
    });
    const result = validateFeedConfig(config);
    expect(result.errors.some((e) => e.path === "config.password")).toBe(true);
  });
});

describe("validateFeedConfig — warnings", () => {
  it("warns on plain Authorization header", () => {
    const config = makeWS({ headers: { Authorization: "Bearer plain-token" } });
    const result = validateFeedConfig(config);
    expect(result.warnings.some((w) => w.path.includes("Authorization"))).toBe(true);
  });
});
