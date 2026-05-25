import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Feed } from "feed";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  serializeAllFeedFormats,
  writeAllFeedFormats,
  extractFeedItemSnapshots,
} from "../utilities/feed-output.utility";

const TEST_DIR = "./public/feeds-test-tmp";

function makeFeed(): Feed {
  const feed = new Feed({
    title: "Test Feed",
    description: "A test",
    id: "https://example.com/feed",
    link: "https://example.com",
    updated: new Date("2026-01-01"),
  });
  feed.addItem({
    title: "Item One",
    id: "https://example.com/1",
    link: "https://example.com/1",
    date: new Date("2026-01-01"),
  });
  return feed;
}

beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

describe("serializeAllFeedFormats", () => {
  it("returns rss2 containing <rss", () => {
    expect(serializeAllFeedFormats(makeFeed()).rss2).toContain("<rss");
  });
  it("returns atom containing <feed", () => {
    expect(serializeAllFeedFormats(makeFeed()).atom).toContain("<feed");
  });
  it("returns json that parses as JSON Feed", () => {
    const parsed = JSON.parse(serializeAllFeedFormats(makeFeed()).json);
    expect(typeof parsed.version).toBe("string");
    expect(parsed.title).toBe("Test Feed");
  });
  it("serializes all formats before any write (idempotent)", () => {
    const f = makeFeed();
    const a = serializeAllFeedFormats(f);
    const b = serializeAllFeedFormats(f);
    expect(a.rss2).toBe(b.rss2);
  });
});

describe("writeAllFeedFormats", () => {
  it("writes .xml, .atom, and .json files", async () => {
    await writeAllFeedFormats("test-feed-id", makeFeed(), TEST_DIR);
    expect(existsSync(`${TEST_DIR}/test-feed-id.xml`)).toBe(true);
    expect(existsSync(`${TEST_DIR}/test-feed-id.atom`)).toBe(true);
    expect(existsSync(`${TEST_DIR}/test-feed-id.json`)).toBe(true);
  });
  it("returns correct URL paths", async () => {
    const urls = await writeAllFeedFormats("url-test", makeFeed(), TEST_DIR);
    expect(urls.rss2).toBe("/public/feeds/url-test.xml");
    expect(urls.atom).toBe("/public/feeds/url-test.atom");
    expect(urls.json).toBe("/public/feeds/url-test.json");
  });
  it("xml file contains RSS 2.0 content", async () => {
    await writeAllFeedFormats("content-test", makeFeed(), TEST_DIR);
    const content = await readFile(`${TEST_DIR}/content-test.xml`, "utf8");
    expect(content).toContain("<rss");
  });
});

describe("extractFeedItemSnapshots", () => {
  it("returns an array with one entry per feed item", () => {
    const snapshots = extractFeedItemSnapshots(makeFeed());
    expect(snapshots).toHaveLength(1);
  });
  it("maps item id to guid", () => {
    const snapshots = extractFeedItemSnapshots(makeFeed());
    expect(snapshots[0].guid).toBe("https://example.com/1");
  });
  it("maps item link", () => {
    const snapshots = extractFeedItemSnapshots(makeFeed());
    expect(snapshots[0].link).toBe("https://example.com/1");
  });
});
