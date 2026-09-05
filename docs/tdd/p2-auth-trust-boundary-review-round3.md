# Test Scrutiny Review (round 3 delta): `p2-auth-trust-boundary`

Rounds 1 and 2 are accepted and their corrections stay. The tests were locked and the production implementation is written. 29 of 32 pass. The three that fail do so because of a defect in the test helper, not in the implementation — so this round is a bug report against the suite, not a coverage request.

## The defect

`rawSetCookie` reads only the first `Set-Cookie` header:

```ts
function rawSetCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  ...
}
```

A successful login emits **two** `Set-Cookie` headers, both named `session`:

1. `hono-sessions/esm/src/Middleware.js:94` writes a session-id cookie *before* `await next()`, for the not-yet-authenticated session.
2. Line 137 writes the persisted session data *after* `next()`, once `session.set("authenticated", true)` has made the cache stale.

A browser applies them in order, so the second wins and the user is logged in. But `headers.get("set-cookie")` returns only the **first**, so `sessionCookiePair` hands every downstream test the stale pre-login cookie. Those tests then assert against a session that was never authenticated.

Verified directly against the running server, outside the suite:

```
using FIRST Set-Cookie  -> GET / with cookie -> 302   (session auth = null)
using LAST  Set-Cookie  -> GET / with cookie -> 200   (session auth = true)
```

The three failures are exactly the tests that depend on `sessionCookie`:

- `a valid session cookie grants access to the app` (expects 200, gets 302)
- `a same-origin state-changing POST with a valid session cookie reaches the route handler` (expects 400, gets 302)
- `safe methods are unaffected by the origin/CSRF guard` (expects 200, gets 302)

None of them is currently testing what it claims to test. As written they would also pass against a broken implementation that never authenticated anyone, because a 302 is indistinguishable from the redirect they would get anyway — so this is a false-negative now and a potential false-positive later.

## Required correction

- `rawSetCookie` must use `res.headers.getSetCookie()` and return the **last** entry, matching how a user agent resolves repeated `Set-Cookie` headers for the same name. Keep the existing "no cookie set" error for the empty case.
- Add a guard so this cannot silently regress: assert that a successful login emits more than one `Set-Cookie` for `session`, and that the pair the helper selects is the one that actually authenticates. Otherwise a future change to session handling could reintroduce first-header selection unnoticed.
- Nothing else changes. Do not relax any assertion, and do not adjust the three failing expectations — 200, 400 and 200 are correct once the right cookie is used.

## Everything else is green

The other 29 pass against the implementation, including every adversarial case: the indeterminate peer address, `127.0.0.1` and `::1` refusal, the Docker-bridge address, forged `X-Forwarded-For` not changing authorization, forged `X-Forwarded-Proto` yielding neither a `Secure` cookie nor an access change, the substring-containment `Origin`, the header-rotation throttle reset, dev-bypass-off-by-default, dev-bypass refused under `NODE_ENV=production`, webhook ingress succeeding anonymously with a valid token and failing 401 without, the webhook exception not widening to `/api/health/summary` or `/trigger-webhook`, and `/public/feeds/*` still returning 404 rather than an auth redirect.

## Verification

Change only `tests/auth-trust-boundary.test.ts`. Re-run the three slice files and report the breakdown; all 32 should pass against the current implementation. Also confirm the three files still produce zero Biome warnings and that `tests/static-diagnostics-cleanup-architecture.test.ts` holds at 545 warnings / 13 infos.
