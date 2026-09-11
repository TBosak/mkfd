import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { WebhookFeedEvent } from "../../models/webhook.model";
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

/**
 * Why the database is unusable, or null when it is fine.
 *
 * A failed migration used to throw out of `initDb` and take the process with
 * it, which meant a degraded database was observable only as a dead container
 * and a stack trace in the logs. Recording the reason lets readiness report it
 * while the process keeps serving — an operator can then reach the app to see
 * what is wrong instead of watching it restart-loop.
 */
let _degradedReason: string | null = null;

/**
 * Strips absolute filesystem paths out of an error message.
 *
 * `redact()` from the logging utility hides values by *field name*, which does
 * not help with a path embedded in a free-text message, so this is the narrow
 * complement rather than a second redactor: it removes Windows drive paths and
 * POSIX absolute paths, leaving the diagnostic sentence intact.
 */
function redactPaths(message: string): string {
  return message
    .replace(/[A-Za-z]:[\\/][^\s"']*/g, "<path>")
    .replace(/(?<![\w.])\/(?:[^\s"']+\/)*[^\s"']+/g, "<path>");
}

/** The database's state, for the readiness surface. Never includes a path. */
export function getDatabaseReadiness(): { ready: boolean; reason?: string } {
  if (_degradedReason) return { ready: false, reason: _degradedReason };
  if (!_sqlite) return { ready: false, reason: "Runtime database has not been initialised." };
  return { ready: true };
}

export function initDb(dbPath: string = process.env.RUNTIME_DB_PATH ?? "./data/runtime.db"): Database {
  const absoluteDbPath = join(process.cwd(), dbPath);
  mkdirSync(dirname(absoluteDbPath), { recursive: true });

  _degradedReason = null;
  _sqlite = new Database(absoluteDbPath);
  const db = drizzle(_sqlite, { schema });
  
  // In Bun, import.meta.dir is the most reliable way to get the current file's directory
  const currentDir = import.meta.dir;
  const migrationsFolder = join(currentDir, "../../drizzle/migrations");
  
  console.log(`[Analytics] Initializing DB at ${absoluteDbPath}`);
  console.log(`[Analytics] Migrations folder: ${migrationsFolder}`);
  
  try {
    if (!existsSync(migrationsFolder)) {
      throw new Error(`Migrations folder not found at ${migrationsFolder}`);
    }
    const migrationFiles = readdirSync(migrationsFolder);
    console.log(`[Analytics] Found migration files: ${migrationFiles.join(", ")}`);
    
    migrate(db, { migrationsFolder });
    console.log("[Analytics] Migrations complete");
  } catch (err) {
    // Recorded rather than thrown. Throwing here killed startup, so the only
    // symptom of a bad database was a restart loop — nothing could be asked
    // what was wrong. The process now stays up and reports not-ready, and the
    // reason deliberately carries no filesystem path: readiness is frequently
    // exposed to an orchestrator and scraped into logs.
    const message = err instanceof Error ? err.message : String(err);
    _degradedReason = `Runtime database could not be opened or migrated: ${redactPaths(message)}`;
    console.error("[Analytics] Migration failed:", err);
  }
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
// Webhook event state
// ---------------------------------------------------------------------------

const WEBHOOK_MAX_ITEMS = 1_000;
const WEBHOOK_MAX_RETENTION_DAYS = 3_650;
const WEBHOOK_LEGACY_LINE_BYTES = 64 * 1024;
const SAFE_WEBHOOK_FEED_ID = /^[A-Za-z0-9_-]+$/;

export type WebhookEventStore = {
  ingest(
    feedId: string,
    event: WebhookFeedEvent,
    policy: { maxItems: number; retentionDays: number },
  ): Promise<{ duplicate: boolean }>;
  read(feedId: string, limit?: number): Promise<WebhookFeedEvent[]>;
  migrateLegacy(): Promise<{ imported: number; skipped: number; files: number }>;
};

export function createWebhookEventStore(
  sqlite: Database,
  options: { clock?: () => Date; legacyDir?: string } = {},
): WebhookEventStore {
  const clock = options.clock ?? (() => new Date());
  let initialMigration: Promise<{ imported: number; skipped: number; files: number }> | undefined;

  const migrateLegacyFiles = async (): Promise<{
    imported: number;
    skipped: number;
    files: number;
  }> => {
    const legacyDir = options.legacyDir;
    if (!legacyDir || !existsSync(legacyDir)) {
      return { imported: 0, skipped: 0, files: 0 };
    }

    let imported = 0;
    let skipped = 0;
    let migratedFiles = 0;
    const files = await readdir(legacyDir);
    for (const filename of files.sort()) {
      const match = /^([A-Za-z0-9_-]+)\.jsonl$/.exec(filename);
      if (!match) {
        skipped += 1;
        continue;
      }
      const feedId = match[1];
      if (!SAFE_WEBHOOK_FEED_ID.test(feedId)) {
        skipped += 1;
        continue;
      }

      let raw: string;
      try {
        raw = await readFile(join(legacyDir, filename), "utf8");
      } catch {
        skipped += 1;
        continue;
      }
      const contentHash = createHash("sha256").update(raw).digest("hex");
      const migrationId = `webhook-jsonl:${feedId}:${contentHash}`;
      const alreadyMigrated = sqlite
        .query("SELECT id FROM runtime_migrations WHERE id = ? LIMIT 1")
        .get(migrationId);
      if (alreadyMigrated) continue;

      const migrateFile = sqlite.transaction(() => {
        let fileImported = 0;
        let fileSkipped = 0;
        for (const line of raw.split(/\r?\n/)) {
          if (!line) continue;
          if (Buffer.byteLength(line, "utf8") > WEBHOOK_LEGACY_LINE_BYTES) {
            fileSkipped += 1;
            continue;
          }
          try {
            const event = parseLegacyWebhookEvent(JSON.parse(line), feedId);
            if (insertWebhookEventRow(sqlite, feedId, event)) fileImported += 1;
          } catch {
            fileSkipped += 1;
          }
        }
        sqlite
          .query(
            "INSERT INTO runtime_migrations (id, name, applied_at, details_json) VALUES (?, ?, ?, ?)",
          )
          .run(
            migrationId,
            "Legacy webhook event copy-forward",
            clock().toISOString(),
            JSON.stringify({ imported: fileImported, skipped: fileSkipped }),
          );
        return { fileImported, fileSkipped };
      });

      const result = migrateFile();
      imported += result.fileImported;
      skipped += result.fileSkipped;
      migratedFiles += 1;
    }
    return { imported, skipped, files: migratedFiles };
  };

  const ensureInitialMigration = async (): Promise<void> => {
    initialMigration ??= migrateLegacyFiles();
    await initialMigration;
  };

  return {
    async ingest(feedId, event, policy) {
      await ensureInitialMigration();
      if (!SAFE_WEBHOOK_FEED_ID.test(feedId)) {
        throw new Error("Invalid webhook feed identifier.");
      }
      const normalized = normalizeWebhookStoragePolicy(policy);
      const cutoff = new Date(
        clock().getTime() - normalized.retentionDays * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const ingestTransaction = sqlite.transaction(() => {
        const inserted = insertWebhookEventRow(sqlite, feedId, event);
        sqlite
          .query("DELETE FROM webhook_feed_events WHERE feed_id = ? AND event_date < ?")
          .run(feedId, cutoff);
        sqlite
          .query(`
            DELETE FROM webhook_feed_events
            WHERE feed_id = ? AND id IN (
              SELECT id FROM webhook_feed_events
              WHERE feed_id = ?
              ORDER BY event_date DESC, received_at DESC, id DESC
              LIMIT -1 OFFSET ?
            )
          `)
          .run(feedId, feedId, normalized.maxItems);
        return inserted;
      });
      return { duplicate: !ingestTransaction() };
    },

    async read(feedId, limit = WEBHOOK_MAX_ITEMS) {
      await ensureInitialMigration();
      if (!SAFE_WEBHOOK_FEED_ID.test(feedId)) {
        throw new Error("Invalid webhook feed identifier.");
      }
      const boundedLimit = Number.isInteger(limit) && limit > 0
        ? Math.min(limit, WEBHOOK_MAX_ITEMS)
        : WEBHOOK_MAX_ITEMS;
      const rows = sqlite
        .query(`
          SELECT id, feed_id, external_id, received_at, event_date, title,
                 description, link, author, categories_json, severity,
                 metadata_json, raw_payload_json, dedupe_key
          FROM webhook_feed_events
          WHERE feed_id = ?
          ORDER BY event_date DESC, received_at DESC, id DESC
          LIMIT ?
        `)
        .all(feedId, boundedLimit) as WebhookEventRow[];
      return rows.map(webhookEventFromRow);
    },

    migrateLegacy: migrateLegacyFiles,
  };
}

type WebhookEventRow = {
  id: string;
  feed_id: string;
  external_id: string | null;
  received_at: string;
  event_date: string;
  title: string;
  description: string | null;
  link: string | null;
  author: string | null;
  categories_json: string;
  severity: WebhookFeedEvent["severity"] | null;
  metadata_json: string | null;
  raw_payload_json: string | null;
  dedupe_key: string;
};

function normalizeWebhookStoragePolicy(policy: {
  maxItems: number;
  retentionDays: number;
}): { maxItems: number; retentionDays: number } {
  for (const [field, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Webhook ${field} must be a positive integer.`);
    }
  }
  return {
    maxItems: Math.min(policy.maxItems, WEBHOOK_MAX_ITEMS),
    retentionDays: Math.min(policy.retentionDays, WEBHOOK_MAX_RETENTION_DAYS),
  };
}

function insertWebhookEventRow(
  sqlite: Database,
  feedId: string,
  event: WebhookFeedEvent,
): boolean {
  const result = sqlite
    .query(`
      INSERT INTO webhook_feed_events (
        id, feed_id, external_id, received_at, event_date, title, description,
        link, author, categories_json, severity, metadata_json,
        raw_payload_json, dedupe_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feed_id, dedupe_key) DO NOTHING
    `)
    .run(
      event.id,
      feedId,
      event.externalId ?? null,
      event.receivedAt,
      event.eventDate,
      event.title,
      event.description ?? null,
      event.link ?? null,
      event.author ?? null,
      JSON.stringify(event.categories),
      event.severity ?? null,
      event.metadata === undefined ? null : JSON.stringify(event.metadata),
      event.rawPayload === undefined ? null : JSON.stringify(event.rawPayload),
      event.dedupeKey,
    );
  return result.changes === 1;
}

function webhookEventFromRow(row: WebhookEventRow): WebhookFeedEvent {
  return {
    id: row.id,
    feedId: row.feed_id,
    externalId: row.external_id ?? undefined,
    receivedAt: row.received_at,
    eventDate: row.event_date,
    title: row.title,
    description: row.description ?? undefined,
    link: row.link ?? undefined,
    author: row.author ?? undefined,
    categories: JSON.parse(row.categories_json) as string[],
    severity: row.severity ?? undefined,
    metadata: row.metadata_json
      ? JSON.parse(row.metadata_json) as Record<string, unknown>
      : undefined,
    rawPayload: row.raw_payload_json
      ? JSON.parse(row.raw_payload_json) as unknown
      : undefined,
    dedupeKey: row.dedupe_key,
  };
}

function parseLegacyWebhookEvent(input: unknown, feedId: string): WebhookFeedEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid legacy webhook event.");
  }
  const value = input as Record<string, unknown>;
  const requiredStrings = ["id", "feedId", "receivedAt", "eventDate", "title", "dedupeKey"];
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string" || !value[field]) {
      throw new Error("Invalid legacy webhook event.");
    }
  }
  if (value.feedId !== feedId || !Array.isArray(value.categories)) {
    throw new Error("Invalid legacy webhook event.");
  }
  if (!value.categories.every((category) => typeof category === "string")) {
    throw new Error("Invalid legacy webhook event.");
  }
  const optionalStrings = ["externalId", "description", "link", "author"] as const;
  for (const field of optionalStrings) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error("Invalid legacy webhook event.");
    }
  }
  if (
    value.severity !== undefined &&
    !["info", "success", "warning", "error"].includes(String(value.severity))
  ) {
    throw new Error("Invalid legacy webhook event.");
  }
  return {
    id: value.id as string,
    feedId: value.feedId as string,
    externalId: value.externalId as string | undefined,
    receivedAt: value.receivedAt as string,
    eventDate: value.eventDate as string,
    title: value.title as string,
    description: value.description as string | undefined,
    link: value.link as string | undefined,
    author: value.author as string | undefined,
    categories: value.categories,
    severity: value.severity as WebhookFeedEvent["severity"],
    metadata: value.metadata as Record<string, unknown> | undefined,
    rawPayload: value.rawPayload,
    dedupeKey: value.dedupeKey as string,
  };
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

// ---------------------------------------------------------------------------
// Backup and restore
//
// Documented in docs/operations/database-backup-restore.md. The runtime
// database holds feed history and settings, so a copy taken while the app is
// writing can be torn — SQLite's own VACUUM INTO takes a consistent snapshot
// instead, which is why this is a function rather than "copy the file".
// ---------------------------------------------------------------------------

/**
 * Writes a consistent snapshot of the runtime database to `destinationPath`.
 *
 * The result is a standalone SQLite file that opens independently of the
 * source, with no WAL or journal sidecar required.
 */
export function backupRuntimeDatabase(sqlite: Database, destinationPath: string): void {
  const absolute = isAbsolute(destinationPath)
    ? destinationPath
    : join(process.cwd(), destinationPath);
  mkdirSync(dirname(absolute), { recursive: true });
  if (existsSync(absolute)) rmSync(absolute);
  // VACUUM INTO snapshots under a read transaction, so it is safe while the
  // app is running. A plain file copy is not.
  sqlite.run(`VACUUM INTO '${absolute.replace(/'/g, "''")}'`);
}

/**
 * Restores a backup over the runtime database file.
 *
 * The caller is responsible for the database being closed first; restoring
 * underneath an open handle is how a half-written file happens.
 */
export function restoreRuntimeDatabase(backupPath: string, destinationPath: string): void {
  const source = isAbsolute(backupPath) ? backupPath : join(process.cwd(), backupPath);
  const target = isAbsolute(destinationPath)
    ? destinationPath
    : join(process.cwd(), destinationPath);
  if (!existsSync(source)) {
    throw new Error("Backup file not found; refusing to restore from a missing snapshot.");
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
