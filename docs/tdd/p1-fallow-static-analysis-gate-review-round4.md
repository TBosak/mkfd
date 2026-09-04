# Test Scrutiny Review (round 4 delta): `p1-fallow-static-analysis-gate`

Rounds 1-3 are accepted and their corrections stay. Implementation is well advanced and two defects in the accepted suite now block green. Both are cases where a test is stricter than the brief it implements.

Implementation completed since round 3: the six dead modules deleted, the nine adapters deleted, worker entry points, `domhandler` declared, `scripts.analyze` on `--fail-on-issues`, the `data-handler` ↔ `rss-builder` cycle untangled via a new `utilities/url-discovery.utility.ts` (with `rss-builder` re-exporting both symbols so its public surface is unchanged), the orphaned `@radix-ui/react-accordion` dependency removed, and `docs/security/static-analysis-exceptions.md` created with an empty array. Typecheck is clean and the circular dependency is gone from the oracle.

## 1. The must-delete sanity check contradicts the deletion it guards

`tests/fallow-static-analysis-gate.test.ts` has:

```
test("allProductionSourceFiles() discovers all six candidate files themselves (sanity check for the scan)")
```

It requires each `MUST_DELETE_MODULES` path to be discoverable by the scan — that is, to exist. The same suite requires those six files to be deleted. Once deletion happens the sanity check fails permanently, so the suite can never be green.

- Required correction: make the sanity check prove the scanner works without depending on the deleted files. Validate `allProductionSourceFiles()` against paths that will still exist (for example `utilities/rss-builder.utility.ts` and `index.ts`), and keep the per-file "nothing references it" checks operating on the deleted set as they already do.

## 2. Zero-unused-exports under `utilities/` would force deleting roadmap-critical code

Amendment 1.D says unused exports must be removed **where removal is provably safe**. The accepted test instead asserts the oracle reports *zero* unused exports under `utilities/`. Those are not the same requirement, and the difference matters a great deal here.

The 22 currently-unused exports include the exact symbols the roadmap requires reconnecting:

- `utilities/css-target-builder.utility.ts :: buildCSSTarget` — V2-07 states the CSS-target builder "containing inference logic is disconnected" and must be wired into create, edit, preview, and worker paths. It is unused *because of* the regression.
- `utilities/data-handler.utility.ts :: processLinks` — V2-07 relative-link/base-URL inference.
- `utilities/data-handler.utility.ts :: parseCookiesForPlaywright` — V2-14 / V2-16 cookie handling.
- `utilities/webhook.utility.ts :: getNewItemsFromRSS` — V2-03 / V2-04 outbound webhook delivery.
- `utilities/sitemap.utility.ts :: applySitemapFilters`, `sortSitemapEntries` — Packet 7A.
- `utilities/service-connector-runner.utility.ts :: resolveServiceConnectorAuth`, `utilities/service-connector-state.utility.ts :: ensureServiceConnectorStateTable` — Packet 9.
- `utilities/worker-manager.utility.ts :: initializeWorker` — worker lifecycle.

Deleting these to satisfy a static-analysis gate is precisely the failure mode the slice already guards against for files: closing a finding by causing a release-blocker regression against locked product decision 3.

- Required correction: mirror the `PROTECTED_CITED_PATHS` pattern at the export level. Introduce a cited list of `file :: export` pairs, each carrying a V2 id or owning packet, that are permitted to remain unused. Assert that every unused export the oracle reports is either in that cited list or absent — so genuinely dead exports still must go, while roadmap-pending ones are deferred with a visible, reviewable citation.
- Verify each citation rather than trusting my classification; if an export on that list has no defensible V2 or packet owner, it is dead and should be required gone.
- The remaining exports with no roadmap owner — candidates include `buildCalendarItems`, `getChromeExtensionPaths`, `getCatalogEntry`, `stripHtml`, `titleCase`, `appendUrl`, `ensureFeedHistoryDir`, `clearFeedHistory`, `loadFilesystemState`, `processLinksAbsolute`, `getByPath`, `getArrayByPath`, `getUserAgent` — should still be required removed unless you find a consumer or a cited owner.

## Verification

Run the five slice files plus the four accepted Packet 1 lock sets. With these two corrections the only remaining RED should be the `fallow audit` CI workflow (not yet written) and whichever genuinely-dead exports remain to be removed. Report the breakdown.
