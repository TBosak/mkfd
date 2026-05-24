# SQLite Runtime Substrate + Feed History Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate Mkfd runtime state into one SQLite database (`./data/runtime.db`) and move feed history persistence from flat files (`./feed-history/*.xml` and `*.dates.json`) into that runtime DB. Keep existing `feed-history.utility.ts` exports unchanged so workers can migrate incrementally.

**Architecture:** The existing analytics DB stack becomes the runtime DB stack. `lib/analytics/schema.ts` continues to own `run_logs`/`settings` and adds `runtime_migrations`, `feed_history_snapshots`, and `feed_history_items`. `lib/analytics/db.ts` initializes `process.env.RUNTIME_DB_PATH ?? "./data/runtime.db"`. A `FeedHistoryStore` interface is implemented against this same DB. `feed-history.utility.ts` is rewritten as a thin wrapper that uses the runtime store when initialized, falling back to file I/O otherwise. Startup calls `initDb` → `setFeedHistoryStore` → `migrateLegacyFeedHistory` inside a try/catch so migration failure never prevents the app from starting.

**Existing branch note:** This branch already has `health.db` wired through `drizzle.config.ts`, `lib/analytics/db.ts`, `lib/analytics/schema.ts`, `index.ts`, Docker env, and health API responses. Because the branch is not live, implementation should directly replace those touchpoints with `runtime.db`/`RUNTIME_DB_PATH` rather than preserving `health.db`, adding `DB_PATH` fallback logic, or creating a migration path.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `drizzle-orm`, `drizzle-kit`, `bun:test`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `drizzle.config.ts` | Point default DB URL at `RUNTIME_DB_PATH ?? ./data/runtime.db` |
| Modify | `lib/analytics/schema.ts` | Keep `run_logs`/`settings`; add `runtime_migrations`, `feed_history_snapshots`, and `feed_history_items` |
| Modify | `lib/analytics/db.ts` | Initialize runtime DB; expose `createFeedHistoryStore`, `migrateLegacyFeedHistory`, and existing run-log helpers from one DB |
| Create | `tests/feed-history-store.test.ts` | Tests for the store and migration function |
| Modify | `utilities/feed-history.utility.ts` | Rewrite as wrapper over `FeedHistoryStore`; preserve all existing exports |
| Modify | `index.ts` | Add startup wiring block |
| Modify | `docker-compose.yml` and deployment docs | Replace `DB_PATH=/app/data/health.db` with `RUNTIME_DB_PATH=/app/data/runtime.db` |
| Modify | `package.json` | Keep one Drizzle generate script for runtime DB migrations |

---

### Task 1: Runtime DB config and package.json script

**Files:**
- Modify: `drizzle.config.ts`
- Modify: `lib/analytics/db.ts`
- Modify: `docker-compose.yml`
- Modify: `package.json`

- [ ] **Step 1: Create the Drizzle config**

```typescript
// drizzle.config.ts
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

- [ ] **Step 2: Keep a single migration generate script in package.json**

In `package.json`, keep or add one runtime DB migration script:

```json
"db:generate": "bunx drizzle-kit generate --config=drizzle.config.ts"
```

- [ ] **Step 3: Update existing analytics DB defaults**

Update the existing `lib/analytics/db.ts` default from `process.env.DB_PATH ?? "./data/health.db"` to `process.env.RUNTIME_DB_PATH ?? "./data/runtime.db"`. Update health/settings API responses that expose the DB path to use the same expression.

- [ ] **Step 4: Update deployment env docs**

Change container/default examples from `DB_PATH=/app/data/health.db` to `RUNTIME_DB_PATH=/app/data/runtime.db`. Remove `DB_PATH` from new docs/config examples because this branch is not live.

- [ ] **Step 5: Commit**

```bash
git add drizzle.config.ts lib/analytics/db.ts docker-compose.yml package.json
git commit -m "feat: rename analytics sqlite database to runtime database"
```

---

### Task 2: Schema and initial migration

**Files:**
- Modify: `lib/analytics/schema.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// lib/analytics/schema.ts
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
  // "items_json" = JSON array of { guid?, link?, title?, pubDate? } (written by Feed Format refactor)
  // "legacy_xml" = raw RSS XML string (written only during legacy migration)
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
    id:                 text("id").primaryKey(),
    feedId:             text("feed_id").notNull(),
    guid:               text("guid"),
    link:               text("link"),
    title:              text("title"),
    titleHash:          text("title_hash"),
    itemHash:           text("item_hash").notNull(),
    pubDate:            text("pub_date"),
    firstSeenAt:        text("first_seen_at").notNull(),
    lastSeenAt:         text("last_seen_at").notNull(),
    sourceSnapshotHash: text("source_snapshot_hash"),
  },
  (table) => [
    index("idx_feed_history_items_feed_id").on(table.feedId),
    uniqueIndex("idx_feed_history_items_dedupe").on(table.feedId, table.itemHash),
  ],
);

export type FeedHistorySnapshot = typeof feedHistorySnapshots.$inferSelect;
export type FeedHistoryItem     = typeof feedHistoryItems.$inferSelect;
```

- [ ] **Step 2: Generate the migration**

```bash
bun run db:generate
```

Expected: A new SQL file appears in `./drizzle/migrations/` containing `CREATE TABLE "runtime_migrations"`, `CREATE TABLE "feed_history_snapshots"`, and `CREATE TABLE "feed_history_items"`.

- [ ] **Step 3: Verify the migration file exists**

```bash
ls ./drizzle/migrations/
```

Expected: One or more `.sql` files listed.

- [ ] **Step 4: Commit**

```bash
git add lib/analytics/schema.ts drizzle/migrations/ drizzle.config.ts package.json
git commit -m "feat: add runtime feed history schema and migration"
```

---

### Task 3: Runtime DB feed history store operations

**Files:**
- Modify: `lib/analytics/db.ts`
- Create: `tests/feed-history-store.test.ts`

- [ ] **Step 1: Write failing snapshot store tests**

```typescript
// tests/feed-history-store.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/feed-history-store.test.ts
```

Expected: FAIL — `createFeedHistoryStore` not found

- [ ] **Step 3: Extend lib/analytics/db.ts with runtime feed history operations**

```typescript
// lib/analytics/db.ts
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import * as schema from "./schema";

export interface FeedHistoryStore {
  getPreviousFeedHistory(feedId: string): Promise<string | null>;
  storeFeedHistory(feedId: string, snapshotData: string, format?: string): Promise<void>;
  clearFeedHistory(feedId: string): Promise<void>;
  loadDateIndex(feedId: string): Promise<Map<string, string>>;
  saveDateIndex(feedId: string, index: Map<string, string>): Promise<void>;
}

export function initDb(
  dbPath = process.env.RUNTIME_DB_PATH ?? "./data/runtime.db",
): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle/migrations" });
  return sqlite;
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

    // loadDateIndex and saveDateIndex implemented in Task 4
    async loadDateIndex(_feedId: string): Promise<Map<string, string>> {
      return new Map();
    },

    async saveDateIndex(_feedId: string, _index: Map<string, string>): Promise<void> {
      // implemented in Task 4
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/feed-history-store.test.ts
```

Expected: PASS (snapshot tests only)

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/db.ts tests/feed-history-store.test.ts
git commit -m "feat: add runtime FeedHistoryStore operations"
```

---

### Task 4: Date-index store operations

**Files:**
- Modify: `lib/analytics/db.ts`
- Modify: `tests/feed-history-store.test.ts`

- [ ] **Step 1: Add failing date-index tests**

Append to `tests/feed-history-store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/feed-history-store.test.ts
```

Expected: FAIL — date-index tests fail (stub returns empty Map, save is no-op)

- [ ] **Step 3: Implement loadDateIndex and saveDateIndex**

In `lib/analytics/db.ts`, replace the stub `loadDateIndex` and `saveDateIndex` inside `createFeedHistoryStore` with:

```typescript
async loadDateIndex(feedId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({
      itemHash:   schema.feedHistoryItems.itemHash,
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
```

- [ ] **Step 4: Run all store tests to verify they pass**

```bash
bun test tests/feed-history-store.test.ts
```

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/db.ts tests/feed-history-store.test.ts
git commit -m "feat: implement loadDateIndex and saveDateIndex in FeedHistoryStore"
```

---

### Task 5: migrateLegacyFeedHistory

**Files:**
- Modify: `lib/analytics/db.ts`
- Modify: `tests/feed-history-store.test.ts`

- [ ] **Step 1: Add failing migration tests**

Append to `tests/feed-history-store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/feed-history-store.test.ts
```

Expected: FAIL — `migrateLegacyFeedHistory` not exported

- [ ] **Step 3: Implement migrateLegacyFeedHistory**

Add to `lib/analytics/db.ts` (after the `createFeedHistoryStore` export):

```typescript
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";

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
```

- [ ] **Step 4: Run all store tests to verify they pass**

```bash
bun test tests/feed-history-store.test.ts
```

Expected: PASS (all tests)

- [ ] **Step 5: Run all project tests to confirm no regressions**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add lib/analytics/db.ts tests/feed-history-store.test.ts
git commit -m "feat: implement migrateLegacyFeedHistory for XML and dates.json files"
```

---

### Task 6: Rewrite feed-history utility as wrapper

**Files:**
- Modify: `utilities/feed-history.utility.ts`

- [ ] **Step 1: Verify existing feed-history tests still pass before touching the file**

```bash
bun test tests/feed-history.test.ts
```

Expected: PASS — these tests exercise the file-based path and must continue passing

- [ ] **Step 2: Rewrite utilities/feed-history.utility.ts**

Replace the entire file with:

```typescript
// utilities/feed-history.utility.ts
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { FeedHistoryStore } from "../lib/analytics/db";

const FEED_HISTORY_DIR = "./feed-history";

let _store: FeedHistoryStore | null = null;

export function setFeedHistoryStore(store: FeedHistoryStore): void {
  _store = store;
}

export function ensureFeedHistoryDir(): void {
  if (!existsSync(FEED_HISTORY_DIR)) {
    mkdirSync(FEED_HISTORY_DIR, { recursive: true });
  }
}

export async function storeFeedHistory(feedId: string, snapshotData: string, format = "items_json"): Promise<void> {
  if (_store) {
    await _store.storeFeedHistory(feedId, snapshotData, format);
    return;
  }
  ensureFeedHistoryDir();
  // File-based fallback: write as .xml regardless of format (legacy behaviour)
  await writeFile(join(FEED_HISTORY_DIR, `${feedId}.xml`), snapshotData, "utf8");
}

export async function getPreviousFeedHistory(feedId: string): Promise<string | null> {
  if (_store) {
    const fromDb = await _store.getPreviousFeedHistory(feedId);
    if (fromDb !== null) return fromDb;
    // Lazy migration: check legacy file
    const xmlPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
    if (existsSync(xmlPath)) {
      try {
        const xml = await readFile(xmlPath, "utf8");
        await _store.storeFeedHistory(feedId, xml, "legacy_xml");
        return xml;
      } catch { /* fall through */ }
    }
    return null;
  }
  // File-based fallback
  const xmlPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
  try {
    if (existsSync(xmlPath)) return await readFile(xmlPath, "utf8");
  } catch { /* ignore */ }
  return null;
}

export async function clearFeedHistory(feedId: string): Promise<void> {
  if (_store) {
    await _store.clearFeedHistory(feedId);
  }
  const xmlPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
  if (existsSync(xmlPath)) {
    const { unlink } = await import("node:fs/promises");
    await unlink(xmlPath);
  }
}

export async function loadDateIndex(feedId: string): Promise<Map<string, string>> {
  if (_store) {
    const fromDb = await _store.loadDateIndex(feedId);
    if (fromDb.size > 0) return fromDb;
    // Lazy migration: check legacy .dates.json file
    const jsonPath = join(FEED_HISTORY_DIR, `${feedId}.dates.json`);
    if (existsSync(jsonPath)) {
      try {
        const raw = await readFile(jsonPath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, string>;
        const index = new Map(Object.entries(parsed));
        await _store.saveDateIndex(feedId, index);
        return index;
      } catch { /* fall through */ }
    }
    return new Map();
  }
  // File-based fallback
  ensureFeedHistoryDir();
  const jsonPath = join(FEED_HISTORY_DIR, `${feedId}.dates.json`);
  try {
    if (existsSync(jsonPath)) {
      const raw = await readFile(jsonPath, "utf8");
      return new Map(Object.entries(JSON.parse(raw)));
    }
  } catch { /* ignore */ }
  return new Map();
}

export async function saveDateIndex(feedId: string, index: Map<string, string>): Promise<void> {
  if (_store) {
    await _store.saveDateIndex(feedId, index);
    return;
  }
  ensureFeedHistoryDir();
  await writeFile(
    join(FEED_HISTORY_DIR, `${feedId}.dates.json`),
    JSON.stringify(Object.fromEntries(index)),
    "utf8",
  );
}

// Pure function — unchanged
function stableStringify(val: unknown): string {
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(",")}]`;
  if (val !== null && typeof val === "object") {
    return `{${Object.keys(val as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(val);
}

export function makeItemKey(item: Record<string, unknown>): string {
  const { date: _date, ...rest } = item;
  return createHash("sha256").update(stableStringify(rest)).digest("hex");
}
```

- [ ] **Step 3: Run existing feed-history tests to confirm file-based path still works**

```bash
bun test tests/feed-history.test.ts
```

Expected: PASS — file-based behaviour unchanged

- [ ] **Step 4: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-history.utility.ts
git commit -m "feat: rewrite feed-history utility as SQLite wrapper with file fallback"
```

---

### Task 7: Startup wiring in index.ts

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add imports near the top of index.ts**

```typescript
import { createFeedHistoryStore, getDb, initDb, migrateLegacyFeedHistory } from "./lib/analytics/db";
import { setFeedHistoryStore } from "./utilities/feed-history.utility";
```

- [ ] **Step 2: Find the existing initDb() call in index.ts**

```bash
grep -n "initDb\|initDb()" /home/timb/projects/mkfd/index.ts | head -5
```

- [ ] **Step 3: Add the feed history store startup block immediately after the existing runtime DB init**

```typescript
// After: initDb();  (or wherever the runtime DB is initialized)

try {
  const runtimeDb = getDb();
  setFeedHistoryStore(createFeedHistoryStore(runtimeDb));
  const migrationResult = await migrateLegacyFeedHistory(runtimeDb);
  console.log(
    `[Startup] Feed history migration complete: ` +
    `${migrationResult.snapshots} snapshots, ` +
    `${migrationResult.dateIndexes} date indexes migrated.`,
  );
} catch (err) {
  console.error(
    "[Startup] Feed history DB init failed — continuing with file-based fallback:",
    err,
  );
}
```

- [ ] **Step 4: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 5: Start the dev server and confirm startup log appears**

```bash
bun run dev
```

Expected output includes one of:
- `[Startup] Feed history migration complete: N snapshots, N date indexes migrated.`
- `[Startup] Feed history DB init failed — continuing with file-based fallback: ...` (if `./data/` is not writable)

Confirm the app responds to requests normally. Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "feat: initialize runtime.db and run legacy feed history migration on startup"
```
