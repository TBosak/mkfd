import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../lib/analytics/schema";
import { createFeedHistoryStore, type FeedHistoryStore } from "../lib/analytics/db";

function makeTestDb(): Database {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle/migrations" });
  return sqlite;
}

describe("FeedHistoryStore — snapshots", () => {
  let store: FeedHistoryStore;

  beforeEach(() => {
    store = createFeedHistoryStore(makeTestDb());
  });

  it("returns null for an unknown feedId", async () => {
    expect(await store.getPreviousFeedHistory("unknown-feed")).toBeNull();
  });

  it("stores and retrieves a snapshot", async () => {
    await store.storeFeedHistory("feed-1", "<rss>test</rss>");
    expect(await store.getPreviousFeedHistory("feed-1")).toBe("<rss>test</rss>");
  });

  it("overwrites an existing snapshot on second store", async () => {
    await store.storeFeedHistory("feed-upd", "<rss>v1</rss>");
    await store.storeFeedHistory("feed-upd", "<rss>v2</rss>");
    expect(await store.getPreviousFeedHistory("feed-upd")).toBe("<rss>v2</rss>");
  });

  it("clears a snapshot", async () => {
    await store.storeFeedHistory("feed-del", "<rss/>");
    await store.clearFeedHistory("feed-del");
    expect(await store.getPreviousFeedHistory("feed-del")).toBeNull();
  });
});

describe("FeedHistoryStore — date index", () => {
  let store: FeedHistoryStore;

  beforeEach(() => {
    store = createFeedHistoryStore(makeTestDb());
  });

  it("returns empty Map for an unknown feedId", async () => {
    const result = await store.loadDateIndex("no-feed");
    expect(result.size).toBe(0);
  });

  it("saves and loads a date index", async () => {
    const index = new Map([
      ["hash-abc", "2026-01-01T00:00:00.000Z"],
      ["hash-def", "2026-01-02T00:00:00.000Z"],
    ]);
    await store.saveDateIndex("feed-idx", index);
    const loaded = await store.loadDateIndex("feed-idx");
    expect(loaded.get("hash-abc")).toBe("2026-01-01T00:00:00.000Z");
    expect(loaded.get("hash-def")).toBe("2026-01-02T00:00:00.000Z");
  });

  it("preserves first_seen_at on subsequent saves of the same item", async () => {
    const originalDate = "2026-01-01T00:00:00.000Z";
    await store.saveDateIndex("feed-preserve", new Map([["hash-x", originalDate]]));
    // Save again with the same item
    await store.saveDateIndex("feed-preserve", new Map([["hash-x", originalDate]]));
    const loaded = await store.loadDateIndex("feed-preserve");
    expect(loaded.get("hash-x")).toBe(originalDate);
  });

  it("clears date index entries with clearFeedHistory", async () => {
    await store.saveDateIndex("feed-clr", new Map([["hash-1", "2026-01-01T00:00:00.000Z"]]));
    await store.clearFeedHistory("feed-clr");
    const loaded = await store.loadDateIndex("feed-clr");
    expect(loaded.size).toBe(0);
  });
});

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { migrateLegacyFeedHistory } from "../lib/analytics/db";

const TMP_DIR = "./feed-history-test-tmp";

describe("migrateLegacyFeedHistory", () => {
  beforeEach(() => mkdirSync(TMP_DIR, { recursive: true }));
  afterEach(() => rmSync(TMP_DIR, { recursive: true, force: true }));

  it("returns zero counts when legacy dir does not exist", async () => {
    const sqlite = makeTestDb();
    const result = await migrateLegacyFeedHistory(sqlite, "./nonexistent-dir-xyz");
    expect(result.snapshots).toBe(0);
    expect(result.dateIndexes).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("migrates an XML snapshot file", async () => {
    writeFileSync(join(TMP_DIR, "feed-abc.xml"), "<rss>migrated</rss>", "utf8");
    const sqlite = makeTestDb();
    const result = await migrateLegacyFeedHistory(sqlite, TMP_DIR);
    expect(result.snapshots).toBe(1);

    const store = createFeedHistoryStore(sqlite);
    expect(await store.getPreviousFeedHistory("feed-abc")).toBe("<rss>migrated</rss>");
  });

  it("migrates a dates.json file preserving original dates", async () => {
    const dateData = { "hash-1": "2026-01-01T00:00:00.000Z", "hash-2": "2026-01-02T00:00:00.000Z" };
    writeFileSync(join(TMP_DIR, "feed-xyz.dates.json"), JSON.stringify(dateData), "utf8");
    const sqlite = makeTestDb();
    const result = await migrateLegacyFeedHistory(sqlite, TMP_DIR);
    expect(result.dateIndexes).toBe(1);

    const store = createFeedHistoryStore(sqlite);
    const loaded = await store.loadDateIndex("feed-xyz");
    expect(loaded.get("hash-1")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("skips XML files that are already in SQLite", async () => {
    writeFileSync(join(TMP_DIR, "feed-skip.xml"), "<rss>old</rss>", "utf8");
    const sqlite = makeTestDb();
    const store = createFeedHistoryStore(sqlite);
    await store.storeFeedHistory("feed-skip", "<rss>already-there</rss>");

    const result = await migrateLegacyFeedHistory(sqlite, TMP_DIR);
    expect(result.skipped).toBe(1);
    // Original SQLite value preserved, not overwritten
    expect(await store.getPreviousFeedHistory("feed-skip")).toBe("<rss>already-there</rss>");
  });

  it("skips files with unsafe feedId characters", async () => {
    writeFileSync(join(TMP_DIR, "bad..id.xml"), "<rss/>", "utf8");
    const sqlite = makeTestDb();
    const result = await migrateLegacyFeedHistory(sqlite, TMP_DIR);
    expect(result.skipped).toBe(1);
    expect(result.snapshots).toBe(0);
  });

  it("never throws — counts bad files as skipped", async () => {
    writeFileSync(join(TMP_DIR, "feed-bad.xml"), "not valid xml but still a string", "utf8");
    writeFileSync(join(TMP_DIR, "feed-badjson.dates.json"), "{ invalid json }", "utf8");
    const sqlite = makeTestDb();
    // Should not throw
    const result = await migrateLegacyFeedHistory(sqlite, TMP_DIR);
    // The XML file migrates fine (we don't parse XML, just store the string)
    // The bad JSON is counted as skipped
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });
});
