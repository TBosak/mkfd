# Runtime Resource Controls — Design Spec

**Date:** 2026-09-09
**Status:** Approved
**Authority:** Mkfd v3 roadmap Packet 3; audit finding S6

## Goal

Put explicit, testable bounds around every user- or remote-controlled input that Mkfd parses, persists, scans, or evaluates repeatedly. Oversized or computationally unsafe work must fail before expensive parsing or durable mutation, while valid v2/v3 feed behavior remains unchanged inside the documented limits.

## Governing product constraints

- YAML remains the portable feed-configuration source of truth; SQLite stores runtime state.
- Published feeds, independently authenticated webhook ingestion, Selector Playground, and explicitly configured FlareSolverr remain supported.
- The shared outbound executor remains the only HTTP(S) response boundary and continues to cap compressed/decompressed response bytes and total time.
- Resource failures use stable client-visible status/error semantics without reflecting secrets or attacker-controlled payload contents.
- Limits are enforced in production paths, not only by validators or UI controls.

## Required outcomes

### HTTP request bodies

- One middleware boundary applies to every request before any `json`, `formData`, `parseBody`, `text`, blob, or array-buffer parser can consume it.
- The fallback maximum body size is **1 MiB** for any unclassified route.
- Current state-changing application/control routes are limited to **256 KiB** unless a stricter class applies.
- `POST /webhook-feeds/:slug` is limited to **64 KiB**, matching the Webhook Feed plan.
- `POST /passkey` is limited to **8 KiB**.
- A valid `Content-Length` above the applicable maximum is rejected without consuming or parsing the body. Chunked/unknown-length bodies are counted while streaming and rejected as soon as they cross the maximum.
- An exact-limit body is allowed through the size boundary. A body one byte over is rejected with `413 Payload Too Large`.
- Missing, malformed, negative, ambiguous, or unsafe length metadata must not create an unbounded path. Malformed length metadata is rejected as a bad request; transfer-encoded bodies are measured rather than trusted.
- A permitted streamed body is replayed byte-for-byte to the downstream parser. Body-free requests and existing authentication/anonymous-route semantics remain intact.

### Parser inputs

- Every remote XML/HTML/JSON/calendar parser receives data only after the shared executor's decompressed-byte cap, or enforces an equivalent explicit byte cap when invoked from a non-network boundary.
- Parsers that can expand input (recurrence, nested sitemap traversal, JSON nesting, archive/compression, or chained pages) have a separate work/output bound; an item-count limit applied after a full parse is not sufficient.
- Malformed or oversized inputs fail deterministically and do not leave partial durable state.

### Webhook ingestion and event state

- Native webhook fields, category arrays, metadata nesting/size, raw payload storage, retained event count, and retention age are bounded.
- Per-slug request rate is bounded at the documented MVP rate of 60 requests/minute.
- Accepted events are persisted transactionally in the managed runtime SQLite database with deduplication and ingestion-time retention; the JSONL read-and-rewrite store is migrated without data loss.
- Authentication is checked without leaking token material, and an oversized body returns 413 rather than a parse/validation error.

### Filesystem sources

- Authorized roots are checked on save and run using canonical paths.
- Directory depth, visited entries, matched files, sidecar bytes/nesting, per-file read bytes, extraction bytes, total scan bytes, and scan time are bounded.
- Symlinks/junctions and time-of-check/time-of-use changes cannot escape an authorized root.
- Hitting a limit produces deterministic partial-failure semantics and never writes a misleading complete scan state.

### User-provided patterns

- Feed-transformer and sitemap regex inputs use one shared safe-pattern contract.
- Unsupported/backtracking-dangerous syntax is rejected during config validation and again at runtime for legacy/hand-authored YAML.
- Invalid or unsafe patterns cannot monopolize the main event loop. Keyword/glob behavior remains compatible where it does not expose arbitrary regex semantics.

## Security boundaries

- Size checks run before authentication handlers that parse bodies and before independently authenticated webhook parsing.
- A `Content-Length` header is an optimization hint only after strict decimal validation; it is never the sole defense for a streamed request.
- Error messages contain the applicable class/limit at most, never submitted data, credentials, filesystem paths, or upstream response bodies.
- Configuration cannot raise hard security ceilings beyond documented safe maxima.
- Limits apply equally to preview, create/edit, manual trigger, scheduled worker, restart/recovery, and migration paths when those paths consume the same untrusted data.

## Compatibility

- Existing valid requests below their class limit retain their bytes and current route behavior.
- V2 config round trips and source output semantics are unchanged by the request-body slice.
- Existing feed limits such as `maxItems`, `retentionDays`, and extraction sizes are normalized into bounded ranges rather than silently discarded.
- Legacy unsafe regex or oversized state is reported as invalid; it is not executed merely for backward compatibility.

## Delivery slices

1. Request-body boundary and route classes.
2. Parser byte/work limits not already guaranteed by the shared outbound executor.
3. Shared safe-pattern validation/evaluation for feed transformer and sitemap.
4. Webhook field/rate/persistence/retention limits and JSONL migration.
5. Filesystem traversal/read/state limits and canonical-root hardening.
6. Architecture guards, migration smoke tests, and Packet 3 exit verification.

Each slice follows separated-role RED/GREEN TDD and locks its accepted tests before production changes.

## Acceptance

- Boundary tests cover exact-limit, one-byte-over, declared-length, streamed/chunked, malformed metadata, early rejection, byte preservation, and route-specific precedence.
- Parser/pattern tests include adversarial expansion and catastrophic-backtracking candidates with deterministic deadlines.
- Webhook tests cover auth, size, field/nesting bounds, rate, dedupe, concurrent ingestion, retention, restart, and JSONL migration.
- Filesystem tests cover depth/entry/byte/time ceilings, symlink/junction/root escape, partial failure, restart, and real-directory behavior on supported platforms.
- `bun run verify:core`, `bun run test:e2e`, and every accepted slice lock pass at the packet boundary.
