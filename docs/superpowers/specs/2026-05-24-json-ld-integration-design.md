# JSON-LD Integration — Design Spec

**Date:** 2026-05-24
**Tier:** R3 Transformation & Scraping Intelligence
**Status:** Approved

---

## Goal

Add JSON-LD extraction as a first-class Web Scraping extraction path, reusing Source Assistant analysis artifacts instead of duplicating analysis.

Supported user flows:

- page-level JSON-LD extraction
- Drill Chain + JSON-LD extraction from detail pages
- JSON-LD with CSS fallback

---

## Scope

### In scope

- Web Scraping extraction modes for JSON-LD workflows
- JSON-LD candidate detection and path mapping UX
- Drill Chain detail-page sampling for JSON-LD viability
- CSS fallback mapping for missing fields
- Source Assistant handoff into prefilled Web Scraping config
- Preview support with field-level source attribution

### Out of scope

- Top-level route type changes (JSON-LD remains internal to `webScraping`)
- Separate JSON-LD analysis endpoint distinct from Source Assistant
- User-configurable JSON-LD tuning knobs (`limit`, `concurrency`, per-stage timeout)

---

## Product Rules

1. Analyze once, reuse everywhere: Source Assistant remains canonical.
2. JSON-LD/Drill Chain are Web Scraping extraction strategies, not top-level feed types.
3. Existing feed recommendation still outranks scraping when valid feeds are discovered.
4. JSON-LD runtime knobs are internal implementation details; user-facing timeout control is only `feed_run_timeout_ms`.

---

## Extraction Modes

For `feedType: webScraping`, support:

- `cssSelectors`
- `jsonLdPage`
- `jsonLdDetailDrillChain`
- `jsonLdWithCssFallback`
- `jsonLdDetailDrillChainWithCssFallback`

Drill Chain config is limited to traversal identity fields (selector/attribute/relative/baseUrl). Sampling budgets and concurrency are internal bounded constants.

---

## Source Assistant Integration

- `POST /source-assistant/analyze` and `POST /utils/analyze-web-page` produce shared observation artifacts.
- Web Scraping form consumes observation output directly and avoids duplicate re-analysis.
- Re-analysis triggers only on meaningful request-source changes (URL/request mode/form values/headers/cookies/advanced mode/explicit user action/cache expiry).

---

## Data and Config Contract

- Feed config stores selected extraction mode and mappings.
- JSON-LD mappings map feed fields (`title`, `description`, `link`, `pubDate`, `author`, `enclosure`, `guid`) to JSON path expressions.
- Optional CSS fallback mappings are per-field and only applied when mapped JSON-LD field is missing/invalid.
- No persisted user fields for JSON-LD drill-chain concurrency/limit/timeout in v1.

---

## Security and Runtime Constraints

- All listing/detail fetches must pass Outbound Fetch Policy before request and redirect follow.
- Total execution budget for listing + detail sampling + extraction is bounded by shared `feed_run_timeout_ms`.
- JSON-LD parser must not fetch remote `@context` URLs.
- Sensitive request material remains masked/redacted in logs/evidence.

---

## Dependencies and Ordering

Depends on:

- Source Assistant: Backend Core
- Source Assistant: Frontend
- Fetch Policy / Retry / Fallback
- Outbound Fetch Policy
- Feed Config Formalization
- Normalized Feed Item Pipeline

Should be implemented before:

- Web Scraping Form Data full UX finalization
- New source-type rollout (Sitemap/GraphQL/etc.) that reuses JSON-LD utilities

---

## Acceptance Criteria

- Web Scraping supports JSON-LD page and Drill Chain workflows with preview/save.
- Source Assistant apply flow can prefill JSON-LD extraction and mapping state.
- Existing feed recommendation remains prioritized when available.
- JSON-LD tuning knobs are not exposed in UI/API/config.
- End-to-end run respects single configurable `feed_run_timeout_ms` budget.
