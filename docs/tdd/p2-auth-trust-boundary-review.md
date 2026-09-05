# Test Scrutiny Review: `p2-auth-trust-boundary`

## Verdict

`RETURN TO CLAUDE`

Strong first draft with an unusually good test-level design. Independent RED reproduction: **12 pass / 16 fail** across the three files, matching the report exactly, and every failure traces to genuinely missing production behaviour.

The three-file split is the right shape and worth keeping:

- `auth-trust-boundary.test.ts` spawns the real `bun index.ts` and drives it over real loopback TCP, so mount order and route exceptions are genuinely exercised rather than simulated.
- `auth-connection-info-boundary.test.ts` drives the real `app.fetch` handler with a controllable `requestIP()`, reaching the indeterminate-address case a real TCP client cannot produce. That is exactly the shipped defect and it could not have been covered any other way.
- `auth-passkey-timing-safety.test.ts` asserts constant-time comparison structurally, correctly avoiding wall-clock timing in CI.

Coverage of the webhook trap is right: valid token succeeds anonymously, invalid token gives 401, and the exception is proven not to widen to `/api/health/summary` or `/trigger-webhook`. The non-authenticated-session-cookie negative test closes a vacuous-pass gap I had not asked for.

Two items must close.

## 1. The new test files break the locked static-diagnostics ceiling

The report states the failures in `static-diagnostics-cleanup-architecture.test.ts` are "pre-existing lint-debt drift unrelated to this slice, untouched by these changes." That is incorrect, and the correction matters because it is the difference between accepting a regression and fixing one.

The pre-slice baseline recorded before the authoring run was `bun test tests/` = **1186 pass / 0 fail**. Nothing was drifting. Measured now:

```
aggregate lint warnings do not exceed the pre-fix baseline
  Expected: <= 545   Received: 548
```

Attributed directly to the new files with the pinned Biome binary:

```
tests/auth-trust-boundary.test.ts            2 warnings
tests/auth-connection-info-boundary.test.ts  1 warning
tests/auth-passkey-timing-safety.test.ts     0
```

2 + 1 = 3, exactly the 545 → 548 delta. The slice caused it.

- Required correction: bring the three files to zero Biome warnings under the pinned configuration, so the locked ceiling holds at 545 / 13. Do not modify the locked test or its baseline.
- This is the same failure mode as the `p1-dependency-ci-security-baseline` slice, where authored tests pushed the ceiling over and had to be cleaned. Check the files with the pinned binary before reporting, rather than attributing a ceiling break to pre-existing debt.

## 2. The session-cookie contract must be conditional, not unconditional

`a successful login issues a hardened session cookie` asserts:

```js
expect(loginSetCookieHeader).toMatch(/;\s*Secure/i);
```

Unconditionally requiring `Secure` is a breaking change for the product's primary deployment model. Browsers only accept `Secure` cookies over HTTPS, with a localhost exception — so the Playwright suite would pass while a self-hosted install at `http://192.168.1.50:5000` could no longer store a session cookie at all, making login impossible. Mkfd is explicitly self-hosted and frequently runs on a plain-HTTP LAN.

The maintainer has decided the policy: **`Secure` is set when the connection is actually over TLS**, either directly or via a trusted proxy reporting `X-Forwarded-Proto: https`. Plain-HTTP LAN installs keep working; TLS installs get the hardened cookie. This still satisfies the brief's requirement that the behaviour be explicit rather than implied by the `SSL` CLI flag.

- Required correction: assert the conditional contract. `HttpOnly` and `SameSite` remain unconditional. `Secure` must be present when the request is over TLS and absent when it is genuinely plain HTTP, and the decision must derive from the request rather than from the `SSL` startup flag.
- Add the adversarial case: a forged `X-Forwarded-Proto: https` arriving from a peer that is **not** a configured trusted proxy must not cause a `Secure` cookie to be issued. Otherwise any client can trick the server into issuing a cookie the browser will then refuse to send back, locking the user out.
- Keep this consistent with requirement 8: forwarded headers may inform transport and logging, never authorization. A forged `X-Forwarded-Proto` must not change any access-control outcome either.

## Test correctness

- [x] RED is caused by missing behaviour, not setup failure. Independently reproduced at 12 pass / 16 fail.
- [x] Assertions are semantic and specific; no snapshots.
- [x] Timing safety is asserted structurally rather than by wall-clock measurement, which would be non-deterministic in CI.
- [x] Integration level is correct — a real spawned server for route/mount behaviour, the real fetch handler for peer-address cases.
- [x] No `.only` / `.skip` / `.todo`.
- [x] Claude changed test files only.

One note on the launcher abort: it reported `docs/agent-workflow/TDD.md` as changed outside `tests/`. That was **my** edit, made while the run was in flight, not a boundary violation by Claude. The session state was reconstructed from the response record and the authored tests are unaffected.

Binding design choices I am accepting from this draft, since tests cannot change after lock: the dev-bypass opt-in is the environment variable `TRUST_LOCAL`, and CSRF is exercised against `POST /delete-feed`.

## Feedback for Claude

Revise the three files for the two items above. Tests only; no production code.

Preserve all 16 genuine RED failures and every existing adversarial case, especially the indeterminate-address test, the substring-containment `Origin` trick, the header-rotation throttle reset, and the webhook non-widening checks. Item 2 changes the shape of one assertion and adds one; it should not reduce coverage.

Verify with the pinned Biome binary that all three files report zero warnings before reporting. Then re-run the three slice files plus `tests/static-diagnostics-cleanup-architecture.test.ts` and report the RED breakdown per file, confirming the aggregate ceiling is back to 545 warnings / 13 infos.

## Round 2 scrutiny and acceptance

`ACCEPTED FOR IMPLEMENTATION`

- Session `2edd570c-9ea1-4324-9543-e7670b387841` (same session throughout; attempt 1 of this revision did nothing, having hit its own usage limit at turn 17).
- Independent result: **15 pass / 17 fail** across the three files, and `static-diagnostics-cleanup-architecture.test.ts` back to **15 pass / 0 fail**.

Both items verified myself rather than taken from the report, since the report was wrong on exactly this point last round:

- Biome, run per-file with the pinned binary and `biome.json`: **zero warnings on all three files**. The locked aggregate ceiling is restored to 545 warnings / 13 infos. The fix was real — an untyped `as any` webhook fixture replaced with a properly typed `WebhookFeedConfig` — not a suppression.
- The cookie contract is now genuinely conditional and split across the two files by capability. `auth-trust-boundary.test.ts` drives a real plain-HTTP loopback server and asserts `Secure` is **absent**; `auth-connection-info-boundary.test.ts` controls the scheme directly and asserts `Secure` **present** on direct HTTPS with the `SSL` flag off, **absent** on plain HTTP with the flag on, and **absent** for a forged `X-Forwarded-Proto: https` from an untrusted peer. Those two flag-inverted cases are what prove the value derives from the request rather than the startup flag; asserting only the positive case would have passed against today's static `secure: SSL`.

RED grew from 16 to 17, entirely from the two new flag-inverted Secure cases. Every previously accepted adversarial case survives: indeterminate address, substring-containment `Origin`, header-rotation throttle reset, and webhook non-widening.

Limitations Claude flagged honestly rather than inventing around, which I accept:

- "Login remains possible after the lockout window" is not covered. It needs either a fake clock across a spawned-process boundary or a real wait, and the brief excludes both. Recorded as a known gap in the throttle contract.
- The trusted-proxy path is proven only negatively — a forged header from an arbitrary peer is ignored. There is no trusted-proxy configuration surface yet, and inventing one in a test would prescribe production internals. The positive "a configured trusted proxy legitimately upgrades to Secure" case belongs with whichever slice introduces that surface.

## Round 3 scrutiny and final acceptance

`ACCEPTED` — delta feedback in `p2-auth-trust-boundary-review-round3.md`.

This round fixed a defect in the suite, not the implementation. Independent result: **33 pass / 0 fail** across the three files against the already-committed implementation (`c0eef46`).

`rawSetCookie` now resolves repeated `Set-Cookie` headers the way a user agent does — via `getSetCookie()`, taking the last entry — and carries a comment explaining why. Claude also added the regression guard I asked for, which is why the count went from 32 to 33: a test asserting a successful login emits more than one `session` cookie and that the selected pair is the one that authenticates. Without it, a future change to session handling could silently reintroduce first-header selection.

Verified independently rather than from the report: zero Biome warnings on all three files, and `static-diagnostics-cleanup-architecture.test.ts` holds at 545 warnings / 13 infos.

**The lock was refreshed after implementation.** This is normally forbidden, and the justification is narrow: the change corrected a helper that made three tests incapable of detecting what they asserted — each failed with a 302 that is indistinguishable from the redirect an unauthenticated request receives anyway, so they were a false negative then and a latent false positive later. No assertion was relaxed, no expectation was adjusted, and no requirement changed. The implementation was written before this round and was not modified to suit it.

## Round 4 scrutiny and slice closure

`ACCEPTED` — delta in `p2-auth-trust-boundary-review-round4.md`.

Independent verification, all measured rather than taken from the report:

- `bun test tests/auth-connection-info-boundary.test.ts tests/feed-history.test.ts` → **20/20** (was 15 pass / 4 fail).
- `bun test tests/` → **1220 pass / 0 fail** (was 1215 / 4; pre-slice baseline was 1186 / 0).
- Slice files → **34/34** (a containment-proof test was added, so the count rose from 33).
- Zero Biome warnings on all three files; `static-diagnostics-cleanup-architecture` holds at 545 warnings / 13 infos.

The containment restores the feed-history singleton to `null`, which is the utility's genuine pre-import state rather than a guessed sentinel — its `if (_store)` branches fall through to file-based behaviour when falsy, and nothing before this file's imports ever sets a store. Claude verified that rather than assuming it, and added a test proving the restoration works so the leak cannot silently return.

The lock was refreshed a second time, again for a test-defect fix with no assertion relaxed and no requirement changed. Both refreshes are recorded in the ledger's decisions section.

### Slice closed

All ten required observable behaviours are implemented and covered. Two accepted limitations carry forward, both recorded rather than worked around: "login remains possible after the lockout window" is untested (it needs a fake clock across a spawned-process boundary or a real wait, and the brief excludes both), and the trusted-proxy path is proven only negatively, since no trusted-proxy configuration surface exists yet. The positive case belongs to whichever slice introduces it.
