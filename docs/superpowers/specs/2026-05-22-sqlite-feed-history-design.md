# SQLite Runtime Substrate + Feed History Migration — Design Spec

**Date:** 2026-05-22
**Tier:** R1 Foundation
**Status:** Approved

---

## Goal

Move runtime state into one SQLite database (`./data/runtime.db`) backed by Drizzle ORM. The existing `health.db` run-log schema becomes part of this runtime DB, and feed history persistence moves from flat files (`./feed-history/{feedId}.xml` and `./feed-history/{feedId}.dates.json`) into the same database. The existing `feed-history.utility.ts` API is preserved unchanged so the worker requires no immediate rewrite. Existing file-based data is migrated synchronously on startup with a non-fatal error boundary; a lazy per-feed fallback handles any files missed during startup migration.

Implementation note: this branch already has `health.db` configured through the analytics DB code, Drizzle config, Docker env, and health API responses. Because the branch is not live, this spec intentionally replaces that implementation with `runtime.db`/`RUNTIME_DB_PATH`; it must not create a second database or preserve `DB_PATH` compatibility.

---

## Scope

### In scope

- `drizzle.config.ts` — single Drizzle config for the runtime DB
- `lib/analytics/schema.ts` — existing `run_logs`/`settings` plus `runtime_migrations`, `feed_history_snapshots`, and `feed_history_items`
- `lib/analytics/db.ts` — `initDb`, `FeedHistoryStore` interface, `createFeedHistoryStore`, `migrateLegacyFeedHistory`, and existing run-log helpers
- `utilities/feed-history.utility.ts` — rewritten as a thin wrapper; existing exports preserved; `setFeedHistoryStore` activates SQLite backing
- `index.ts` — startup wiring: `initDb` → `setFeedHistoryStore(createFeedHistoryStore(getDb()))` → `migrateLegacyFeedHistory`
- `docker-compose.yml` and deployment docs — replace `DB_PATH=/app/data/health.db` with `RUNTIME_DB_PATH=/app/data/runtime.db`
- Backward compatibility: all file-based fallbacks remain until a feed is migrated

### Out of scope

- Worker changes — worker API (`Map<string, string>`, `loadDateIndex`, `saveDateIndex`) is unchanged
- Deleting legacy XML or JSON files after migration — files stay in place (copy-forward only)
- Advanced item queries (filtering by date range, new-item counts) — `feed_history_items` schema supports them but no query API is added yet
- Moving YAML feed configs into SQLite — configs stay portable files

---

## Database Setup

### `drizzle.config.ts`

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/analytics/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.RUNTIME_DB_PATH ?? "./data/runtime.db",
  },
});
```

Migration files live in `./drizzle/migrations/`. Runtime DB configuration uses `RUNTIME_DB_PATH` and defaults to `./data/runtime.db`.

---

## Schema

### `lib/analytics/schema.ts`

```ts
import { int, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const runtimeMigrations = sqliteTable("runtime_migrations", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  appliedAt:   text("applied_at").notNull(),
  detailsJson: text("details_json"),
});

export const feedHistorySnapshots = sqliteTable("feed_history_snapshots", {
  feedId:           text("feed_id").primaryKey(),
  format:           text("format").notNull().default("items_json"),
  // "items_json"  — JSON array of { guid, link, title, pubDate } written by the Feed Format refactor
  // "legacy_xml"  — RSS XML string migrated from a legacy ./feed-history/*.xml file
  snapshotData:     text("snapshot_data").notNull(),
  contentHash:      text("content_hash"),
  itemCount:        int("item_count"),
  migratedFromPath: text("migrated_from_path"),
  migratedAt:       text("migrated_at"),
  createdAt:        text("created_at").notNull(),
  updatedAt:        text("updated_at").notNull(),
});

export const feedHistoryItems = sqliteTable(
  "feed_history_items",
  {
    id:                  text("id").primaryKey(),
    feedId:              text("feed_id").notNull(),
    guid:                text("guid"),
    link:                text("link"),
    title:               text("title"),
    titleHash:           text("title_hash"),
    itemHash:            text("item_hash").notNull(),
    pubDate:             text("pub_date"),
    firstSeenAt:         text("first_seen_at").notNull(),
    lastSeenAt:          text("last_seen_at").notNull(),
    sourceSnapshotHash:  text("source_snapshot_hash"),
  },
  (table) => [
    index("idx_feed_history_items_feed_id").on(table.feedId),
    uniqueIndex("idx_feed_history_items_dedupe").on(table.feedId, table.itemHash),
  ],
);

export type FeedHistorySnapshot = typeof feedHistorySnapshots.$inferSelect;
export type FeedHistoryItem     = typeof feedHistoryItems.$inferSelect;
```

---

## Store Interface and Implementation

### `lib/analytics/db.ts`

#### Interface

```ts
export interface FeedHistoryStore {
  // Snapshot operations (replaces XML files)
  // snapshotData is a JSON string — format depends on the `format` column:
  //   "items_json": JSON array of { guid?, link?, title?, pubDate? } (written by Feed Format refactor)
  //   "legacy_xml": raw RSS XML string (written only during legacy migration)
  getPreviousFeedHistory(feedId: string): Promise<string | null>;
  storeFeedHistory(feedId: string, snapshotData: string, format?: string): Promise<void>;
  clearFeedHistory(feedId: string): Promise<void>;

  // Item date-index operations (replaces .dates.json files)
  loadDateIndex(feedId: string): Promise<Map<string, string>>;
  saveDateIndex(feedId: string, index: Map<string, string>): Promise<void>;
}
```

#### `initDb`

```ts
export function initDb(
  dbPath = process.env.RUNTIME_DB_PATH ?? "./data/runtime.db",
): Database
```

Creates the `./data/` directory if needed, opens the runtime SQLite file, runs Drizzle migrations from `./drizzle/migrations/`, and returns the `Database` instance.

#### `createFeedHistoryStore`

```ts
export function createFeedHistoryStore(sqlite: Database): FeedHistoryStore
```

Returns an implementation of `FeedHistoryStore` backed by the given SQLite connection.

**`getPreviousFeedHistory`** — `SELECT snapshot_data FROM feed_history_snapshots WHERE feed_id = ?`. Returns `null` if not found. Callers are responsible for interpreting the returned string based on its `format` — the Feed Format spec defines the `"items_json"` shape.

**`storeFeedHistory`** — upsert into `feed_history_snapshots` on `feed_id` conflict, updating `snapshot_data`, `format` (defaults to `"items_json"`), `content_hash` (SHA-256 of the data string), `updated_at`.

**`clearFeedHistory`** — deletes row from `feed_history_snapshots` and all rows from `feed_history_items` for the given `feedId`.

**`loadDateIndex`** — `SELECT item_hash, first_seen_at FROM feed_history_items WHERE feed_id = ?`. Returns a `Map<string, string>` keyed by `item_hash`, valued by `first_seen_at`. Returns empty `Map` if no rows found.

**`saveDateIndex`** — for each `(itemHash, firstSeenDate)` entry in the `Map`, upsert into `feed_history_items` on `(feed_id, item_hash)` conflict: update `last_seen_at = now()` for existing rows; insert new rows with `id = feedId + ":" + itemHash`, `first_seen_at = firstSeenDate` (the Map value — preserving the original date), `last_seen_at = now()`. This ensures legacy dates are preserved during migration and the worker's first-seen tracking remains accurate.

#### `migrateLegacyFeedHistory`

```ts
export async function migrateLegacyFeedHistory(
  sqlite: Database,
  legacyDir = "./feed-history",
): Promise<{ snapshots: number; dateIndexes: number; skipped: number }>
```

**Behavior:**

1. If `legacyDir` does not exist, return `{ snapshots: 0, dateIndexes: 0, skipped: 0 }`.
2. Read all files in `legacyDir`.
3. For each `{feedId}.xml` file:
   - Validate `feedId` matches `/^[a-zA-Z0-9_\-]+$/`. Skip if unsafe.
   - Check if a row already exists in `feed_history_snapshots`. Skip if present.
   - Read the XML, store via `storeFeedHistory(feedId, xml, "legacy_xml")`. Increment `snapshots`.
4. For each `{feedId}.dates.json` file:
   - Validate `feedId`. Skip if unsafe.
   - Check if any rows already exist in `feed_history_items` for this `feedId`. Skip if present.
   - Parse the JSON as `Record<string, string>` (itemHash → firstSeenDate).
   - Insert all entries via `saveDateIndex`. Increment `dateIndexes`.
5. Log a summary: `[FeedHistory] Migrated N snapshots, N date indexes (N skipped).`
6. Return counts. **Never throws** — errors on individual files are caught, logged, and counted as skipped.

---

## Utility Wrapper

### `utilities/feed-history.utility.ts` — updated

The file keeps all existing exports. A module-level `_store` variable is `null` by default (file-based mode) or an active `FeedHistoryStore` (SQLite mode).

```ts
export function setFeedHistoryStore(store: FeedHistoryStore): void
```

Sets the module-level store. Called once on startup after creating a store from the runtime DB.

**Updated function behaviour:**

| Function | SQLite mode | File mode (no DB set) |
|---|---|---|
| `getPreviousFeedHistory` | Query `feed_history_snapshots` for `snapshot_data`; on miss, lazily migrate XML file with `format="legacy_xml"`, return | Read XML file directly |
| `storeFeedHistory` | Upsert to `feed_history_snapshots` with provided `format` (default `"items_json"`) | Write to file (legacy path, format ignored) |
| `clearFeedHistory` | Delete from both tables + delete XML file if present | Delete XML file |
| `loadDateIndex` | Query `feed_history_items` → Map; on empty, check JSON file, lazily migrate, return | Read JSON file |
| `saveDateIndex` | Upsert all entries to `feed_history_items` | Write JSON file |
| `makeItemKey` | Unchanged — pure function, no I/O | Same |
| `ensureFeedHistoryDir` | No-op (dir still created for legacy fallback) | Creates dir |

**Lazy migration pattern** (used by `getPreviousFeedHistory` and `loadDateIndex`):

```
try SQLite → if miss → check legacy file → if found → migrate to SQLite → return data
```

This means a feed whose files were skipped during startup migration (e.g. corrupted file fixed later) will self-heal on first access.

---

## Startup Wiring

### `index.ts` additions

```ts
import { createFeedHistoryStore, getDb, initDb, migrateLegacyFeedHistory } from "./lib/analytics/db";
import { setFeedHistoryStore } from "./utilities/feed-history.utility";

// In startup block, after runtime DB initialization:
try {
  initDb();
  const runtimeDb = getDb();
  setFeedHistoryStore(createFeedHistoryStore(runtimeDb));
  const migrationResult = await migrateLegacyFeedHistory(runtimeDb);
  console.log(
    `[Startup] Feed history migration complete: ${migrationResult.snapshots} snapshots, ` +
    `${migrationResult.dateIndexes} date indexes migrated.`,
  );
} catch (err) {
  console.error("[Startup] Feed history migration failed — continuing with file-based fallback:", err);
}
```

If the entire block throws, the app continues normally. The utility falls back to file-based mode because `setFeedHistoryStore` was never called.

---

## What This Spec Does Not Cover

- Worker changes — `loadDateIndex`, `saveDateIndex`, `makeItemKey`, `storeFeedHistory`, `getPreviousFeedHistory`, `clearFeedHistory` all keep their existing signatures
- Deleting legacy files after migration
- Advanced item history queries (new item counts, date-range filtering) — reserved for later features that need them
- Moving YAML feed configs into SQLite
