import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const runLogs = sqliteTable("run_logs", {
  id: int("id").primaryKey({ autoIncrement: true }),
  feedId: text("feed_id").notNull(),
  feedName: text("feed_name").notNull(),
  feedType: text("feed_type").notNull(),
  startedAt: int("started_at").notNull(),
  durationMs: int("duration_ms"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  httpStatus: int("http_status"),
  timedOut: int("timed_out").notNull().default(0),
  itemCount: int("item_count"),
  prevItemCount: int("prev_item_count"),
  selectorMatches: text("selector_matches"),
  dateFallbacks: int("date_fallbacks").notNull().default(0),
  duplicateGuids: int("duplicate_guids").notNull().default(0),
  webhookStatus: text("webhook_status"),
  webhookError: text("webhook_error"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type RunLog = typeof runLogs.$inferSelect;
export type NewRunLog = typeof runLogs.$inferInsert;
