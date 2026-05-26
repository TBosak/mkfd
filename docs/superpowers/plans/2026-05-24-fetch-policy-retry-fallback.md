# Fetch Policy / Retry / Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a shared fetch execution policy with one configurable feed-run timeout plus retry/redirect/fallback behavior that all scraper-style fetch paths reuse.

**Architecture:** Create a policy utility that resolves effective settings (`per-feed > global > env/default`), enforces outbound policy checks, executes requests under a feed-run deadline budget, and optionally falls back to advanced mode.

**Security decision:** SSRF/outbound blocking remains mandatory for every attempt and redirect target in both standard and advanced modes.

**Tech Stack:** Bun, TypeScript, Hono, `bun:test`

**Depends on (must be implemented first):**
- Outbound Fetch Policy
- Feed Config Formalization
- Settings Page (Runtime/Admin)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `utilities/fetch-policy.utility.ts` | Resolve effective policy + execute request attempts |
| Create | `models/fetch-policy.model.ts` | Typed runtime policy definitions |
| Modify | `utilities/outbound-fetch-policy.utility.ts` callers | Ensure all attempts/redirects are revalidated |
| Modify | `workers/*` and scraper utilities | Replace ad-hoc fetch behavior with shared executor |
| Create | `tests/fetch-policy.test.ts` | Unit tests for precedence, retry, fallback, redirect handling |
| Modify | `tests/*integration*` (as needed) | Integration checks for transformed/assistant fetch paths |

---

### Task 1: Define typed policy model

- [ ] Add fetch policy model with `feedRunTimeoutMs`, retry, backoff, redirect cap, response cap, mode, and fallback fields.
- [ ] Add validation/normalization bounds for each field.
- [ ] Add resolver precedence: `per-feed override > global setting > env/default`.
- [ ] Treat request-level timeouts as internal executor details (not JSON-LD-specific user settings).

### Task 2: Implement shared fetch executor

- [ ] Implement `executeWithFetchPolicy(url, policy, context)` utility.
- [ ] Enforce a single feed-run deadline budget across all attempts/redirects/fallback.
- [ ] Enforce outbound policy before each attempt and redirect follow.
- [ ] Implement retry classifier for network/408/429/5xx cases.
- [ ] Implement fixed/exponential backoff behavior.
- [ ] Implement optional single advanced fallback attempt.

### Task 3: Wire call sites

- [ ] Replace direct fetch usage in scraper preview/sample flows.
- [ ] Replace direct fetch usage in worker web-scraping and transformer probes.
- [ ] Replace Source Assistant observation fetches with shared executor.
- [ ] Ensure feed-level overrides are passed for each feed request path.

### Task 4: Add tests

- [ ] Unit: precedence resolution and value bounds.
- [ ] Unit: retry/backoff and non-retry behavior.
- [ ] Unit: fallback trigger conditions and one-time fallback cap.
- [ ] Unit: redirect revalidation behavior.
- [ ] Integration: representative worker/assistant path uses shared policy.

### Task 5: Verify

- [ ] Run targeted tests:
```bash
bun test tests/fetch-policy.test.ts
```
- [ ] Run related integration tests:
```bash
bun test tests
```

Expected: PASS with no regressions in existing fetch paths.

## Implementation Notes - 2026-05-25

- Added typed fetch policy model and shared fetch executor with bounded timeout, response size, redirects, retry classification, and backoff.
- Added effective policy resolution from per-feed config/env/default values.
- Wired standard web scraping fetches, existing feed parser fetches, and Source Assistant observation fetches through the shared executor.
- Verification: `bun test tests/fetch-policy.test.ts tests/existing-feed-parser.test.ts tests/source-assistant/analyzers.test.ts tests/web-scraping-form-data.test.ts`, `bun test tests/`, and `cd frontend && bun run build` pass.
