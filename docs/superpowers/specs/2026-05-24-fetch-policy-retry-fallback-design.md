# Fetch Policy / Retry / Fallback — Design Spec

**Date:** 2026-05-24
**Tier:** R3 Transformation & Scraping Intelligence
**Status:** Approved

---

## Goal

Define one shared fetch execution policy for scraper-style requests so all relevant features use consistent timeout, retry, redirect, and fallback behavior.

This layer sits above the Outbound Fetch Policy security boundary and below feature-specific extraction logic.

---

## Scope

### In scope

- Shared fetch policy utility and typed policy model
- Whole-feed run timeout budget enforcement
- Request timeout and max-response-size safety limits (internal, not per-feature knobs)
- Retry count + backoff strategy
- Safe redirect behavior integrated with outbound policy checks
- Standard fetch mode and advanced mode (FlareSolverr path)
- Optional fallback from standard to advanced mode
- Global defaults + per-feed overrides in v1
- Unit/integration tests for policy behavior

### Out of scope

- Proxy profile data model details (covered in Proxy/User-Agent Profiles spec)
- Feature-specific extraction/parsing logic
- Browser automation flows beyond configured advanced fetch path
- Secret bootstrap/auth settings (`passkey`, `cookie_secret`, `encryption_key`)

---

## Policy Model

```ts
type RetryBackoffMode = "none" | "fixed" | "exponential";
type FetchMode = "standard" | "advanced";

type FetchPolicy = {
  feedRunTimeoutMs: number;
  maxResponseSizeBytes: number;
  maxRedirects: number;
  retryCount: number;
  retryBackoffMode: RetryBackoffMode;
  retryBackoffMs: number;
  mode: FetchMode;
  fallbackToAdvanced: boolean;
  allowPrivateFetches: boolean;
  outboundFetchAllowlist: string[];
  userAgentProfileId?: string;
  proxyProfileId?: string;
};
```

### v1 precedence

1. Per-feed override
2. Global runtime setting
3. Env/default fallback

Per-feed overrides are first-class in v1 and apply only to that feed.

`feedRunTimeoutMs` is the single user-configurable timeout control. Request-level timeouts inside the executor are derived internal values and are not JSON-LD- or analyzer-specific settings.

---

## Execution Rules

1. Build effective policy from precedence model.
2. Validate target with Outbound Fetch Policy before request.
3. Run request attempts under one feed-run deadline (`feedRunTimeoutMs`) with response-size enforcement.
4. On redirect, validate each target before follow.
5. On retry-eligible failure, retry with configured backoff.
6. If configured and failure persists, run advanced fallback once.
7. Return typed outcome with attempt metadata for logs/history.

Retry-eligible failures include network errors, 408/429, and 5xx responses. 4xx (except 408/429) does not retry.

---

## Security & Reliability Requirements

- Outbound Fetch Policy remains mandatory regardless of retry/fallback mode.
- Do not log secret material or sensitive headers.
- Cap `feedRunTimeoutMs` and retry/backoff values with server-side validation bounds.
- Prevent unbounded loops (retry cap, redirect cap, single advanced fallback attempt).
- Preserve host-level audit context (`feedId`, host, mode, attempt count).

---

## Dependencies and Ordering

Depends on:

- Outbound Fetch Policy
- Feed Config Formalization
- Settings Page (Runtime/Admin) for global defaults
- Protected Value Encryption (if request headers/body include protected values)

Should be implemented before:

- Proxy / User-Agent Profiles rollout
- Web Scraping Form Data worker wiring
- JSON-LD and Source Assistant runtime hardening

---

## Acceptance Criteria

- Shared fetch policy utility is used by scraper/transformer/source-assistant fetch paths.
- Effective policy honors per-feed overrides in v1.
- Redirect, feed-run timeout, retry, and fallback behaviors are consistent and tested.
- Policy outputs observable attempt metadata without leaking sensitive data.
