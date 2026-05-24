# Proxy / User-Agent Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement reusable proxy and user-agent profiles with secure storage and consistent runtime application across scraper fetch paths.

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this plan.**

**Architecture:** Add typed profile storage in runtime DB, expose profile CRUD APIs, resolve effective request identity per feed (`override > profile > global > env/default`), and wire into shared fetch executor. Settings is the canonical profile management surface; Builder uses dropdown selection plus inline create via shared form component.

**Security decision:** Sensitive proxy credentials and protected header values are encrypted/masked, never returned in plaintext, and are replace-only after save.

**Tech Stack:** Bun, TypeScript, Hono, drizzle-orm/bun-sqlite, React 18, `bun:test`

**Depends on (must be implemented first):**
- Protected Value Encryption
- Feed Config Formalization
- Settings Page (Runtime/Admin)
- Fetch Policy / Retry / Fallback

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `lib/analytics/schema.ts` | Add proxy/user-agent profile tables |
| Modify | `lib/analytics/db.ts` | Add profile CRUD and lookup helpers |
| Create | `utilities/request-profile.utility.ts` | Resolve effective proxy + user-agent values |
| Create | `routes/profiles.ts` | Profile CRUD endpoints (`GET/POST/PUT/DELETE /api/settings/request-profiles`) |
| Modify | `utilities/fetch-policy.utility.ts` | Apply resolved request profiles at execution time |
| Create | `frontend/src/components/settings/ProxyProfileForm.tsx` | Shared proxy profile create/edit form used by Settings and Builder |
| Create | `frontend/src/components/settings/UserAgentProfileForm.tsx` | Shared user-agent profile create/edit form used by Settings and Builder |
| Create | `frontend/src/pages/settings/RequestProfilesPage.tsx` (or Settings section) | Canonical profile management UI |
| Modify | `frontend/src/pages/builder/*` | Profile dropdowns and inline create modal wiring |
| Create | `tests/request-profiles.test.ts` | Validation, masking, precedence, runtime resolution tests |

---

### Task 1: Profile schema and model

- [ ] Add proxy profile table and user-agent profile table with enable flags and timestamps.
- [ ] Model protected fields for proxy auth/header secrets.
- [ ] Add server-side validators for host/port/protocol/header shapes.

### Task 2: Backend APIs

- [ ] Add `GET /api/settings/request-profiles`.
- [ ] Add `POST/PUT/DELETE` profile endpoints with strict validation.
- [ ] Ensure APIs return masked sensitive values only.
- [ ] Treat secret fields as replace-only on update (no plaintext readback).
- [ ] Add optional `POST /api/settings/request-profiles/test` endpoint with timeout + rate-limit + sanitized logging.

### Task 3: Runtime resolution

- [ ] Implement resolver precedence: `per-feed override > profile reference > global default > env/default`.
- [ ] Integrate resolver into shared fetch executor.
- [ ] Ensure all relevant worker/assistant/transformer fetch paths use the resolver.

### Task 4: Settings UI

- [ ] Add profile list/create/edit/delete UI.
- [ ] Add masked secret inputs and reveal/replace UX where allowed.
- [ ] Add explicit trust warning in proxy profile UX (proxy can observe traffic).
- [ ] Build reusable profile form components consumed by both Settings and Builder.
- [ ] Add per-feed selector/override controls in feed config editing surfaces.

### Task 5: Builder integration

- [ ] Add proxy profile dropdown in Builder request configuration.
- [ ] Add inline "Add profile" action that opens shared form modal/drawer.
- [ ] Auto-select newly created profile after successful save.
- [ ] Keep per-feed proxy override controls gated to schema-supported fields.

### Task 6: Tests and verification

- [ ] Unit: profile validation, masking, and precedence resolution.
- [ ] Unit: runtime application of profiles to request options.
- [ ] Unit: replace-only secret update semantics.
- [ ] Integration: representative feed fetch path resolves profile + override correctly.
- [ ] Integration: Builder inline create -> auto-select workflow.
- [ ] Run:
```bash
bun test tests/request-profiles.test.ts
```

Expected: PASS with no sensitive value leakage.
