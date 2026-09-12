# Test Review: `p3-filesystem-runtime-controls`

**Round:** 1 — full semantic review
**Verdict:** REVISION REQUIRED

The draft has a strong structure and clean harness, but the following gaps must
be corrected before RED can be accepted. Preserve the compact single-file suite
and return delta evidence only.

1. **A1/A13 save-time wiring is unproved.** Calling the authorization helper
   proves its semantics but not that the config persistence boundary invokes it.
   Add a behavior-level save/create or update assertion using an isolated config
   directory and approved root. It must accept a canonical in-root directory and
   reject an escaped/missing/file root without writing/replacing YAML. Keep the
   portable normalizer free of host probing if that is the existing contract.
2. **A1 canonical escape is incomplete.** Add a configured directory path that
   traverses a symlink to an outside canonical target (when supported), distinct
   from the scan-time skipped-entry case.
3. **E1 exact/+1 boundaries are mostly missing.** Current tests prove exact depth
   but only over for entry/match/pattern limits; the byte test uses 99 without an
   exact control; extraction never reaches 20,000 characters. Add compact policy
   or injected-limit cases proving exact and first-over for entry, match, total
   read bytes, per-file read bytes, extraction output, pattern count/UTF-8 bytes,
   and maxItems. Do not create 64 MiB/10,000-file fixtures when a controlled
   lower behavior-level limit gives the same proof.
4. **A4 prototype fixture is ineffective.** `JSON.stringify({ __proto__: ... })`
   does not serialize an own `__proto__` key. Construct raw JSON containing the
   key. Also cover exact/+1 depth and node limits and a non-object root.
5. **A4 over-limit semantics contradict the brief.** An over-byte sidecar is a
   sanitized recoverable skip, like malformed metadata; it must increment the
   failure/warning evidence and preserve valid neighbors, not reject the whole
   scan. The scanner must not read past the byte ceiling.
6. **A5 byte/output assertions are partly vacuous.** Enable a content-hash or
   supported extraction read when testing total bytes; use content longer than
   20,000 characters and assert the exact bounded output; prove a configured
   ceiling above 5 MiB cannot raise the hard per-file cap while a lower ceiling
   remains effective.
7. **A7 leakage check misses Error.message.** `JSON.stringify(Error)` omits the
   non-enumerable message. Inspect a safe projection including `String(error)`,
   `message`, `code`, and any public details/counters; assert the secret/path is
   absent there.
8. **A9 rollback fails before meaningful mutation.** The `BEFORE INSERT` trigger
   can abort before any write. Add a failure during update or disappearance
   cleanup after a candidate change, then prove all prior state survives and no
   candidate becomes visible. Keep the test implementation-neutral where
   possible.
9. **A10 does not prove file metadata advances.** `"one"` and `"two"` are both
   three bytes. Change size/mtime deterministically and assert last-modified and
   size advance while stable ID/first-seen stay fixed.
10. **A11 migration does not prove import.** The only valid row conflicts, so no
    new legacy row is shown to copy forward. Include a valid non-conflicting
    neighbor and an unsafe relative-path record. Assert explicit first/second
    migration counts rather than the regex that rejects any result containing
    the word `imported` even when its value is zero.
11. **I1/E5 no-JSON-state invariant needs direct proof.** After a successful scan
    backed by temporary SQLite, assert no legacy JSON state is created in either
    the caller temp state directory or repository state. Arrange RED so the old
    scanner cannot mutate checkout state while the new store export is absent;
    the full draft command itself must respect E5.
12. **A9 concurrency evidence is weak.** Identical concurrent scans ending with
    three identical rows can pass under serialization that overwrites state.
    Assert stable first-seen identities/one row per path across two connections
    and no transient/partial read through a deterministic transaction seam, or
    otherwise make the no-half-complete/no-lost-update property observable.

Run the entire focused file for RED, not only the four-test subset. It may fail
on missing exports/behavior, but must have no fixture, syntax, permission, or
repository-state failures and no individual test may exceed the default 5-second
budget.

## Round 2 — revision delta review

**Verdict:** REVISION REQUIRED

The first revision closes the original structural gaps and independently
reproduces as 15 intended RED failures / 1 guard pass. Correct these remaining
test-quality gaps; keep all accepted coverage unchanged.

1. **E5 still risks the repository database.** The `scan()` wrapper supplies no
   `stateStore` for most calls. Once the export exists, a conforming production
   scanner may default to managed `data/runtime.db`, contradicting the suite's
   caller-owned-state claim. Give every non-state-specific scan a temporary
   SQLite store (outside the scanned directory) by default; preserve explicitly
   supplied stores for transaction/restart/migration tests. Assert before/after
   that neither checkout JSON state nor the checkout runtime DB is changed.
2. **A4/E1 sidecar evidence is confounded and the byte edge is absent.** With an
   empty include list, each `*.md.json` is also an item and generates a missing
   `*.json.json` failure, so aggregate failure counts do not prove the intended
   malformed/depth/node/prototype cases. Restrict that scan to content files and
   assert exact-depth/exact-node acceptance plus +1 skips specifically. Add an
   exact-byte valid sidecar and a +1-byte recoverable skip, with deterministic
   evidence that the implementation did not consume bytes beyond the ceiling.
   Cover the remaining `prototype` mutation key alongside `__proto__` and
   `constructor`.
3. **E2 timeout control does not advance.** `now: () => 30_001` returns the same
   value for start and later checks in a conventional elapsed-time calculation.
   Use a deterministic advancing sequence (exact 30,000 accepted and 30,001
   rejected) or an equivalent controlled monotonic clock. Cancellation and
   timeout must each prove unchanged temporary state.
4. **A7 unsafe-I/O injection may never run.** The base config has no enabled
   extraction and does not require a content read, so an implementation can
   correctly avoid the injected `readFile`. Enable `contentHash` or a supported
   extraction path and prove the seam was reached before checking the sanitized
   typed failure. Also assert state remains unchanged.
5. **A5 configured-limit semantics remain incomplete.** The current cases lower
   only the injected operation limit. Add behavior proving a lower
   `extraction.maxFileSizeBytes`/`maxCharacters` remains effective, and that
   nonpositive, fractional, nonfinite, and wrongly typed extraction limits fail
   validation rather than becoming unbounded. Preserve the above-hard-cap case.
6. **A6 invalid collection types are untested.** Add compact normalization cases
   for a non-array include/exclude and non-string entries. Requirement A6 says
   invalid types as well as invalid values fail before traversal.
7. **A11 first-use migration is only manual.** Calling `migrateLegacy()` proves
   the importer but not that first store/scanner use performs the copy-forward.
   Add one automatic first-use observation (store read or scan, according to the
   public state contract), then retain the explicit idempotency/conflict/source
   assertions. No implementation should pass while leaving the importer unused.
8. **A1/A13 persistence integration is still ambiguous.** The new standalone
   `saveFilesystemFeedConfig()` test is acceptable only if that function is the
   actual persistence boundary used by the application. Add a narrow integration
   assertion/guard that the existing create/update save path delegates to this
   authorized boundary, so an unused export cannot satisfy save-time security.

## Round 3 — acceptance review

**Verdict:** ACCEPTED RED

The second revision closes every Round 2 delta without weakening accepted
coverage. The lead independently verified:

- all ordinary scans receive a caller-owned temporary SQLite store and compare
  checkout SQLite/JSON plus caller JSON state before and after;
- sidecar content files are isolated from their metadata files, with exact/+1
  byte behavior, bounded-read instrumentation, exact/+1 structural limits, and
  all prototype-mutation keys covered;
- exact and first-over monotonic timeout sequences, cancellation, unsafe I/O,
  and every failure-state rollback are deterministic;
- configured extraction limits and invalid numeric/collection types are
  behaviorally asserted;
- first-read legacy migration, explicit migration idempotency/conflict handling,
  and source preservation are observable; and
- the create/update application route is guarded to delegate to the authorized
  persistence boundary.

Independent commands:

```text
bunx biome check tests/p3-filesystem-runtime-controls.test.ts
Checked 1 file. No fixes applied.

bun test tests/p3-filesystem-runtime-controls.test.ts
0 pass / 16 intended fail / no fixture, syntax, timeout, or state-mutation failure
```

The failures are attributable to the missing production exports, managed schema,
and route delegation. The suite is accepted for locking.

## GREEN and handoff evidence

The accepted test remained byte-for-byte locked throughout implementation.

```text
bun test tests/p3-filesystem-runtime-controls.test.ts
16 pass / 0 fail / 288 assertions

packet-relevant focused verification
70 pass / 0 fail / 364 assertions

config/catalog compatibility verification
43 pass / 0 fail / 326 assertions

bun run typecheck
pass

bun run test:e2e
56 pass / 8 skipped / 0 fail

bun run tdd:tests -- verify --id p3-filesystem-runtime-controls
accepted test hash verified
```

`bun run verify:core` reached 1,910 passing tests. Its three failures were the
pre-existing readiness tests exceeding their default five-second test timeout
under aggregate load; the complete readiness file passed 18/18 with the
documented 15-second timeout. Lint, catalog validation, and the production build
were also independently green.
