-- Consolidates the duplicate settings store.
--
-- `settings` and `app_settings` were declared with an identical
-- {key, value} shape, but only `app_settings` was ever read or written —
-- every accessor in lib/analytics/db.ts uses it. `settings` was created by
-- migration 0000 and then never touched: a decoy that a future change could
-- easily have written to instead of the live table.
--
-- Order matters here. Rows are carried across BEFORE the drop, and the
-- live table wins on a key present in both: `app_settings` is what the
-- application has actually been reading, so its value is the current one and
-- the dead table's is at best stale.

CREATE TABLE IF NOT EXISTS `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `app_settings` (`key`, `value`)
SELECT `key`, `value` FROM `settings`
WHERE `key` NOT IN (SELECT `key` FROM `app_settings`);
--> statement-breakpoint
DROP TABLE `settings`;
