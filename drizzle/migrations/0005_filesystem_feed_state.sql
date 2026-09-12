CREATE TABLE IF NOT EXISTS `filesystem_feed_state` (
	`feed_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`stable_id` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_modified_at` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_filesystem_feed_state_identity` ON `filesystem_feed_state` (`feed_id`,`relative_path`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_filesystem_feed_state_feed_id` ON `filesystem_feed_state` (`feed_id`);
