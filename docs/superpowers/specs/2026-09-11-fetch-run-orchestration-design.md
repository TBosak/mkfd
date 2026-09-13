# Fetch Run Orchestration — Design Addendum

**Date:** 2026-09-11  
**Packet:** 3 — runtime, configuration, settings, network, and resource-control platform  
**Status:** Approved for TDD

## Reconciliation

This addendum narrows and updates the approved 2026-05-24 Fetch Policy design
against the v3 roadmap and the runtime that now exists. The shared pinned
outbound executor and FlareSolverr adapter remain the mandatory security
boundaries. The current `executeWithFetchPolicy` loop handles basic status
retries but ignores `mode` and `fallbackToAdvanced`, has no cancellation
contract, and exposes raw transport text in errors.

## Slice boundary

This slice completes one request-run state machine:

- bounded standard retries with fixed, exponential, or zero backoff;
- direct advanced mode and a single optional advanced fallback after standard
  retry exhaustion;
- one monotonic deadline across requests, waits, redirects, and fallback;
- cancellation of active requests and pending backoff;
- typed, sanitized outcomes and attempt evidence; and
- production wiring for web-scraping requests while preserving existing
  transformer and Source Assistant standard-fetch behavior.

Per-feed run serialization and global worker-queue backpressure are a separate
Packet 3 vertical slice. They wrap whole feed runs; placing them inside the
per-request executor would incorrectly reject legitimate multi-request sources
such as sitemap traversal and drill chains.

## Execution contract

1. Resolve bounded effective policy using the existing precedence contract.
2. In standard mode, perform at most `retryCount + 1` standard attempts.
3. Retry only transport failures, 408, 429, and 5xx responses. Ordinary 4xx
   responses are returned without retry or fallback.
4. In explicit advanced mode, use the approved FlareSolverr adapter and apply
   the retry policy to advanced attempts.
5. In standard mode with fallback enabled, one advanced attempt may follow
   exhausted retry-eligible standard attempts. It is never repeated.
6. Policy refusal, cancellation, or an exhausted deadline never triggers
   fallback.
7. Every request, redirect, backoff, and fallback consumes the same deadline.
   Remaining time, not the original budget, is passed to the advanced adapter.
8. Cancellation must interrupt both an in-flight operation and a pending
   backoff without starting another attempt.

## Security and observability

- Both modes retain the shared outbound policy. Advanced execution validates
  the target and FlareSolverr endpoint separately through its adapter.
- Public attempt evidence contains mode, ordinal, status when available,
  elapsed time, and a stable outcome code. It must not expose URL credentials,
  query values, protected headers/cookies, proxy credentials, or raw transport
  messages.
- Terminal failures use a typed error with a stable safe code and the sanitized
  attempt evidence. Callers must not need to parse human prose.
- Retry and backoff bounds remain server-controlled: retry count 0–5, backoff
  0–30,000 ms, total timeout 1,000–600,000 ms, redirect count 0–10, and response
  bytes 64 KiB–20 MiB.

## Compatibility

- Successful standard 2xx responses preserve data, status, final URL, and
  response headers.
- Ordinary 4xx responses remain normal results for callers that inspect them.
- Existing request-profile headers, user agent, proxy selection, form method,
  and request body continue to reach the standard executor unchanged.
- No live external service is required for verification.

## Acceptance

The Luna-authored suite must prove retry classification, exact attempt caps,
fixed/exponential waits, exact/over deadline behavior, direct advanced mode,
single fallback behavior, cancellation during request and backoff, sanitized
typed failures/metadata, and web-scraping integration. Existing fetch-policy,
form, transformer, and Source Assistant tests must remain green.
