import { int, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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
}, (table) => [
  index("idx_run_logs_feed_id").on(table.feedId),
  index("idx_run_logs_started_at").on(table.startedAt),
]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type RunLog = typeof runLogs.$inferSelect;
export type NewRunLog = typeof runLogs.$inferInsert;

export const runtimeMigrations = sqliteTable("runtime_migrations", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  appliedAt:   text("applied_at").notNull(),
  detailsJson: text("details_json"),
});

export const feedHistorySnapshots = sqliteTable("feed_history_snapshots", {
  feedId:           text("feed_id").primaryKey(),
  format:           text("format").notNull().default("items_json"),
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
