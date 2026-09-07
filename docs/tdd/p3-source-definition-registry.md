# TDD Requirements Brief: `p3-source-definition-registry`

## Ownership

- Roadmap packet and findings: Packet 3, the "backend `FeedConfig` union and one source-definition registry authoritative for type IDs, schema version, validation, protected fields, runtime dispatch, preview support, and output capabilities" bullet.
- Production surfaces owned by this slice: `models/feed-config.model.ts`, a new registry module, and the runtime dispatch sites in `workers/feed-updater.worker.ts`, `utilities/preview-generator.utility.ts`, `utilities/feed-config-caster.utility.ts`, `utilities/feed-config-normalizer.utility.ts`, `utilities/worker-manager.utility.ts` and `routes/feeds.ts`.
- Explicitly NOT in this slice: the V2 golden round-trip contract tests and the remaining strict per-type field validation — those are the next slice and depend on this registry existing. Also out: the settings registry, Drizzle migrations, retry/fallback, browser/FlareSolverr adapters. The frontend's divergent type maps belong to Packet 4.
- Do not modify `utilities/outbound-fetch-policy.utility.ts`, `utilities/feed-config-route-adapter.utility.ts`, `utilities/fetch-policy.utility.ts` or `lib/outbound/*`. The executor contract was frozen by `p3-shared-outbound-executor` last commit and its nine test files are locked.
- Claude-owned test surfaces: `tests/` only.

## Current RED baseline

`bun run verify:core` = **1506 pass / 0 fail** at commit `c726a2b`. `bun run test:e2e` = **56 passed / 8 skipped / 0 failed** across 64. Thirteen test locks verify.

The static gate is **locked at a ceiling of 545 warnings / 13 infos with zero errors**; it currently reads **542 / 10** because the executor slice deleted three duplicate redirect loops. The lock asserts diagnostics do not *exceed* the ceiling, so 542/10 is the number to stay at or below — do not treat the gap as budget to spend.

### The defect

There are **51 `feedType === "..."` string comparisons across six files**:

| File | Comparisons |
|---|---|
| `workers/feed-updater.worker.ts` | 16 |
| `utilities/preview-generator.utility.ts` | 16 |
| `utilities/feed-config-caster.utility.ts` | 10 |
| `utilities/feed-config-normalizer.utility.ts` | 5 |
| `routes/feeds.ts` | 3 |
| `utilities/worker-manager.utility.ts` | 1 |

`models/feed-config.model.ts:193` does define a proper discriminated union of twelve members — `webScraping`, `rest`, `api`, `email`, `graphql`, `calendar`, `sitemap`, `filesystem`, `webhook`, `feedTransformer`, `serviceConnector`, `changeDetection` — and `utilities/feed-config-validator.utility.ts:44` does reject an unsupported `feedType`. So the type system is not the problem.

The problem is that everything *else* a source type implies is scattered as literals: which runtime branch executes it, whether preview supports it, which fields are protected, what output it can produce. The worker and the preview generator each carry a sixteen-branch chain, and the two have drifted — they are separate hand-maintained lists of the same knowledge. Adding a thirteenth source type today means finding and editing six files correctly, with nothing that fails if you miss one.

## Required observable behavior

1. **One registry is the single source of truth for source types.** Every supported type is declared once, with the metadata the rest of the system needs. The union in `models/feed-config.model.ts` and the registry must not be able to disagree — prove that a type present in one but absent from the other is a failure, not something that silently half-works.
2. **Runtime dispatch is driven by the registry, not by chained string comparisons.** Executing a feed and previewing a feed must both resolve their handler through the registry. Prove behaviourally: every registered type dispatches to its own handler, and an unregistered type is refused rather than falling through to a default.
3. **Adding a source type requires touching one place.** This is the requirement that gives the slice its value, and it needs a real test, not a comment. Register a fictitious type in a test and prove the system routes it end to end without any production file being edited. If the design cannot support that, say so rather than writing a test that only asserts the registry object has keys.
4. **Preview support is declared, not inferred.** A type that cannot be previewed must be refused with a clear message when preview is requested, and one that can must work. Today `preview-generator` decides this by exhausting an if/else chain and falling off the end.
5. **Protected fields are declared per type in the registry**, and masking/resolution consults it rather than a separate hand-maintained list. Prove a protected field on a source type is masked on read, since that is the property `p2-protected-value-aes-gcm` established and this must not regress.
6. **Disabled and unknown types are refused consistently at every entry point** — create, update, preview, and scheduled execution. Prove all four, because today each has its own chain and they can disagree.
7. **Every existing source type keeps working.** This is the compatibility requirement and the one that matters most: twelve types, each with a real config, must still cast, normalize, validate, dispatch and produce output exactly as before. The slice reorganises where knowledge lives; it changes no behaviour.

## Anti-bypass and adversarial requirements

- Do not delete a source type to simplify the registry. All twelve stay; `changeDetection` and `serviceConnector` included.
- Do not satisfy requirement 2 by keeping the if/else chains and adding a registry alongside them. The chains are the defect. If a branch genuinely cannot be driven from the registry, name it and say why rather than leaving it silently in place.
- Do not weaken `utilities/feed-config-validator.utility.ts`'s existing rejection of unsupported types.
- Requirement 3 must not be satisfied by a test that registers a type and then asserts only that the registry contains it. Route something through it.
- Do not change the on-disk YAML shape of any existing config. The normalizer's job is to keep old configs readable, and the next slice pins that with golden round trips.
- New test files must add ZERO new Biome diagnostics. Traps that have bitten here: a control character in a regex is an **error**, and `${...}` inside an ordinary string is a warning. **Run `bun run verify:static` before reporting** — it has been denied on five consecutive slices; if it is denied again, say so explicitly rather than assuming.
- Run each new test file 6-8 times and confirm the split is identical. Two flaky locked tests have been caught here.
- Do not modify any file under an existing lock. Thirteen slices are locked.

## Test-author expectations

- Unit tests over the registry itself, and integration tests that drive real public entry points — `fetchDataAndUpdateFeed`, `generatePreview`, the feeds route handlers — rather than asserting a particular function was called.
- Requirement 7 deserves a table-driven test across all twelve types with a minimal valid config each, so a regression names the type that broke.
- Requirement 1's union-versus-registry agreement is best proven at the type level plus a runtime assertion; describe what you chose.

## Notes and open questions for the lead

Flag rather than guess:

- Whether the registry should live in `models/` beside the union or in `utilities/`. Note that `lib/` is deliberately outside the architecture gate's scan and is not the right home for this.
- Whether handlers should be functions held in the registry, or the registry should hold identifiers a dispatcher maps. The first is more direct; the second avoids the registry importing every worker path. Say which your tests assume and why.
- Whether `changeDetection` is actually implemented or is a placeholder — its config type is `Record<string, unknown>`, which suggests the latter. If it is a stub, say so; I would rather register it honestly as unimplemented than have it look supported.
