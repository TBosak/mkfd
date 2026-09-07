# Test Scrutiny Review: `p3-source-definition-registry`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` — first round. The fourth slice running to need no revision.

- Session `6adee542-b6fc-45e4-9886-ddf9bef4ee41` (`claude-sonnet-5`, 114k output tokens across 144 turns; an 18-token `claude-haiku` entry is auxiliary). `is_error: false`. 13 permission denials.
- Five new files: `feed-source-registry.utility.test.ts`, `feed-source-registry-dispatch.test.ts`, `feed-source-registry-preview-support.test.ts`, `feed-source-registry-worker-and-routes.test.ts`, `feed-config-type-compatibility.test.ts`.
- CF-05 abort, this time with nine stray `worker-sanity-filesystem-*.json` artifacts the suite created by exercising the worker. Removed, `feed-state` restored, tests untouched. Slice state file missing (CF-04); reconstructed.

Independent RED reproduction: **1528 pass / 7 fail** across `tests/` (1535 total = the 1506 baseline plus 29 new). Per file: registry utility 0/1 and dispatch 0/1 (both module-load failures — the registry does not exist yet), preview-support 2/2, worker-and-routes 8/2, type-compatibility 12/1.

Verified independently: `bun run verify:static` holds at **542 warnings / 10 infos, zero errors** across 335 files — no regression toward the locked 545/13 ceiling, which is what I asked for after the executor slice lowered it. `bun run typecheck` clean. All thirteen existing locks verify. Six consecutive runs: identical at 22 pass / 7 fail.

## Requirement 3 is proven properly, and better than the brief specified

This was the requirement I expected to be gamed — "adding a source type requires touching one place" invites a test that registers something and then asserts a map contains it. Instead, `feed-source-registry-dispatch.test.ts` proves it in three phases through `generatePreview()`, the real entry point:

1. **Before registration**, the fictitious type is refused — establishing it is genuinely unknown rather than reaching a default fallback that would make phase 2 meaningless.
2. **After `registerFeedSourceType`**, preview dispatches to the definition's own handler and the handler's marker string appears in the actual `feed.rss2()` output. Routed end to end, no production file edited by the test.
3. **After `unregisterFeedSourceType`**, it is refused again.

Phase 3 is the part I would not have thought to require. It rules out the possibility that phase 2 succeeded for some unrelated reason — the routing has to be genuinely driven by the registry entry, not cached, not hardcoded elsewhere. That is a stronger proof than the brief asked for.

The contract that falls out of it is sound: `FeedSourceDefinition { type, schemaVersion, implemented, previewSupported, protectedFields, outputCapabilities, executePreview }`, with `registerFeedSourceType` / `unregisterFeedSourceType`.

## Rulings on the three open questions

1. **The registry lives in `utilities/`**, as the tests assume via `feed-source-registry.utility`. Correct: it holds behaviour (handlers, dispatch), not just shape, and `models/` should stay declarative. `lib/` was never a candidate — it sits outside the architecture gate's scan deliberately, and that exemption exists for the outbound primitive alone.
2. **Handlers are functions held in the registry.** The dispatch test registers a definition carrying `executePreview` directly, and that is the right call: an identifier-plus-dispatcher indirection would have made requirement 3 unprovable without also editing the dispatcher, which is exactly the coupling this slice removes.
3. **`changeDetection` is registered honestly via an `implemented` flag.** The definition shape carries `implemented: boolean`, so a stub is declared as a stub rather than looking supported. This is what I asked for — I would rather the registry say "registered, not implemented" than have a type appear complete because it has an entry.

## The rest

- Requirement 7 is table-driven over `ORDINARY_ROUND_TRIP_CASES`, so a regression names the type that broke rather than failing anonymously.
- Requirement 2's refusal is proven as an actual refusal at a public entry point, not as an absent map key.
- The two module-load failures are legitimate pre-implementation RED, but they mean the bulk of the coverage has never executed. I read both files rather than inferring from the failure shape, which is how the three-phase structure above was confirmed.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Reproduced at 1528 pass / 7 fail.
- [x] Requirement 3 routes end to end and cannot pass by accident; the unregister phase closes the last hole.
- [x] Never-executed files were read line by line rather than trusted.
- [x] No new Biome diagnostics; 542 / 10 held, no drift toward the 545 / 13 ceiling.
- [x] `bun run typecheck` clean; all thirteen existing locks verify.
- [x] Deterministic across six runs.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only (the stray `feed-state` artifacts were runtime output, not source edits).

The suite is locked and implementation may begin.
