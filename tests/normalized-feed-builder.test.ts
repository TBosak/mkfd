import { describe, it, expect } from "bun:test";
import { Feed } from "feed";
import { buildFeedFromNormalizedItems } from "../utilities/normalized-feed-builder.utility";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

const baseOpts = {
  feedId: "test-feed",
  feedName: "Test Feed",
  items: [] as NormalizedFeedItem[],
};

describe("buildFeedFromNormalizedItems", () => {
  it("returns a Feed instance", () => {
    const feed = buildFeedFromNormalizedItems(baseOpts);
    expect(feed).toBeInstanceOf(Feed);
  });

  it("uses feedName as title when no metadata title", () => {
    const feed = buildFeedFromNormalizedItems(baseOpts);
    expect(feed.options.title).toBe("Test Feed");
  });

  it("uses overrides.title first", () => {
    const feed = buildFeedFromNormalizedItems({
      ...baseOpts,
      overrides: { title: "Override Title" },
      metadata: { title: "Meta Title" },
    });
    expect(feed.options.title).toBe("Override Title");
  });

  it("uses metadata.title over sourceFeedMeta.title", () => {
    const feed = buildFeedFromNormalizedItems({
      ...baseOpts,
      metadata: { title: "Meta Title" },
      sourceFeedMeta: { title: "Source Title" },
    });
    expect(feed.options.title).toBe("Meta Title");
  });

  it("maps items with dates, GUIDs, and categories", () => {
    const items: NormalizedFeedItem[] = [{
      title: "Item 1",
      link: "https://example.com/1",
      guid: "guid-1",
      pubDate: new Date("2026-01-01"),
      categories: ["Tech", "News"],
    }];
    const feed = buildFeedFromNormalizedItems({ ...baseOpts, items });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].id).toBe("guid-1");
    expect(feed.items[0].category).toEqual([{ name: "Tech" }, { name: "News" }]);
  });

  it("maps enclosures", () => {
    const items: NormalizedFeedItem[] = [{
      title: "With Enclosure",
      link: "https://example.com/2",
      enclosure: { url: "https://example.com/audio.mp3", type: "audio/mpeg", length: 12345 },
    }];
    const feed = buildFeedFromNormalizedItems({ ...baseOpts, items });
    expect(feed.items[0].enclosure?.url).toBe("https://example.com/audio.mp3");
  });

  it("generates a stable GUID fallback when guid is missing", () => {
    const items: NormalizedFeedItem[] = [{ title: "No Guid", link: "https://example.com/3" }];
    const feed = buildFeedFromNormalizedItems({ ...baseOpts, items });
    expect(feed.items[0].id).toBeTruthy();
    expect(typeof feed.items[0].id).toBe("string");
  });

  it("does not expose protected values", () => {
    // Ensure the feed's rss2() output doesn't contain obvious protected value markers
    const items: NormalizedFeedItem[] = [{ title: "Safe Item", link: "https://example.com/4" }];
    const feed = buildFeedFromNormalizedItems({ ...baseOpts, items });
    const output = feed.rss2();
    expect(output).not.toContain("ENC:v1:");
    expect(output).not.toContain('"type":"protected"');
  });
});
