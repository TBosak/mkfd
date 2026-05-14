import { describe, it, expect } from "bun:test";
import { buildRSSFromApiData } from "../utilities/rss-builder.utility";

const BASE_CONFIG = {
  feedId: "test-api-feed",
  apiMapping: {
    items: "items",
    title: "title",
    description: "description",
    link: "link",
    date: "date",
    guid: "guid",
  },
  config: { baseUrl: "https://example.com", title: "Test Feed" },
  serverUrl: "http://localhost:5000",
};

const SAMPLE_ITEM = {
  title: "Article One",
  description: "First article body.",
  link: "https://example.com/article-1",
};

function extractGuids(xml: string): string[] {
  return [...xml.matchAll(/<guid[^>]*>(.*?)<\/guid>/g)].map((m) => m[1]);
}

describe("buildRSSFromApiData — dateIndex", () => {
  it("adds a new item to the dateIndex on first build", () => {
    const apiData = { items: [SAMPLE_ITEM] };
    const dateIndex = new Map<string, string>();

    buildRSSFromApiData(apiData, BASE_CONFIG, dateIndex);

    expect(dateIndex.size).toBe(1);
    const [, storedDate] = [...dateIndex.entries()][0];
    expect(new Date(storedDate).getTime()).toBeGreaterThan(0);
  });

  it("preserves the stored date for a recognised item and does not add a new entry", () => {
    const apiData = { items: [SAMPLE_ITEM] };
    const dateIndex = new Map<string, string>();

    // First build — populates index
    buildRSSFromApiData(apiData, BASE_CONFIG, dateIndex);
    expect(dateIndex.size).toBe(1);

    // Override with a known past date
    const storedDate = "2024-01-15T10:30:00.000Z";
    const [key] = dateIndex.keys();
    dateIndex.set(key, storedDate);

    // Second build — should recognise the item and not overwrite
    buildRSSFromApiData(apiData, BASE_CONFIG, dateIndex);
    expect(dateIndex.size).toBe(1);
    expect(dateIndex.get(key)).toBe(storedDate);
  });

  it("adds a new entry when a second distinct item appears", () => {
    const item2 = { title: "Article Two", link: "https://example.com/article-2" };
    const dateIndex = new Map<string, string>();

    buildRSSFromApiData({ items: [SAMPLE_ITEM] }, BASE_CONFIG, dateIndex);
    expect(dateIndex.size).toBe(1);

    buildRSSFromApiData({ items: [SAMPLE_ITEM, item2] }, BASE_CONFIG, dateIndex);
    expect(dateIndex.size).toBe(2);
  });

  it("works correctly when dateIndex is not provided (backwards compat)", () => {
    const apiData = { items: [SAMPLE_ITEM] };
    expect(() => buildRSSFromApiData(apiData, BASE_CONFIG)).not.toThrow();
  });
});

describe("buildRSSFromApiData — stable GUID", () => {
  it("produces the same GUID across two builds without an explicit guid field", () => {
    const apiData = { items: [SAMPLE_ITEM] };

    const xml1 = buildRSSFromApiData(apiData, BASE_CONFIG, new Map());
    const xml2 = buildRSSFromApiData(apiData, BASE_CONFIG, new Map());

    const guids1 = extractGuids(xml1);
    const guids2 = extractGuids(xml2);

    expect(guids1.length).toBe(1);
    expect(guids1[0]).toBe(guids2[0]);
  });
});
