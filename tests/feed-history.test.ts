import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import {
  makeItemKey,
  loadDateIndex,
  saveDateIndex,
} from "../utilities/feed-history.utility";

const FEED_ID = "test-date-index-fixture";
const INDEX_PATH = join("./feed-history", `${FEED_ID}.dates.json`);

afterEach(() => {
  if (existsSync(INDEX_PATH)) rmSync(INDEX_PATH);
});

describe("makeItemKey", () => {
  it("returns the same hash regardless of field insertion order", () => {
    const a = { link: "https://example.com/1", title: "Foo", guid: "" };
    const b = { title: "Foo", guid: "", link: "https://example.com/1" };
    expect(makeItemKey(a)).toBe(makeItemKey(b));
  });

  it("returns different hashes for different inputs", () => {
    const a = { title: "Foo", link: "https://example.com/1" };
    const b = { title: "Bar", link: "https://example.com/2" };
    expect(makeItemKey(a)).not.toBe(makeItemKey(b));
  });

  it("excludes the date field so items with different dates hash identically", () => {
    const base = { title: "Foo", link: "https://example.com/1" };
    const withDate1 = { ...base, date: new Date("2024-01-01") };
    const withDate2 = { ...base, date: new Date("2025-06-15") };
    expect(makeItemKey(withDate1)).toBe(makeItemKey(withDate2));
  });

  it("includes non-date fields so distinct items produce distinct keys", () => {
    const a = { title: "Foo", link: "https://example.com/1", date: new Date() };
    const b = { title: "Bar", link: "https://example.com/1", date: new Date() };
    expect(makeItemKey(a)).not.toBe(makeItemKey(b));
  });
});

describe("loadDateIndex / saveDateIndex", () => {
  it("loadDateIndex returns an empty Map when no file exists", async () => {
    const index = await loadDateIndex(FEED_ID);
    expect(index).toBeInstanceOf(Map);
    expect(index.size).toBe(0);
  });

  it("round-trips through saveDateIndex and loadDateIndex", async () => {
    const index = new Map([
      ["abc123", "2024-01-15T10:30:00.000Z"],
      ["def456", "2024-02-20T14:22:00.000Z"],
    ]);

    await saveDateIndex(FEED_ID, index);
    const loaded = await loadDateIndex(FEED_ID);

    expect(loaded.size).toBe(2);
    expect(loaded.get("abc123")).toBe("2024-01-15T10:30:00.000Z");
    expect(loaded.get("def456")).toBe("2024-02-20T14:22:00.000Z");
  });

  it("overwrites the file on subsequent saves", async () => {
    await saveDateIndex(FEED_ID, new Map([["key1", "2024-01-01T00:00:00.000Z"]]));
    await saveDateIndex(FEED_ID, new Map([["key2", "2024-06-01T00:00:00.000Z"]]));

    const loaded = await loadDateIndex(FEED_ID);
    expect(loaded.size).toBe(1);
    expect(loaded.has("key1")).toBe(false);
    expect(loaded.get("key2")).toBe("2024-06-01T00:00:00.000Z");
  });

  it("returns an empty Map when the index file contains invalid JSON", async () => {
    const { writeFileSync, mkdirSync } = await import("fs");
    mkdirSync("./feed-history", { recursive: true });
    writeFileSync(INDEX_PATH, "{ invalid json {{", "utf8");

    const index = await loadDateIndex(FEED_ID);
    expect(index).toBeInstanceOf(Map);
    expect(index.size).toBe(0);
  });
});
