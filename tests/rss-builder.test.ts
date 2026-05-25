import { describe, it, expect } from "bun:test";
import { buildRSSFromApiData, buildRSS, buildFeedObject, buildFeedObjectFromApiData } from "../utilities/rss-builder.utility";
import { Feed } from "feed";

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

    const result1 = buildRSSFromApiData(apiData, BASE_CONFIG, new Map());
    const result2 = buildRSSFromApiData(apiData, BASE_CONFIG, new Map());

    const guids1 = extractGuids(result1.xml);
    const guids2 = extractGuids(result2.xml);

    expect(guids1.length).toBe(1);
    expect(guids1[0]).toBe(guids2[0]);
  });
});

const SAMPLE_HTML = `
  <html><body>
    <div class="post">
      <h2 class="title">Hello World</h2>
      <a class="link" href="https://example.com/hello">Read</a>
      <p class="description">Some body text.</p>
    </div>
  </body></html>
`;

const SCRAPING_CONFIG = {
  feedId: "test-web-feed",
  config: { baseUrl: "https://example.com" },
  article: {
    iterator: { selector: ".post" },
    title: { selector: ".title", stripHtml: true },
    link: { selector: ".link", attribute: "href" },
    description: { selector: ".description", stripHtml: true },
    date: { selector: ".date" },   // not present — will fall back to processDates("")
    guid: { selector: ".guid" },   // not present — will fall back to makeItemKey
  },
  serverUrl: "http://localhost:5000",
};

describe("buildRSS — dateIndex", () => {
  it("adds a new item to the dateIndex on first build", async () => {
    const dateIndex = new Map<string, string>();
    await buildRSS(SAMPLE_HTML, SCRAPING_CONFIG, dateIndex);
    expect(dateIndex.size).toBe(1);
  });

  it("preserves the stored date for a recognised item and does not add a new entry", async () => {
    const dateIndex = new Map<string, string>();

    await buildRSS(SAMPLE_HTML, SCRAPING_CONFIG, dateIndex);
    expect(dateIndex.size).toBe(1);

    const storedDate = "2024-03-10T08:00:00.000Z";
    const [key] = dateIndex.keys();
    dateIndex.set(key, storedDate);

    await buildRSS(SAMPLE_HTML, SCRAPING_CONFIG, dateIndex);
    expect(dateIndex.size).toBe(1);
    expect(dateIndex.get(key)).toBe(storedDate);
  });

  it("works correctly when dateIndex is not provided", async () => {
    const result = await buildRSS(SAMPLE_HTML, SCRAPING_CONFIG);
    expect(typeof result.xml).toBe("string");
  });
});

describe("buildRSS — stable GUID", () => {
  it("produces the same GUID across two builds", async () => {
    const result1 = await buildRSS(SAMPLE_HTML, SCRAPING_CONFIG, new Map());
    const result2 = await buildRSS(SAMPLE_HTML, SCRAPING_CONFIG, new Map());

    const guids1 = extractGuids(result1.xml);
    const guids2 = extractGuids(result2.xml);

    expect(guids1.length).toBe(1);
    expect(guids1[0]).toBe(guids2[0]);
  });
});

describe("buildRSSFromApiData — BuildRSSResult shape", () => {
  it("returns an object with xml and metrics fields", () => {
    const apiData = { items: [SAMPLE_ITEM] };
    const result = buildRSSFromApiData(apiData, BASE_CONFIG, new Map());
    expect(typeof result.xml).toBe("string");
    expect(result.xml).toContain("<rss");
    expect(typeof result.metrics).toBe("object");
    expect(typeof result.metrics.itemCount).toBe("number");
    expect(typeof result.metrics.dateFallbacks).toBe("number");
    expect(typeof result.metrics.duplicateGuids).toBe("number");
    expect(result.metrics.selectorMatches).toBeNull();
  });

  it("metrics.itemCount matches the number of items produced", () => {
    const apiData = { items: [SAMPLE_ITEM, { ...SAMPLE_ITEM, title: "Article Two", link: "https://example.com/2" }] };
    const result = buildRSSFromApiData(apiData, BASE_CONFIG, new Map());
    expect(result.metrics.itemCount).toBe(2);
  });

  it("metrics.dateFallbacks increments when date is missing", () => {
    const result = buildRSSFromApiData({ items: [SAMPLE_ITEM] }, BASE_CONFIG, new Map());
    expect(result.metrics.dateFallbacks).toBe(1);
  });

  it("metrics.dateFallbacks is 0 when all items have valid dates", () => {
    const itemWithDate = { ...SAMPLE_ITEM, date: "2024-01-15T10:00:00Z" };
    const result = buildRSSFromApiData({ items: [itemWithDate] }, {
      ...BASE_CONFIG,
      apiMapping: { ...BASE_CONFIG.apiMapping, date: "date" },
    }, new Map());
    expect(result.metrics.dateFallbacks).toBe(0);
  });

  it("metrics.duplicateGuids is 0 when all GUIDs are unique", () => {
    const items = [
      { ...SAMPLE_ITEM, guid: "guid-1" },
      { ...SAMPLE_ITEM, title: "Two", link: "https://example.com/2", guid: "guid-2" },
    ];
    const result = buildRSSFromApiData({ items }, {
      ...BASE_CONFIG,
      apiMapping: { ...BASE_CONFIG.apiMapping, guid: "guid" },
    }, new Map());
    expect(result.metrics.duplicateGuids).toBe(0);
  });
});

describe("buildFeedObject", () => {
  it("returns a Feed instance", async () => {
    const html = `<html><body>
      <article><h2 class="title">Story 1</h2><a class="link" href="/1">Link</a></article>
    </body></html>`;
    const config = {
      feedId: "test-obj",
      feedName: "test-obj",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://example.com" },
      article: {
        iterator: { selector: "article" },
        title: { selector: ".title" },
        link: { selector: ".link", attribute: "href", isRelative: true, baseUrl: "https://example.com" },
      },
    };
    const result = await buildFeedObject(html, config);
    expect(result.feed).toBeInstanceOf(Feed);
    expect(typeof result.feed.rss2).toBe("function");
    expect(typeof result.feed.atom1).toBe("function");
    expect(typeof result.feed.json1).toBe("function");
    expect(result.metrics).toBeDefined();
  });
});

describe("buildFeedObjectFromApiData", () => {
  it("returns a Feed instance", () => {
    const config = {
      feedId: "api-obj",
      feedName: "api-obj",
      feedType: "api",
      refreshTime: 5,
      config: { baseUrl: "https://api.example.com" },
      apiMapping: { items: "items", title: "title", link: "link" },
    };
    const data = { items: [{ title: "Post 1", link: "https://example.com/1" }] };
    const result = buildFeedObjectFromApiData(data, config);
    expect(result.feed).toBeInstanceOf(Feed);
    expect(result.metrics.itemCount).toBe(1);
  });
});
