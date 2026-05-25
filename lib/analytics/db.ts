import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

const DEFAULT_SETTINGS: RetentionSettings = {
  retentionDays: 30,
  retentionDaysEnabled: true,
  retentionRuns: 100,
  retentionRunsEnabled: true,
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

export async function getSettings(sqlite: Database): Promise<RetentionSettings> {
  const db = drizzle(sqlite, { schema });
  const rows = await db.select().from(schema.settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    retentionDays: map.retention_days !== undefined ? Number(map.retention_days) : DEFAULT_SETTINGS.retentionDays,
    retentionDaysEnabled: map.retention_days_enabled !== undefined ? map.retention_days_enabled === "true" : DEFAULT_SETTINGS.retentionDaysEnabled,
    retentionRuns: map.retention_runs !== undefined ? Number(map.retention_runs) : DEFAULT_SETTINGS.retentionRuns,
    retentionRunsEnabled: map.retention_runs_enabled !== undefined ? map.retention_runs_enabled === "true" : DEFAULT_SETTINGS.retentionRunsEnabled,
  };
}

export async function saveSettings(sqlite: Database, s: RetentionSettings): Promise<void> {
  const db = drizzle(sqlite, { schema });
  const entries = [
    { key: "retention_days", value: String(s.retentionDays) },
    { key: "retention_days_enabled", value: String(s.retentionDaysEnabled) },
    { key: "retention_runs", value: String(s.retentionRuns) },
    { key: "retention_runs_enabled", value: String(s.retentionRunsEnabled) },
  ];
  for (const entry of entries) {
    await db
      .insert(schema.settings)
      .values(entry)
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: entry.value } });
  }
}
