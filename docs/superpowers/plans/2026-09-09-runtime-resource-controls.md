# Runtime Resource Controls — Implementation Plan

**Spec:** `../specs/2026-09-09-runtime-resource-controls-design.md`
**Roadmap:** Packet 3, audit finding S6

## Documentation reviewed

- `docs/features/Mkfd Enhancements Overview.md`
- `docs/features/Mkfd Release - Review and Plan.md`
- `docs/features/Webhook Feed Implementation Plan.md` security, payload-size, rate-limit, persistence, and test requirements
- `docs/features/Filesystem Feed Implementation Plan.md` scan, extraction, and size-limit requirements
- Existing Feed Transformer, Sitemap, and Calendar feature-plan validation/limit sections
- `docs/mkfd-v3-implementation-roadmap.md` Packet 3 and `mkfd-audit-aggregate-0526.md` S6

The older feature plans define source behavior but do not provide one cross-cutting resource boundary. The linked spec reconciles that gap and controls this implementation.

## Slice 1 — request-body boundary

### File map

- Create a focused middleware/limit-policy module under `middleware/` or `utilities/` that owns constants, route classification, strict length validation, streamed-byte counting, 413/400 responses, and lossless replay.
- Mount it in `index.ts` before session/auth middleware and before every route parser.
- Add only Luna-authored tests under `tests/`; the lead does not edit accepted test files.
- Record RED/GREEN, test-author identity, lock, and residual risk in `docs/mkfd-v3-implementation-ledger.md`.

### Required order

1. Record the current integration-test baseline.
2. Write and review a requirements brief covering real-server mount order, exact boundaries, streamed bodies, malformed length metadata, early rejection, and byte preservation.
3. Have GPT-5.6 Luna author tests only; return coverage defects to the same test-author role.
4. Reproduce RED for missing size enforcement and confirm existing below-limit behavior remains green.
5. Lock the accepted tests.
6. Implement the smallest shared middleware/policy and mount it ahead of parsers.
7. Run targeted GREEN, relevant auth/webhook regression tests, `verify:core`, `test:e2e`, and lock verification.

## Slice 2 — bounded parser work

- Inventory each XML/HTML/JSON/ICS parser entry point and prove whether the shared executor already caps its network bytes.
- Add explicit byte and expansion/work caps only where the proof is absent: direct parser APIs, sitemap recursion, recurrence expansion, nested structures, or chained-page aggregation.
- Keep source output and v2 compatibility unchanged below the limits.

## Slice 3 — safe user patterns

- Introduce one validation/evaluation contract used by feed-transformer and sitemap regex rules.
- Reject unsupported or unsafe expressions at save and runtime; do not rely on a compile-only check.
- Prove bounded behavior with adversarial patterns and long inputs without time-dependent flaky assertions.

## Slice 4 — webhook limits and persistence

- Bound every native event field, arrays, metadata nesting/bytes, and raw-payload retention.
- Add per-slug 60/minute rate limiting with controlled time in tests.
- Move events to a managed Drizzle migration and transactional ingestion with dedupe and retention in the same operation.
- Copy-forward existing JSONL events, retain recoverability, and prove concurrent ingestion/restart behavior.

## Slice 5 — filesystem limits

- Validate canonical authorized roots on save and run.
- Add bounded traversal depth, entries, matches, bytes, sidecars, extraction, and time.
- Prevent symlink/junction and TOCTOU root escape and avoid committing partial state as a complete scan.
- Exercise real temporary directories on Windows/Linux-relevant paths.

## Slice 6 — convergence

- Add or update architecture guards only through the test-author workflow.
- Verify every request/parser/pattern/webhook/filesystem production entry point is classified.
- Run Packet 3 regression suites, all locks, `verify:core`, and `test:e2e`.
- Update the implementation ledger and feature progress from evidence; leave the feature In progress until all six slices close.

## Verification strategy

- Narrow semantic tests at RED and GREEN for each slice.
- Real-server integration tests for middleware order and HTTP framing behavior.
- Deterministic unit tests for pure validation/limit policy.
- SQLite migration/concurrency/restart tests for webhook state.
- Real-directory tests for filesystem boundaries.
- `bun run tdd:tests -- verify --id <slice-id>` before handoff of every slice.
