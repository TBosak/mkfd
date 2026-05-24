# Settings Page (Runtime/Admin) — Design Spec

**Date:** 2026-05-24
**Tier:** R2.5 Admin & Runtime UX
**Status:** Approved

---

## Goal

Add a first-class Settings page for administrators to configure most operational/runtime behavior currently spread across environment variables and ad-hoc defaults, while keeping high-risk boot secrets explicitly gated.

The page should provide one place to manage:

- runtime retention settings (already present in Health)
- outbound fetch safety toggles
- server/public URL and scraping runtime defaults
- advanced scraping and email worker runtime settings
- reusable request profile management (proxy/user-agent) used by Builder

For fetch/proxy-related keys, Settings controls global defaults; feed-level overrides (v1) are configured in feed config and take precedence for that feed.

---

## Scope

### In scope

- New admin Settings page under the app shell
- Backend settings API for typed app settings
- Runtime DB persistence for app settings
- Effective-settings resolution utility used by fetch/runtime code
- Safe redaction/masking behavior for sensitive settings
- Explicit restart-required metadata for boot-level settings
- Migration of existing Health settings tab to the shared settings model

### Out of scope

- Multi-user role model (single-admin assumption remains)
- Remote secret manager integrations
- Full config-file editor
- Feature-specific advanced tuning UIs (for future feature specs)
  - except request-profile CRUD, which is explicitly in scope as a shared admin primitive

---

## Settings Model

Settings are split by mutability and risk:

### Class A — Runtime editable (no restart)

- `retention_days`, `retention_days_enabled`
- `retention_runs`, `retention_runs_enabled`
- `server_url` (used for feed links)
- `allow_private_fetches`
- `outbound_fetch_allowlist`
- `chrome_extensions_path`
- `feed_run_timeout_ms` (single user-configurable whole-feed scrape/fetch timeout)
- `default_max_response_size_bytes` (if fetch policy runtime supports it)

### Class B — Runtime editable, restart recommended

- `node_options` (used by IMAP worker spawn defaults)
- any setting consumed only at process/worker initialization boundaries

### Class C — Boot secrets / critical auth (env-only in v1)

- `passkey`
- `cookie_secret`
- `encryption_key`
- `ssl`
- `runtime_db_path`

Class C values are not editable in the Settings UI for v1. They are shown as source metadata only (or masked presence), remain environment-managed, and are always restart-required when changed outside the app.

---

## Storage and Precedence

Use a typed app settings store in the runtime DB (`runtime.db`) with keys + metadata.

### Resolution precedence

1. Explicit runtime setting from DB
2. Environment fallback
3. Code default

For Class C keys, env is the only source of truth in v1.

---

## API Surface

### Read effective settings

- `GET /api/settings`
- Returns:
  - effective values (masked where sensitive)
  - source (`db` | `env` | `default`)
  - `restartRequired` flag per setting
  - validation warnings

### Update settings

- `PUT /api/settings`
- Accepts partial typed payload with server-side validation.
- Rejects unknown keys.
- Applies per-key policy:
  - runtime keys update immediately
  - restart keys update with warning
  - class C keys are rejected as read-only in v1

### No secret mutation endpoint in v1

- Class C keys are read-only via Settings API.
- Secret rotation remains an environment/deployment operation.

---

## Security Requirements

- Never return plaintext for `passkey`, `cookie_secret`, `encryption_key`, or protected values.
- Audit-log setting mutations (who/when/key, excluding secret values).
- Validate all URL/path/list settings server-side.
- Outbound policy settings must integrate with `assertOutboundFetchAllowed` behavior.
- UI must clearly indicate Class C settings are env-managed and read-only in v1.

---

## UX Requirements

- Group settings by category:
  - Security
  - Runtime/Storage
  - Network & Fetch Policy
  - Scraping Runtime
  - Email Worker
- Each row shows:
  - current value (masked when needed)
  - source (`DB`, `ENV`, `Default`)
  - restart badge when applicable
- Save behavior:
  - inline validation
  - per-section save
  - unsaved changes warning
- Add "Export sanitized diagnostics" action (no secrets).

---

## Dependencies and Ordering

Depends on:

- Protected Value Encryption
- Feed Config Formalization
- SQLite Runtime Substrate + Feed History
- Outbound Fetch Policy
- App Shell / Navigation

Should be completed before:

- Broad Tier 2 fetch/retry/fallback controls UI
- Proxy/user-agent profiles UI
- Source Assistant operational tuning UI

---

## Acceptance Criteria

- Admin can manage non-secret runtime settings from one Settings page.
- Existing health retention settings are consolidated into the unified settings API/model.
- Outbound policy toggles are configurable in Settings and reflected in runtime behavior.
- Feed-level fetch/proxy overrides in v1 can override global defaults for that feed only.
- Sensitive/boot settings are clearly marked env-managed, masked, and restart-required.
- No setting path leaks secret plaintext in API responses or logs.
