# Proxy / User-Agent Profiles — Design Spec

**Date:** 2026-05-24
**Tier:** R3 Transformation & Scraping Intelligence
**Status:** Draft

---

## Goal

Add reusable proxy and user-agent profiles so feeds can share stable request identities without duplicating low-level request config.

This feature standardizes profile management while still allowing per-feed overrides in v1.
Settings is the source of truth for profile definitions; Builder consumes those profiles via selection controls.

---

## Scope

### In scope

- Runtime-managed profile registry for:
  - proxy profiles
  - user-agent profiles
- Feed config references to profile IDs
- Per-feed override fields in v1
- Settings/Admin UI for creating/updating profiles
- Builder dropdown selectors for profile assignment
- Builder inline "create profile" flow that reuses the same form component as Settings
- Validation, masking, and safe storage for sensitive profile fields
- Integration with shared fetch policy execution

### Out of scope

- Automatic proxy pool rotation logic
- Third-party managed browser/session orchestration
- Cross-feed adaptive profile scoring

---

## Data Model

### Proxy profile

- `id`, `name`, `enabled`
- `protocol` (`http` | `https` | `socks5`)
- `host`, `port`
- optional auth (`username`, protected `password`)
- optional static headers

### Feed config linkage

- `request.proxyProfileId?: string`
- optional `request.proxyOverride` (v1) for per-feed one-off values
- if `proxyProfileId` is set, runtime resolves profile first, then applies override fields

### User-agent profile

- `id`, `name`, `enabled`
- `userAgent` string
- optional client-hints metadata (future-compatible, optional)

### v1 precedence

1. Per-feed explicit override values
2. Per-feed referenced profile values
3. Global default profile (if configured)
4. Env/default fallback

Per-feed overrides are supported in v1 and are scoped to that feed.

---

## Security Requirements

- Proxy passwords and sensitive header values are stored as protected values.
- Profile APIs never return plaintext secrets.
- Secret fields are write-only after creation/update; reads return masked presence and metadata only.
- Validation rejects unsafe/invalid host, port, and header structures.
- Outbound Fetch Policy still validates request destinations regardless of proxy/user-agent selection.
- Add explicit UI warning: selected proxy can observe outbound request traffic for that feed.
- Optional proxy test endpoint must be rate-limited, timeout-bound, and must not log credential material.

---

## Integration Requirements

- Shared fetch executor consumes effective proxy/user-agent values.
- Source Assistant, transformer, and web scraping worker paths use the same profile resolution.
- Settings page shows profile origin and indicates masked sensitive fields.
- Builder exposes profile dropdowns and uses the shared profile form for inline create/edit.

---

## UX Contract

- Settings page contains canonical proxy/user-agent profile management (list/create/edit/delete).
- Builder request section includes:
  - profile dropdown
  - "Add profile" action opening shared form in modal/drawer
  - auto-select newly created profile on success
- Builder keeps manual override controls for v1 only where explicitly enabled by feed config schema.

---

## Dependencies and Ordering

Depends on:

- Protected Value Encryption
- Feed Config Formalization
- Settings Page (Runtime/Admin)
- Fetch Policy / Retry / Fallback

Should be implemented before:

- Higher-volume source types (Sitemap, GraphQL, Calendar) where request reliability is critical

---

## Acceptance Criteria

- Admin can define proxy and user-agent profiles centrally.
- Feed configs can reference profiles and optionally override per feed in v1.
- Runtime requests use resolved effective profile values consistently across fetch paths.
- Sensitive profile secrets are masked/protected end-to-end.
