# Source Assistant: Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Source Assistant frontend flow on Build Feed, including analyze, recommendations, apply hydration, and Web Scraping analysis handoff.

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this plan.**

**Architecture:** Build Feed page owns assistant state and orchestrates backend calls (`analyze`, `apply`, `analyze-web-page`). Recommendation rendering is componentized and reusable.

**Security decision:** Frontend must never render or persist secret request values in logs, URL params, or local storage. Backend remains the source of truth for policy decisions.

**Tech Stack:** React 18, TypeScript, react-hook-form, shadcn/ui, existing app shell/layout

**Depends on (must be implemented first):**
- Source Assistant: Backend Core
- Builder UI Redesign
- Feed Config Formalization
- Existing Feed Transformer (apply target supported)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `frontend/src/pages/BuildFeedPage.tsx` | Add assistant state, analyze/apply orchestration, builder switching |
| Create | `frontend/src/components/source-assistant/*` | Assistant panel/input/progress/recommendation components |
| Create | `frontend/src/components/recommendation/*` | Shared reasons/evidence/warnings/confidence components |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Accept applied starter state and assistant context |
| Modify | `frontend/src/components/forms/WebScrapingForm.tsx` | Add analysis banner, plan hydration, re-analyze path |
| Create | `frontend/src/lib/source-assistant-client.ts` | Typed API client helpers for analyze/apply/web-page-analysis |
| Create | `frontend/src/types/source-assistant.ts` | Frontend response/request types aligned to backend model |
| Create | `frontend/src/hooks/useSourceAssistant.ts` | Encapsulate request lifecycle and stale-state logic |
| Create | `frontend/src/components/forms/WebScrapingAnalysisBanner.tsx` | Analysis completed/re-analyze UI |
| Create | `frontend/src/components/forms/WebScrapingAnalysisPanel.tsx` | Embedded web scraping recommendation detail UI |
| Create | `frontend/src/tests/source-assistant-frontend.test.tsx` | Component/integration tests for analyze/apply flow |

---

### Task 1: Typed client + state hook

**Files:**
- Create: `frontend/src/types/source-assistant.ts`
- Create: `frontend/src/lib/source-assistant-client.ts`
- Create: `frontend/src/hooks/useSourceAssistant.ts`

- [ ] Add typed request/response models for analyze/apply/web-page-analysis.
- [ ] Implement API client helpers.
- [ ] Implement hook with status flags: `idle/analyzing/ready/error`.
- [ ] Add stale-analysis tracking triggered by key input changes.

### Task 2: Source Assistant UI components

**Files:**
- Create: `frontend/src/components/source-assistant/*`
- Create: `frontend/src/components/recommendation/*`

- [ ] Build input + advanced options controls.
- [ ] Build progress step renderer.
- [ ] Build ranked recommendation list + card details.
- [ ] Build reusable confidence/reasons/evidence/warnings components.

### Task 3: Build Feed orchestration

**Files:**
- Modify: `frontend/src/pages/BuildFeedPage.tsx`
- Modify: `frontend/src/components/forms/FeedBuilderForm.tsx`

- [ ] Add assistant state model at page level.
- [ ] Wire analyze submit -> `POST /source-assistant/analyze`.
- [ ] Wire apply action -> `POST /source-assistant/apply`.
- [ ] Switch active builder based on apply response.
- [ ] Reset/hydrate form using returned starter config.

### Task 4: Web Scraping integration

**Files:**
- Modify: `frontend/src/components/forms/WebScrapingForm.tsx`
- Create: `frontend/src/components/forms/WebScrapingAnalysisBanner.tsx`
- Create: `frontend/src/components/forms/WebScrapingAnalysisPanel.tsx`

- [ ] Show "analysis already completed" banner when assistant analysis exists.
- [ ] Pre-hydrate request and extraction setup from `webScrapingPlan`.
- [ ] Add `Re-analyze Page` path using `/utils/analyze-web-page`.
- [ ] Mark analysis stale when relevant request/extraction inputs change.

### Task 5: Fallback/manual behavior

**Files:**
- Modify relevant Build Feed and form components

- [ ] Keep manual feed-type setup available even when assistant is present.
- [ ] Handle weak/no recommendations with explicit manual fallback card.
- [ ] Ensure apply failures do not lose current form state.

### Task 6: Validation

**Files:**
- Create: `frontend/src/tests/source-assistant-frontend.test.tsx`

- [ ] Test analyze request + progress + recommendations render order.
- [ ] Test apply switches builder and hydrates form values.
- [ ] Test Web Scraping banner and re-analyze button behavior.
- [ ] Test stale-state transitions on relevant field changes.

### Task 7: Verification

- [ ] Run frontend tests:
```bash
cd frontend && bun test
```
- [ ] Run frontend type-check:
```bash
cd frontend && bun run tsc --noEmit
```
- [ ] Manual smoke:
  - analyze source
  - apply top recommendation
  - confirm builder hydration
  - re-analyze in Web Scraping path

Expected: PASS, with no regression to manual builder flows.

## Implementation Notes - 2026-05-25

- Added typed Source Assistant frontend client, response types, and lifecycle hook.
- Wired Build Feed Source Assistant recommendations through `/source-assistant/apply`, including builder switching and starter config hydration.
- Added Web Scraping analysis banner/panel and `/utils/analyze-web-page` re-analysis path for applied Source Assistant state.
- Verification: `cd frontend && bun run build` passes. The frontend package has no `test` script.
