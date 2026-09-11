# Test Scrutiny Review: `p3-safe-user-patterns`

## Verdict

`ACCEPTED FOR IMPLEMENTATION`

## Requirement traceability

- Shared validation/runtime behavior for both source types: mirrored validation matrices at lines 309-420 and runtime suites at lines 422-971. The observable behavior is well covered; an implementation-architecture assertion is intentionally unnecessary.
- RE2-compatible accepted syntax and rejected malformed, catastrophic, backreference, and lookaround syntax: lines 267-295, 323-365, 423-530, 626-644, 702-725, and 897-915.
- 512-byte UTF-8 pattern boundary: lines 367-391, 569-594, and 835-860.
- 64 KiB UTF-8 candidate boundary: lines 596-624 and 862-895.
- 64-rule combined budget: exact 64 and 65th-rule rejection are split across include/exclude; the offending validation path is asserted as `exclude.32`.
- Case sensitivity and allowed flags: lines 423-530 and 798-833.
- Exact-path validation and sanitized messages: helpers at lines 151-179 and the validation matrix cover both pattern-specific paths and the exact over-budget path.
- Independent legacy runtime enforcement and sanitized failures: lines 569-677 and 835-948.
- Compile-once reuse: both multi-candidate runtime cases use the data-free engine-neutral instrumentation option and assert exactly one callback per accepted rule.
- Non-regex and sitemap keyword compatibility: lines 532-567 and 798-833.
- Documented sitemap examples and include/exclude precedence: lines 727-751.
- Feed scalar/category and all sitemap field shapes: lines 423-530 and 753-796.
- v2 compatibility: safe runtime behavior is covered by the focused suite and recorded compatibility command; the deliberately incompatible invalid-regex assertion was migrated by Luna.

## Missing cases or weak assertions

### Resolved in revision 3: engine-neutral compile reuse

- Both exported filtering entry points now receive a no-argument compile observer, and the tests assert exactly one callback while one accepted rule evaluates three candidates. The observer cannot replace the compiler or receive user-controlled data.
- Relevant requirement/spec reference: brief requirements 1, 2, and 9; test constraint to avoid a specific package/private implementation design.

### Resolved in revision 1: combined 65-rule boundary and exact path

- The revised validation and runtime cases use 32 include plus 33 exclude regex rules and validation asserts `exclude.32`.
- Relevant requirement/spec reference: brief requirements 5 and 7.

### Resolved in revision 1: oversized patterns rejected before native construction

- Both runtime boundaries now assert the submitted 513-byte source is absent from native constructions.
- Relevant requirement/spec reference: brief requirements 3 and 8.

### Resolved in revision 1: stale invalid-regex compatibility assertion

- Luna revised only the stale assertion to require a sanitized throw and preserved category coverage.
- Relevant requirement/spec reference: brief requirements 8 and compatibility invariant that unsafe legacy regex is deliberately incompatible.

## Test correctness

- [x] RED is caused by missing behavior, not setup/import/environment failure (8 pass, 32 intended failures).
- [x] Existing behavior is not accidentally weakened; the deliberate invalid-regex migration is explicit.
- [x] Assertions are generally semantic and specific.
- [x] Mocks/fakes sit at the correct outbound boundary.
- [x] Fixtures are deterministic and contain no secrets.
- [x] No required case is skipped, marked todo, or snapshot-approved without scrutiny.
- [x] Tests do not over-constrain a valid implementation and fully prove required behavior; revision 3 uses engine-neutral, data-free instrumentation for compile reuse.
- [x] Luna changed test files only; the lead owns the brief/review documents.

## Feedback for Luna

Accepted after revision 3 and the test-owned Biome cleanup. Focused RED reproduced at 8 pass / 32 fail / 105 assertions; compatibility reproduced at 76 pass / 1 intended failure / 117 assertions. Biome, TypeScript, and diff checks are clean. Lock `tests/p3-safe-user-patterns.test.ts` and `tests/feed-item-filter.test.ts` before implementation.
