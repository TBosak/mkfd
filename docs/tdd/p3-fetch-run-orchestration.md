# TDD Requirements Brief: `p3-fetch-run-orchestration`

## Ownership

- Roadmap packet and finding IDs: Packet 3 retry/fallback bullet; S3, S4, S6;
  Fetch Policy readiness finding.
- Feature spec and implementation-plan links:
  `docs/superpowers/specs/2026-05-24-fetch-policy-retry-fallback-design.md`,
  `docs/superpowers/specs/2026-09-11-fetch-run-orchestration-design.md`, and
  `docs/superpowers/plans/2026-09-11-fetch-run-orchestration.md`.
- Production surfaces owned by this slice: `models/fetch-policy.model.ts`,
  `utilities/fetch-policy.utility.ts`, `utilities/web-scraping-fetcher.utility.ts`,
  and narrowly required cancellation propagation in existing standard callers.
- Test surfaces the authorized test author may add or edit:
  `tests/p3-fetch-run-orchestration*.test.ts` only.

## Behavioral contract

| ID | Required observable behavior |
|---|---|
| A1 | A standard request makes at most `retryCount + 1` attempts; transport failures, 408, 429, and 5xx retry, while other 4xx responses return immediately without fallback. |
| A2 | Fixed, exponential, and zero backoff produce the bounded wait sequence; no wait or attempt begins if it cannot fit within the one remaining deadline. |
| A3 | `mode: advanced` executes through the approved advanced seam rather than the standard transport and applies the same bounded retry classification. |
| A4 | Standard mode with `fallbackToAdvanced` performs exactly one advanced attempt only after retry-eligible standard exhaustion; it does not fallback after a normal 4xx, policy refusal, cancellation, or timeout. |
| A5 | Standard 2xx and ordinary 4xx results retain data, status, final URL, headers, and ordered sanitized attempt evidence. |
| A6 | Web-scraping simple and form requests honor explicit advanced mode/fallback through the shared executor while retaining method, body, headers, cookies, request profile, and outbound policy. |
| A7 | Existing-feed and Source Assistant standard requests continue using the same shared policy behavior; an unused alternate executor cannot satisfy the integration contract. |

## Invariants and state transitions

| ID | Invariant or transition |
|---|---|
| I1 | One monotonic deadline covers every attempt, redirect, backoff, and fallback; the advanced seam receives only the remaining positive budget. |
| I2 | Attempt ordinals are contiguous and modes reflect the transport actually used; fallback can add at most one final advanced record. |
| I3 | The outbound policy object is preserved for every standard attempt and is supplied to the approved advanced adapter path. |
| I4 | Retry/fallback state is operation-local: concurrent independent calls do not share attempt counts, cancellation, or deadlines. |

## Errors and boundaries

| ID | Error condition or boundary behavior |
|---|---|
| E1 | Exact retry/backoff/timeout limits are accepted and first-over values are bounded by the existing resolver contract: retries 0–5, backoff 0–30,000 ms, timeout 1,000–600,000 ms, redirects 0–10, response bytes 64 KiB–20 MiB. |
| E2 | Cancellation before start, during an active request, and during backoff terminates promptly with a typed cancellation code and starts no later attempt or fallback. |
| E3 | Deadline exhaustion before/during request, backoff, or fallback returns a typed deadline code rather than a raw transport error. Exact-deadline and first-over behavior are deterministic. |
| E4 | Retry exhaustion and advanced failure expose stable typed safe codes plus attempt evidence without URL credentials/query secrets, protected header/cookie values, proxy credentials, FlareSolverr endpoint secrets, or raw injected error text. |
| E5 | A retry-eligible response with a response body does not leak that body through public error/attempt data. |

## Current behavior and RED reason

Pre-existing baseline:

```text
bun test tests/fetch-policy.test.ts tests/web-scraping-form-data.test.ts tests/existing-feed-parser.test.ts tests/source-assistant/analyzers.test.ts --timeout=30000
12 pass / 0 fail / 26 assertions
```

The current loop ignores `mode` and `fallbackToAdvanced`, has no advanced seam
or cancellation signal, sleeps with ambient timers, throws untyped prose that
includes raw transport messages, and has no production integration for advanced
web-scraping execution. New tests must fail for those missing behaviors rather
than for imports, fixtures, or live-network setup.

## Required edge and adversarial cases

- Cover each retryable status, at least one transport failure, and contrasting
  400/401/403/404 behavior.
- Prove zero, exact maximum, and attempted-over-maximum retry counts without a
  large or slow fixture.
- Prove fixed/exponential wait sequences with controlled time; do not sleep in
  wall-clock time.
- Cover advanced success/failure, direct advanced mode, standard recovery before
  fallback, single fallback success/failure, and fallback suppression cases.
- Cancel before start, during the transport, and during backoff.
- Use secret-bearing URLs, headers/cookies, proxy credentials, endpoints, error
  strings, and bodies, then inspect `String(error)`, message, code, public
  details, result metadata, and attempt records for leakage.
- Run concurrent independent executions with deterministic interleaving to
  prove operation-local state.

## Compatibility and migration invariants

- Preserve current successful standard response semantics and ordinary-4xx
  return behavior.
- Preserve `resolveFetchPolicy` precedence and clamping expected by the locked
  settings tests.
- Preserve request-profile and form-request propagation.
- No persisted-data migration is part of this slice.

## Non-goals

- Whole-feed per-ID serialization and global worker queue backpressure (the
  immediately following Packet 3 slice).
- Browser session internals, FlareSolverr protocol internals, proxy CRUD, source
  parsing, or new UI controls.
- Live third-party services.

## Test constraints

- No live third-party services.
- Deterministic fixtures and controlled time/randomness.
- Assert semantics rather than incidental formatting or private call structure.
- New required tests must demonstrate RED for the intended reason before implementation.
- The authorized test author may modify only `tests/` and `frontend/e2e/`.
- The test author self-reviews, fixes routine test-side issues, runs the narrow deterministic checks, and returns a compact coverage manifest keyed by the stable requirement IDs.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] Applicable edge/security/compatibility cases are covered.
- [ ] Failure messages identify the violated contract.
- [ ] Tests are isolated and deterministic.
- [ ] Targeted RED command and expected failure are stated.
