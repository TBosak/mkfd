# Test Scrutiny Review (round 5 delta): `p2-auth-trust-boundary`

Rounds 1-4 are accepted and the slice was closed. This round reopens it for one corrected requirement, decided by the maintainer, plus a consequence of that change you must handle in the same pass.

## Background

Closing this slice made authentication real for the first time. That surfaced a contradiction between two locks that had been latent, because the loopback bypass meant login never actually ran:

- `tests/auth-trust-boundary.test.ts:197` asserts a successful login redirects to exactly `"/"`.
- `frontend/e2e/fixtures.ts:35` waits for `**/public/` after submitting the passkey.

With login working, `bun run test:e2e` went to **48 failed**, every test timing out while setting up the `authenticatedPage` fixture.

The maintainer has ruled: **`/public/` is correct.** The SPA is served under `/public/` — Vite's `base` and the router's `basename` both say so — and `"/"` lands outside the basename. The implementation now redirects there, and `index.ts` is already updated.

## 1. Correct the redirect assertion

`tests/auth-trust-boundary.test.ts:197` currently reads:

```ts
expect(res.headers.get("location")).toBe("/");
```

- Required change: assert the successful-login redirect targets `/public/`. Nothing else about that test changes.

## 2. The throttle assertion goes vacuous — fix it in the same pass

This is the part that matters more, and it is not obvious. At the end of the login-throttling test:

```ts
// A successful login redirects to "/". If throttled, it must not.
expect(location).not.toBe("/");
```

Once a successful login redirects to `/public/`, `location` is never `"/"` — so this assertion passes whether or not throttling works. It would still pass against an implementation with **no lockout at all**, which is precisely the behaviour the test exists to prove. Changing item 1 without changing this would leave a test that reads as if it guards the lockout while guarding nothing.

- Required change: assert the post-lockout attempt is observably refused rather than merely "not one specific path". Assert the throttled response status is 429, and that its `location` is not the successful-login target. Both together, so neither a missing lockout nor a changed redirect target can make it vacuous again.
- Keep the existing `expect(statuses).toContain(429)` earlier in the test and the header-rotation reset guard; they are correct.

## 3. Do not touch the e2e fixture

`frontend/e2e/fixtures.ts` belongs to the `p1-cross-platform-e2e-launch` lock and is already correct — it waits for `**/public/`, which is now what the implementation does. Leave it alone.

## Verification

Change only `tests/auth-trust-boundary.test.ts`. Then:

```
bun test tests/auth-trust-boundary.test.ts tests/auth-connection-info-boundary.test.ts tests/auth-passkey-timing-safety.test.ts
```

All 34 must pass against the current implementation. Confirm zero Biome warnings on the three files and that `tests/static-diagnostics-cleanup-architecture.test.ts` still holds at 545 warnings / 13 infos. Report the breakdown.
