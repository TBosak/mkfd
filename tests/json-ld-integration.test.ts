import { describe, expect, test } from "bun:test";
import { extractJsonLdItemsFromHtml } from "../utilities/json-ld-extractor.utility";
import { buildFeedObject } from "../utilities/rss-builder.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";

const html = `
  <html><head>
    <script type="application/ld+json">
      {
        "@type": "NewsArticle",
        "headline": "JSON-LD headline",
        "description": "Structured summary",
        "url": "/items/1",
        "datePublished": "2026-05-25T12:00:00Z",
        "author": { "name": "Reporter" },
        "keywords": ["mkfd", "feeds"]
      }
    </script>
  </head><body></body></html>
`;

const feedConfig: any = {
  feedId: "jsonld-feed",
  feedName: "JSON-LD Feed",
  feedType: "webScraping",
  refreshTime: 5,
  config: { baseUrl: "https://example.com/news" },
  article: { iterator: { selector: "" } },
  extraction: {
    mode: "jsonLdPage",
    mappings: {
      title: "headline",
      description: "description",
      link: "url",
      pubDate: "datePublished",
      author: "author.name",
      categories: "keywords",
      guid: "url",
    },
  },
};

describe("JSON-LD integration", () => {
  test("extracts normalized feed items from page-level JSON-LD", () => {
    const result = extractJsonLdItemsFromHtml(html, "https://example.com/news", feedConfig.extraction);
    expect(result.items[0]).toMatchObject({
      title: "JSON-LD headline",
      description: "Structured summary",
      link: "https://example.com/items/1",
      author: "Reporter",
      categories: ["mkfd", "feeds"],
    });
  });

  test("webScraping build path routes JSON-LD items through feed builder", async () => {
    const { feed, metrics } = await buildFeedObject(html, feedConfig);
    expect(metrics.itemCount).toBe(1);
    expect(feed.rss2()).toContain("JSON-LD headline");
  });

  test("validation rejects persisted JSON-LD tuning keys", () => {
    const result = validateFeedConfig({
      ...feedConfig,
      extraction: { ...feedConfig.extraction, limit: 25 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path === "extraction.limit")).toBe(true);
  });
});
