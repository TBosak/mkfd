# TDD Requirements Brief: `p2-csp-security-headers`

## Ownership

- Roadmap packet and findings: Packet 2; app-wide CSP and security headers.
- Production surfaces owned by this slice: the app-wide middleware in `index.ts`, the login page in `routes/utils.ts` (its markup and its stylesheet), and whatever header module the implementation introduces.
- Explicitly NOT in this slice: container hardening (see CF-11), the redacting logger. The playground's own CSP in `routes/utils.ts:321` belongs to `p2-selector-playground-isolation` and is **locked** — this slice must not weaken or override it.
- Claude-owned test surfaces: `tests/` and `frontend/e2e/` only.

## Current RED baseline

`bun run verify:core` = **1316 pass / 0 fail** at commit `dc72e8b`. `bun run test:e2e` = **40 passed / 8 skipped / 0 failed** across 48. Nine test locks verify.

The defects:

1. **No security headers on any response except the playground.** `routes/utils.ts:321-323` sets `Content-Security-Policy`, `X-Content-Type-Options` and `Referrer-Policy` on the `/proxy` document only, because that slice needed them for its own isolation. Every other response — the SPA, the login page, the API, the published feeds — carries none. There is no `nosniff`, no framing control, no CSP, no referrer policy.
2. **The login page loads a stylesheet from a third-party CDN.** `routes/utils.ts:348`:

   ```html
   <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
   ```

   Unpinned beyond a major version, no integrity attribute, on the one page every operator sees before they have a session. This is the same finding class as the SelectorGadget CloudFront dependency already closed in `p2-selector-playground-isolation`, and it has the same two consequences: a third party can influence what the login page looks like, and the page degrades on the air-gapped and LAN installs Mkfd supports.
3. **No framing control.** Nothing prevents the app being framed by another origin, so clickjacking against the authenticated UI is unobstructed.

## Required observable behavior

1. **Every application response carries a baseline set of security headers.** At minimum `X-Content-Type-Options: nosniff`, a `Referrer-Policy` that does not leak full URLs cross-origin, and a `Content-Security-Policy`. Prove this on several different response kinds — the SPA root, the login page, a JSON API response, and a published feed — not on one route.
2. **The SPA's CSP forbids inline and remote script.** `public/index.html` contains exactly one script, an external module from the app's own origin, so `script-src 'self'` is achievable without `'unsafe-inline'` or `'unsafe-eval'`. Prove behaviourally that an injected inline script does not execute in the browser, not merely that a header string is present.
3. **Framing is controlled.** The app must refuse to be framed by another origin, via `frame-ancestors` and a legacy `X-Frame-Options` for older agents. **Careful:** the Selector Playground legitimately frames `/proxy` from the app's own origin, so a blanket `frame-ancestors 'none'` applied to that response would break a shipped feature that a locked slice proves works. State how the policy distinguishes them.
4. **The login page has no third-party dependency.** Opening it must issue no request to any host other than the app's own. Whether the stylesheet is self-hosted or removed is the implementation's call, but the page must remain legible and usable, and the browser suite must still be able to log in — `frontend/e2e/fixtures.ts` keys on the page title `Enter Passkey` and fills `input[name="passkey"]`, and it is **locked**, so that contract cannot change.
5. **HSTS is sent only when the connection is actually HTTPS.** Mkfd supports plain-HTTP LAN installs; sending `Strict-Transport-Security` to such a client would make the app unreachable for the max-age. Derive this from the request the same way the `Secure` cookie decision does (`index.ts:154` derives it from the request URL protocol, deliberately not from the `SSL` startup flag), and prove both branches.
6. **The playground's own CSP still holds exactly as locked.** `p2-selector-playground-isolation` asserts a specific policy on `/proxy`. The app-wide middleware must not replace, append to, or relax it. Prove the playground's policy is still what that slice requires.
7. **Published feeds still work.** `/public/feeds/*` is anonymous and consumed by feed readers, not browsers. Headers must not change its content type or make it unparseable. Prove a feed still serves and parses.

## Anti-bypass and adversarial requirements

- Do not add `'unsafe-inline'` or `'unsafe-eval'` to `script-src`. If something appears to need it, that is a finding to report, not a policy to write.
- Do not disable or skip the middleware for any route in order to make a test pass. If a route genuinely needs a different policy, it must say so explicitly and the test must assert the difference.
- Do not weaken the locked playground CSP, and do not "unify" it into the app-wide policy.
- Do not change the login page's title or the `input[name="passkey"]` selector; a locked e2e fixture depends on both.
- Do not send HSTS unconditionally, and do not derive it from the `SSL` startup flag.
- A test asserting only that a header string contains a directive is weak. Where the effect is observable in a browser — inline script blocked, framing refused, no third-party request on the login page — assert the effect.
- Do not introduce a new runtime dependency for header handling; Hono ships `secureHeaders` if a helper is wanted.

## Test-author expectations

- Integration tests over the real app for the header presence and per-response-kind coverage.
- Playwright coverage for the effects that are only observable in a browser: an injected inline script not executing, the app refusing to be framed cross-origin, and the login page issuing no third-party request. Use the existing authenticated fixture where a session is needed; the login page itself must be tested unauthenticated.
- A test proving the playground's locked CSP is unchanged, so a regression there is caught here rather than in the other slice.
- New test files must add ZERO Biome warnings against the locked ceiling of **545 warnings / 13 infos**. Verify with `bun run verify:static` before reporting; if the launcher denies that command, say so rather than guessing.
- Run any new test file several times and confirm the pass/fail split is identical. Two flaky tests were caught in `p2-protected-value-aes-gcm`; a flaky test in a locked suite gets blamed on the next implementation.
- Do not modify any file under an existing lock. Nine slices are locked, including `frontend/e2e/fixtures.ts` and `tests/e2e-harness-config.test.ts`.

## Notes and open questions for the lead

Flag rather than guess:

- **`style-src` is the hard one.** 33 files under `frontend/src` use React `style={{ ... }}`, which emits inline `style` attributes. Under CSP those need `style-src-attr 'unsafe-inline'` (or CSP3 `'unsafe-hashes'` with per-value hashes, which is impractical for dynamic values). Propose a policy that is honest about this: a strict `script-src` with a pragmatic `style-src` is a real improvement and worth stating plainly, whereas claiming a strict policy that the app cannot actually run under is worse than none. Say what you propose and why.
- Whether the Pico stylesheet should be self-hosted (matching the SelectorGadget precedent, which pinned and integrity-checked a vendored copy) or dropped in favour of a small amount of inline CSS on the login page. Note that inline CSS interacts with requirement 2's `style-src` decision.
- Whether `frame-ancestors` should be `'none'` app-wide with `'self'` only on `/proxy`, or `'self'` throughout. Requirement 3 needs a concrete answer; state the one your tests assume.
