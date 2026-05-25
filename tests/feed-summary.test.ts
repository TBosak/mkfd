import { describe, it, expect } from "bun:test";
import { normalizeFeedType, detectSecrets, buildFeedSummary, toRelative } from "../utilities/feed-summary.utility";

describe("normalizeFeedType", () => {
  it("maps webScraping -> scrape", () => expect(normalizeFeedType("webScraping")).toBe("scrape"));
  it("maps api -> rest", () => expect(normalizeFeedType("api")).toBe("rest"));
  it("maps rest -> rest", () => expect(normalizeFeedType("rest")).toBe("rest"));
  it("maps email -> email", () => expect(normalizeFeedType("email")).toBe("email"));
  it("maps graphql -> graphql", () => expect(normalizeFeedType("graphql")).toBe("graphql"));
  it("maps calendar -> calendar", () => expect(normalizeFeedType("calendar")).toBe("calendar"));
  it("maps sitemap -> sitemap", () => expect(normalizeFeedType("sitemap")).toBe("sitemap"));
  it("maps filesystem -> filesystem", () => expect(normalizeFeedType("filesystem")).toBe("filesystem"));
  it("maps webhook -> webhook", () => expect(normalizeFeedType("webhook")).toBe("webhook"));
  it("unknown type falls back to scrape", () => expect(normalizeFeedType("unknown")).toBe("scrape"));
});

describe("detectSecrets", () => {
  it("detects protected value", () => {
    const config: any = { config: { headers: { Authorization: { type: "protected", value: "x" } } } };
    expect(detectSecrets(config).protected).toBe(true);
  });
  it("detects env var", () => {
    const config: any = { config: { headers: { Authorization: { type: "env", key: "API_KEY" } } } };
    expect(detectSecrets(config).env).toBe(true);
  });
  it("detects plain sensitive value", () => {
    const config: any = { config: { headers: { Authorization: "Bearer hardcoded" } } };
    expect(detectSecrets(config).plain).toBe(true);
  });
  it("returns all false for clean config", () => {
    const config: any = { config: { baseUrl: "https://example.com" } };
    const s = detectSecrets(config);
    expect(s.protected).toBe(false);
    expect(s.env).toBe(false);
    expect(s.plain).toBe(false);
  });
});

describe("buildFeedSummary", () => {
  const file = { id: "my-feed", filename: "my-feed.yaml" };
  const config: any = {
    feedId: "my-feed", feedName: "My Feed", feedType: "webScraping",
    enabled: true, refreshTime: 60, config: { baseUrl: "https://example.com/news" },
  };

  it("returns neverRun when no run log", () => {
    const s = buildFeedSummary(file, config);
    expect(s.status).toBe("neverRun");
    expect(s.lastRunAt).toBeUndefined();
  });
  it("returns error when last run was error", () => {
    const run: any = { feedId: "my-feed", status: "error", startedAt: Date.now() - 60000, itemCount: 0, prevItemCount: 0, errorMessage: "timeout" };
    const s = buildFeedSummary(file, config, run);
    expect(s.status).toBe("error");
    expect(s.statusDetail).toBe("timeout");
  });
  it("returns healthy when last run was success", () => {
    const run: any = { feedId: "my-feed", status: "success", startedAt: Date.now() - 60000, itemCount: 10, prevItemCount: 8 };
    const s = buildFeedSummary(file, config, run);
    expect(s.status).toBe("healthy");
    expect(s.lastNewItemCount).toBe(2);
  });
  it("returns disabled when enabled=false", () => {
    const disabledConfig = { ...config, enabled: false };
    const run: any = { feedId: "my-feed", status: "success", startedAt: Date.now() - 60000, itemCount: 5, prevItemCount: 5 };
    const s = buildFeedSummary(file, disabledConfig, run);
    expect(s.status).toBe("disabled");
  });
  it("maps sourceUrl from config.baseUrl for webScraping", () => {
    const s = buildFeedSummary(file, config);
    expect(s.sourceUrl).toBe("https://example.com/news");
  });
  it("uses metadata.title when present", () => {
    const configWithMeta = { ...config, metadata: { title: "Custom Title", tags: [], favorite: false } };
    const s = buildFeedSummary(file, configWithMeta);
    expect(s.title).toBe("Custom Title");
  });
});

describe("toRelative", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(toRelative(new Date(Date.now() - 30000).toISOString())).toBe("just now");
  });
  it("returns minutes ago", () => {
    expect(toRelative(new Date(Date.now() - 5 * 60 * 1000).toISOString())).toBe("5 min ago");
  });
  it("returns hours ago", () => {
    expect(toRelative(new Date(Date.now() - 2 * 3600 * 1000).toISOString())).toBe("2 h ago");
  });
  it("returns days ago", () => {
    expect(toRelative(new Date(Date.now() - 3 * 86400 * 1000).toISOString())).toBe("3 days ago");
  });
});
