# Settings Page (Runtime/Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin Settings page backed by a unified settings API and runtime DB persistence, covering most operational settings currently configured by env vars/defaults.

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this plan.**

**Architecture:** Add typed app-settings utilities in backend, expose `GET/PUT /api/settings`, and migrate Health retention settings to this shared model. Frontend gets a dedicated Settings page with grouped sections, source badges, restart-required badges, masked secret handling, and a request-profiles section that can be reused by Builder flows.

**Security decision:** Secret/boot-critical settings never round-trip in plaintext. Class C keys are env-only and read-only in v1; rotation stays in deployment workflows and is restart-required.

**Tech Stack:** Bun, TypeScript, Hono, drizzle-orm/bun-sqlite, React 18, shadcn/ui, `bun:test`

**Depends on (must be implemented first):**
- Protected Value Encryption
- Feed Config Formalization
- SQLite Runtime Substrate + Feed History
- Outbound Fetch Policy
- App Shell / Navigation Redesign

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `lib/analytics/schema.ts` | Add app settings table(s) and optional audit log table |
| Modify | `lib/analytics/db.ts` | Add typed app-settings read/write functions |
| Create | `utilities/app-settings.utility.ts` | Typed keys, defaults, validators, masking, precedence resolution |
| Create | `tests/app-settings.test.ts` | Unit tests for validation, masking, precedence |
| Create | `routes/settings.ts` | `GET /api/settings`, `PUT /api/settings` endpoints (class C writes rejected) |
| Modify | `frontend/src/pages/health/SettingsTab.tsx` | Migrate retention controls to shared settings API or deprecate tab |
| Create | `frontend/src/pages/settings/SettingsPage.tsx` | Main settings UI |
| Create | `frontend/src/components/settings/*` | Section cards, source badges, restart badges, read-only env-bound indicators |
| Create/Modify | `frontend/src/components/settings/RequestProfiles*` | Shared request profile management surface used by Settings and Builder modal flows |
| Modify | `frontend/src/main.tsx` (or routes file) | Add `/settings` route |
| Modify | `README.md` and `docker-compose.yml` docs | Document runtime settings behavior and env precedence |

---

### Task 1: Typed settings model and storage

**Files:**
- Modify: `lib/analytics/schema.ts`
- Modify: `lib/analytics/db.ts`
- Create: `utilities/app-settings.utility.ts`
- Create: `tests/app-settings.test.ts`

- [ ] Add typed key registry:
  - key name
  - type (`string|number|boolean|string[]`)
  - class (`A|B|C`)
  - restartRequired
  - default resolver
- [ ] Add DB storage for app settings (`settings` table extension or separate `app_settings` table).
- [ ] Add validation and normalization functions (URLs, lists, bounds).
- [ ] Add masking rules for sensitive keys.
- [ ] Add effective settings resolver with precedence `db > env > default`.
- [ ] Add unit tests for validation, masking, and precedence.

### Task 2: Settings API

**Files:**
- Create: `routes/settings.ts`
- Modify: `utilities/app-settings.utility.ts`
- Modify: `index.ts` (mount `routes/settings.ts` router)

- [ ] Add `GET /api/settings` returning effective values + source + restart metadata.
- [ ] Add `PUT /api/settings` for partial updates with strict key validation.
- [ ] Reject class C keys in `PUT /api/settings` with explicit read-only env-managed error.
- [ ] Ensure all secret values are masked in responses.
- [ ] Add safe error responses with per-field validation details.

### Task 3: Migrate health retention endpoints

**Decision:** Keep the Health Dashboard retention tab. Wire it to the shared settings API (retention-scoped subset only). Remove the old `GET/PUT /api/health/settings` endpoint once migration is complete — do not keep a shim.

**Files:**
- Modify: `routes/settings.ts` (remove old `/api/health/settings` routes after migration)
- Modify: `frontend/src/pages/health/SettingsTab.tsx`

- [ ] Update `SettingsTab.tsx` to read/write via `GET /api/settings` and `PUT /api/settings` instead of the old `/api/health/settings` endpoint.
- [ ] Scope the Health tab to retention-related keys only (e.g. log retention days, run history count) — do not surface unrelated settings here.
- [ ] Remove `GET /api/health/settings` and `PUT /api/health/settings` route handlers from the backend.
- [ ] Verify the Health Dashboard retention tab still functions correctly end-to-end after the migration.
- [ ] Verify the Settings page also shows and edits the same retention keys under its Runtime/Storage section.

### Task 4: Frontend settings page

**Files:**
- Create: `frontend/src/pages/settings/SettingsPage.tsx`
- Create: `frontend/src/components/settings/*`
- Modify: route wiring file

- [ ] Add categorized sections:
  - Security
  - Runtime/Storage
  - Network & Fetch Policy
  - Scraping Runtime
  - Email Worker
- [ ] Show source badges (`DB|ENV|Default`) and restart-required badges.
- [ ] Add masked inputs and reveal-on-demand controls where allowed.
- [ ] Show class C settings as env-managed read-only rows (masked presence only).
- [ ] Include request-profiles management section (proxy/user-agent) that can be opened from Builder for inline create/edit.
- [ ] Add save/discard behavior with dirty-state tracking.

### Task 5: Wire runtime consumers

**Files:**
- Modify existing fetch/runtime call sites as needed

- [ ] Replace direct env reads in runtime codepaths where settings should be UI-manageable.
- [ ] Ensure outbound fetch policy reads `allow_private_fetches` and `outbound_fetch_allowlist` from effective settings.
- [ ] Apply precedence for fetch/proxy-related keys as `per-feed override > global settings > env/default`.
- [ ] Ensure `feed_run_timeout_ms` is the single user-configurable timeout control for scraper-style runs.
- [ ] Keep hard boot values env-bound with no DB override path in v1.

### Task 6: Validation and docs

**Files:**
- Modify: `README.md`
- Modify: relevant deployment docs

- [ ] Document setting categories and precedence.
- [ ] Document restart-required keys and behavior.
- [ ] Document security guarantees for masked/protected settings.

### Task 7: Verification

- [ ] Run targeted tests:
```bash
bun test tests/app-settings.test.ts
```
- [ ] Run existing analytics/settings tests:
```bash
bun test tests/analytics.test.ts
```
- [ ] Manual checks:
  - settings load/save works
  - source badges show correct origin
  - masked secrets never leak
  - outbound policy toggles affect behavior

Expected: PASS, with no regression in health retention behavior.
