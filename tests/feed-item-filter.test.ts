import { describe, expect, test } from "bun:test";
import { filterFeedItems } from "../utilities/feed-item-filter.utility";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

const item = (overrides: Partial<NormalizedFeedItem> = {}): NormalizedFeedItem => ({
  title: "Test Title",
  ...overrides,
});

describe("filterFeedItems", () => {
  test("returns all items when no filters provided", () => {
    const result = filterFeedItems({ items: [item(), item({ title: "Other" })] });
    expect(result.items).toHaveLength(2);
    expect(result.filteredItemCount).toBe(0);
  });

  test("exclude contains removes matching item", () => {
    const result = filterFeedItems({
      items: [item({ title: "Sponsored Post" }), item({ title: "Regular Post" })],
      filters: { exclude: [{ field: "title", type: "contains", value: "sponsored", caseSensitive: false }] },
    });
    expect(result.items.map((i) => i.title)).toEqual(["Regular Post"]);
    expect(result.filteredItemCount).toBe(1);
  });

  test("include keeps matching items and exclude wins", () => {
    const result = filterFeedItems({
      items: [item({ title: "Tech Sponsored" }), item({ title: "Tech News" }), item({ title: "Sports" })],
      filters: {
        include: [{ field: "title", type: "contains", value: "tech", caseSensitive: false }],
        exclude: [{ field: "title", type: "contains", value: "sponsored", caseSensitive: false }],
      },
    });
    expect(result.items.map((i) => i.title)).toEqual(["Tech News"]);
    expect(result.filteredItemCount).toBe(2);
  });

  test("categories match any category and invalid regex is ignored", () => {
    const cats = filterFeedItems({
      items: [item({ categories: ["tech", "gadgets"] }), item({ categories: ["sports"] })],
      filters: { exclude: [{ field: "categories", type: "contains", value: "tech" }] },
    });
    expect(cats.items).toHaveLength(1);
    const invalid = filterFeedItems({
      items: [item()],
      filters: { exclude: [{ field: "title", type: "regex", value: "[invalid" }] },
    });
    expect(invalid.items).toHaveLength(1);
  });
});
