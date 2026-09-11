CREATE TABLE `webhook_feed_events` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`external_id` text,
	`received_at` text NOT NULL,
	`event_date` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`link` text,
	`author` text,
	`categories_json` text NOT NULL,
	`severity` text,
	`metadata_json` text,
	`raw_payload_json` text,
	`dedupe_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_feed_events_feed_date` ON `webhook_feed_events` (`feed_id`, `event_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhook_feed_events_dedupe` ON `webhook_feed_events` (`feed_id`, `dedupe_key`);
