CREATE TABLE `run_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` text NOT NULL,
	`feed_name` text NOT NULL,
	`feed_type` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer,
	`status` text NOT NULL,
	`error_message` text,
	`http_status` integer,
	`timed_out` integer DEFAULT 0 NOT NULL,
	`item_count` integer,
	`prev_item_count` integer,
	`selector_matches` text,
	`date_fallbacks` integer DEFAULT 0 NOT NULL,
	`duplicate_guids` integer DEFAULT 0 NOT NULL,
	`webhook_status` text,
	`webhook_error` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
