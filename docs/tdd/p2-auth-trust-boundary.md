# TDD Requirements Brief: `p2-auth-trust-boundary`

## Ownership

- Roadmap packet and findings: Packet 2; A2 (auth middleware fails open and trusts proxied traffic), the loopback/CSRF path recorded at `mkfd-audit-aggregate-0526.md:428`, and the session/passkey portions of S1/S2.
- Production surfaces owned by this slice: the auth middleware, session configuration, and passkey verification in `index.ts`; the route-exception list; a new origin/CSRF guard; login throttling.
- Explicitly NOT in this slice: A1 Selector Playground isolation, protected-value AES-GCM migration, `/configs/*` static serving, CSP and security headers, container hardening, and the redacting logger. Those are separate Packet 2 slices.
- Claude-owned test surfaces: `tests/` and `frontend/e2e/` only.

## Current RED baseline

`index.ts:149` is the whole authorization decision:

```ts
const connInfo = await getConnInfo(c);
const isLocal =
  !connInfo?.remote?.address ||
  ["127.0.0.1", "::1"].includes(connInfo.remote.address);
if (isLocal) return await next();
```

Four distinct defects, all reachable in a default deployment:

1. **Fails open on an indeterminate address.** `!connInfo?.remote?.address` grants full unauthenticated access whenever the peer address cannot be read, for any reason.
2. **Loopback is treated as authorization.** Behind a reverse proxy the peer is `127.0.0.1`, and in Docker it is the bridge gateway. This repository ships `docker-compose.yml` and documents reverse-proxy deployment, so the standard production topology disables authentication for every remote visitor.
3. **Passkey comparison is not timing-safe.** `inputKey === passkey` at `index.ts:163` short-circuits on the first differing byte.
4. **No throttling on `POST /passkey`.** Unlimited guesses at whatever entropy the operator chose.

Consequence of 1 and 2 together: on a normal Docker-plus-reverse-proxy install, `authMiddleware` returns `next()` for anonymous internet traffic before it ever consults the session.

### A trap this slice must not fall into

`routes/webhook.ts:10` exposes `POST /webhook-feeds/:slug` for external services, and it already authenticates independently and correctly via `verifyWebhookToken(token, feedConfig.webhookFeed.tokenHash)`. But `index.ts:179` mounts `authMiddleware` on `/*` with only `/public/feeds/*` excepted, so a legitimate external sender holding a valid token is redirected to `/passkey`. Inbound webhooks therefore work today **only** because a sender that looks local skips auth.

Removing the loopback bypass without excepting this route will permanently break inbound webhook ingress. That is the "deliberate independently authenticated webhook exception" the packet requires, and it must be proven by test, not assumed.

## Required observable behavior

1. **Authorization never derives from the peer address.** An anonymous request must be refused regardless of whether the peer is `127.0.0.1`, `::1`, a private bridge address, or unreadable. Prove the refusal specifically for the indeterminate-address case, which currently fails open.
2. **Fail closed.** Any error or absent value in the connection-info path results in refusal, never in `next()`.
3. **A development bypass may exist, but must be explicit, off by default, and impossible to enable accidentally in production.** It must require a deliberate opt-in that is absent from the shipped configuration, and it must refuse to activate when the app is running in a production configuration. A test must prove the default configuration does not grant it, and that a production-shaped configuration cannot turn it on.
4. **Passkey verification is timing-safe** and compares over a fixed-length digest rather than raw strings, so comparison time does not vary with the number of matching leading bytes.
5. **`POST /passkey` is throttled.** Repeated failures from the same origin are progressively refused, and the throttle cannot be reset by simply varying a header the client controls. A successful login must remain possible after the lockout window.
6. **State-changing requests carry an origin/CSRF check.** A cross-origin form POST to the app must be refused even when a valid session cookie is present, which is the `:428` attack. Safe methods are unaffected. The check must not rely on `SameSite` alone.
7. **Session cookies are hardened.** `httpOnly` and an appropriate `sameSite` are already set; `secure` currently follows the `SSL` flag, so a plaintext deployment issues a non-secure cookie. Define and enforce the intended behavior explicitly rather than leaving it implied by a CLI flag.
8. **Trusted-proxy handling is for observability only.** If a forwarded client address is parsed for logging, it must never feed an authorization decision, and a forged forwarding header must not change any access outcome.
9. **`POST /webhook-feeds/:slug` remains reachable without a session** and continues to authenticate solely on its own token. Prove that a valid token succeeds anonymously, an invalid token is refused with 401, and the route is not reachable merely because the peer looks local.
10. **`/public/feeds/*` stays anonymously readable**, preserving the existing feed-output contract.

## Anti-bypass and adversarial requirements

- Do not satisfy requirement 1 by moving the loopback allowance into configuration that ships enabled, or by widening the route-exception list beyond `/public/feeds/*` and the webhook ingress path.
- The dev bypass must not be enableable by an environment variable that a production compose file or Dockerfile already sets, and a test must assert the shipped `docker-compose.yml` and `dockerfile` do not enable it.
- Throttling state must be keyed on something the client cannot trivially rotate; a test must prove that changing a client-supplied header does not reset the counter.
- The CSRF guard must not be satisfiable by an attacker-supplied `Origin` or `Referer` that merely contains the expected host as a substring.
- Timing-safe comparison must be asserted structurally (a constant-time primitive over equal-length inputs), not by measuring wall-clock timing, which is non-deterministic in CI.
- Cover both the authenticated and anonymous paths for every route class: app pages, state-changing POSTs, `/public/feeds/*`, `/passkey` itself, and webhook ingress.
- Do not implement or test Selector Playground isolation, protected-value encryption, security headers, or container hardening here.

## Test-author expectations

- Integration tests that drive the real Hono app through requests, rather than unit-testing the middleware function in isolation, so the mount order and route exceptions are genuinely exercised.
- Include a regression test for the exact current defect: a request whose connection info is unavailable must be refused.
- Include a deployment-configuration test proving the shipped compose and Dockerfile do not enable the bypass.
- Keep tests deterministic: no reliance on real timing, real network, or wall-clock sleeps beyond a controlled fake clock for the throttle window.
- Run the new tests plus the five accepted Packet 1 lock sets. Do not run the full filesystem-mutating suite.

## Non-goals

- Any other Packet 2 slice (A1 playground isolation, AES-GCM protected values, `/configs/*` serving, CSP/headers, container hardening, redacting logger).
- Changing the passkey's storage format or introducing user accounts.
- Rate-limiting anything other than the login endpoint.

## Acceptance checklist

- [ ] Anonymous access is refused for loopback, bridge, and indeterminate peer addresses.
- [ ] The middleware fails closed on error.
- [ ] The dev bypass is off by default and cannot activate in a production configuration; the shipped compose and Dockerfile are proven not to enable it.
- [ ] Passkey comparison is structurally constant-time.
- [ ] Login throttling works and cannot be reset by a client-controlled header.
- [ ] A cross-origin state-changing POST with a valid session cookie is refused.
- [ ] Webhook ingress succeeds anonymously with a valid token and fails with an invalid one.
- [ ] `/public/feeds/*` remains anonymously readable.
- [ ] Targeted RED command and genuine failure breakdown are reported.
