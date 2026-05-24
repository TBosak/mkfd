# Source Assistant: Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Source Assistant backend observation, scoring, caching, and route endpoints exactly as defined by the approved backend-core design spec.

**Architecture:** Build a modular backend spine under `utilities/source-assistant/` with pure scorers/adapters, a sequential observer pipeline, and a small in-memory cache. Expose `POST /source-assistant/analyze`, `POST /source-assistant/apply`, and `POST /utils/analyze-web-page`.

**Security decision:** All Source Assistant outbound fetches must pass through the shared outbound fetch policy boundary before request and before redirect follow.
**Runtime policy decision:** JSON-LD drill-chain limit/concurrency/timeout are internal fixed bounds, not user-configurable knobs; total execution budget comes from shared `feed_run_timeout_ms`.

**Tech Stack:** Bun, TypeScript, Hono, axios, `bun:test`

**Depends on (must be implemented first):**
- Backend Route Decomposition
- Outbound Fetch Policy
- Existing selector suggestion utility rename/migration path in spec
- Feed Config Formalization (for starter config targets)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/source-assistant.model.ts` | Shared Source Assistant type system |
| Create | `utilities/source-assistant/analysis-cache.utility.ts` | TTL cache + key generation |
| Create | `utilities/source-assistant/observer.utility.ts` | 4-phase observation pipeline |
| Create | `utilities/source-assistant/recommender.utility.ts` | scorer orchestration + ranking |
| Create | `utilities/source-assistant/scorers/*.ts` | route confidence scorers |
| Create | `utilities/source-assistant/starter-configs/*.ts` | per-route apply adapters |
| Create | `utilities/feed-discovery.utility.ts` | feed discovery analyzer |
| Create | `utilities/json-ld.utility.ts` | raw JSON-LD extraction |
| Create | `utilities/json-ld-analysis.utility.ts` | JSON-LD quality/path analysis |
| Create | `utilities/json-ld-drill-chain.utility.ts` | detail-page sampling + analysis |
| Create | `utilities/form-detection.utility.ts` | detected form model extraction |
| Rename | `utilities/suggestion-engine.utility.ts` | rename to `utilities/selector-suggestion.utility.ts` and update imports |
| Create | `routes/source-assistant.ts` | analyze/apply endpoints |
| Modify | `routes/utils.ts` | add analyze-web-page endpoint |
| Modify | `index.ts` | mount source-assistant router |
| Create | `tests/source-assistant/*.test.ts` | unit/integration tests by module |

---

### Task 1: Types + cache foundation

**Files:**
- Create: `models/source-assistant.model.ts`
- Create: `utilities/source-assistant/analysis-cache.utility.ts`
- Create: `tests/source-assistant/analysis-cache.test.ts`

- [ ] Add all core model types from spec.
- [ ] Implement TTL cache (15 min), size cap (50), oldest-entry eviction.
- [ ] Add deterministic cache key helper.
- [ ] Add unit tests for expiry, eviction, and key stability.

### Task 2: Base analyzers

**Files:**
- Create: `utilities/feed-discovery.utility.ts`
- Create: `utilities/json-ld.utility.ts`
- Create: `utilities/json-ld-analysis.utility.ts`
- Create: `utilities/form-detection.utility.ts`
- Create: `tests/source-assistant/analyzers.test.ts`

- [ ] Implement feed discovery candidates.
- [ ] Implement JSON-LD extraction and quality analysis.
- [ ] Implement form detection model.
- [ ] Add tests for typical HTML samples and edge cases.

### Task 3: Drill-chain analysis

**Files:**
- Create: `utilities/json-ld-drill-chain.utility.ts`
- Create: `tests/source-assistant/drill-chain.test.ts`

- [ ] Implement sampled detail-page pipeline with fixed internal bounds (no user-configurable JSON-LD knobs).
- [ ] Apply outbound fetch policy checks for each sampled URL.
- [ ] Aggregate per-page JSON-LD coverage into drill-chain candidates.
- [ ] Add tests for candidate selection and fallback behavior.

### Task 4: Observer pipeline

**Files:**
- Create: `utilities/source-assistant/observer.utility.ts`
- Create: `tests/source-assistant/observer.test.ts`

- [ ] Implement 4-phase sequential observation pipeline.
- [ ] Ensure partial observation result on fetch failures (no hard crash path).
- [ ] Integrate analyzers + drill-chain stage under explicit conditions.
- [ ] Enforce outbound fetch policy at observer request boundaries.
- [ ] Enforce shared feed-run timeout budget across observation flow.

### Task 5: Scorers + recommender

**Files:**
- Create: `utilities/source-assistant/scorers/*.ts`
- Create: `utilities/source-assistant/recommender.utility.ts`
- Create: `tests/source-assistant/recommender.test.ts`

- [ ] Implement all route scorers from spec.
- [ ] Apply `rankScore = confidence + priorityBonus - riskPenalty`.
- [ ] Filter and band recommendations as defined by spec context.
- [ ] Add tests for ranking and threshold behaviors.

### Task 6: Starter config adapters

**Files:**
- Create: `utilities/source-assistant/starter-configs/*.ts`
- Create: `tests/source-assistant/starter-configs.test.ts`

- [ ] Implement per-route starter config adapters.
- [ ] Ensure feedId-safe and formalized-config-compatible outputs.
- [ ] Add tests ensuring expected starter payload shape per route.

### Task 7: Route integration

**Files:**
- Create: `routes/source-assistant.ts`
- Modify: `routes/utils.ts`
- Modify: `index.ts`

- [ ] Add `POST /source-assistant/analyze`.
- [ ] Add `POST /source-assistant/apply`.
- [ ] Add `POST /utils/analyze-web-page`.
- [ ] Mount router in `index.ts`.
- [ ] Ensure all endpoint fetch flows use outbound fetch policy.

### Task 8: Selector utility rename migration

**Files:**
- Rename: `utilities/suggestion-engine.utility.ts`
- Modify: imports in all dependents

- [ ] Rename utility to `selector-suggestion.utility.ts`.
- [ ] Update backend and frontend imports.
- [ ] Verify no stale path references remain.

### Task 9: Verification

- [ ] Run targeted suite:
```bash
bun test tests/source-assistant/
```
- [ ] Run affected backend tests:
```bash
bun test tests/
```
- [ ] Manual endpoint smoke checks for analyze/apply and web-page analysis.

Expected: PASS, with bounded runtime and no SSRF policy bypass.
