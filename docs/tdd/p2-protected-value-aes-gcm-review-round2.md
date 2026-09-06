# Test Scrutiny Review (round 2 delta): `p2-protected-value-aes-gcm`

Items 1, 2 and 3 from round 1 are **accepted**. Item 4 is not yet fixed, in a sibling test. That is the only thing standing between this suite and the lock.

## Accepted

- **Item 1 (was blocking).** Migration and rotation now build `.yaml` fixture stores via `js-yaml`, mirroring `utilities/config-manager.utility.ts`. Zero `.json` references remain in either file, the `ignores non-JSON files` case is gone, and `migrates a real-shaped .yaml feed config file specifically (not merely a JSON-parseable one)` closes the hole directly. This was the defect that would have shipped a green security slice with no production effect.
- **Item 2.** `expectDeliberateKeyRefusal` is the right shape: it requires an `Error`, a non-empty message, a message mentioning the key, and explicitly *not* matching the internal-crash signature. The three key-boundary tests moved from 3 pass / 0 fail to 1 pass / 2 fail, so they now fail against the unfixed code instead of passing for the wrong reason. The one that still passes is the `env`-value pass-through, which is a compatibility guard and correctly passes today.
- **Item 3.** The corrected characterization is carried in the describe names and comments.

Verified independently: `bun test tests/` = **1258 pass / 24 fail** (up from 1262 / 20, exactly the four newly-genuine refusal assertions). `bun run verify:static` holds at **545 warnings / 13 infos** across 307 files. `bun run typecheck` clean. All seven existing locks verify unchanged.

## The one remaining defect: `:230` is still nondeterministic

You stabilized `never returns the correct plaintext ...` — that one is now solid. Its sibling was left on the same unstable footing:

```ts
it("a wrong-key failure and a malformed-envelope failure are not reported identically", () => {
```

Eight runs of `tests/security-utility-aes-gcm.test.ts`: seven at 17 fails, one at 16. Union of failures 17, intersection 16, and the single difference is this test. It passes roughly one run in eight.

The cause is the same 17.5% measured in round 1, reached from the other side. `decrypt(envelope, OTHER_KEY)` at `:235` does not reliably throw — about one time in six it returns `""` instead — so `wrongKeyMessage` is sometimes `""` and sometimes the generic `"Decryption failed. Possibly due to invalid key or corrupted data."`. The malformed path at `:242` varies too. Whether `:247`, `:248` and `:249` fail therefore depends on which combination came up.

Both outcomes are RED today, which is why it looks harmless — but it is RED *for two different reasons on different runs*, and one combination is GREEN. Under AES-GCM this becomes deterministic (tag failure versus parse failure), so the instability is purely an artifact of the current cipher. That is exactly why it must not be locked as-is: the first time it flips after this slice closes, it will be blamed on the implementation.

- Required correction: make its RED reason stable, the same way you fixed the sibling. Loop a modest number of trials — 50 is plenty — and assert the property that is stably false today: across every trial, a wrong-key decryption must fail, and its failure must be distinguishable from a malformed-envelope failure. Do not assert on one sampled attempt.
- Keep the two failure modes genuinely distinguishable as the requirement-7 contract. Do not weaken it to "both throw".

## Verification

Change only `tests/security-utility-aes-gcm.test.ts`. Then run:

```
bun test tests/security-utility-aes-gcm.test.ts
```

**eight times** and report the pass/fail split for each. All eight must be identical — that is the acceptance criterion for this round, not merely that the suite is red. Then run `bun test tests/` once and confirm the ceiling still reads 545 warnings / 13 infos.
