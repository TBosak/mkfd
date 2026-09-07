# Test Scrutiny Review: `p3-settings-substrate-reconciliation`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` after one narrow revision.

- Session `4b499f81-55a5-42d4-82cb-d4b5bc1fa52b` (`claude-sonnet-5`, 73k output over 77 turns, then 2.5k over 10 for the revision). `is_error: false` both times. 14 permission denials.
- One new file: `tests/p3-settings-substrate-reconciliation.test.ts`, 18 tests.

Independent RED reproduction: **6 pass / 12 fail**, identical across six runs. `bun run verify:static` at zero errors, 542 warnings, 10 infos. `bun run typecheck` clean. All fifteen prior locks verified.

## The vacuity traps were all handled

Every shortcut the brief named was closed:

- **Requirement 1** seeds the dead `settings` table *before* migrating and proves rows are carried into `app_settings` — including the conflict case where the live value wins, and the case where `app_settings` starts empty. Not merely "the table is gone".
- **Requirement 5** runs `initDb` twice and `migrate()` twice against real SQLite files.
- **Requirement 6** seeds at migrations 0000, 0001 and 0002 by applying the real migration files, then runs the real startup path. A hand-written old schema would have proved something other than what ships.
- **Requirement 7** parses `docs/operations/database-backup-restore.md` for the module path and the two function names, then dynamically imports and calls them. Documentation drift fails the test. That is better than the brief asked for, and it means the doc cannot rot into fiction.

The single `:memory:` database is confined to requirement 2 — value round-trip fidelity for quotes, newlines, non-ASCII and empty strings, where file state is irrelevant. Every requirement that *is* about file or migration state uses a real file. I checked this rather than assuming it was an oversight.

## Round 2: an assertion no implementation could satisfy

`:423` asserted `expect(res.headers.get("location")).not.toContain("/passkey")`. A correct `/readyz` does not redirect, so it emits no `Location` header, `get("location")` returns `null`, and Bun's `toContain` throws on a non-string.

Verified against the running server rather than inferred:

```
HTTP/1.1 200 OK
{"ready":true}
```

No `Location` header, reachable with no session cookie. The endpoint did exactly what the test's own name required and the assertion failed anyway. Satisfying the line as written would have meant emitting a `Location` header on a 200 — meaningless, and a defect introduced solely to please a test.

Fixed as directed with `?? ""`, keeping **both** halves of the guard rather than retreating to a status-only check. Verified independently: 18 pass / 0 fail across six consecutive runs.

**Lock refreshed for a test defect, not a relaxation.** The revised assertion proves the same property; it simply stops throwing on the absence of a header that should be absent.

## Rulings on the open questions

1. **`app_settings` survives; `settings` is dropped.** No rename. `app_settings` is what every accessor already reads, so renaming would churn working code and the migration for zero behavioural gain. Migration `0003` carries rows across *before* the drop, live value winning on conflict — the live table is what the app has been reading, so its value is current and the dead table's is at best stale.
2. **Readiness is a separate anonymous `/readyz`, not part of `routes/health.ts`.** The health routes report feed-run health and sit behind the session gate. A readiness probe behind that gate is useless to a container orchestrator, which has no cookie. `/readyz` joins `/public/feeds/*` and `/webhook-feeds/*` in `ANONYMOUS_ROUTES` — a deliberate addition to a deliberately short list. It exposes only ready/not-ready and a path-free reason: no counts, no configuration, nothing an unauthenticated caller could mine.
3. **`runtime_migrations` stays.** It is the ledger for `migrateLegacyFeedHistory`'s lazy data migration, which is a different concern from Drizzle's schema migrations and runs against data rather than DDL. Recorded here so the next reader does not assume it is redundant with Drizzle's own table.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Reproduced at 6 pass / 12 fail.
- [x] Data carry-over is proven by seeding, not asserted by absence.
- [x] Real SQLite files wherever file or migration state is the subject.
- [x] Documentation is executed, so drift fails.
- [x] Zero errors; warnings and infos held at 542 / 10.
- [x] `bun run typecheck` clean; all fifteen prior locks verify.
- [x] Deterministic across six runs, before and after the revision.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only.

## Implementation notes

`verify:core` 1673 pass / 0 fail; `test:e2e` 56 passed / 8 skipped / 0 failed; all sixteen locks verify.

`initDb` no longer throws on a failed migration. It records a degraded reason and returns, so the process stays up and `/readyz` reports the state. The previous behaviour — throw and die — meant a bad database was diagnosable only from container logs and a restart loop; now an operator can reach the app and ask it what is wrong.

`redactPaths` in `lib/analytics/db.ts` is a narrow complement to `redact()`, not a second redactor. `redact()` hides values by *field name*, which cannot help with an absolute path embedded in a free-text error message. It strips Windows drive paths and POSIX absolute paths and leaves the diagnostic sentence intact.
