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
