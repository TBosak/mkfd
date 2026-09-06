# Test Scrutiny Review: `p2-protected-value-aes-gcm`

## Verdict

`RETURN TO CLAUDE` — one blocking defect that would make the migration a no-op in production, one vacuity problem, plus a correction to my own brief and rulings on the three questions you flagged.

Independent RED reproduction: **1262 pass / 20 fail** across `tests/` (1282 total = the 1245 baseline plus 37 new). That matches your report exactly. The 20 comprises 17 assertion failures plus 3 module-load failures (`protected-value-migration`, `protected-value-rotation`, `startup-encryption-key-validation`), which fail to import because the modules and the `assertValidEncryptionKey` export do not exist yet. That is legitimate pre-implementation RED, but it means those three files' assertions have **never executed**, so I read them line by line rather than inferring from the failure shape.

Verified independently, not from your report: `bun run verify:static` holds at exactly **545 warnings / 13 infos** across 307 files (up from 300, so the 7 new files add zero); `bun run typecheck` is clean; all seven existing locks verify unchanged. I note the launcher denied your `verify:static` call, so you could not check the ceiling yourself — it is clean, and this is the first slice in four not to break it.

The work is strong. `collectProtectedValues` walking arbitrary nesting, the frozen `legacyForgeEncrypt` fixture that keeps the read-old tests meaningful after `security.utility.ts` is rewritten, tamper coverage split across ciphertext/IV/tag/version independently, byte-comparing an unreadable file before and after migration, and the restart-resilience case are all exactly right. Three things need fixing.

## 1. BLOCKING: migration and rotation target the wrong store format

`tests/protected-value-migration.test.ts` and `tests/protected-value-rotation.test.ts` build fixture stores of `.json` files. The real store is **YAML**:

- `utilities/config-manager.utility.ts:16-19` — `readFeedConfig` joins `${id}.yaml` and parses with `yaml.load`.
- `utilities/config-manager.utility.ts:25` — `writeFeedConfig` writes `yaml.dump(config)`.
- `routes/catalog.ts:81` — writes `${feedId}.yaml`.
- `utilities/worker-manager.utility.ts:272` — loads configs with `yaml.load`.

An implementation that satisfies this suite as written would migrate nothing on any real deployment. Worse, the case `ignores non-JSON files in the store` actively locks that in: it asserts a non-`.json` file is skipped, and every real config is a non-`.json` file. A correct implementation that migrated the YAML store would **fail** that test. That inverts the requirement.

This is the one defect in the suite that could ship a security slice with zero production effect, which is why it blocks.

- Required correction: build the fixture stores as `.yaml` using `js-yaml` (already a dependency), mirroring `readFeedConfig`/`writeFeedConfig`. Keep a case proving a genuinely unrelated file is ignored, but make it something that is not a config at all — `README.txt` is fine — and add an explicit case proving a `.yaml` config **is** migrated.
- The `unreadable`-is-left-untouched test must keep its byte-for-byte comparison. Note that a YAML round-trip through `yaml.load`/`yaml.dump` will not preserve formatting byte-for-byte in general, so for the untouched-file case assert the file was not rewritten at all rather than that a re-dump matches.

## 2. Assertions that pass today for the wrong reason

`tests/protected-values-key-boundary.test.ts` asserts only `toThrow()`:

```ts
expect(() => protectValue("secret", "")).toThrow();
```

All three tests in that file pass against the **unfixed** code, so they demonstrate nothing. I checked why, and it is not what my brief claimed:

```
empty  -> THREW: tmp.length is not a function. (In 'tmp.length()', 'tmp.length' is 0)
4-char -> THREW: tmp.length is not a function. (In 'tmp.length()', 'tmp.length' is 4)
```

A bare `toThrow()` is satisfied by that internal `node-forge` type error. The requirement is a *refusal with an actionable message*, and this cannot tell the two apart.

- Required correction: assert the error is identifiable — a message match, an error subclass, or a `code` property — so these fail in RED and pass only against a deliberate refusal. Apply the same treatment anywhere in `startup-encryption-key-validation.test.ts` that asserts a bare `toThrow()`; requirement 5 explicitly says "not a stack trace from deep inside the cipher", and only a message-level assertion can prove that.

## 3. Correction to my brief — defects 3 and 5 were mischaracterized

My brief said a short or malformed key "is accepted silently" and that the `?? ""` call sites encrypt "under the empty string with no error". That is wrong, and I would rather correct the record than have you write tests around a false premise. Both cases throw today — just uselessly, from inside `node-forge`, at the moment of use rather than at startup.

The real defect is therefore narrower and should be stated as: **an unusable key fails late and unintelligibly instead of being refused early and actionably.** Requirement 5 stands unchanged; only its justification moves. Where a test's name or comment asserts silent acceptance, correct it.

What my brief got right, and what the evidence now shows is worse than stated, is the integrity defect. Over 400 trials, decrypting a valid envelope with the **wrong key**:

```
threw (correct)   : 330
returned garbage  : 70  (17.5%)
sample garbage    : "" | "" | ""
```

17.5% of the time the wrong key does not fail — it returns the empty string, because `decodeUtf8` of garbage followed by `.trim()` collapses to `""`. A caller then authenticates to a third-party service with an empty password and no error anywhere. Please put that number in a comment on the wrong-key test; it is the clearest single justification for the whole slice.

## 4. One flaky test — keep it, but stabilize its RED reason

`wrong key vs. corrupted envelope are distinguishable failure modes > fails when decrypting a well-formed, untampered envelope with the wrong key` passes in 5 runs out of 6. I ran the file six times: 15/13, 13/15, 14/14, 13/15, and the failure set differs only by that one test. Everything else is stable — 14 tests fail in all six runs.

This is not your bug. It is the 17.5% above: the current cipher is *nondeterministically* broken, so a test asserting "wrong key throws" is nondeterministic against it. Under AES-GCM the tag check makes it deterministic.

- Required correction: keep the test, but assert the property that is stably false today — that a wrong-key decryption **never returns a value**, rather than that it throws on any particular attempt. Loop a modest number of trials (50 is plenty) so RED is deterministic. A test that passes 5 runs in 6 is worse than useless in a locked suite: it will be blamed on the implementation the first time it flips after this slice closes.

## 5. Rulings on your three open questions

All three of your proposals are accepted, one with an addition. You were right to flag them rather than guess.

1. **Empty-key call sites: refuse at the crypto layer; do not change the call sites.** Ratified. I verified your stated reason rather than taking it: `routes/profiles.ts:8-14` and `:16-22` wrap each call in `try/catch` and return a 400, and `fetchDataAndUpdateFeed` in `workers/feed-updater.worker.ts:110+` wraps its work in a `try`. A throw therefore fails one request or one feed update cleanly instead of crashing the process. Refusing centrally also covers call sites nobody has audited yet.
2. **`NODE_ENV === "production"` governs the startup refusal.** Ratified — it is the signal `index.ts` already uses for the local-trust dev bypass closed in `p2-auth-trust-boundary`, and a second, differently-spelled production signal would be a latent inconsistency.
3. **Migration is an exported function, invoked by a CLI entry point.** Your exported-function shape is right and testable; keep it. My addition: it must **not** run as a startup step, and it is not an HTTP route in this slice. Rewriting every stored secret automatically on boot is a hard-to-reverse action taken without operator consent, and if the key is wrong it would rewrite or report every value in the store on an ordinary restart. An operator runs it deliberately. A route can come later behind the session gate if there is demand.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Independently reproduced at 1262 pass / 20 fail.
- [x] Zero new Biome warnings; ceiling holds at 545 / 13 across 307 files.
- [x] `bun run typecheck` clean.
- [x] All seven existing locks verify unchanged.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only. The launcher aborted on `feed-state/filesystem/filesystem-test.json` (CF-05); restored by me, tests untouched.
- [ ] Migration and rotation exercise the real store format — **item 1**.
- [ ] Refusal assertions distinguish a deliberate refusal from an internal error — **item 2**.
- [ ] RED is deterministic — **item 4**.

## Feedback for Claude

Fix items 1, 2, 3 and 4. Change test files only. Specifically:

- Rebuild the migration and rotation fixture stores as `.yaml` via `js-yaml`, matching `utilities/config-manager.utility.ts`, and add a case proving a real-shaped `.yaml` config is migrated. Replace the `ignores non-JSON files` case with one that ignores a genuinely non-config file.
- Replace bare `toThrow()` assertions with assertions on an identifiable, actionable error.
- Correct any test name or comment that says a short or empty key is accepted silently; it throws unintelligibly instead.
- Make the wrong-key test deterministic by asserting no value is ever returned across repeated trials, and record the 17.5% figure in a comment.

Preserve every other case, especially the four-position tamper coverage, the frozen legacy fixture, the idempotence and unreadable-value handling, and the whitespace round-trip that catches `.trim()`. Re-run `bun test tests/`, confirm the ceiling still reads 545 / 13, and report the pass/fail split along with a note on which tests remain in RED and why.

## Round 2 scrutiny and acceptance

`ACCEPTED FOR IMPLEMENTATION`

- Session `a1d30f30-3bb8-45fd-a7c4-de1021158781` (same session throughout), 13 turns, `is_error: false`. Only `tests/security-utility-aes-gcm.test.ts` changed, as directed.

The remaining nondeterminism is gone. `tests/security-utility-aes-gcm.test.ts:231` now loops 50 trials and asserts that a wrong-key decryption **always** throws, that a malformed-envelope decryption always throws, and that the two messages differ. It keeps the requirement-7 distinguishability contract rather than retreating to "both throw", which was the weakening I was most concerned about.

Determinism verified directly rather than from the report: eight consecutive runs of the file, each written to a fresh temp directory and diffed by test name. All eight are **11 pass / 17 fail**, union 17, intersection 17, zero flipping tests. Before this round it was seven runs at 17 fails and one at 16.

Also verified: `bun test tests/` = **1258 pass / 24 fail** (baseline 1245 pass / 0 fail at `40234cb`, so 37 new tests of which 24 are RED); `bun run verify:static` at exactly **545 warnings / 13 infos** across 307 files; `bun run typecheck` clean; all seven existing locks verify unchanged.

The suite is locked and implementation may begin.

### Rulings carried into implementation

1. Refuse the empty key at the crypto layer; do not change the `?? ""` call sites. Verified they wrap in try/catch, so a throw degrades cleanly.
2. `NODE_ENV === "production"` governs the startup refusal, matching the local-trust bypass in `p2-auth-trust-boundary`.
3. Migration is an exported function invoked by a CLI entry point — not a startup step, not an HTTP route — and operates on the YAML store described by `utilities/config-manager.utility.ts`.
4. The `.trim()` on the decrypt path must be deleted outright; plaintext round-trips byte for byte.
