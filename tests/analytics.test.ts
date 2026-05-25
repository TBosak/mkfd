import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../lib/analytics/schema";
import {
  insertRunLog,
  pruneRunLogs,
  getLastItemCount,
} from "../lib/analytics/db";
import type { RetentionSettings, RunLogInput } from "../lib/analytics/db";

function makeTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle/migrations" });
  return { sqlite, db };
}

const MINIMAL_LOG: RunLogInput = {
  feedId: "feed-1",
  feedName: "Test Feed",
  feedType: "webScraping",
  startedAt: 1700000000000,
  status: "success",
  durationMs: 1200,
  itemCount: 10,
  dateFallbacks: 0,
  duplicateGuids: 0,
  timedOut: false,
  httpStatus: 200,
  selectorMatches: null,
  errorMessage: null,
  webhookStatus: null,
  webhookError: null,
};

describe("insertRunLog", () => {
  it("inserts a row and returns the inserted record", async () => {
    const { sqlite } = makeTestDb();
    const row = await insertRunLog(sqlite, MINIMAL_LOG);
    expect(row.id).toBeGreaterThan(0);
    expect(row.feedId).toBe("feed-1");
    expect(row.status).toBe("success");
  });

  it("stores prevItemCount from the most recent prior run for the same feed", async () => {
    const { sqlite } = makeTestDb();
    await insertRunLog(sqlite, { ...MINIMAL_LOG, itemCount: 5 });
    const second = await insertRunLog(sqlite, { ...MINIMAL_LOG, itemCount: 8 });
    expect(second.prevItemCount).toBe(5);
  });

  it("prevItemCount is null when no prior run exists", async () => {
    const { sqlite } = makeTestDb();
    const row = await insertRunLog(sqlite, MINIMAL_LOG);
    expect(row.prevItemCount).toBeNull();
  });

  it("does not use a different feed's item count as prevItemCount", async () => {
    const { sqlite } = makeTestDb();
    await insertRunLog(sqlite, { ...MINIMAL_LOG, feedId: "feed-2", itemCount: 99 });
    const row = await insertRunLog(sqlite, { ...MINIMAL_LOG, feedId: "feed-1", itemCount: 5 });
    expect(row.prevItemCount).toBeNull();
  });
});

describe("pruneRunLogs", () => {
  const FULL_SETTINGS: RetentionSettings = {
    retentionDays: 30,
    retentionDaysEnabled: true,
    retentionRuns: 100,
    retentionRunsEnabled: true,
  };

  it("prunes rows older than retentionDays when enabled", async () => {
    const { sqlite, db } = makeTestDb();
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await insertRunLog(sqlite, { ...MINIMAL_LOG, startedAt: old });
    await insertRunLog(sqlite, { ...MINIMAL_LOG, startedAt: Date.now() });
    await pruneRunLogs(sqlite, "feed-1", { ...FULL_SETTINGS, retentionDays: 30, retentionRunsEnabled: false });
    const rows = await db.select().from(schema.runLogs).all();
    expect(rows.length).toBe(1);
  });

  it("prunes oldest rows beyond retentionRuns when enabled", async () => {
    const { sqlite, db } = makeTestDb();
    for (let i = 0; i < 5; i++) {
      await insertRunLog(sqlite, { ...MINIMAL_LOG, startedAt: Date.now() + i });
    }
    await pruneRunLogs(sqlite, "feed-1", { ...FULL_SETTINGS, retentionRuns: 3, retentionDaysEnabled: false });
    const rows = await db.select().from(schema.runLogs).all();
    expect(rows.length).toBe(3);
  });

  it("keeps all rows when both thresholds are disabled", async () => {
    const { sqlite, db } = makeTestDb();
    for (let i = 0; i < 10; i++) {
      await insertRunLog(sqlite, MINIMAL_LOG);
    }
    await pruneRunLogs(sqlite, "feed-1", { retentionDays: 1, retentionDaysEnabled: false, retentionRuns: 1, retentionRunsEnabled: false });
    const rows = await db.select().from(schema.runLogs).all();
    expect(rows.length).toBe(10);
  });

  it("only prunes rows for the specified feedId", async () => {
    const { sqlite, db } = makeTestDb();
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await insertRunLog(sqlite, { ...MINIMAL_LOG, feedId: "feed-1", startedAt: old });
    await insertRunLog(sqlite, { ...MINIMAL_LOG, feedId: "feed-2", startedAt: old });
    await pruneRunLogs(sqlite, "feed-1", { ...FULL_SETTINGS, retentionDays: 30, retentionRunsEnabled: false });
    const rows = await db.select().from(schema.runLogs).all();
    expect(rows.length).toBe(1);
    expect(rows[0].feedId).toBe("feed-2");
  });
});

describe("getLastItemCount", () => {
  it("returns null when no runs exist for the feed", async () => {
    const { sqlite } = makeTestDb();
    expect(await getLastItemCount(sqlite, "feed-1")).toBeNull();
  });

  it("returns the itemCount from the most recent run", async () => {
    const { sqlite } = makeTestDb();
    await insertRunLog(sqlite, { ...MINIMAL_LOG, itemCount: 5, startedAt: 1000 });
    await insertRunLog(sqlite, { ...MINIMAL_LOG, itemCount: 9, startedAt: 2000 });
    expect(await getLastItemCount(sqlite, "feed-1")).toBe(9);
  });
});
