import { describe, expect, test } from "bun:test";
import { discoverFeeds } from "../../utilities/feed-discovery.utility";
import { extractJsonLd } from "../../utilities/json-ld.utility";
import { analyzeJsonLd } from "../../utilities/json-ld-analysis.utility";
import { detectForms } from "../../utilities/form-detection.utility";

const html = `
  <html><head>
    <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="RSS">
    <script type="application/ld+json">{"@type":"NewsArticle","headline":"One"}</script>
  </head><body>
    <form action="/search"><input name="q" required></form>
  </body></html>
`;

describe("source assistant analyzers", () => {
  test("discovers feeds", () => {
    expect(discoverFeeds(html, "https://example.com/news")[0]).toMatchObject({ url: "https://example.com/feed.xml", type: "rss" });
  });

  test("extracts and analyzes JSON-LD", () => {
    const analysis = analyzeJsonLd(extractJsonLd(html));
    expect(analysis.itemLikeCount).toBe(1);
    expect(analysis.highValueTypes).toContain("NewsArticle");
  });

  test("detects forms", () => {
    const forms = detectForms(html, "https://example.com/news");
    expect(forms[0].actionUrl).toBe("https://example.com/search");
    expect(forms[0].confidence).toBeGreaterThan(0.8);
  });
});
