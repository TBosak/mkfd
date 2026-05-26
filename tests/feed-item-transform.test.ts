import { describe, expect, test } from "bun:test";
import { transformFeedItems } from "../utilities/feed-item-transform.utility";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

const now = "2024-01-17T00:00:00Z";
const item = (overrides: Partial<NormalizedFeedItem> = {}): NormalizedFeedItem => ({
  title: "Test Title",
  ...overrides,
});

describe("transformFeedItems", () => {
  test("applies text transforms", () => {
    const result = transformFeedItems({
      items: [item({ description: "<p>Hello   <b>world</b></p>" })],
      config: { description: { stripHtml: true, normalizeWhitespace: true, prefix: ">", truncateCharacters: 20 } },
      fetchedAt: now,
    });
    expect(result.items[0].description).toBe(">Hello world");
  });

  test("uses fallbackFrom when text is missing", () => {
    const result = transformFeedItems({
      items: [item({ description: undefined, content: "From content" })],
      config: { description: { fallbackFrom: ["content"] } },
      fetchedAt: now,
    });
    expect(result.items[0].description).toBe("From content");
  });

  test("cleans links", () => {
    const result = transformFeedItems({
      items: [item({ link: "http://example.com/post?utm_source=x&id=123&ref=abc" })],
      config: { link: { forceHttps: true, removeTrackingParams: true, allowedParams: ["id"] } },
      fetchedAt: now,
    });
    expect(result.items[0].link).toBe("https://example.com/post?id=123");
  });

  test("resolves guid and date strategies", () => {
    const result = transformFeedItems({
      items: [item({ guid: undefined, link: "https://example.com/post", pubDate: undefined, updatedDate: undefined })],
      config: { guidStrategy: "existingOrLinkHash", dateStrategy: "publishedOrUpdatedOrFetched" },
      fetchedAt: now,
    });
    expect(result.items[0].guid).toBe("https://example.com/post");
    expect(result.items[0].pubDate).toBe(now);
  });
});
