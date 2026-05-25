CREATE TABLE `feed_history_items` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`guid` text,
	`link` text,
	`title` text,
	`title_hash` text,
	`item_hash` text NOT NULL,
	`pub_date` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`source_snapshot_hash` text
);
--> statement-breakpoint
CREATE INDEX `idx_feed_history_items_feed_id` ON `feed_history_items` (`feed_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feed_history_items_dedupe` ON `feed_history_items` (`feed_id`,`item_hash`);--> statement-breakpoint
CREATE TABLE `feed_history_snapshots` (
	`feed_id` text PRIMARY KEY NOT NULL,
	`format` text DEFAULT 'items_json' NOT NULL,
	`snapshot_data` text NOT NULL,
	`content_hash` text,
	`item_count` integer,
	`migrated_from_path` text,
	`migrated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`applied_at` text NOT NULL,
	`details_json` text
);
