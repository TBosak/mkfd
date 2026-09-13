# Test Review: `p3-fetch-run-orchestration`

## Round 1 — full semantic review

**Verdict:** REVISION REQUIRED

The draft independently reproduces as 4 existing/guard passes and 12 intended
failures with no syntax, import, timeout, or cleanup failures. The structure is
compact and most requirements are represented, but these gaps must be corrected
before RED can be accepted. Preserve the existing coverage and return only this
delta.

1. **E3 clock cases are internally inconsistent.** The `before` sequence starts
   at 100, which gives a deadline of 200 and permits the request, while the
   `request` sequence can expire at the pre-request check and therefore need not
   call the transport. Supplying both `now` and `clock` with contradictory
   values also lets two conforming seam names behave differently. Select one
   exact public clock seam (`now` is preferred), define its call sequence, and
   make before-request, post-request, backoff, and pre-fallback exhaustion
   unambiguous. Add an exact-deadline contrast beside first-over behavior.
2. **A4 policy refusal is inferred from prose.** A generic `Error("outbound
   policy refused ...")` is observationally the same as a retryable transport
   failure unless production parses human text. Use a stable policy-refusal
   type/code or exercise the real outbound policy with a deterministic blocked
   numeric target. Assert the typed safe terminal code and that neither retry
   nor fallback runs.
3. **A3 only proves one advanced 503 retry.** Prove the same classifier applies
   in direct advanced mode: one transport/408-or-429 retryable contrast and one
   ordinary 4xx that returns immediately without retry. Keep this compact; the
   exhaustive standard status matrix need not be duplicated.
4. **E2 does not prove active cancellation reaches the transport.** The fake
   listens to the controller captured from the test, so it can pass even if the
   executor never passes the signal into its transport configuration. Read the
   signal supplied to the fake transport (and advanced seam if covered) and
   reject from that signal. Assert it is the caller's signal and no later
   attempt/fallback starts.
5. **E4 misses recovered-attempt and advanced-path leakage.** A transport error
   followed by success currently leaves its raw error message in the successful
   result's attempt array. Assert successful result metadata is sanitized too.
   Add an advanced failure containing a secret-bearing solver endpoint/error and
   inspect `String(error)`, message, code, public details, and attempts. A
   response body's secret must remain absent in retry/fallback evidence.
6. **A5 does not assert the promised semantic attempt fields.** Require a stable
   outcome code and a finite nonnegative elapsed/duration value in successful,
   ordinary-4xx, retry, and terminal evidence. Do not assert ambient exact
   milliseconds.
7. **A6 proves direct advanced mode but not configured fallback or cookie
   propagation.** Add a compact local fallback flow: the standard target remains
   retryably unsuccessful, the configured solver runs once, and the returned
   HTML comes from it. In both advanced cases assert the solver payload receives
   the intended cookie without exposing it in public metadata. Also cover the
   safe typed failure when advanced/fallback is requested without a valid enabled
   solver configuration.
8. **A7 is only a string-presence guard.** It prevents deletion of an import but
   does not show the existing-feed and Source Assistant paths receive shared
   retry/deadline behavior. Add small local behavioral integrations (a first
   retryable response followed by valid RSS/JSON/HTML is enough) and retain the
   source guard only if it adds a non-vacuous architectural constraint.
9. **E1 lower edges are incomplete.** Upper exact/+1 is covered, but add compact
   exact/first-below checks for retry count, backoff, and redirect count as well
   as the already-covered timeout/response-size minima.

Keep one canonical deterministic seam vocabulary in the test types:
`advancedFetch`, `now`, `wait`, `signal`, `remainingMs`, and `outboundPolicy`.
Avoid alternative-property fallbacks such as `clock` or
`policyOptions ?? outboundPolicy ?? policy`, because they weaken the contract
and can make the same fixture pass incompatible implementations.

## Round 2 — revision delta review

**Verdict:** REVISION REQUIRED

The revision closes all nine Round 1 findings and independently reproduces as
3 passes / 14 intended failures / 72 assertions. Two semantic gaps remain:

1. **A4 does not prove the one-attempt cap when fallback fails.** The successful
   fallback case cannot catch an implementation that retries the fallback only
   after an error. Add a compact case where standard attempts exhaust and the
   advanced fallback throws or returns a retry-eligible failure. Assert exactly
   one advanced call, a typed `FETCH_ADVANCED_FAILED`, and ordered sanitized
   standard-plus-advanced attempt evidence.
2. **A5/I2/E4 calls attempt evidence stable and sanitized without testing either
   property on successful results.** `expectAttemptMetrics` accepts any nonempty
   `outcomeCode`; assert exact semantic codes for representative success,
   retryable-status, transport-error, and ordinary-4xx attempts. Also inspect
   the successful/recovered public attempt array and prove the original URL
   credential/query marker is absent. The operational `finalUrl` return remains
   unchanged; this check is about audit attempt records.

Remove the duplicate identical maximum-attempt assertion while making this
delta. Preserve every other accepted case and return the complete focused RED.

## Round 3 — acceptance review

**Verdict:** ACCEPTED RED

The final delta closes both Round 2 findings without weakening accepted
coverage. Failed fallback now proves the single-attempt cap and ordered safe
evidence. Representative attempt transitions assert exact stable outcome codes,
and recovered public attempt records are checked for URL credential, query, and
transport-message leakage.

Independent verification:

```text
bunx biome check tests/p3-fetch-run-orchestration.test.ts
Checked 1 file. No fixes applied.

bun test tests/p3-fetch-run-orchestration*.test.ts
3 pass / 17 intended fail / 75 assertions
```

All failures are attributable to missing production orchestration seams,
advanced/fallback behavior, typed safe evidence, deadline/cancellation handling,
or web-scraping wiring. The local integration servers start and stop cleanly;
there are no import, syntax, fixture, timeout, or unrelated-state failures.
