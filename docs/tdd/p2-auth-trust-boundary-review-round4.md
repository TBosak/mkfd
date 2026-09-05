# Test Scrutiny Review (round 4 delta): `p2-auth-trust-boundary`

Rounds 1-3 are accepted. The slice's own three files are **33 pass / 0 fail** against the committed implementation, and the implementation is done. One item remains: the new tests break four unrelated tests when the full suite runs.

## The slice pollutes global state for every later test in the process

`bun run verify:core` fails with four failures in `tests/feed-history.test.ts`, none of which relate to auth:

```
loadDateIndex returns an empty Map when no file exists   Expected: 0   Received: 4
round-trips through saveDateIndex and loadDateIndex
overwrites the file on subsequent saves
returns an empty Map when the index file contains invalid JSON
```

`tests/feed-history.test.ts` passes **8/8 in isolation**. Reproduced minimally:

```
bun test tests/auth-connection-info-boundary.test.ts tests/feed-history.test.ts   -> 15 pass / 4 fail
bun test tests/feed-history.test.ts                                              -> 8 pass / 0 fail
```

Cause: `auth-connection-info-boundary.test.ts` imports `../index.ts` in-process to obtain the real `app.fetch` handler. That import executes the entry point's module scope, which among other things calls

```ts
setFeedHistoryStore(createFeedHistoryStore(runtimeDb));
```

so the process-wide feed-history store is swapped from the file-backed default to a database-backed one pointed at the test's `RUNTIME_DB_PATH`. `feed-history.test.ts` then calls `loadDateIndex(FEED_ID)` and reads that database instead of the filesystem, seeing 4 rows where it expects an empty result. The `feed-history/` directory is empty, which is why this presents as a phantom index rather than a stale file.

The technique itself is right and I do not want it replaced — driving the real `app.fetch` with a controllable `requestIP()` is the only way to reach the indeterminate-address case, and that is the shipped defect this slice exists to fix. The problem is only that the import's global side effects are never undone.

## Required correction

- Contain the side effects of importing `../index.ts`. Capture the feed-history store before the import and restore it afterwards, so the process-wide store is what it was; a plain `afterAll` restore is sufficient. Apply the same treatment to any other global the import mutates if one is found.
- Add an assertion that proves the containment works, so this cannot silently regress: after the suite's teardown, `loadDateIndex` on a fresh id must still behave as it does with no import having happened. A comment alone will not catch a future regression.
- Do not solve this by editing `tests/feed-history.test.ts`. It is correct as written, it is not part of this slice, and changing it would hide the leak rather than fix it.
- Do not switch the test away from importing the real entry point. That would lose the coverage that matters most here.

## Everything else is green

The slice's own 33 tests pass, all three files report zero Biome warnings, and `static-diagnostics-cleanup-architecture.test.ts` holds at 545 warnings / 13 infos.

One production change was made this round and is already committed: `loginThrottleKey` used an `as unknown as` double cast, which broke the locked `'as unknown as' double-cast usage does not exceed the pre-fix baseline` guard in `static-diagnostics-cleanup-anti-bypass.test.ts`. It now reads `getConnInfo(c).remote?.address` directly. That was mine, not yours, and it is fixed.

## Verification

Change only `tests/auth-connection-info-boundary.test.ts` unless containment genuinely requires touching another slice file. Then run:

```
bun test tests/auth-connection-info-boundary.test.ts tests/feed-history.test.ts
bun test tests/
```

Report both. The first must be 19/19 and the second must have zero failures.
