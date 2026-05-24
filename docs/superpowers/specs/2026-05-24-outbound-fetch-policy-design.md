# Outbound Fetch Policy — Design Spec

**Date:** 2026-05-24
**Tier:** R1 Foundation
**Status:** Approved

---

## Goal

Define one shared outbound URL policy that blocks SSRF-prone destinations by default and is applied consistently at every user-controlled fetch boundary.

This spec covers the **security boundary** only. It does not replace the broader Tier 2 "Fetch Policy / Retry / Fallback" work (retry, timeout, FlareSolverr strategy, proxy profiles, user-agent profiles).

---

## Scope

### In scope

- Shared policy utility (`utilities/outbound-fetch-policy.utility.ts`)
- URL scheme validation (`http:` / `https:` only)
- Hostname + DNS resolution checks against blocked private/reserved ranges
- Cloud metadata host/IP blocking
- Redirect target revalidation before follow
- Admin override controls:
  - `ALLOW_PRIVATE_FETCHES=true`
  - `OUTBOUND_FETCH_ALLOWLIST=host1,host2,10.0.0.5`
- Per-feed override inputs passed from effective feed config in v1
- Required integration points in existing fetch paths
- Unit tests for policy behavior

### Out of scope

- Retry counts/backoff
- Request timeout defaults
- FlareSolverr fallback orchestration
- Proxy/user-agent profile design
- Per-feed retry policy UI
- General HTTP client abstraction

---

## Threat Model

The app accepts user-configured URLs and can run in self-hosted environments with network reachability beyond a browser sandbox. Without a policy boundary, fetch paths can target:

- loopback interfaces
- private LAN ranges
- link-local destinations
- cloud metadata services
- reserved/multicast ranges

Impact includes internal service probing, metadata credential exposure, and unintended access to local infrastructure.

---

## Policy Contract

### Utility surface

```ts
export type OutboundFetchPolicyOptions = {
  allowPrivateFetches?: boolean;
  allowlistHosts?: string[];
};

export function parseAllowlist(raw?: string): string[];
export function isBlockedAddress(address: string): boolean;
export async function assertOutboundFetchAllowed(
  rawUrl: string,
  options?: OutboundFetchPolicyOptions,
): Promise<void>;
```

### Required rules

1. Only allow `http:` and `https:`.
2. Normalize hostnames for comparison.
3. Block known metadata hosts.
4. Resolve DNS (`all: true`) and reject if **any** resolved address is blocked.
5. Block loopback/private/link-local/reserved/multicast ranges (IPv4 + IPv6).
6. Re-run policy on each redirect target before follow.
7. Allow explicit overrides via `allowPrivateFetches` or `allowlistHosts`.

### Environment controls

- `ALLOW_PRIVATE_FETCHES=true` permits private destinations globally.
- `OUTBOUND_FETCH_ALLOWLIST` is a comma-separated host/IP allowlist.
- Env values are read at call sites and passed into the policy options.
- In v1, call sites may pass per-feed overrides; precedence is `per-feed override > global runtime setting/env > safe default`.

---

## Integration Points (Required)

Apply the policy before outbound requests in:

- `GET /proxy`
- preview/sample HTML fetch
- selector suggestion fetch helpers
- root URL utility fetch helpers
- worker fetches from feed config URLs
- existing-feed transformer probe/parser fetches
- source-assistant observation fetches (where input URL is user-provided)

For worker and transformer paths, call sites must merge feed-level override values into policy options before invoking the utility.

Any new feature that fetches user-configured URLs must use this policy.

---

## Error Handling

- Policy utility throws explicit errors for blocked URLs.
- Route handlers map policy failures to safe client errors (4xx) without leaking internal DNS/network details.
- Worker paths log blocked destination context minimally (feedId + host) and surface actionable failure status.

---

## Testing

Minimum unit coverage:

- allows public URL
- rejects non-http scheme
- blocks loopback + RFC1918 + link-local + metadata targets
- parses allowlist correctly
- allows explicit allowlist/override

Integration checks:

- `/proxy` rejects blocked URL
- preview path rejects blocked URL
- worker/transformer path rejects blocked URL

---

## Dependencies and Ordering

- No feature dependency required to define this policy.
- Must be implemented before:
  - Backend Route Decomposition finalization
  - Existing Feed Transformer rollout
  - Source Assistant backend routes
  - Tier 2 fetch/retry/fallback and proxy/user-agent profile expansion

This is a foundational security control and should ship ahead of broader scraping intelligence work.

---

## Acceptance Criteria

- A single shared policy utility exists and is reused by all fetch boundaries listed above.
- Private/metadata destinations are blocked by default.
- Redirect chains are policy-checked target-by-target.
- Admin overrides are explicit and auditable via env config.
- Feed-specific overrides are explicit in feed config and scoped to that feed only.
- Outbound fetch paths no longer perform ad-hoc URL safety checks independently.
