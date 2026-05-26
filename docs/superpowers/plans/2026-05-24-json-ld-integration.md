# JSON-LD Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement JSON-LD extraction workflows for Web Scraping using Source Assistant artifacts, with Drill Chain support and optional CSS fallback.

**Architecture:** Reuse Source Assistant JSON-LD + drill-chain analyzers for setup recommendations, then execute extraction through Web Scraping runtime with shared fetch policy and normalized item pipeline.

**Security decision:** Keep JSON-LD traversal limits/concurrency/timeouts internal-only; enforce a single configurable runtime budget via `feed_run_timeout_ms`.

**Tech Stack:** Bun, TypeScript, Hono, React 18, `bun:test`

**Depends on (must be implemented first):**
- Source Assistant: Backend Core
- Source Assistant: Frontend
- Fetch Policy / Retry / Fallback
- Outbound Fetch Policy
- Feed Config Formalization
- Normalized Feed Item Pipeline

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `models/csstarget.model.ts` (or formalized config model files) | Add/align JSON-LD extraction mode shape without user tuning knobs |
| Modify | `utilities/source-assistant/starter-configs/web-scraping.adapter.ts` | Emit JSON-LD extraction starter config |
| Create/Modify | `utilities/json-ld-extractor.utility.ts` | Convert JSON-LD analysis/mapping into normalized items |
| Modify | `utilities/data-handler.utility.ts` and related web-scraping runtime files | Execute listing/detail extraction with shared timeout budget |
| Modify | `frontend/src/pages/builder` / Web Scraping UI files | JSON-LD mode selection, mapping editor, fallback UI |
| Create | `frontend/src/components/web-scraping/JsonLd*` | Candidate picker, mapping table, path browser, raw viewer |
| Create | `tests/json-ld-integration.test.ts` | End-to-end extraction/mapping behavior coverage |

---

### Task 1: Config and model alignment

- [ ] Define JSON-LD extraction mode types in feed config model.
- [ ] Include Drill Chain traversal identity fields only (`selector`, `attribute`, `isRelative`, `baseUrl`).
- [ ] Exclude persisted user knobs for `limit`, `concurrency`, and per-stage timeout.
- [ ] Ensure config validation rejects unsupported JSON-LD tuning keys.

### Task 2: Runtime extraction pipeline

- [ ] Implement JSON-LD item extraction for page-level mode.
- [ ] Implement Drill Chain detail-page JSON-LD extraction path.
- [ ] Implement per-field CSS fallback for missing JSON-LD values.
- [ ] Route results through normalized item pipeline before feed formatting.
- [ ] Enforce shared feed-run timeout budget and outbound policy checks for listing/detail fetches.

### Task 3: Source Assistant handoff

- [ ] Map Source Assistant recommendation output to JSON-LD starter config payloads.
- [ ] Preserve Analyze-once behavior (no duplicate analysis unless trigger conditions changed).
- [ ] Include warnings/evidence in Web Scraping analysis section for user inspection.

### Task 4: Web Scraping UI

- [ ] Add JSON-LD extraction mode options and recommendation badges.
- [ ] Add JSON-LD candidate picker and field mapping editor.
- [ ] Add available-path browser and collapsed raw JSON-LD viewer.
- [ ] Add CSS fallback editor for supported fields.
- [ ] Show source attribution in preview (JSON-LD vs CSS fallback).

### Task 5: Tests and verification

- [ ] Unit: JSON-LD extraction/parsing/mapping behavior.
- [ ] Unit: fallback merge behavior and missing-field handling.
- [ ] Unit: config validation rejects JSON-LD tuning keys.
- [ ] Integration: Source Assistant apply -> Web Scraping JSON-LD prefill.
- [ ] Integration: Drill Chain JSON-LD extraction honors shared feed-run timeout budget.
- [ ] Run targeted tests:
```bash
bun test tests/json-ld-integration.test.ts
```

Expected: PASS with consistent JSON-LD extraction behavior and no user-exposed per-stage tuning knobs.

## Implementation Notes - 2026-05-25

- Added formal Web Scraping JSON-LD extraction config shape and validation that rejects persisted tuning knobs.
- Added JSON-LD item extraction into the normalized feed pipeline and wired `buildFeedObject` to execute JSON-LD modes.
- Source Assistant Web Scraping starter configs now prefill JSON-LD mode and mappings when structured item data is found.
- Web Scraping UI exposes JSON-LD mode and mapping fields in the existing extraction section.
- Verification: `bun test tests/json-ld-integration.test.ts`, `bun test tests/`, and `cd frontend && bun run build` pass.
