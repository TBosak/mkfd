# TDD Requirements Brief: `p3-parser-input-bounds`

## Ownership

- Roadmap packet and finding IDs: Mkfd v3 Packet 3, S6 resource limits — bounded XML, HTML, JSON, and ICS parser inputs.
- Feature spec and implementation-plan links: `docs/superpowers/specs/2026-09-09-runtime-resource-controls-design.md`; `docs/superpowers/plans/2026-09-09-runtime-resource-controls.md`; `docs/features/Existing Feed Transformer Implementation Plan.md` section 20; `docs/features/JSON-LD Integration Implementation Plan.md` section 22; `docs/features/Sitemap Integration Implementation Plan.md` parser/security sections; `docs/features/Calendar Feed Implementation Plan.md` validation/security sections.
- Production surfaces owned by this slice: `parseExistingFeed`/`parseExistingFeedContent`; `parseSitemapXml`/`fetchAndBuildSitemapItems`; `parseIcsEvents`/`fetchAndBuildCalendarItems`; `extractJsonLd`, `extractJsonLdItemsFromHtml`, and `analyzeJsonLdDrillChain` before their first HTML/JSON parser.
- Test surfaces GPT-5.6 Luna may add or edit: only a new `tests/p3-parser-input-bounds.test.ts` and new helpers/fixtures under `tests/` if genuinely needed. Existing tests and all production/config/docs files are out of bounds.

## Current behavior and RED reason

The shared outbound executor caps ordinary sitemap, calendar, and HTML responses at 2 MiB, while `parseExistingFeed` explicitly caps fetched content at 4 MiB. Their public direct-content/parser APIs bypass those network limits and accept arbitrarily large strings. JSON-LD additionally parses an unlimited number of embedded blocks of unlimited individual size despite its feature plan naming 500,000 bytes and 20 blocks as defaults.

Pre-existing baseline:

`bun test tests/existing-feed-parser.test.ts tests/existing-feed-parser-security.test.ts tests/json-ld-integration.test.ts tests/sitemap-outbound-executor.test.ts tests/calendar-feed-outbound-executor.test.ts --timeout=30000` → 24 pass / 0 fail / 48 assertions.

The new targeted command must be `bun test tests/p3-parser-input-bounds.test.ts --timeout=30000`. RED must come from missing parser-entry limits, not import, fixture, syntax, live-network, or incidental timeout failures.

## Required observable behavior

1. Existing-feed content has a 4 MiB encoded-byte ceiling, matching its existing fetched-response policy. A valid RSS, Atom, or JSON Feed document of exactly 4 MiB is accepted; the same class at 4 MiB + 1 byte is rejected before XML/JSON parsing with an error that identifies the existing-feed input limit.
2. Sitemap XML has a 2 MiB encoded-byte ceiling, matching the shared executor default used by `fetchAndBuildSitemapItems`. Valid XML at exactly 2 MiB is accepted; 2 MiB + 1 byte is rejected before Cheerio parsing with an error that identifies the sitemap input limit.
3. Calendar ICS has a 2 MiB encoded-byte ceiling, matching the shared executor default used by `fetchAndBuildCalendarItems`. Valid ICS at exactly 2 MiB is accepted; 2 MiB + 1 byte is rejected before event matching/parsing with an error that identifies the calendar input limit.
4. HTML passed to JSON-LD extraction or drill-chain analysis has a 2 MiB encoded-byte ceiling. Valid HTML at exactly 2 MiB remains analyzable; 2 MiB + 1 byte is rejected before Cheerio parses it, with an error that identifies the HTML/JSON-LD input limit.
5. `extractJsonLd` parses at most 20 non-empty `application/ld+json` blocks in document order. The first 20 ordinary blocks remain returned exactly as today; a 21st valid block is not parsed or returned.
6. An individual JSON-LD script block is parsed only when its encoded payload is at most 500,000 bytes. A valid block at exactly 500,000 bytes is returned; a 500,001-byte block is ignored without parsing, while a later valid in-budget block is still returned. This preserves the established best-effort behavior for invalid embedded JSON-LD rather than failing the whole page.
7. All limits use encoded UTF-8 bytes, not JavaScript UTF-16 code units. Multi-byte content must be accepted at the exact byte ceiling and refused/ignored at one encoded byte over it.
8. Below-limit RSS/Atom/JSON Feed fields and items, sitemap URLs/metadata, calendar events, and JSON-LD nodes remain semantically identical to the pre-slice behavior.
9. Direct-content convenience paths and fetched-response paths must enforce the same effective ceiling; callers cannot bypass a limit by supplying `content` directly.
10. Limit failures and skipped JSON-LD blocks must not echo attacker-controlled content, local paths, credentials, or entire input bodies.

## Required edge and adversarial cases

- Empty and ordinary small inputs retain their existing parse/error semantics; the limit layer must not manufacture successful phantom results.
- Exercise exact maximum and +1 encoded byte for every document class without snapshots.
- Include at least one multi-byte boundary proof.
- JSON-LD block counting must define empty blocks as non-work: empty blocks do not consume the 20 parsed-block allowance.
- Invalid JSON-LD within the first 20 candidates remains best-effort and does not prevent a later valid in-budget block from being extracted.
- Prove rejection happens before the expensive parser using a deterministic observable seam or a deliberately malformed tail whose old parser error would differ; do not rely on elapsed-time thresholds.
- No live third-party requests, uncontrolled clocks, shared mutable fixtures, or allocation of inputs substantially larger than the stated ceilings.

Auth/CSRF, secrets, DNS/redirects, concurrency/restart, persistence migration, keyboard/mobile, and accessibility are not applicable to these pure/parser entry points. Existing outbound-executor locks continue to own network authorization and response streaming.

## Compatibility and migration invariants

- No persisted config or v2 feed schema changes are permitted.
- The existing 4 MiB existing-feed network policy and 2 MiB shared-executor default remain authoritative; this slice closes direct-parser bypasses rather than lowering those limits.
- Existing parser return shapes, ordering, metadata mapping, date behavior, and below-limit output remain unchanged.
- Invalid embedded JSON-LD continues to be skipped rather than throwing; oversize individual blocks follow that same best-effort rule.
- Existing accepted tests are not edited, skipped, weakened, or re-baselined.

## Non-goals

- Request-body limits, completed in `p3-request-body-limits`.
- Implementing currently absent child-sitemap traversal or calendar recurrence expansion.
- Configured sitemap scan limits, recurrence work budgets, chained-page aggregation/concurrency, webhook persistence/rate limits, filesystem traversal limits, or safe user regex evaluation; those remain later slices in the approved resource-controls plan.
- Changing outbound response-size policy, parser libraries, feed schema, or UI.

## Test constraints

- No live third-party services.
- Deterministic fixtures and controlled time/randomness.
- Assert semantics rather than incidental formatting or private call structure.
- New required tests must demonstrate RED for the intended reason before implementation.
- GPT-5.6 Luna may modify only `tests/` and `frontend/e2e/`, under the maintainer-authorized temporary substitution for Claude Sonnet 5.
- Avoid timing assertions and excessive memory pressure; construct boundary fixtures programmatically and release them within the test.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] Applicable byte, block-count, malformed-input, sanitization, and compatibility cases are covered.
- [ ] Failure messages identify the violated contract.
- [ ] Tests are isolated and deterministic.
- [ ] Targeted RED command and expected failure are stated.
- [ ] The author changes only the allowed new test/helper paths and reports every changed path.
