# TDD Requirements Brief: `p3-webhook-event-state`

## Ownership

- Roadmap packet and finding IDs: Mkfd v3 Packet 3, Packet 7B webhook substrate prerequisite, audit S6 and the remaining ingress portions of S9.
- Feature spec and implementation-plan links: `docs/superpowers/specs/2026-09-09-runtime-resource-controls-design.md`, `docs/superpowers/plans/2026-09-09-runtime-resource-controls.md` Slice 4, `docs/features/Webhook Feed Implementation Plan.md` sections 3, 6-9, 14, 17-18, 21, and 24, and `docs/mkfd-v3-implementation-roadmap.md` Packets 3 and 7B.
- Production surfaces owned by this slice: `models/webhook.model.ts`, `utilities/webhook-feed.utility.ts`, `routes/webhook.ts`, the managed runtime SQLite schema/migration/startup path under `lib/analytics/` and `drizzle/migrations/`, and only the minimal adjacent configuration/preview wiring required to use the same durable event store.
- Test surfaces Luna may add or edit: tests under `tests/` that exercise webhook validation, rate policy, managed migration, transactional ingestion, route behavior, concurrency, retention, legacy JSONL copy-forward, and restart durability. Luna must not edit production, configuration, migration, documentation, or lock files.

## Current behavior and RED reason

The webhook validator bounds only `title`. It coerces category members with `String`, accepts unbounded descriptions, identifiers, authors, URLs, category counts/lengths, and metadata depth/bytes, and accepts malformed dates/URLs. The public ingestion route accepts a token from the query string, does not require JSON media type, has no per-slug request rate, reflects validation messages, and reads and rewrites the complete per-feed JSONL file for every accepted event. Dedupe and retention are not transactional, no retention is applied during ingestion, concurrent writers can lose events, and the runtime SQLite schema has no webhook event table or legacy JSONL migration.

Pre-existing baseline on 2026-09-10:

```text
bun test tests/source-types.test.ts tests/auth-trust-boundary.test.ts --timeout=30000
25 pass / 0 fail / 46 assertions
```

The new focused suite must fail because the bounded validation, rate policy, SQLite schema/transaction, restart durability, and JSONL copy-forward behavior do not exist. It must not use the already-implemented 64 KiB request-body boundary as RED; that behavior is locked by `p3-request-body-limits`.

## Required observable behavior

- **A1 — Native validation:** `validateWebhookPayload` accepts the documented native payload below every limit and returns the same meaningful values without type coercion. Unknown top-level properties may be ignored for v2 compatibility, but a recognized property with the wrong type is rejected.
- **A2 — Scalar/array bounds:** Native payload fields have hard UTF-8 byte/element limits: `id` 300 bytes, `title` 300 bytes after trimming and non-empty, `description` 20,000 bytes, `url` 2,048 bytes and absolute HTTP(S) only, `date` 64 bytes and a valid date when provided, `author` 300 bytes, at most 25 categories with each category a non-empty string of at most 100 bytes, and `severity` one of the documented four values.
- **A3 — Metadata bounds:** `metadata`, when present, is a JSON object (not an array/null), at most 16 KiB serialized as UTF-8, at most 8 object/array levels deep, and at most 1,024 total contained keys/array elements. Cycles, non-JSON values, unsafe keys such as `__proto__`/`prototype`/`constructor`, and values that cannot be serialized are rejected deterministically before persistence. Errors name the violated field/limit but never include submitted values.
- **A4 — Normalization:** Normalization uses a valid payload date according to `dateStrategy`, falls back to `receivedAt` only where `payloadDateOrReceivedAt` permits it, preserves external IDs, and stores a bounded raw payload only when `storeRawPayload` is true. Invalid dates never reach normalization because validation rejects them.
- **A5 — Configuration ceilings:** Runtime webhook configuration cannot raise storage ceilings: ingestion clamps `maxItems` to 1-1,000 and `retentionDays` to 1-3,650, rejecting non-integer/non-finite/non-positive values rather than silently creating an unbounded store. Existing valid v2 values retain their semantics.
- **A6 — Managed schema:** The managed Drizzle schema contains a `webhook_feed_events` table with a primary event ID, feed ID, optional external ID, received/event timestamps, normalized fields, optional metadata/raw JSON, and dedupe key. It has an index supporting newest-per-feed reads and a unique `(feed_id, dedupe_key)` constraint.
- **A7 — Transactional ingestion:** One ingestion operation inserts or identifies the duplicate and enforces both age and count retention in the same SQLite transaction. It returns `{ duplicate: false }` only when inserted and `{ duplicate: true }` for an existing per-feed dedupe key. The same dedupe key remains independent across different feed IDs.
- **A8 — Concurrency/restart:** Concurrent ingestion of the same event for one feed produces exactly one durable row without thrown uniqueness races. Concurrent distinct events are not lost. Reads return no more than the clamped maximum, in deterministic newest-first order, and survive closing/reopening the real SQLite file.
- **A9 — Retention semantics:** Age retention uses controlled ingestion time, removes rows older than `retentionDays`, preserves the boundary row, and count retention keeps the deterministic newest `maxItems` rows. No accepted ingestion ever performs a whole-history JSONL read/rewrite.
- **A10 — Legacy migration:** A startup/idempotent migration copies valid legacy `feed-state/webhooks/<safe-feed-id>.jsonl` events into SQLite without loss, deduplicates repeated migration runs, skips malformed lines and unsafe filenames without aborting other files, records enough migration evidence to avoid repeated work, and leaves the source JSONL file recoverable. Rows already present in SQLite win on a dedupe conflict. Migration diagnostics and result objects contain counts and safe identifiers only, not event payloads or absolute paths.
- **A11 — Header-only authentication:** `POST /webhook-feeds/:slug` accepts credentials only as one syntactically valid `Authorization: Bearer <token>` header. Missing, malformed, invalid, query-string-only, or ambiguous credentials receive the same generic 401 response without token/slug reflection. Valid anonymous ingress remains supported and other routes do not become anonymous.
- **A12 — Media/error semantics:** The ingestion route requires `application/json` (parameters such as `charset=utf-8` are allowed), returns a stable 415 for other media types, uses the already-established 413 body boundary before JSON parsing, and returns stable sanitized 400 errors for malformed JSON or invalid fields. It never returns a submitted value, token, stack, database detail, or filesystem path.
- **A13 — Rate limit:** A deterministic per-slug limiter permits 60 requests in one fixed one-minute window and rejects the 61st with 429 and a stable sanitized response. Attempts for one configured slug do not consume another slug's budget. Invalid-auth attempts for an existing slug count so the limiter also bounds credential guessing; tests control time and do not sleep.
- **A14 — Route persistence/output:** A successfully inserted event is read from SQLite to regenerate feed output. A duplicate is reported as a successful idempotent response and does not create an extra item. Existing normalized webhook item mapping and feed response fields remain compatible.

## Required edge and adversarial cases

- **E1 — Input boundaries:** Exercise exact-limit and one-byte-over values with multibyte UTF-8, empty/whitespace strings, wrong scalar/container types, 25/26 categories, 100/101-byte category members, metadata at/over its byte/depth/node ceilings, cycles, and prototype-pollution keys.
- **E2 — Invalid values:** Cover invalid schemes, credentials in URLs, relative URLs, malformed dates, NaN/infinite/fractional configuration limits, and `storeRawPayload` both false and true.
- **E3 — Real concurrency:** Prove dedupe under concurrent promises and two independent SQLite connections or another genuinely interleaving setup when practical; a serial loop is not concurrency evidence.
- **E4 — Isolated durable fixtures:** Use a real temporary SQLite file and legacy JSONL directory for migration/restart tests. Do not inspect or modify the repository's real `data/runtime.db` or persistent feed-state fixtures.
- **E5 — Rollback:** If any insert/retention step fails, the operation leaves no partial mutation. Tests may induce a database constraint/trigger failure without prescribing the internal transaction library.
- **E6 — Controlled rate window:** Test rate-window reset at the exact boundary with an injected/controlled clock. Do not wait on wall time.
- **E7 — Locked regressions:** Preserve the locked anonymous-valid-token route and 64 KiB request-body behaviors; include regression assertions only where this slice's routing changes could bypass them.

## Compatibility and migration invariants

- **I1 — V2 semantics:** Existing v2 webhook configs with valid `maxItems`, `retentionDays`, `duplicateStrategy`, `dateStrategy`, and `storeRawPayload` preserve event normalization and item output inside the new ceilings.
- **I2 — Token secrecy:** Existing bearer-token hashing and constant-time verification remain valid; plaintext tokens are never persisted or returned after creation.
- **I3 — Recoverable migration:** Existing JSONL data is copied forward, not destructively renamed or deleted. Malformed legacy lines do not erase valid neighbors.
- **I4 — State ownership:** YAML remains feed-configuration authority; SQLite owns runtime webhook events. No event state is written back into YAML.
- **I5 — Locked boundaries:** Existing request-body limits and auth-boundary tests remain immutable and green.

## Non-goals

- Token generation/show-once creation UX, slug generation/uniqueness across saved configs, custom third-party mappings/presets, health-dashboard counters, outgoing webhook delivery, startup RSS rebuild, atomic feed-file replacement, and frontend form changes belong to later Packet 7B/Packet 5 slices.
- Do not redesign the shared runtime database, general readiness, feed output builder, request-body middleware, or session/CSRF policy.
- Do not test a private helper name, a particular SQL builder API, or incidental SQL text formatting where semantic schema/transaction behavior can be asserted.

## Test constraints

- No live third-party services.
- Deterministic fixtures and controlled time/randomness.
- Assert semantics rather than incidental formatting or private call structure.
- New required tests must demonstrate RED for the intended reason before implementation.
- GPT-5.6 Luna may modify only `tests/` and `frontend/e2e/` under the maintainer-authorized temporary substitution for Claude Sonnet 5. The lead must not modify Luna-authored tests.
- Reuse existing public exports where they express the contract. If a new engine-neutral injection point is necessary for controlled time, SQLite selection, legacy-directory selection, or failure injection, declare the smallest behavior-level contract in the test commentary and flag it for lead review; do not prescribe implementation internals.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] Applicable edge/security/compatibility cases are covered.
- [ ] Failure messages identify the violated contract without reflecting submitted data.
- [ ] Tests are isolated and deterministic.
- [ ] Targeted RED command and expected failure are stated.
