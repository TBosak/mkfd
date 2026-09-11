# TDD Requirements Brief: `p3-safe-user-patterns`

## Ownership

- Roadmap packet and finding IDs: Packet 3, audit finding S6; Runtime Resource Controls slice 3.
- Feature spec and implementation-plan links: `docs/superpowers/specs/2026-09-09-runtime-resource-controls-design.md`; `docs/superpowers/plans/2026-09-09-runtime-resource-controls.md`; `docs/superpowers/specs/2026-05-23-existing-feed-transformer-design.md`; `docs/superpowers/specs/2026-05-24-sitemap-design.md`; `docs/features/Existing Feed Transformer Implementation Plan.md`; `docs/features/Sitemap Integration Implementation Plan.md`.
- Production surfaces owned by this slice: a shared safe user-pattern contract; feed-transformer filter validation/evaluation; sitemap filter validation/evaluation; the existing config validator integration for both source types.
- Test surfaces Luna may add or edit: the new focused test file under `tests/`, plus the pre-existing invalid-regex assertion in `tests/feed-item-filter.test.ts` that conflicts with this slice's deliberate runtime incompatibility. Do not edit production/configuration files or unrelated tests.

## Current behavior and RED reason

`utilities/feed-item-filter.utility.ts` and `utilities/sitemap.utility.ts` independently construct JavaScript `RegExp` objects directly from user-controlled YAML. Invalid expressions are silently treated as non-matches at runtime, unsafe expressions are accepted by `validateFeedConfig`, and a backtracking-heavy expression can monopolize the main event loop. The sitemap implementation also recompiles a rule for every candidate entry rather than once per filter operation.

Pre-authoring compatibility baseline:

```text
bun test tests/feed-item-filter.test.ts tests/source-types.test.ts tests/feed-config-validator.test.ts tests/p3-v2-golden-round-trips.test.ts --timeout=30000
77 pass / 0 fail / 117 assertions
```

The new test file must establish RED specifically because the shared safe-pattern contract and its two validation/runtime integrations do not exist yet.

## Required observable behavior

1. One shared contract governs user-provided regexes for both feed-transformer and sitemap filters. Its externally visible behavior is identical at validation and runtime.
2. A pattern is accepted only when it is valid under a linear-time, RE2-compatible regex language. Ordinary literals, escaped punctuation, anchors, alternation, character classes, capturing/non-capturing groups, and bounded or unbounded quantifiers remain supported. JavaScript-only constructs that defeat linear evaluation are rejected, including numeric/named backreferences and positive/negative lookahead or lookbehind.
3. Pattern source is capped at 512 UTF-8 bytes. Exactly 512 bytes is accepted when syntactically valid; 513 bytes is rejected before compilation/evaluation. Empty regex source is valid and retains JavaScript/RE2 match-all semantics.
4. Each candidate string presented to a regex is capped at 64 KiB in UTF-8 bytes. Exactly 64 KiB is evaluated normally; 64 KiB plus one byte is rejected before regex evaluation.
5. At most 64 regex rules may appear across one config block's include and exclude lists. Exactly 64 is valid; 65 produces a validation error and is rejected at runtime for legacy or hand-authored YAML. Keyword/non-regex rules do not consume this regex-rule budget.
6. `caseSensitive: false` performs case-insensitive matching; `true` remains case-sensitive. No caller may supply arbitrary flags.
7. `validateFeedConfig` reports invalid, unsafe, oversized, or over-budget regex filters as errors at their exact feed-transformer or sitemap filter path. Messages identify the violated pattern contract but never echo the submitted expression or candidate text.
8. Runtime evaluation independently enforces the same contract even when validation was bypassed. An invalid/unsafe/oversized pattern, an over-budget rule collection, or an oversized candidate throws a sanitized pattern-contract error instead of becoming a silent non-match or invoking an unsafe native regex.
9. Within one feed-transformer or sitemap filtering operation, each accepted regex rule is compiled once and reused across all candidate items/fields/categories. Exclude rules retain precedence over include rules. To make this security/performance invariant verifiable without prescribing an engine, both exported filtering entry points accept an optional engine-neutral instrumentation option whose compile callback is invoked once after each successful user-pattern compilation. The callback receives no pattern, candidate, flags, or other user-controlled data and cannot replace or weaken the production compiler.
10. Existing non-regex feed-transformer operations (`contains`, `notContains`, `equals`, `startsWith`, `endsWith`) and sitemap keyword matching retain their current case-sensitivity and include/exclude behavior.
11. Existing documented sitemap examples such as `/news|/notices|/agendas` and `/tag/|/category/|/author/`, plus ordinary feed-transformer patterns, remain valid and produce the same matches.

## Required edge and adversarial cases

- Exact and one-byte-over pattern and candidate limits must use multibyte UTF-8 cases so character count cannot masquerade as byte count.
- Include malformed syntax, nested-quantifier/catastrophic candidates such as `(a+)+$`, ambiguous quantified alternation such as `(a|aa)+$`, backreferences, and all four lookaround classes. These must be rejected deterministically without a wall-clock timing assertion.
- Prove the dangerous candidates never reach the native JavaScript regex evaluator. A test-side seam, child-process instrumentation, or a linear-engine behavioral proof is acceptable; do not rely only on source-text matching.
- Prove compile-once reuse through the engine-neutral instrumentation hook with multiple candidates. Assert only the callback count; the hook must not expose submitted pattern or candidate text and must not allow compiler injection.
- Cover filters on scalar feed fields, categories, and each sitemap field shape, including numeric priority stringification.
- Cover both validation-time and runtime enforcement for both source types, including a legacy/hand-authored config that bypasses validation before the filtering function is called.
- Errors must not contain adversarial pattern or candidate sentinel text.

## Compatibility and migration invariants

- Safe v2 feed-transformer regex filters and documented sitemap regex filters keep their matching, case-sensitivity, include/exclude, and round-trip behavior.
- Non-regex filter types are unaffected and do not consume the regex budget.
- Legacy unsafe regex is deliberately incompatible: it is reported as invalid and is never executed merely for backward compatibility.
- No schema or durable-state migration is required; this is validation and runtime enforcement over existing YAML shapes.

## Non-goals

- Template-variable validation patterns, filesystem glob syntax, internal application regex literals, CSS selectors, and webhook custom-payload interpolation.
- New frontend controls or client-side-only validation.
- Sitemap recursion/page enrichment, parser byte limits, webhook persistence, or filesystem traversal limits.
- Changing feed ordering, deduplication, mapping, item limits, or output formats.

## Test constraints

- No live third-party services.
- Deterministic fixtures and controlled time/randomness.
- Assert semantics rather than incidental formatting or a specific package/private implementation design.
- New required tests must demonstrate RED for the intended reason before implementation.
- Luna may modify only `tests/` and `frontend/e2e/`.
- Do not use `.only`, `.skip`, `.todo`, snapshots, wall-clock performance thresholds, or a test that merely greps production source.

## Acceptance checklist

- [ ] Shared contract behavior is traced through validation and runtime for both source types.
- [ ] Exact/+1 UTF-8 limits and the 64-rule budget are covered.
- [ ] Safe syntax compatibility and unsafe syntax rejection are comprehensive.
- [ ] Dangerous expressions are proven not to reach unsafe native evaluation without flaky timing.
- [ ] Compile-once reuse and include/exclude behavior are meaningful and deterministic.
- [ ] Sanitized errors and legacy runtime enforcement are covered.
- [ ] Targeted RED command and expected failure are stated.
