# Test Scrutiny Review (round 3 delta): `p1-fallow-static-analysis-gate`

Rounds 1 and 2 are accepted and their corrections stay. This round is not a defect report — the product decision behind the slice changed, and the brief now carries **Amendment 1**. Read it before revising; it supersedes requirements 4 through 7.

Summary of the change: enforcing the entire backlog measured at roughly 300 findings, and closing that with an exceptions file would be governance theatre. The gate now judges **changed code**, the worst existing findings get **fixed**, and exceptions become a last resort expected to stay empty.

## 1. CI gates changed code, not the whole backlog

The CI workflow must run `fallow audit` — the changed-file gate that fails only on findings a change introduces — rather than the full pipeline. Keep every existing anti-bypass assertion and add these:

- The audit step must not weaken the comparison: reject a `--gate` value that excludes introduced findings, and reject a base-ref choice that would make the comparison trivially empty (for example diffing a ref against itself).
- `bun run analyze` stays as the full-pipeline local command.

## 2. Prove the gate flag actually gates

`fallow --ci` is documented as equivalent to `--format sarif --fail-on-issues --quiet`, but I measured it exiting **0 with 82 findings present**. Only `--fail-on-issues` genuinely fails. The current test accepts either flag, so an implementation using `--ci` would pass every assertion while gating nothing.

- Required assertion: prove the configured gate command exits non-zero when findings exist, by running it against a fixture or state that definitely has a finding. Do not accept a flag on the strength of its documentation.
- Drop `--ci` from the accepted-flag set unless the same test proves it fails.

## 3. `ROADMAP_PENDING_PATHS` is over-broad — split it

The list protects all eleven currently-unused files. That was a faithful reading of my original brief, but it is wrong: it protects genuinely dead files, which makes green unreachable except through exceptions.

A path may remain protected **only with a cited reason** — a V2 finding id, or an owning packet whose scope will consume it.

- **Keep protected, cited:** `CookiesManager.tsx` (V2-16), `KVEditor.tsx` (V2-02), `CatalogMetadataForm.tsx`, `CatalogSanitizedYamlPreview.tsx`, `CatalogSubmissionDialog.tsx` (all Packet 8).
- **Move to "must be deleted":** `SectionHeader.tsx`, `SectionPager.tsx`, `accordion.tsx`, `SettingsTab.tsx`, `lib/analytics/types.ts`, `models/imapconfig.model.ts`.

I verified all six of those are unreferenced anywhere in the repository apart from the test that protects them. Assert their deletion the same way the nine starter-config adapters are asserted, and add the matching "nothing imports them" check. Verify my classification rather than taking it on trust; if you find a real consumer for any of the six, say so and leave it protected.

## 4. Exceptions become the last resort

`docs/security/static-analysis-exceptions.md` keeps its contract and must still exist, but the expected steady state is an empty array.

- Relax the cross-check that currently requires every `unused_files` path to have an exception record: after the deletions and the protected-path set above, the remaining unused files are the five cited ones. Require that every *remaining* unused file is either cited in the protected set or has an exception record — not that all of them have records.
- Keep the rule that a genuinely dead file may never be an exception.

## 5. Fix the worst existing findings

Add coverage for two in-scope repairs, both small, local, and owned by no other packet:

- The `data-handler.utility.ts` ↔ `rss-builder.utility.ts` circular dependency must be gone; fallow reports it as an initialization and tree-shaking risk. Assert the cycle is absent via the oracle, and add behavior tests over the affected exports so the untangling is proven safe rather than assumed.
- The unused exports fallow reports in first-party `utilities/` must be removed where removal is provably safe. Lock the behavior of anything that stays.

Complexity hotspots and clone groups in Packet 3-6 surfaces stay out of scope and are not exception candidates; the audit gate is what stops those surfaces getting worse.

## Verification

Run the four slice files plus the four accepted Packet 1 lock sets, and report the revised RED breakdown per file. Expect RED to grow — the deletions and the cycle fix are not implemented yet.
