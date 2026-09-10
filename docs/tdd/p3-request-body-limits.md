# TDD Requirements Brief: `p3-request-body-limits`

## Ownership

- Roadmap packet and finding IDs: Packet 3 resource-control bullet; S6 required fix 1.
- Feature spec and implementation-plan links: `docs/superpowers/specs/2026-09-09-runtime-resource-controls-design.md`; `docs/superpowers/plans/2026-09-09-runtime-resource-controls.md`; `docs/features/Webhook Feed Implementation Plan.md` (64 KB payload requirement).
- Production surfaces owned by this slice: the shared inbound request-body boundary, its route-limit policy/constants, and its mount in `index.ts` before body parsers/authenticated or anonymous routes.
- Test surfaces GPT-5.6 Luna may add or edit: new slice-specific files under `tests/` and new test-only helpers/fixtures under `tests/`. Existing accepted tests and all production/configuration/docs files are read-only to the test author.

## Current behavior and RED reason

The real application installs no body-limit middleware. It has 25 direct `req.json()`, `req.formData()`, or `req.parseBody()` entry points. `POST /passkey` parses a form body, the anonymous `POST /webhook-feeds/:slug` parses JSON, and authenticated control/authoring routes parse JSON or forms with no byte ceiling. A declared or streamed oversized body can therefore reach an expensive parser and, for webhook ingestion, persistence.

Pre-existing baseline recorded immediately before authoring:

```text
bun test tests/auth-trust-boundary.test.ts
19 pass / 0 fail / 36 expectations
```

The narrow RED command should be the new slice test file(s). New behavioral tests must fail because oversize inputs are not rejected with 413; existing under-limit/auth behavior should continue to pass.

## Required observable behavior

1. The production server enforces a **1 MiB (1,048,576-byte) fallback cap** on any body-bearing request that has no stricter class.
2. Every current state-changing application/control request (`POST`, `PUT`, `PATCH`, or `DELETE`) is capped at **256 KiB (262,144 bytes)** unless requirement 3 or 4 is stricter.
3. `POST /webhook-feeds/:slug` is capped at **64 KiB (65,536 bytes)**.
4. `POST /passkey` is capped at **8 KiB (8,192 bytes)**.
5. An exact-limit body crosses the size boundary intact and reaches downstream routing/parsing. A body one byte over receives status 413. Tests may assert a downstream success or route-specific validation response for the exact-limit case, but must distinguish it from rejection by the size boundary.
6. A valid `Content-Length` known to exceed the applicable cap is rejected before request-body parsing. An oversized syntactically invalid JSON/form body must therefore return 413, not the parser's 400/error response.
7. A body without a usable declared length, including HTTP chunked transfer, is counted by bytes while streaming and is rejected as soon as it exceeds the applicable cap. A permitted streamed body is replayed byte-for-byte so downstream parsing observes the original content.
8. Limits count encoded bytes, not JavaScript characters. Multi-byte UTF-8 input cannot exceed a cap merely by hiding behind a smaller character count.
9. A malformed, negative, non-decimal, or ambiguous `Content-Length` must not create an unbounded path. The request is rejected as malformed (400 is acceptable); it must not reach the route parser or be accepted as a normal request. Use raw TCP only where the runtime fetch client normalizes forbidden framing.
10. A 413 response is stable and sanitized: it identifies the payload-too-large condition, does not reflect submitted body fragments or secrets, and does not become a generic parser-validation response.
11. The boundary is mounted early enough to protect both the passkey parser and independently authenticated webhook parser. It must not make webhook ingestion session-authenticated or make `/public/feeds/*` session-authenticated.
12. Body-free requests retain existing behavior. In particular, the anonymous readiness route and static published-feed route remain reachable according to their existing contracts, and authenticated below-limit control requests continue to function.

## Required edge and adversarial cases

- Exact maximum and maximum + 1 for the 8 KiB, 64 KiB, and 256 KiB classes, plus one fallback-cap scenario if it can be exercised without relying on private implementation exports.
- Both valid declared-length and chunked/unknown-length bodies.
- Malformed oversized JSON proving early 413 precedence over parsing.
- A valid streamed JSON or form body proving lossless downstream replay.
- Multi-byte UTF-8 near a boundary, measured in bytes.
- Invalid length metadata over a raw HTTP connection.
- Anonymous valid-token webhook under the limit remains functional; anonymous unrelated protected routes remain refused.
- No live third-party service, shared mutable server process, timing race, or fixed-state dependency. A real server subprocess is preferred because middleware mount order is part of the contract; clean up all feed, DB, output, and process fixtures.

## Compatibility and migration invariants

- Valid v2/v3 feed requests at or below their applicable cap preserve the exact submitted bytes and current route semantics.
- Existing session, CSRF, login-throttle, webhook bearer-token, and anonymous published-feed behavior is unchanged.
- No YAML, SQLite, or feed-output migration is part of this slice.
- Route-specific limits override the fallback; no request may select a more permissive limit through headers, content type, query parameters, or body fields.

## Non-goals

- Webhook field/category/metadata bounds, rate limiting, SQLite event migration, retention, or concurrency (later resource-control slice).
- Filesystem traversal/read limits (later slice).
- Safe-regex evaluation (later slice).
- Remote response-size caps already owned by the shared outbound executor, parser expansion limits, retry/queue/concurrency, or browser session budgets.
- Changing route payload schemas, authentication policy, UI behavior, or user-configurable limit settings.

## Test constraints

- GPT-5.6 Luna is the explicit replacement test author for this slice because Claude weekly usage is unavailable.
- The test author may modify only `tests/` (and `frontend/e2e/` if genuinely necessary; no browser coverage is expected here).
- Do not edit, delete, rename, weaken, skip, or re-baseline any existing accepted test.
- No live third-party services.
- Deterministic fixtures and controlled time/randomness.
- Assert semantics rather than incidental formatting or private call structure.
- New required tests must demonstrate RED for the intended reason before implementation.
- Avoid snapshots, `.only`, `.skip`, `.todo`, arbitrary sleeps, and warning-ceiling regressions.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] Applicable edge/security/compatibility cases are covered.
- [ ] Failure messages identify the violated contract.
- [ ] Tests are isolated and deterministic.
- [ ] Targeted RED command and expected failure are stated.
- [ ] The author changed test/fixture files only and reports every changed path.
