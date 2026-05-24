# Outbound Fetch Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one shared SSRF/outbound-fetch policy before any feature fetches a user-configured URL.

**Architecture:** `utilities/outbound-fetch-policy.utility.ts` validates URL scheme, hostname, DNS results, private/loopback/link-local/reserved ranges, cloud metadata addresses, and explicit admin overrides. Every fetch boundary calls it before requesting a URL and again before manually following redirects.

**Security decision:** Default behavior blocks loopback, private RFC1918/ULA networks, link-local ranges, multicast/reserved ranges, and known cloud metadata hosts/IPs. Self-hosted admins can intentionally allow LAN sources with `ALLOW_PRIVATE_FETCHES=true` or `OUTBOUND_FETCH_ALLOWLIST=nas.local,10.0.0.5`. In v1, feed-level overrides are allowed but must remain explicit and scoped per feed.

**Tech Stack:** Bun, TypeScript, `node:dns/promises`, `node:net`, `bun:test`

**Depends on:** None. Implement this before Feed Format preview changes, Backend Route Decomposition, Existing Feed Transformer, Source Assistant, proxy/user-agent profiles, or any new source type that fetches user-controlled URLs.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `utilities/outbound-fetch-policy.utility.ts` | Validate user-configured outbound URLs against SSRF policy |
| Create | `tests/outbound-fetch-policy.test.ts` | Unit tests for scheme/range/allowlist handling |
| Modify | `index.ts` and fetch utilities | Apply policy at existing fetch boundaries until Backend Route Decomposition moves them |

---

### Task 1: Policy utility

- [ ] Add `parseAllowlist(raw)`.
- [ ] Add `isBlockedAddress(address)` for IPv4/IPv6 private, loopback, link-local, reserved, multicast, and metadata ranges.
- [ ] Add `assertOutboundFetchAllowed(rawUrl, options)` that permits only `http:` and `https:`, checks metadata hostnames, resolves DNS, and rejects blocked resolved addresses unless the admin override or host allowlist applies.
- [ ] Read runtime defaults from `ALLOW_PRIVATE_FETCHES` and `OUTBOUND_FETCH_ALLOWLIST` at call sites, not inside low-level pure helpers.
- [ ] Define caller merge precedence for policy options as `feed override > global setting/env > safe default`.
- [ ] **Migration note:** In v1, env vars are the only source of `allowPrivateFetches` and `outboundFetchAllowlist`. When Settings Page (Runtime/Admin) is implemented, these reads must be replaced with effective settings lookups (`settings.allowPrivateFetches`, `settings.outboundFetchAllowlist`). Design call sites to accept an options object so the source can change without touching policy logic.

### Task 2: Policy tests

- [ ] Allows normal public `http`/`https` URLs.
- [ ] Rejects non-HTTP schemes such as `file:`.
- [ ] Blocks `127.0.0.1`, `::1`, `169.254.169.254`, `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16` by default.
- [ ] Allows explicit allowlist hosts and IPs.
- [ ] Parses comma-separated allowlists with trimming and lowercase normalization.

### Task 3: Apply to fetch boundaries

- [ ] Apply before `/proxy`.
- [ ] Apply before sample HTML fetches and preview generation.
- [ ] Apply before selector suggestion and root-url utility fetches.
- [ ] Apply before worker fetches of feed config URLs.
- [ ] Apply before Existing Feed Transformer probe/parser fetches.
- [ ] Revalidate every redirect target before following it.
- [ ] Ensure worker/transformer callers pass feed-specific policy options when overrides exist.

### Task 4: Verify

```bash
bun test tests/outbound-fetch-policy.test.ts
```

Expected: PASS.
