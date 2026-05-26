import { describe, expect, test } from "bun:test";
import { parseExistingFeedContent } from "../utilities/existing-feed-parser.utility";

describe("parseExistingFeedContent", () => {
  test("parses RSS items", () => {
    const parsed = parseExistingFeedContent({
      url: "https://example.com/rss.xml",
      format: "auto",
      content: `<?xml version="1.0"?><rss version="2.0"><channel><title>RSS Feed</title><item><title>One</title><link>https://example.com/1</link><guid>1</guid><category>Tech</category></item></channel></rss>`,
    });
    expect(parsed.detectedFormat).toBe("rss");
    expect(parsed.feed.title).toBe("RSS Feed");
    expect(parsed.items[0].title).toBe("One");
    expect(parsed.items[0].categories).toEqual(["Tech"]);
  });

  test("parses Atom entries", () => {
    const parsed = parseExistingFeedContent({
      url: "https://example.com/atom.xml",
      format: "auto",
      content: `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title><entry><id>a1</id><title>Atom One</title><link href="https://example.com/a1"/><updated>2024-01-01T00:00:00Z</updated></entry></feed>`,
    });
    expect(parsed.detectedFormat).toBe("atom");
    expect(parsed.items[0].link).toBe("https://example.com/a1");
  });

  test("parses JSON Feed items", () => {
    const parsed = parseExistingFeedContent({
      url: "https://example.com/feed.json",
      format: "auto",
      content: JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "JSON Feed",
        items: [{ id: "j1", title: "Json One", url: "https://example.com/j1", tags: ["json"] }],
      }),
    });
    expect(parsed.detectedFormat).toBe("jsonFeed");
    expect(parsed.items[0].guid).toBe("j1");
    expect(parsed.items[0].categories).toEqual(["json"]);
  });
});
