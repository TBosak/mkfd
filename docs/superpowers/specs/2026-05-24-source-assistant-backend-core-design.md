# Source Assistant: Backend Core — Design Spec

**Date:** 2026-05-24
**Tier:** Phase 3
**Status:** Approved

---

## Goal

Implement the Source Assistant observation engine, scoring model, and three backend endpoints that power feed-route recommendations. No frontend changes — this spec covers the backend only.

---

## Scope

### In scope

- `models/source-assistant.model.ts` — all shared types
- Observation engine (`observeSource`) with a 4-phase sequential pipeline
- Sub-analyzers: feed discovery, JSON-LD, drill chain, form detection, selector suggestion (migrated from existing engine)
- 9 route scorers: `existingFeed`, `sitemap`, `calendar`, `restApi`, `graphql`, `serviceConnector`, `webScraping`, `changeDetection`, `manual`
- 9 starter config adapters (one per route)
- In-memory analysis cache (TTL 15 min, max 50 entries)
- `POST /source-assistant/analyze`, `POST /source-assistant/apply`, `POST /utils/analyze-web-page`
- Rename `utilities/suggestion-engine.utility.ts` → `utilities/selector-suggestion.utility.ts`

### Out of scope

- Frontend components, panels, or form hydration (Source Assistant: Frontend spec)
- SQLite-backed cache or analysis history
- Form submission result-page sampling (later)
- FlareSolverr integration in observer (advanced fetch mode deferred to Fetch Policy spec)
- Service fingerprint database (stub scorer only)
- All Phase 4+ features

---

## Prerequisites

This spec assumes the Backend Route Decomposition plan has been executed. `routes/utils.ts` exists and this spec adds one endpoint to it.

---

## Architecture

### Observation pipeline

`observeSource(input, opts)` runs in four sequential phases and returns `SourceAssistantObservation`.

**Phase 1 — Fetch**
- Normalize input URL (reuse `normalizeUrl` from `utilities/feed-config-route-adapter.utility.ts` or the shared URL helper extracted from it)
- Fetch with axios. Capture: `status`, `contentType`, `headers`, `finalUrl`.
- On fetch failure: return partial observation with `warnings` entry — do not throw.

**Phase 2 — Content routing** (branches on content-type)
- `text/html`: run all HTML analyzers in sequence:
  1. `discoverExistingFeeds(html, finalUrl)` — link tags + common path probes
  2. `extractJsonLd(html)` → `analyzeJsonLd(nodes, finalUrl)` — page-level JSON-LD
  3. `suggestSelectors(html, finalUrl)` — reuses existing selector engine
  4. `detectForms(html, finalUrl)` — HTML form detection
  5. Sitemap probe: parse `robots.txt` for `Sitemap:` directive first; fallback HEAD probes at `{origin}/sitemap.xml` and `{origin}/sitemap_index.xml`
- `application/json`: REST API shape analysis (root array or `items`/`data`/`results` key)
- `application/xml`, `application/rss+xml`, `application/atom+xml`: attempt feed parse + sitemap check
- `text/calendar`: calendar detection
- Unknown/other: partial observation with warning

**Phase 3 — Drill chain sampling** (HTML only)
- Condition: page JSON-LD is low-value (only WebSite/Organization/BreadcrumbList/CollectionPage) AND selector candidates include repeating link patterns
- Extract up to 5 candidate detail URLs from link candidates
- Sample up to 3 pages using internal bounded concurrency; no user-configurable JSON-LD concurrency/timeout knobs
- Run `extractJsonLd` + `analyzeJsonLd` on each sampled page
- Assemble `JsonLdDrillChainCandidate[]` with per-page coverage scores

**Phase 4 — Assemble** — combine all results into `SourceAssistantObservation` and return.

### Recommendation engine

`buildRecommendations(obs, context)`:
- `context = "sourceAssistant"` → call all 9 route scorers → sort by `rankScore` → filter out confidence < 15 (except `manual`, always included)
- `context = "webScrapingPageAnalysis"` → call only `webScraping` scorer → return `WebScrapingPageAnalysisRecommendation[]`

Each scorer is a pure function:
```ts
type ScorerResult = {
  confidence: number;
  reasons: SourceAssistantReason[];
  evidence: SourceAssistantEvidence[];
  warnings: SourceAssistantWarning[];
  webScrapingPlan?: WebScrapingAnalysisPlan;   // webScraping scorer only
};
```

rankScore formula:
```
rankScore = confidence + priorityBonus - riskPenalty
```

Priority bonuses:
```ts
const sourceRoutePriorityBonus: Record<SourceAssistantRouteType, number> = {
  existingFeed: 8,
  sitemap: 6,
  calendar: 6,
  restApi: 5,
  graphql: 4,
  serviceConnector: 4,
  webScraping: 3,
  changeDetection: 1,
  manual: 0,
};
```

### Cache

Module-level `Map<string, SourceAnalysisCacheEntry>` in `analysis-cache.utility.ts`.
- Key: `sha256(normalizedInput + "|" + JSON.stringify(sortedRequestOptions))`
- TTL: 15 minutes
- Max entries: 50 (evict oldest on overflow)
- Passive eviction: entries checked on read

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/source-assistant.model.ts` | All types (see Models section) |
| Create | `utilities/feed-discovery.utility.ts` | `discoverExistingFeeds(html, pageUrl)` |
| Create | `utilities/json-ld.utility.ts` | `extractJsonLd(html): Record<string, unknown>[]` — raw `<script type="application/ld+json">` extraction; see also JSON-LD Integration spec for extended utility API |
| Create | `utilities/json-ld-analysis.utility.ts` | `analyzeJsonLd(nodes, pageUrl): JsonLdAnalysisResult` — type classification, candidate scoring, high/low-value detection |
| Create | `utilities/json-ld-drill-chain.utility.ts` | `analyzeJsonLdDrillChain(html, pageUrl, selectorResult): Promise<JsonLdDrillChainCandidate[]>` — link detection, detail page sampling |
| Create | `utilities/form-detection.utility.ts` | `detectForms(html, pageUrl): DetectedHtmlForm[]` |
| Rename | `utilities/suggestion-engine.utility.ts` → `utilities/selector-suggestion.utility.ts` | Rename only; no logic changes; update all imports |
| Create | `utilities/source-assistant/observer.utility.ts` | `observeSource(input, opts): Promise<SourceAssistantObservation>` |
| Create | `utilities/source-assistant/analysis-cache.utility.ts` | `getCachedAnalysis`, `setCachedAnalysis`, `makeCacheKey` |
| Create | `utilities/source-assistant/recommender.utility.ts` | `buildRecommendations(obs, context)` |
| Create | `utilities/source-assistant/scorers/existing-feed.scorer.ts` | `scoreExistingFeed(obs)` |
| Create | `utilities/source-assistant/scorers/web-scraping.scorer.ts` | `scoreWebScraping(obs)` — includes `WebScrapingAnalysisPlan` builder |
| Create | `utilities/source-assistant/scorers/sitemap.scorer.ts` | `scoreSitemap(obs)` |
| Create | `utilities/source-assistant/scorers/calendar.scorer.ts` | `scoreCalendar(obs)` |
| Create | `utilities/source-assistant/scorers/rest-api.scorer.ts` | `scoreRestApi(obs)` |
| Create | `utilities/source-assistant/scorers/graphql.scorer.ts` | `scoreGraphql(obs)` |
| Create | `utilities/source-assistant/scorers/service-connector.scorer.ts` | `scoreServiceConnector(obs)` (stub — no fingerprint DB yet) |
| Create | `utilities/source-assistant/scorers/change-detection.scorer.ts` | `scoreChangeDetection(obs)` |
| Create | `utilities/source-assistant/scorers/manual.scorer.ts` | `scoreManual(obs)` |
| Create | `utilities/source-assistant/starter-configs/existing-feed.adapter.ts` | `buildExistingFeedStarterConfig(rec, obs, requestOptions)` |
| Create | `utilities/source-assistant/starter-configs/web-scraping.adapter.ts` | `buildWebScrapingStarterConfig(plan, requestOptions)` |
| Create | `utilities/source-assistant/starter-configs/sitemap.adapter.ts` | `buildSitemapStarterConfig(rec, obs, requestOptions)` |
| Create | `utilities/source-assistant/starter-configs/calendar.adapter.ts` | `buildCalendarStarterConfig(rec, obs, requestOptions)` |
| Create | `utilities/source-assistant/starter-configs/rest-api.adapter.ts` | `buildRestApiStarterConfig(rec, obs, requestOptions)` |
| Create | `utilities/source-assistant/starter-configs/graphql.adapter.ts` | `buildGraphqlStarterConfig(rec, obs, requestOptions)` |
| Create | `utilities/source-assistant/starter-configs/service-connector.adapter.ts` | `buildServiceConnectorStarterConfig(rec, obs, requestOptions)` |
| Create | `utilities/source-assistant/starter-configs/change-detection.adapter.ts` | `buildChangeDetectionStarterConfig(rec, obs, requestOptions)` |
| Create | `utilities/source-assistant/starter-configs/manual.adapter.ts` | `buildManualStarterConfig(rec, obs, requestOptions)` |
| Create | `routes/source-assistant.ts` | `POST /source-assistant/analyze`, `POST /source-assistant/apply`; no injected deps |
| Modify | `routes/utils.ts` | Add `POST /utils/analyze-web-page` |
| Modify | `index.ts` | Add `app.route("/", sourceAssistantRouter())` |

---

## Models (`models/source-assistant.model.ts`)

```ts
export type SourceAssistantRouteType =
  | "existingFeed"
  | "sitemap"
  | "calendar"
  | "restApi"
  | "graphql"
  | "serviceConnector"
  | "webScraping"
  | "changeDetection"
  | "manual";

export type SourceAssistantConfidenceBand =
  | "veryLikely"
  | "goodOption"
  | "possible"
  | "fallback"
  | "notRecommended";

export type SourceAssistantReason = {
  code: string;
  message: string;
  weight: number;
};

export type SourceAssistantWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};

export type SourceAssistantEvidence = {
  id: string;
  type:
    | "url" | "contentType" | "html" | "linkTag" | "header" | "json"
    | "sitemap" | "form" | "jsonLd" | "drillChain" | "sampledDetailPage"
    | "schema" | "serviceFingerprint" | "calendar" | "selector";
  label: string;
  value: string;
};

export type ExistingFeedCandidate = {
  id: string;
  title?: string;
  url: string;
  format: "rss" | "atom" | "jsonFeed" | "unknown";
  source: "currentUrl" | "linkTag" | "commonUrl" | "manual";
  confidence: number;
  itemCount?: number;
  latestItemDate?: string;
  warnings: SourceAssistantWarning[];
};

export type SelectorCandidate = {
  selector: string;
  attribute?: string;
  confidence: number;
  exampleValues: string[];
};

export type SelectorSuggestionResult = {
  iteratorCandidates: SelectorCandidate[];
  linkCandidates: SelectorCandidate[];
  fieldCandidates: Record<string, SelectorCandidate[]>;
  recommendedArticleConfig?: WebScrapingArticleConfig;
  confidence: number;
  warnings: SourceAssistantWarning[];
};

export type DetectedHtmlForm = {
  id: string;
  action: string;
  method: "GET" | "POST";
  fields: DetectedFormField[];
  confidence: number;
  isSearchForm: boolean;
  warnings: SourceAssistantWarning[];
};

export type DetectedFormField = {
  name: string;
  type: string;
  label?: string;
  isQueryField: boolean;
};

export type JsonLdNodeSummary = {
  id: string;
  type: string[];
  label: string;
  path: string;
  fieldCount: number;
  isHighValue: boolean;
  feedFieldCoverage: JsonLdFeedFieldCoverage;
  preview: Record<string, unknown>;
  availablePaths: JsonLdAvailablePath[];
  raw?: unknown;
};

export type JsonLdAvailablePath = {
  path: string;
  exampleValue: string;
  valueType?: "string" | "number" | "boolean" | "object" | "array" | "date" | "url";
  suggestedFeedField?: string;
};

export type JsonLdFeedFieldMapping = {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  author?: string;
  enclosure?: string;
  guid?: string;
  categories?: string;
  contentEncoded?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  lat?: string;
  long?: string;
};

export type JsonLdFeedFieldCoverage = {
  title: boolean;
  description: boolean;
  link: boolean;
  pubDate: boolean;
  author: boolean;
  enclosure: boolean;
  guid: boolean;
  categories: boolean;
};

// scope "itemList" = ItemList/ListItem extraction; "auto" = let analyzer choose
export type JsonLdExtractionConfig = {
  scope: "page" | "detailPage" | "itemList" | "auto";
  candidateId?: string;
  types: string[];
  mapping: JsonLdFeedFieldMapping;
  itemPath?: string;       // for scope "itemList": path to the list array
  itemValuePath?: string;  // for scope "itemList": path within each list item
  drillChain?: DrillChainConfig;
};

// Only traversal-identity fields are persisted. limit/concurrency/timeoutMs are
// internal bounded constants and must NOT appear in saved feed YAML configs.
export type DrillChainConfig = {
  selector: string;
  attribute: string;
  isRelative: boolean;
  baseUrl: string;
};

export type JsonLdExtractionCandidate = {
  id: string;
  type: string[];
  scope: "page" | "detailPage" | "itemList" | "auto";
  confidence: number;
  label: string;
  summary: string;
  nodeIds: string[];
  config: JsonLdExtractionConfig;
  mapping: JsonLdFeedFieldMapping;
  coverage: JsonLdFeedFieldCoverage;
  missingFields: string[];
  warnings: SourceAssistantWarning[];
};

export type JsonLdSampledDetailPage = {
  url: string;
  status?: number;
  success: boolean;
  jsonLdFound: boolean;
  candidateTypes: string[];
  availablePaths: JsonLdAvailablePath[];
  mappingCoverage: JsonLdFeedFieldCoverage;
  warnings: SourceAssistantWarning[];
};

export type JsonLdDrillChainCandidate = {
  id: string;
  confidence: number;
  label: string;
  summary: string;
  linkSelector: SelectorCandidate;
  sampledPages: JsonLdSampledDetailPage[];
  mapping: JsonLdFeedFieldMapping;
  types: string[];
  missingFields: string[];
  warnings: SourceAssistantWarning[];
};

export type JsonLdAnalysisResult = {
  found: boolean;
  recommended: boolean;
  confidence: number;
  summary: string;
  nodes: JsonLdNodeSummary[];
  candidates: JsonLdExtractionCandidate[];
  drillChainCandidates?: JsonLdDrillChainCandidate[];
  warnings: SourceAssistantWarning[];
};

export type DiscoveredSitemap = {
  url: string;
  type: "sitemap" | "sitemapIndex";
  urlCount?: number;
  warnings: SourceAssistantWarning[];
};

export type DiscoveredCalendar = {
  url: string;
  confidence: number;
};

export type ServiceFingerprint = {
  service: string;
  confidence: number;
};

export type SourceAssistantHtmlObservation = {
  title?: string;
  lang?: string;
  description?: string;
  canonical?: string;
};

export type SourceAssistantJsonObservation = {
  isArray: boolean;
  itemsPath?: string;
  fieldSample: string[];
  hasDateField: boolean;
  hasTitleField: boolean;
  hasLinkField: boolean;
};

export type SourceAssistantXmlObservation = {
  rootTag: string;
  isFeed: boolean;
  format?: "rss" | "atom" | "jsonFeed";
};

export type SourceAssistantObservation = {
  input: string;
  normalizedInput: string;
  inputType: "url" | "apiEndpoint" | "serviceUrl" | "filePath" | "unknown";
  finalUrl?: string;
  status?: number;
  contentType?: string;
  headers?: Record<string, string>;
  fetchedAt: string;
  html?: SourceAssistantHtmlObservation;
  json?: SourceAssistantJsonObservation;
  xml?: SourceAssistantXmlObservation;
  discoveredFeeds?: ExistingFeedCandidate[];
  discoveredSitemaps?: DiscoveredSitemap[];
  discoveredCalendars?: DiscoveredCalendar[];
  forms?: DetectedHtmlForm[];
  jsonLd?: JsonLdAnalysisResult;
  selectorSummary?: SelectorSuggestionResult;
  serviceFingerprints?: ServiceFingerprint[];
  warnings: SourceAssistantWarning[];
};

// Web Scraping plan types

export type WebScrapingRequestPlan =
  | { mode: "simple"; url: string }
  | { mode: "form"; url: string; selectedFormId?: string; formConfig: WebScrapingFormRequestConfig };

export type WebScrapingFormRequestConfig = {
  action: string;
  method: "GET" | "POST";
  fields: Record<string, string>;
};

export type WebScrapingArticleConfig = {
  iterator?: string;
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  author?: string;
  enclosure?: string;
  guid?: string;
};

export type WebScrapingExtractionPlan =
  | { mode: "existingFeed"; feedCandidateId: string }
  | { mode: "jsonLd"; candidateId: string; config: JsonLdExtractionConfig }
  | { mode: "jsonLdWithCssFallback"; candidateId: string; config: JsonLdExtractionConfig; fallbackArticleConfig?: WebScrapingArticleConfig }
  | { mode: "cssSelectors"; articleConfig: WebScrapingArticleConfig }
  | { mode: "manualSelectors" };

export type WebScrapingPageAnalysisRoute =
  | "existingFeed"
  | "drillChainJsonLd"
  | "drillChainJsonLdWithCssFallback"
  | "pageJsonLd"
  | "itemListJsonLd"
  | "jsonLdWithCssFallback"
  | "cssSelectors"
  | "formSubmission"
  | "manualSelectors";

export type WebScrapingPageAnalysisRecommendation = {
  id: string;
  route: WebScrapingPageAnalysisRoute;
  confidence: number;
  rankScore: number;
  confidenceBand: SourceAssistantConfidenceBand;
  label: string;
  summary: string;
  reasons: SourceAssistantReason[];
  warnings: SourceAssistantWarning[];
  evidence: SourceAssistantEvidence[];
  action:
    | "useExistingFeed"
    | "useDrillChainJsonLd"
    | "useDrillChainJsonLdWithCssFallback"
    | "usePageJsonLd"
    | "useItemListJsonLd"
    | "useJsonLdWithCssFallback"
    | "useCssSelectors"
    | "configureForm"
    | "continueManual";
  starterConfig?: Partial<Record<string, unknown>>;
};

export type WebScrapingAnalysisPlan = {
  request: WebScrapingRequestPlan;
  extraction: WebScrapingExtractionPlan;
  discoveredFeeds: ExistingFeedCandidate[];
  jsonLd?: JsonLdAnalysisResult;
  selectors?: SelectorSuggestionResult;
  forms?: DetectedHtmlForm[];
  recommendations: WebScrapingPageAnalysisRecommendation[];
};

// Recommendation model

export type SourceAssistantRecommendation = {
  id: string;
  routeType: SourceAssistantRouteType;
  label: string;
  confidence: number;
  rankScore: number;
  confidenceBand: SourceAssistantConfidenceBand;
  summary: string;
  reasons: SourceAssistantReason[];
  warnings: SourceAssistantWarning[];
  evidence: SourceAssistantEvidence[];
  nextStep: "import" | "configure" | "chooseResource" | "mapFields" | "selectSelectors" | "manualSetup";
  // TODO: narrow to Partial<FeedConfig> once Feed Config Formalization model is in place
  starterConfig?: Partial<Record<string, unknown>>;
  webScrapingPlan?: WebScrapingAnalysisPlan;
};

// Cache

export type AnalysisRequestOptions = {
  headers?: Record<string, string>;
  cookies?: Array<{ name: string; value: string }>;
  userAgent?: string;
};

export type SourceAnalysisCacheEntry = {
  analysisId: string;
  createdAt: string;
  expiresAt: string;
  observation: SourceAssistantObservation;
  requestOptions: AnalysisRequestOptions;
};

// Endpoint request/response types

export type SourceAssistantAnalyzeRequest = {
  input: string;
  hints?: {
    expectedContent?: "articles" | "events" | "files" | "updates" | "messages" | "unknown";
    hasAuthentication?: boolean;
    preferredRoute?: SourceAssistantRouteType;
    advanced?: boolean;
  };
  requestOptions?: AnalysisRequestOptions;
};

export type SourceAssistantAnalyzeResponse = {
  analysisId: string;
  input: string;
  normalizedInput: string;
  analyzedAt: string;
  observation: SourceAssistantObservation;
  recommendations: SourceAssistantRecommendation[];
};

export type SourceAssistantApplyRequest = {
  analysisId: string;
  recommendationId: string;
  overrides?: Record<string, unknown>;
};

export type SourceAssistantApplyResponse = {
  routeType: SourceAssistantRouteType;
  builder:
    | "existingFeed" | "sitemap" | "calendar" | "restApi" | "graphql"
    | "serviceConnector" | "webScraping" | "changeDetection" | "manual";
  // TODO: narrow to Partial<FeedConfig> once Feed Config Formalization model is in place
  starterConfig: Partial<Record<string, unknown>>;
  formValues?: Record<string, unknown>;
  webScrapingPlan?: WebScrapingAnalysisPlan;
  warnings: SourceAssistantWarning[];
};

export type WebScrapingPageAnalysisRequest = {
  url: string;
  requestOptions?: AnalysisRequestOptions;
  advanced?: boolean;
  // form submission mode deferred to Web Scraping Form Data spec;
  // reserve requestMode here for future compatibility
  requestMode?: "simple";
};

export type WebScrapingPageAnalysisResponse = {
  url: string;
  finalUrl: string;
  requestMode: "simple" | "form";
  observation: SourceAssistantObservation;
  webScrapingPlan: WebScrapingAnalysisPlan;
  recommendations: WebScrapingPageAnalysisRecommendation[];
  warnings: SourceAssistantWarning[];
};

export type RecommendationContext = "sourceAssistant" | "webScrapingPageAnalysis";
```

---

## Sub-analyzer Contracts

### `utilities/feed-discovery.utility.ts`

```ts
export async function discoverExistingFeeds(
  html: string,
  pageUrl: string
): Promise<ExistingFeedCandidate[]>
```

Discovery sources and scoring:
- `+95` current URL is valid RSS/Atom/JSON Feed
- `+90` page declares `<link rel="alternate" type="application/rss+xml">`
- `+80` common feed path exists and parses (probe paths: `/feed`, `/rss`, `/rss.xml`, `/atom.xml`, `/feed.xml`, `/feed.atom`, `/blog/feed`, `/rss/feed.xml`, `/index.xml`)
- `+25` feed parsed successfully
- `+15` feed has multiple items
- `+10` latest item appears recent (within 90 days)
- `-20` feed has no items
- `-30` feed parse failed
- `-15` feed appears stale (latest item > 1 year old)

### `utilities/json-ld.utility.ts`

```ts
export function extractJsonLd(html: string): Record<string, unknown>[]
```

Parses all `<script type="application/ld+json">` tags. Returns raw JSON objects (including `@graph` expansion). Silently skips malformed blocks.

**Note:** The JSON-LD Integration spec extends this utility with `normalizeJsonLdBlocks`, `flattenJsonLdPaths`, `getJsonLdValue`, and helper normalizers for image/author/url. Implement the base extraction here; those extensions land in the JSON-LD Integration plan.

### `utilities/json-ld-analysis.utility.ts`

```ts
export function analyzeJsonLd(
  nodes: Record<string, unknown>[],
  pageUrl: string
): JsonLdAnalysisResult
```

High-value types: `NewsArticle`, `BlogPosting`, `Article`, `Event`, `VideoObject`, `PodcastEpisode`, `Recipe`, `Product`, `JobPosting`, `ItemList`.
Low-value types: `WebSite`, `Organization`, `BreadcrumbList`, `CollectionPage`, `SearchAction`.

Does not fetch remote `@context` URLs. Populates `JsonLdNodeSummary.id/label/path/fieldCount/feedFieldCoverage/preview` so the JSON-LD Integration UI (candidate picker, path browser) has the data it needs without re-analysis.

### `utilities/json-ld-drill-chain.utility.ts`

```ts
export async function analyzeJsonLdDrillChain(
  html: string,
  pageUrl: string,
  selectorResult: SelectorSuggestionResult
): Promise<JsonLdDrillChainCandidate[]>
```

Drill chain scoring signals:
- `+30` listing page has repeated item/card structure
- `+25` likely detail links found
- `+35` sampled detail pages contain NewsArticle/BlogPosting/Article
- `+25` sampled detail pages share consistent JSON-LD types
- `+25` sampled detail pages share title/link/date mappings
- `+15` sampled detail pages include image/enclosure
- `+10` sampled detail pages include author
- `-25` detail pages fail fetch
- `-20` detail pages have inconsistent schema
- `-20` sampled detail pages only contain low-value types
- `-15` no stable title/link/date mapping found

Defaults: `sampleDetailPages: 3`, `maxSampleDetailPages: 5`, `analysisConcurrency: 2`, `analysisTimeoutMs: 10000`.

### `utilities/form-detection.utility.ts`

```ts
export function detectForms(html: string, pageUrl: string): DetectedHtmlForm[]
```

Form scoring:
- `+75` useful search/filter form detected
- `+25` q/query/search/keyword field found
- `+20` filter selects found
- `+20` action and method are clear
- `-25` dynamic CSRF-like hidden field
- `-40` login/password form
- `-30` newsletter/email-only form

---

## Scorer Specifications

### Existing feed scorer

Confidence signals:
- `+95` current URL content-type is RSS/Atom/JSON Feed
- `+90` link tag declares feed with parsed candidates
- `+80` common path probe returns parseable feed
- Add item count / freshness bonuses from discovery result

### Sitemap scorer

Confidence signals:
- `+85` sitemap.xml parsed with article-like recent URLs
- `+70` robots.txt declares sitemap, sitemap parsed
- `+60` sitemap index found with sub-sitemaps
- `-20` sitemap exists but no URLs found

### Calendar scorer

Confidence signals:
- `+95` content-type is `text/calendar`
- `+90` URL ends in `.ics`
- `+85` response body contains `BEGIN:VCALENDAR`
- `+60` page contains link to `.ics` file

### REST API scorer

Confidence signals:
- `+80` content-type is `application/json`
- `+25` root is array or has `items`/`data`/`results` key
- `+20` objects have title/name field
- `+20` objects have link/url field
- `+15` objects have date field

### GraphQL scorer

Confidence signals:
- `+80` URL path is `/graphql`
- `+60` response body contains `"errors"` array (GraphQL error shape)
- `+50` page scripts reference a GraphQL endpoint
- `+40` introspection probe responds (if available)

### Service connector scorer

Stub implementation. Returns `confidence: 0, reasons: []`. Placeholder for fingerprint database in a future spec.

### Web scraping scorer

Runs after all HTML analyzers complete. Builds `WebScrapingAnalysisPlan` with internal recommendations ordered by priority:

1. `existingFeed` — if valid feed discovered
2. `drillChainJsonLd` — drill chain candidate confidence ≥ 85
3. `drillChainJsonLdWithCssFallback` — drill chain confidence 70–84 with selector fallback
4. `pageJsonLd` — page-level high-value JSON-LD
5. `itemListJsonLd` — ItemList JSON-LD
6. `jsonLdWithCssFallback` — JSON-LD present but incomplete; selectors available
7. `cssSelectors` — strong selector candidates, no JSON-LD
8. `formSubmission` — useful form detected, initial page has no repeated items
9. `manualSelectors` — always available as fallback

Top-level `webScraping` route confidence = confidence of the best internal recommendation.

### Change detection scorer

Confidence signals:
- `+60` page loads successfully
- `+10` page has no repeated items (nothing else to scrape)
- `+10` no strong JSON-LD route exists
- `-30` feed/API/sitemap route has confidence > 70

Change detection is recommended only as a fallback.

### Manual scorer

Always returns `confidence: 50` with a single reason: "manual setup is always available."
Strengthened to `confidence: 80` when:
- Fetch failed
- Auth required (401/403 status)
- All automated routes confidence < 35

---

## Endpoint Implementations

### `routes/source-assistant.ts`

```ts
export function sourceAssistantRouter(): Hono
```

`POST /source-assistant/analyze`:
1. Parse + validate body as `SourceAssistantAnalyzeRequest`
2. `normalizeUrl(body.input)` → compute `makeCacheKey(normalizedInput, body.requestOptions)`
3. `getCachedAnalysis(key)` → if hit, rebuild response: `buildRecommendations(entry.observation, "sourceAssistant")` → return response with cached `analysisId`
4. Cache miss → `observeSource(normalizedInput, body.requestOptions)` → observation
5. `buildRecommendations(observation, "sourceAssistant")` → recommendations
6. Generate `analysisId` (UUID), `analyzedAt` (ISO timestamp)
7. `setCachedAnalysis(key, { analysisId, observation, requestOptions: body.requestOptions ?? {} })`
8. Return `SourceAssistantAnalyzeResponse`

`POST /source-assistant/apply`:
1. Parse + validate body as `SourceAssistantApplyRequest`
2. `getByAnalysisId(body.analysisId)` → 404 if not found or expired
3. Rebuild: `buildRecommendations(entry.observation, "sourceAssistant")` → find recommendation by `body.recommendationId` → 404 if not found
4. Route to matching adapter: `buildStarterConfig(recommendation, entry.observation, entry.requestOptions, body.overrides)`
5. Adapter includes `entry.requestOptions.headers` and `entry.requestOptions.cookies` in the returned `starterConfig` where the feed type supports them
6. Return `SourceAssistantApplyResponse`

### `routes/utils.ts` addition

`POST /utils/analyze-web-page`:
1. Parse + validate body as `WebScrapingPageAnalysisRequest`
2. `normalizeUrl(body.url)` → compute cache key (same function, same cache as `/analyze`)
3. `getCachedAnalysis(key)` → if hit, use cached observation directly
4. Cache miss → `observeSource(normalizedUrl, body.requestOptions)`; generate `analysisId`; `setCachedAnalysis(key, { analysisId, observation, requestOptions: body.requestOptions ?? {} })`
5. `buildRecommendations(observation, "webScrapingPageAnalysis")` → internal recommendations
6. Build `WebScrapingAnalysisPlan` from web scraping scorer result
7. Return `WebScrapingPageAnalysisResponse`

---

## Cache Implementation

```ts
// utilities/source-assistant/analysis-cache.utility.ts

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;

const cache = new Map<string, SourceAnalysisCacheEntry>();

export function makeCacheKey(
  normalizedInput: string,
  requestOptions?: object
): string

export function getCachedAnalysis(key: string): SourceAnalysisCacheEntry | null

export function setCachedAnalysis(
  key: string,
  entry: { analysisId: string; observation: SourceAssistantObservation }
): void
```

`makeCacheKey` sorts object keys before hashing so `{ headers: {a:1,b:2} }` and `{ headers: {b:2,a:1} }` produce the same key. Uses `crypto.createHash("sha256")` from Node/Bun.

`setCachedAnalysis` evicts the oldest entry when size reaches `CACHE_MAX_ENTRIES` before inserting.

Both `/source-assistant/analyze` and `/utils/analyze-web-page` share the same cache. On a cache hit, each endpoint reconstructs its own response shape from `entry.observation` — the observation is the common artifact.

`POST /source-assistant/apply` looks up by `analysisId`, not by cache key. The cache supports `getByAnalysisId(analysisId: string): SourceAnalysisCacheEntry | null` for this purpose.

---

## Security

- Do not log request headers or cookies.
- Do not include headers or cookie values in `evidence` items — mask with `[protected]`.
- Limit response body size captured in observation to 5 MB.
- Limit redirects to 5.
- Total analysis timeout is governed by the shared feed-run timeout policy (`feed_run_timeout_ms`).
- Drill chain sampling uses fixed internal bounds (max 5 detail pages, bounded worker pool) and must remain within remaining feed-run budget.
- Do not fetch remote JSON-LD `@context` URLs.
- Do not automatically submit detected forms.
- Mask sensitive header values in `evidence` items (replace values with `[protected]`).

---

## Tests

### Unit tests

`tests/feed-discovery.test.ts`
- RSS link tag → candidate with `source: "linkTag"`, confidence ≥ 90
- Common path probe hit → candidate with `source: "commonUrl"`, confidence ≥ 80
- Stale feed (items > 1 year old) → confidence penalty applied
- No feeds found → empty array

`tests/json-ld.test.ts`
- Extracts multiple `<script type="application/ld+json">` tags
- Silently skips malformed JSON

`tests/json-ld-analysis.test.ts`
- NewsArticle on page → `recommended: true`, high confidence
- WebSite-only → `recommended: false`, low confidence
- Missing `pubDate` path → coverage flag `pubDate: false`

`tests/json-ld-drill-chain.test.ts`
- Repeated article links detected → `JsonLdDrillChainCandidate[]` populated
- Consistent NewsArticle across sampled pages → high confidence
- Inconsistent schema across pages → warning added
- Sampled pages fail fetch → `-25` penalty, warning

`tests/form-detection.test.ts`
- Search form with `q` field → `isSearchForm: true`, high confidence
- Login form (password field) → low confidence, warning

`tests/selector-suggestion.test.ts`
- Existing tests from `suggestion-engine.utility.ts` migrated and passing

### Scorer tests

`tests/source-assistant/scorers/*.test.ts` — one file per scorer. Each test verifies:
- Canonical positive observation → expected confidence band
- Canonical negative observation → `notRecommended` or low confidence
- Required reasons and evidence populated

`tests/source-assistant/scorers/existing-feed.scorer.test.ts` example:
- Observation with `discoveredFeeds: [{ confidence: 95, itemCount: 20 }]` → confidence ≥ 90, band `veryLikely`
- Observation with no discovered feeds → confidence < 35

### Observer tests

`tests/source-assistant/observer.test.ts` (mocked axios):
- HTML response with RSS link tag → `observation.discoveredFeeds` populated
- HTML with drill-chain-eligible page → `observation.jsonLd.drillChainCandidates` populated
- Fetch failure (axios throws) → observation returned with `warnings` entry, no throw
- JSON content-type response → `observation.json` populated, no HTML analyzers run

### Recommender tests

`tests/source-assistant/recommender.test.ts`:
- Valid feed in observation → `existingFeed` is first recommendation
- HTML with JSON-LD only → `webScraping` is first recommendation
- HTML with no useful signals → `manual` always present in results
- `context = "webScrapingPageAnalysis"` → only `WebScrapingPageAnalysisRecommendation[]` returned

### Route tests

`tests/source-assistant/routes.test.ts`:
- `POST /source-assistant/analyze` → returns `analysisId`, `recommendations`
- `POST /source-assistant/analyze` (cache hit) → second call returns same `analysisId`
- `POST /source-assistant/apply` with valid `analysisId` + `recommendationId` → returns `starterConfig`
- `POST /source-assistant/apply` with unknown `analysisId` → 404
- `POST /source-assistant/apply` with unknown `recommendationId` → 404
- `POST /utils/analyze-web-page` → returns `webScrapingPlan` and `recommendations`

---

## Smoke Tests (manual, after implementation)

```
[ ] bun run dev starts without errors
[ ] POST /source-assistant/analyze with a real news site URL returns recommendations
[ ] existingFeed is top recommendation when the URL has an RSS feed
[ ] webScraping recommendation includes webScrapingPlan with internal recommendations
[ ] POST /source-assistant/apply returns a starter config
[ ] POST /utils/analyze-web-page returns webScrapingPlan
[ ] Second POST /source-assistant/analyze with same URL returns cached result
[ ] POST /source-assistant/apply with expired analysisId returns 404
[ ] GET /api/health/* routes still work (no regression)
```
