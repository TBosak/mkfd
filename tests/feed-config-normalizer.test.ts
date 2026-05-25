import { describe, it, expect } from "bun:test";
import type { FeedMetadata, FeedConfigOrigin } from "../models/feed-metadata.model";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
import type {
  FeedConfig,
  WebScrapingFeedConfig,
  RestFeedConfig,
  EmailFeedConfig,
  defaultFeedRssMetadata,
} from "../models/feed-config.model";
import { defaultFeedRssMetadata as defaults } from "../models/feed-config.model";

describe("FeedMetadata types", () => {
  it("accepts a local origin", () => {
    const origin: FeedConfigOrigin = { type: "local" };
    expect(origin.type).toBe("local");
  });

  it("accepts a community origin with catalogId", () => {
    const origin: FeedConfigOrigin = {
      type: "community",
      catalogId: "github-releases",
      importedAt: "2026-05-22T00:00:00Z",
    };
    expect(origin.catalogId).toBe("github-releases");
  });

  it("accepts a FeedMetadata with tags and category", () => {
    const meta: FeedMetadata = {
      title: "My Feed",
      tags: ["news", "local"],
      category: "civic",
      favorite: true,
    };
    expect(meta.tags).toHaveLength(2);
  });
});

describe("defaultFeedRssMetadata", () => {
  it("has feedGenerator set to MkFD Feed Generator", () => {
    expect(defaults.feedGenerator).toBe("MkFD Feed Generator");
  });
  it("has feedDocs set to rssboard.org", () => {
    expect(defaults.feedDocs).toBe("https://www.rssboard.org/rss-specification");
  });
  it("has empty arrays for categories, skipHours, skipDays", () => {
    expect(defaults.feedCategories).toEqual([]);
    expect(defaults.feedSkipHours).toEqual([]);
    expect(defaults.feedSkipDays).toEqual([]);
  });
});

describe("FeedConfig shapes", () => {
  it("WebScrapingFeedConfig has config and article", () => {
    const config: WebScrapingFeedConfig = {
      feedId: "abc",
      feedName: "test",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://example.com" },
      article: { iterator: { selector: "article" } },
    };
    expect(config.feedType).toBe("webScraping");
  });

  it("RestFeedConfig has config and apiMapping", () => {
    const config: RestFeedConfig = {
      feedId: "def",
      feedName: "api",
      feedType: "rest",
      refreshTime: 5,
      config: { baseUrl: "https://api.example.com" },
      apiMapping: { items: "data" },
    };
    expect(config.feedType).toBe("rest");
  });
});

describe("normalizeLoadedFeedConfig", () => {
  it("normalizes a legacy webScraping config without schemaVersion", () => {
    const raw = {
      feedId: "test-ws",
      feedName: "Test Feed",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://example.com" },
      article: { iterator: { selector: "article" } },
    };
    const result = normalizeLoadedFeedConfig(raw);
    expect(result.feedType).toBe("webScraping");
    expect(result.feedId).toBe("test-ws");
    expect(result.enabled).toBe(true);
  });

  it("mirrors article.pubDate onto article.date", () => {
    const raw = {
      feedId: "d1",
      feedName: "F",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" }, pubDate: { selector: "time" } },
    };
    const result = normalizeLoadedFeedConfig(raw) as import("../models/feed-config.model").WebScrapingFeedConfig;
    expect(result.article.date).toBeDefined();
    expect(result.article.date).toEqual(result.article.pubDate);
  });

  it("mirrors article.date onto article.pubDate", () => {
    const raw = {
      feedId: "d2",
      feedName: "F",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" }, date: { selector: "time" } },
    };
    const result = normalizeLoadedFeedConfig(raw) as import("../models/feed-config.model").WebScrapingFeedConfig;
    expect(result.article.pubDate).toEqual(result.article.date);
  });

  it("normalizes a legacy api config", () => {
    const raw = {
      feedId: "api-1",
      feedName: "API Feed",
      feedType: "api",
      refreshTime: 5,
      config: { baseUrl: "https://api.com" },
      apiMapping: { items: "data" },
    };
    const result = normalizeLoadedFeedConfig(raw);
    expect(result.feedType).toBe("api");
  });

  it("fills missing enabled with true", () => {
    const raw = {
      feedId: "x",
      feedName: "X",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" } },
    };
    expect(normalizeLoadedFeedConfig(raw).enabled).toBe(true);
  });

  it("fills missing refreshTime with 5", () => {
    const raw = {
      feedId: "x",
      feedName: "X",
      feedType: "webScraping",
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" } },
    };
    expect(normalizeLoadedFeedConfig(raw as any).refreshTime).toBe(5);
  });

  it("applies defaultFeedRssMetadata for missing RSS fields", () => {
    const raw = {
      feedId: "x",
      feedName: "X",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" } },
    };
    const result = normalizeLoadedFeedConfig(raw);
    expect(result.feedGenerator).toBe("MkFD Feed Generator");
    expect(result.feedCategories).toEqual([]);
  });

  it("never throws for unknown feedType", () => {
    const raw = { feedId: "x", feedName: "X", feedType: "unknown", refreshTime: 5 };
    expect(() => normalizeLoadedFeedConfig(raw as any)).not.toThrow();
  });
});
