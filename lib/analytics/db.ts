import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { mkdirSync, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import * as schema from "./schema";
import type { RunLog } from "./schema";

export type RetentionSettings = {
  retentionDays: number;
  retentionDaysEnabled: boolean;
  retentionRuns: number;
  retentionRunsEnabled: boolean;
};

export type RunLogInput = {
  feedId: string;
  feedName: string;
  feedType: string;
  startedAt: number;
  durationMs: number | null;
  status: "success" | "error";
  errorMessage: string | null;
  httpStatus: number | null;
  timedOut: boolean;
  itemCount: number | null;
  selectorMatches: Record<string, number> | null;
  dateFallbacks: number;
  duplicateGuids: number;
  webhookStatus: string | null;
  webhookError: string | null;
};

let _sqlite: Database | null = null;

export function initDb(dbPath: string = process.env.RUNTIME_DB_PATH ?? "./data/runtime.db"): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  _sqlite = new Database(dbPath);
  const db = drizzle(_sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle/migrations" });
  return _sqlite;
}

export function getDb(): Database {
  if (!_sqlite) throw new Error("Analytics DB not initialized — call initDb() first");
  return _sqlite;
}

export async function getLastItemCount(sqlite: Database, feedId: string): Promise<number | null> {
  const db = drizzle(sqlite, { schema });
  const rows = await db
    .select({ itemCount: schema.runLogs.itemCount })
    .from(schema.runLogs)
    .where(eq(schema.runLogs.feedId, feedId))
    .orderBy(desc(schema.runLogs.startedAt))
    .limit(1);
  return rows[0]?.itemCount ?? null;
}

export async function insertRunLog(sqlite: Database, input: RunLogInput): Promise<RunLog> {
  const db = drizzle(sqlite, { schema });
  const prevItemCount = await getLastItemCount(sqlite, input.feedId);
  const rows = await db
    .insert(schema.runLogs)
    .values({
      feedId: input.feedId,
      feedName: input.feedName,
      feedType: input.feedType,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      status: input.status,
      errorMessage: input.errorMessage,
      httpStatus: input.httpStatus,
      timedOut: input.timedOut ? 1 : 0,
      itemCount: input.itemCount,
      prevItemCount,
      selectorMatches: input.selectorMatches ? JSON.stringify(input.selectorMatches) : null,
      dateFallbacks: input.dateFallbacks,
      duplicateGuids: input.duplicateGuids,
      webhookStatus: input.webhookStatus,
      webhookError: input.webhookError,
    })
    .returning();
  return rows[0];
}

export async function pruneRunLogs(sqlite: Database, feedId: string, s: RetentionSettings): Promise<void> {
  const db = drizzle(sqlite, { schema });

  if (s.retentionDaysEnabled) {
    const cutoff = Date.now() - s.retentionDays * 24 * 60 * 60 * 1000;
    await db
      .delete(schema.runLogs)
      .where(and(eq(schema.runLogs.feedId, feedId), lt(schema.runLogs.startedAt, cutoff)));
  }

  if (s.retentionRunsEnabled) {
    const rows = await db
      .select({ id: schema.runLogs.id })
      .from(schema.runLogs)
      .where(eq(schema.runLogs.feedId, feedId))
      .orderBy(desc(schema.runLogs.startedAt));

    if (rows.length > s.retentionRuns) {
      const idsToDelete = rows.slice(s.retentionRuns).map((r) => r.id);
      if (idsToDelete.length > 0) {
        await db.delete(schema.runLogs).where(inArray(schema.runLogs.id, idsToDelete));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// App Settings (key/value store for typed settings)
// ---------------------------------------------------------------------------

/**
 * Reads all rows from the app_settings table and returns them as a plain
 * Record<string, string>. Keys are the setting identifiers; values are raw
 * serialized strings.
 */
export async function getAppSettings(sqlite: Database): Promise<Record<string, string>> {
  const db = drizzle(sqlite, { schema });
  const rows = await db.select().from(schema.appSettings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Persists a partial update to the app_settings table. Each entry in the
 * provided record is upserted individually.
 */
export async function saveAppSettings(
  sqlite: Database,
  values: Record<string, string>,
): Promise<void> {
  const db = drizzle(sqlite, { schema });
  for (const [key, value] of Object.entries(values)) {
    await db
      .insert(schema.appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }
}

// ---------------------------------------------------------------------------
// Feed History Store
// ---------------------------------------------------------------------------

export interface FeedHistoryStore {
  getPreviousFeedHistory(feedId: string): Promise<string | null>;
  storeFeedHistory(feedId: string, snapshotData: string, format?: string): Promise<void>;
  clearFeedHistory(feedId: string): Promise<void>;
  loadDateIndex(feedId: string): Promise<Map<string, string>>;
  saveDateIndex(feedId: string, index: Map<string, string>): Promise<void>;
}

export function createFeedHistoryStore(sqlite: Database): FeedHistoryStore {
  const db = drizzle(sqlite, { schema });

  return {
    async getPreviousFeedHistory(feedId: string): Promise<string | null> {
      const rows = await db
        .select({ snapshotData: schema.feedHistorySnapshots.snapshotData })
        .from(schema.feedHistorySnapshots)
        .where(eq(schema.feedHistorySnapshots.feedId, feedId))
        .limit(1);
      return rows[0]?.snapshotData ?? null;
    },

    async storeFeedHistory(feedId: string, snapshotData: string, format = "items_json"): Promise<void> {
      const now = new Date().toISOString();
      const contentHash = createHash("sha256").update(snapshotData).digest("hex");
      await db
        .insert(schema.feedHistorySnapshots)
        .values({ feedId, snapshotData, format, contentHash, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.feedHistorySnapshots.feedId,
          set: { snapshotData, format, contentHash, updatedAt: now },
        });
    },

    async clearFeedHistory(feedId: string): Promise<void> {
      await db
        .delete(schema.feedHistorySnapshots)
        .where(eq(schema.feedHistorySnapshots.feedId, feedId));
      await db
        .delete(schema.feedHistoryItems)
        .where(eq(schema.feedHistoryItems.feedId, feedId));
    },

    async loadDateIndex(feedId: string): Promise<Map<string, string>> {
      const rows = await db
        .select({
          itemHash:    schema.feedHistoryItems.itemHash,
          firstSeenAt: schema.feedHistoryItems.firstSeenAt,
        })
        .from(schema.feedHistoryItems)
        .where(eq(schema.feedHistoryItems.feedId, feedId));

      return new Map(rows.map((r) => [r.itemHash, r.firstSeenAt]));
    },

    async saveDateIndex(feedId: string, index: Map<string, string>): Promise<void> {
      const now = new Date().toISOString();
      for (const [itemHash, firstSeenAt] of index) {
        const id = `${feedId}:${itemHash}`;
        await db
          .insert(schema.feedHistoryItems)
          .values({ id, feedId, itemHash, firstSeenAt, lastSeenAt: now })
          .onConflictDoUpdate({
            target: schema.feedHistoryItems.id,
            set: { lastSeenAt: now },
            // first_seen_at is intentionally NOT updated — preserve the original date
          });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy feed history migration
// ---------------------------------------------------------------------------

const SAFE_FEED_ID = /^[a-zA-Z0-9_\-]+$/;

export async function migrateLegacyFeedHistory(
  sqlite: Database,
  legacyDir = "./feed-history",
): Promise<{ snapshots: number; dateIndexes: number; skipped: number }> {
  if (!existsSync(legacyDir)) {
    return { snapshots: 0, dateIndexes: 0, skipped: 0 };
  }

  const store = createFeedHistoryStore(sqlite);
  const db = drizzle(sqlite, { schema });
  const files = await readdir(legacyDir);
  let snapshots = 0;
  let dateIndexes = 0;
  let skipped = 0;

  for (const file of files) {
    const ext = extname(file);

    if (ext === ".xml") {
      const feedId = basename(file, ".xml");
      if (!SAFE_FEED_ID.test(feedId)) { skipped++; continue; }

      try {
        const existing = await store.getPreviousFeedHistory(feedId);
        if (existing !== null) { skipped++; continue; }

        const xml = await readFile(`${legacyDir}/${file}`, "utf8");
        await store.storeFeedHistory(feedId, xml, "legacy_xml");
        snapshots++;
      } catch (err) {
        console.warn(`[FeedHistory] Skipping ${file} during migration:`, err);
        skipped++;
      }
      continue;
    }

    if (file.endsWith(".dates.json")) {
      const feedId = basename(file, ".dates.json");
      if (!SAFE_FEED_ID.test(feedId)) { skipped++; continue; }

      try {
        const existingRows = await db
          .select({ id: schema.feedHistoryItems.id })
          .from(schema.feedHistoryItems)
          .where(eq(schema.feedHistoryItems.feedId, feedId))
          .limit(1);

        if (existingRows.length > 0) { skipped++; continue; }

        const raw = await readFile(`${legacyDir}/${file}`, "utf8");
        const parsed = JSON.parse(raw) as Record<string, string>;
        const index = new Map(Object.entries(parsed));
        await store.saveDateIndex(feedId, index);
        dateIndexes++;
      } catch (err) {
        console.warn(`[FeedHistory] Skipping ${file} during migration:`, err);
        skipped++;
      }
    }
  }

  console.log(
    `[FeedHistory] Migrated ${snapshots} snapshots, ${dateIndexes} date indexes (${skipped} skipped).`,
  );
  return { snapshots, dateIndexes, skipped };
}
