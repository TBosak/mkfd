# Source Assistant: Frontend — Design Spec

**Date:** 2026-05-24
**Tier:** R3 Transformation & Scraping Intelligence
**Status:** Approved

---

## Goal

Implement the Source Assistant frontend experience as the default entry point on Build Feed, including analyze progress, ranked recommendation cards, and apply-to-builder hydration without redundant re-analysis.

---

## Scope

### In scope

- Source Assistant panel on Build Feed landing
- Analyze flow using `POST /source-assistant/analyze`
- Recommendation list/cards with confidence, reasons, warnings, and evidence
- Apply flow using `POST /source-assistant/apply`
- Builder hydration state in Build Feed page
- Web Scraping integration banner ("analysis already completed")
- Re-analyze controls when analysis becomes stale
- Shared recommendation components reusable by Source Assistant and Web Scraping page analysis

### Out of scope

- Backend observation/scoring logic (owned by backend-core spec)
- New route scorers or recommendation algorithms
- Deep Web Scraping extraction engine changes
- Multi-user permissions model

---

## UX Requirements

### Build Feed landing

- Source Assistant appears above manual feed-type entry options.
- Input supports URL/source value + advanced options from backend request model.
- Analyze action shows phase-based progress states.

### Recommendation rendering

- Show ranked recommendation cards with:
  - route title
  - confidence percent + confidence band
  - primary rationale
  - expandable reasons/evidence/warnings
- Web Scraping cards must display explicit internal setup recommendation (for example, Drill Chain + JSON-LD).

### Apply behavior

- Selecting a recommendation calls `POST /source-assistant/apply`.
- Response determines target builder and starter config.
- Build Feed switches to target builder and hydrates form values immediately.
- "Analyze once, reuse everywhere" is preserved.

### Web Scraping integration

- If opening Web Scraping via Source Assistant apply:
  - show "analysis already completed" banner
  - show recommended extraction/request plan
  - show "Re-analyze Page" (not "Analyze Page")
- Re-analysis is triggered only when inputs affecting analysis validity change.

---

## Frontend State Model

Add page-level assistant state in Build Feed:

```ts
type FeedBuilderAssistantState = {
  analysis?: SourceAssistantAnalyzeResponse;
  selectedRecommendation?: SourceAssistantRecommendation;
  appliedStarterConfig?: Partial<FeedConfig>;
  webScrapingPlan?: WebScrapingAnalysisPlan;
  analysisStatus?: "idle" | "analyzing" | "ready" | "error";
  analysisStale?: boolean;
};
```

The Build Feed page owns this state and passes it to form components, primarily `WebScrapingForm`.

---

## Component Model

Source Assistant components:

- `SourceAssistantPanel`
- `SourceAssistantInput`
- `SourceAssistantAdvancedOptions`
- `SourceAssistantProgress`
- `SourceRecommendationList`
- `SourceRecommendationCard`
- `SourceRecommendationDetails`
- `SourceEvidenceList`
- `SourceWarningList`
- `SourceConfidenceBadge`

Shared recommendation components:

- `RecommendationCard`
- `ConfidenceBadge`
- `RecommendationReasons`
- `EvidenceList`
- `WarningList`

Web Scraping embedded analysis components:

- `WebScrapingAnalysisBanner`
- `WebScrapingPageAnalysisPanel`
- `WebScrapingAnalysisRecommendationCard`
- `ExistingFeedCandidates`
- `JsonLdAnalysisPanel`
- `JsonLdDrillChainPanel`

---

## Data Contracts

Consumes backend endpoints:

- `POST /source-assistant/analyze`
- `POST /source-assistant/apply`
- `POST /utils/analyze-web-page` (manual Web Scraping or explicit re-analysis)

No frontend-only scoring. UI must render backend recommendations as-is.

---

## Dependencies and Ordering

Depends on:

- Source Assistant: Backend Core
- Existing Feed Transformer (for apply target compatibility)
- Builder UI Redesign
- Feed Config Formalization

Should be completed before:

- JSON-LD integration frontend refinements
- advanced scraping intelligence UX features that assume assistant state model

---

## Acceptance Criteria

- Source Assistant is visible as the default Build Feed entry flow.
- Analyze action shows progress and returns ranked recommendations.
- Apply action switches builder and hydrates starter config without a second analysis call.
- Web Scraping opens with existing analysis context when applicable.
- Manual setup remains available at all times.
