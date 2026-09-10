# Test Scrutiny Review: `p3-parser-input-bounds`

## Verdict

`ACCEPTED FOR IMPLEMENTATION`

GPT-5.6 Luna is the maintainer-authorized temporary test author while Claude weekly usage is exhausted. The test-only write boundary and independent lead-review gate remain unchanged.

## Requirement traceability

| Requirement | Test evidence | Review |
|---|---|---|
| 1 — 4 MiB existing-feed ceiling | Per-format RSS, Atom, and JSON Feed exact/+1 cases; fetched-path exact/+1 case | Covered, including format-specific error identity and ordinary item preservation. |
| 2 — 2 MiB sitemap ceiling | Direct exact/+1 and fetched exact/+1 cases | Covered. |
| 3 — 2 MiB calendar ceiling | Direct exact/+1 and fetched exact/+1 cases | Covered. |
| 4 — 2 MiB JSON-LD HTML ceiling | Exact multi-byte HTML through all three public entry points; +1 through all three; fetched detail pages | Covered. |
| 5 — at most 20 non-empty JSON-LD blocks | Three empty blocks + 20 valid + valid block 21; 19 invalid attempts + valid attempt 20 + valid candidate 21 with observed parse inputs | Covered for both successful and invalid parse attempts. |
| 6 — 500,000-byte per-block ceiling | Exact multi-byte block returned and observed by `JSON.parse`; +1 marker absent from both parse inputs and output; later valid block parsed/returned | Covered, including pre-parse enforcement. |
| 7 — UTF-8 bytes | 2 MiB HTML and 500,000-byte block use `é` and assert encoded bytes exceed code units | Covered. |
| 8 — below-limit compatibility | Exact documents preserve one ordinary item/event/URL/node; existing parser regression files remain untouched | Covered for representative semantics. |
| 9 — direct and fetched paths | Existing feed, sitemap, calendar, and drill-chain detail fetch cases | Covered. |
| 10 — sanitized failures/skips | Per-class marker non-reflection and absent oversize JSON-LD marker | Covered. |
| Empty/min compatibility edge | Existing locked test covers empty existing-feed rejection; revised tests pin empty sitemap stats/collections, empty ICS, empty extraction, empty mapped-extraction warning, and empty drill-chain analysis | Covered. |

Independent final RED reproduction: `bun test tests/p3-parser-input-bounds.test.ts --timeout=30000` → 10 pass / 13 fail / 71 assertions. All failures are attributable to the missing production limits and block caps; imports, fixtures, mocks, empty/min behavior, and ordinary compatibility cases execute successfully.

## Missing cases or weak assertions

None remain. Revision 1 added semantic empty-input regression cases, an invalid-attempt budget case that observes exactly 20 JSON parse inputs, and a narrowly scoped `JSON.parse` observer restored in `finally`. The observer proves exact-limit and later valid payloads reach parsing while the oversize marker does not, without adding a production hook or prescribing production file structure.

## Test correctness

- [x] RED is caused by missing behavior, not setup/import/environment failure.
- [x] Existing behavior is not accidentally weakened.
- [x] Current assertions are semantic and specific.
- [x] Mocks/fakes sit at the approved outbound boundary and make no live requests.
- [x] Fixtures are deterministic and contain only test marker strings, not secrets.
- [x] No required case is skipped, todo, or snapshot-approved.
- [x] Current tests do not over-constrain the production organization.
- [x] Luna changed one new test file only.

## Feedback for GPT-5.6 Luna

Revision accepted. Luna changed only `tests/p3-parser-input-bounds.test.ts`; no further test changes are requested.
