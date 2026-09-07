# TDD Requirements Brief: `p3-settings-substrate-reconciliation`

## Ownership

- Roadmap packet and findings: Packet 3, "reconcile `settings` vs `app_settings`, use managed Drizzle migrations for all runtime tables, document backup/restore, expose degraded DB state through readiness, and execute the SQLite real-data/lazy-migration smoke plan."
- Production surfaces owned by this slice: `lib/analytics/schema.ts`, `lib/analytics/db.ts`, `drizzle/migrations/*`, `utilities/app-settings.utility.ts`, and whatever readiness surface the implementation introduces.
- Explicitly NOT in this slice: the **typed settings registry** with defaults, validation, secret classification and live-vs-restart behaviour. That is a separate Packet 3 bullet and depends on this substrate being settled first. This slice is the storage layer, not the setting semantics.
- Do not touch the outbound executor (`utilities/outbound-fetch-policy.utility.ts`, `utilities/feed-config-route-adapter.utility.ts`, `utilities/fetch-policy.utility.ts`, `lib/outbound/*`) or the config caster/normalizer/validator — both contracts were frozen by earlier slices and their test files are locked.
- Claude-owned test surfaces: `tests/` only.

## Current RED baseline

`bun run verify:core` = **1655 pass / 0 fail** at commit `62ee07d`. `bun run test:e2e` = **56 passed / 8 skipped / 0 failed**. Fifteen test locks verify.

Static gate: **zero errors, 542 warnings, 10 infos** against a locked ceiling of 545/13. Stay at or below 542/10. Three separate anti-bypass gates fired on the previous slice — they count `noExplicitAny`, `noNonNullAssertion`, and `as unknown as` occurrences and refuse growth. Note the last of those greps raw text, so it counts the string appearing in a **comment** too.

### What is already correct

Stated so the brief does not imply more is broken than is:

- All six runtime tables — `run_logs`, `settings`, `app_settings`, `runtime_migrations`, `feed_history_snapshots`, `feed_history_items` — are created by files in `drizzle/migrations/`, and `lib/analytics/db.ts:60` applies them with Drizzle's `migrate()`. Managed migrations are in place.

### The defects

1. **`settings` is a dead table.** `lib/analytics/schema.ts:26` declares it with the same `{ key, value }` shape as `app_settings` at line 34, and migration `0000` creates it. Nothing reads or writes it: the only settings accessors in `lib/analytics/db.ts` (lines 151–168) use `schema.appSettings`. Two identical tables where one is live and one is a decoy is exactly how a future change writes to the wrong one.

2. **A failed migration takes down startup with no readiness signal.** `lib/analytics/db.ts:52-67` throws on any migration error, and the comment there says so explicitly ("let's throw to see the error in logs"). The app has health routes (`routes/health.ts`) but they report *feed run* health, not database state, so there is no way to observe a degraded database short of the process dying.

3. **Backup and restore are undocumented.** The runtime DB holds feed history and settings; nothing states how to back it up or restore it, or what happens if it is restored from an older schema.

## Required observable behavior

1. **One settings table.** The duplicate is resolved so that only one key/value settings table exists in the schema, with a migration that removes the other without losing data. If any rows exist in the dead table, they must be carried over rather than dropped — prove that with a fixture that seeds the losing table before migrating.
2. **Reading and writing a setting works through one accessor**, and a round trip returns exactly what was written, including values containing quotes, newlines, and non-ASCII characters.
3. **A failed or partial migration is observable rather than fatal-and-silent.** Startup must surface a degraded database state through a readiness surface instead of only throwing into the log. State what "degraded" means concretely — the process is running but the database is unusable — and prove the readiness surface reports it. Whether startup still refuses to serve traffic is a design decision; say which you chose and why.
4. **Readiness distinguishes healthy from degraded.** A healthy database reports ready; a database that cannot be opened or migrated reports not-ready with a reason. The reason must not leak a filesystem path or a connection string beyond what an operator needs — reuse `redact()` from `utilities/log-redaction.utility.ts` rather than writing a second redactor.
5. **Migrations are idempotent and safe to re-run.** Applying migrations twice against the same database is a no-op. Prove it against a real SQLite file, not a mock.
6. **A database created by an older schema still opens.** Seed a database at an earlier migration point, run startup, and prove it migrates forward rather than failing. This is the lazy-migration smoke the roadmap asks for.
7. **Backup and restore are documented and the documented procedure works.** Whatever the docs say to do, a test must perform it: back up a populated database, restore it, and prove the data is intact and the app can read it.

## Anti-bypass and adversarial requirements

- Do not resolve requirement 1 by deleting the dead table from `schema.ts` while leaving it in the database. The migration must actually drop it, and the drop must be ordered after any data carry-over.
- Do not make requirement 3 pass by catching the error and continuing silently. A degraded database must be *reported*, not swallowed.
- Do not weaken the existing `migrate()` call or replace managed migrations with hand-rolled DDL.
- Do not introduce a new database dependency.
- Tests must use real SQLite files in a temp directory, not an in-memory mock, since the defects are about migration and file state.
- **Run `bun run verify:static` before reporting.** It has been denied on seven consecutive slices; if denied again, say so explicitly rather than assuming the gate holds.
- Run each new test file 6-8 times and confirm the split is identical. Two flaky locked tests have been caught on this project.
- Do not modify any file under an existing lock. Fifteen slices are locked.

## Test-author expectations

- Integration tests against real temp-directory SQLite databases for requirements 1, 5 and 6.
- For requirement 6, seed the database by applying only the earlier migration files, then run the real startup path — do not hand-write the old schema, or the test proves something other than what ships.
- Requirement 7's test should drive the documented commands or exported functions rather than reimplementing the procedure, so documentation drift fails the test.

## Notes and open questions for the lead

Flag rather than guess:

- Which table survives. `app_settings` is the live one and `settings` the decoy, so keeping `app_settings` is the obvious call — but say whether the migration should rename it to `settings` instead, and what that costs.
- Whether readiness belongs on the existing `routes/health.ts` surface or a separate `/readyz`-style endpoint. Note that anything anonymous must be deliberate: `ANONYMOUS_ROUTES` in `index.ts` is currently `/public/feeds/*` and `/webhook-feeds/*` only, and a readiness probe that requires a session is useless to a container orchestrator.
- Whether `runtime_migrations` (used by `migrateLegacyFeedHistory`) should stay a separate hand-rolled ledger alongside Drizzle's own, or be folded in. If it stays, say what it is for so the next reader does not assume it is redundant.
