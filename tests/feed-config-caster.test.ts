import { describe, it, expect } from "bun:test";
import { castFeedFormDataToFeedConfig } from "../utilities/feed-config-caster.utility";
import type { WebScrapingFeedConfig, RestFeedConfig, EmailFeedConfig } from "../models/feed-config.model";
import { isProtectedValue } from "../utilities/protected-values.utility";

const KEY = "a18c1fd2211edd76a18c1fd2211edd76";

type FeedFormData = Record<string, unknown>;

const baseFormData = {
  feedName: "Test Feed",
  refreshTime: 10,
  reverse: false,
  strict: false,
  advanced: false,
  headers: {},
  cookies: [],
};

describe("castFeedFormDataToFeedConfig — webScraping", () => {
  it("produces schemaVersion 2", () => {
    const data = { ...baseFormData, feedType: "webScraping", feedUrl: "https://x.com", itemSelector: "li" };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY });
    expect(result.schemaVersion).toBe(2);
  });

  it("assigns a feedId when not provided", () => {
    const data = { ...baseFormData, feedType: "webScraping", feedUrl: "https://x.com", itemSelector: "li" };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY });
    expect(typeof result.feedId).toBe("string");
    expect(result.feedId.length).toBeGreaterThan(0);
  });

  it("uses provided feedId", () => {
    const data = { ...baseFormData, feedType: "webScraping" as const, feedUrl: "https://x.com", itemSelector: "li" };
    const result = castFeedFormDataToFeedConfig(data, { feedId: "my-id", encryptionKey: KEY });
    expect(result.feedId).toBe("my-id");
  });

  it("maps feedUrl to config.baseUrl", () => {
    const data = { ...baseFormData, feedType: "webScraping" as const, feedUrl: "https://x.com", itemSelector: "article" };
    const result = castFeedFormDataToFeedConfig(data as FeedFormData, { encryptionKey: KEY }) as WebScrapingFeedConfig;
    expect(result.config.baseUrl).toBe("https://x.com");
  });

  it("maps itemSelector to article.iterator.selector", () => {
    const data = { ...baseFormData, feedType: "webScraping" as const, feedUrl: "https://x.com", itemSelector: "article.card" };
    const result = castFeedFormDataToFeedConfig(data as FeedFormData, { encryptionKey: KEY }) as WebScrapingFeedConfig;
    expect(result.article.iterator?.selector).toBe("article.card");
  });
});

describe("castFeedFormDataToFeedConfig — api → rest", () => {
  it("converts feedType api to rest", () => {
    const data = { ...baseFormData, feedType: "api", feedUrl: "https://api.com", apiItemsPath: "data" };
    const result = castFeedFormDataToFeedConfig(data as FeedFormData, { encryptionKey: KEY });
    expect(result.feedType).toBe("rest");
  });

  it("maps apiItemsPath to apiMapping.items", () => {
    const data = { ...baseFormData, feedType: "api", feedUrl: "https://api.com", apiItemsPath: "results" };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY }) as RestFeedConfig;
    expect(result.apiMapping.items).toBe("results");
  });
});

describe("castFeedFormDataToFeedConfig — email", () => {
  it("writes password as ProtectedValue, not encryptedPassword", () => {
    const data = {
      ...baseFormData,
      feedType: "email",
      emailHost: "imap.gmail.com",
      emailPort: 993,
      emailUsername: "user@gmail.com",
      emailPassword: "my-password",
      emailFolder: "INBOX",
      emailCount: 10,
    };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY }) as EmailFeedConfig;
    expect(isProtectedValue(result.config.password)).toBe(true);
    expect(result.config.encryptedPassword).toBeUndefined();
  });
});

describe("castFeedFormDataToFeedConfig — protected headers", () => {
  it("encrypts a new protected header value", () => {
    const data = {
      ...baseFormData,
      feedType: "webScraping" as const,
      feedUrl: "https://x.com",
      itemSelector: "li",
      headers: { Authorization: { type: "protected" as const, value: "my-token" } },
    };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY }) as WebScrapingFeedConfig;
    const authHeader = result.headers?.Authorization;
    expect(isProtectedValue(authHeader)).toBe(true);
    expect((authHeader as { value: string }).value).not.toBe("my-token");
  });

  it("leaves a masked ******** header value unchanged (preserving existing ciphertext)", () => {
    const data = {
      ...baseFormData,
      feedType: "webScraping" as const,
      feedUrl: "https://x.com",
      itemSelector: "li",
      headers: { Authorization: { type: "protected" as const, value: "********" } },
    };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY }) as WebScrapingFeedConfig;
    const authHeader = result.headers?.Authorization;
    expect((authHeader as { value: string }).value).toBe("********");
  });
});
