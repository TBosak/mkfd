# Test Scrutiny Review: `p3-webhook-event-state`

## Verdict

`ACCEPTED FOR IMPLEMENTATION`

## Delta feedback

- **A2 / E2 — calendar-valid dates:** The invalid-date cases do not reject a syntactically parseable but impossible calendar date such as `2026-02-30T12:00:00Z`. A validator that relies only on permissive timestamp normalization can pass. Add the smallest precise assertion that an impossible calendar date is invalid.
- **A3 / E1 — complete JSON-value boundary:** Function and bigint cases do not cover non-finite numbers or values silently omitted/coerced by `JSON.stringify` (`undefined`, symbol, `NaN`, or infinity). An implementation can pass while accepting non-JSON metadata. Add compact representative cases that close this counterexample without enumerating implementation details.
- **A4 / I1 — preserve existing dedupe semantics:** The `idOnly` missing-ID assertion requires two otherwise identical payloads to receive different dedupe keys, but the brief does not authorize changing existing v2 strategy semantics and current behavior falls back to the payload hash. Preserve the existing strategy behavior; do not invent new `idOnly` semantics in this resource-control slice.
- **A5 — enforce ceilings at the runtime store boundary:** Pure config normalization alone allows an implementation whose event store accepts an unbounded/invalid policy when called directly. Add the smallest behavior-level store or route scenario proving values above the hard ceilings cannot retain more than 1,000 events/3,650 days and invalid non-positive/fractional/non-finite values cannot create an unbounded ingestion path. Avoid a call-spy assertion when durable state can prove the behavior.
- **A7 / A9 — retention on duplicate operations:** The suite permits an early duplicate return that skips required ingestion-time retention. Add a case with stale/excess neighboring rows where duplicate ingestion still enforces age/count retention.
- **E5 — retention failure rollback:** The trigger aborts `INSERT`, so an implementation that never reaches retention—or runs retention nontransactionally after insert—can pass. Induce a retention/delete failure after a candidate insert and prove the candidate insert is rolled back and prior rows remain.
- **A10 — automatic initialization wiring:** Calling `migrateLegacy()` explicitly does not enforce the brief's startup/lazy-initialization behavior; production could expose the method and never invoke it. Add one behavior-level initialization/restart test proving the production initialization path automatically performs the idempotent copy-forward. A minimal optional legacy-directory injection on the existing initialization boundary is acceptable.
- **A12 — sanitized persistence failures and absent media type:** The 400 tests cover parser/validation failures only, so the current route can still reflect a database error or absolute path. Inject a failing event store and prove the response is the same sanitized client-safe failure. Also include a missing `Content-Type` request in the 415 contract.
- **A14 / I1 — preserve item mapping:** The output test requires `guid = externalId` and appends severity to categories, but current v2 mapping uses the normalized internal event ID and existing categories only. Those product changes are outside this S6 slice and contradict the brief's compatibility invariant. Assert the existing item mapping instead.

## Already accepted; do not duplicate

- A1, A6, A8's real-file restart/distinct ordering, A11, A13, E3, E4, E6, and I2-I5 are semantically adequate.
- E7/I5 may remain inherited from the locked request-body/auth suites.
- The proposed `normalizeWebhookFeedConfig`, `createWebhookEventStore`, controlled clock/legacy directory, and router store/output-directory seams are accepted as small behavior-level testability contracts.

## Required handoff

Self-validate routine syntax/fixture/format issues, run the narrow RED command, and return only the compact manifest with updated mappings for the IDs above. Do not retransmit unchanged test content.

## Delta review 2

- **A5 — negative policy at the store boundary:** The revised durable-store cases cover zero, fractional, NaN, and infinity, while the pure normalizer covers `-1`. A store implementation can still accept a negative `maxItems` or `retentionDays` directly and create an unbounded SQLite query/delete path. Add the two smallest negative store-policy cases. All other revised IDs are accepted; do not revisit them.

## Acceptance evidence

- Luna added both negative durable-store policies and changed no file outside `tests/p3-webhook-event-state.test.ts`.
- Deterministic Biome check: clean.
- Lead-reproduced focused RED: 2 pass, 29 intended fail, 113 assertions across 31 tests. Failures are caused by missing bounded validation, configuration normalization, managed schema/store, migration, sanitized route behavior, rate limiting, and SQLite-backed output—not syntax, fixture, import, or environment errors.
- A1-A14, E1-E7, and I1-I5 are now covered either in the accepted focused file or by the named existing locked request-body/auth suites. The accepted seams expose behavior-level clock, database, legacy-directory, event-store, and output-directory boundaries without requiring a private implementation strategy.

## GREEN and handoff evidence

- Lead implementation: managed migration/table, transactional dedupe and
  retention, idempotent legacy copy-forward, bounded validation/configuration,
  header-only auth, fixed-window rate limiting, sanitized route failures, and
  SQLite-backed feed regeneration.
- Lead-reproduced focused GREEN after Luna's performance-only fixture revision:
  31 pass / 0 fail / 350 assertions in 2.73 seconds under Bun's default per-test
  timeout. The ceiling test fell from about 18.7 seconds to 0.16 seconds without
  changing its behavior assertions.
- Compatibility: 96 pass / 0 fail / 234 assertions across source types, auth
  trust boundary, request-body limits, and v2 golden round trips. Luna revised
  the two superseded JSONL observations in the locked request-body suite to
  query isolated SQLite state; the lead accepted and relocked that delta.
- Typecheck and aggregate lint exit clean; catalog validation and production
  build pass; Playwright reports 56 passed / 8 skipped / 0 failed. Both affected
  slice locks verify.
- The full-core run started while the next filesystem RED file was being
  authored, so its test stage intentionally included 12 filesystem RED failures,
  plus the two already-recorded readiness 5-second timeouts and the pre-optimization
  webhook ceiling timeout. The optimized webhook suite is independently green
  under the default timeout; the next Packet 3 convergence run will supersede
  that contaminated aggregate.
