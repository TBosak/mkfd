## Goal

Build Source Assistant as Mkfd’s canonical analysis and recommendation engine for feed creation.

Source Assistant should let the user enter a source once, analyze it once, and receive ranked, explainable recommendations for the best way to create a feed.

It should answer:

```text
What is the best route for turning this source into a feed?
```

It should also include enough route-specific setup detail to hydrate the selected builder without requiring the user to analyze the same source again.

The ideal flow:

```text
User enters source
  -> Mkfd analyzes once
  -> Mkfd discovers possible feed routes
  -> Mkfd recommends the best route with evidence
  -> user chooses a recommendation
  -> matching builder opens already configured
  -> user reviews, previews, and saves
```

The core rule:

```text
Analyze once, reuse everywhere.
```

---

## 1. Product role

Source Assistant is the global advisor for Mkfd.

It should not replace the manual builders. It should sit above them and help users pick the best path.

Manual setup remains available for power users.

Source Assistant should be able to recommend:

```text
Existing feed
Sitemap
Calendar
REST API
GraphQL
Service connector
Web scraping
Change detection
Manual setup
```

For Web Scraping specifically, it should also recommend the best internal setup:

```text
Simple URL + CSS selectors
Simple URL + JSON-LD
Simple URL + JSON-LD with CSS fallback
Drill Chain + JSON-LD
Drill Chain + JSON-LD with CSS fallback
Form submission + CSS selectors
Form submission + JSON-LD
Manual selectors
```

The user should not need to know these options up front. Source Assistant should discover and explain them.

---

## 2. User-facing experience

### Build Feed landing

Source Assistant should be the default entry point on the Build Feed page.

```text
Build a feed

What do you want to turn into a feed?

[ https://example.com/news                         ]

[ Analyze Source ]

Advanced options
[ ] This source needs headers or cookies
[ ] Try advanced browser rendering
[ ] I already know what type of feed this is

Or configure manually:
[ Web Scraping ] [ REST API ] [ Email ] [ Calendar ] [ Sitemap ] [ GraphQL ] ...
```

### Analysis progress

After the user clicks **Analyze Source**, show progress clearly.

```text
Analyzing source...

✓ Fetching source
✓ Checking for existing feeds
✓ Checking for sitemaps
✓ Checking for calendars
✓ Checking API/JSON shape
✓ Checking GraphQL hints
✓ Detecting forms
✓ Reading page-level JSON-LD
✓ Detecting repeated item links
✓ Sampling Drill Chain detail pages
✓ Reading detail-page JSON-LD
✓ Suggesting CSS selectors
✓ Building recommendations
```

### Recommendation results

Show ranked route cards.

```text
Recommended approaches

1. Existing feed
   96% · Very likely
   This page already publishes an RSS feed.
   [Use existing feed]

2. Web scraping
   91% · Good option
   Recommended setup: Drill Chain + JSON-LD.
   [Configure web scraping]

3. Sitemap feed
   82% · Good option
   Found a sitemap with recent article-like URLs.
   [Configure sitemap]

4. REST API
   62% · Possible
   Found JSON-like data, but item mapping needs review.
   [Map API fields]
```

The Web Scraping card should never be vague. It should expose the internal recommendation.

```text
Web scraping
91% · Good option

Recommended setup:
Drill Chain + JSON-LD

Why:
- The listing page contains repeated article links.
- The listing page JSON-LD only describes the website.
- Sampled detail pages contain NewsArticle JSON-LD.
- Detail-page JSON-LD includes title, date, author, description, image, and canonical URL.

[Configure web scraping]
```

---

## 3. Analyze once, reuse everywhere

A guided user should not have this experience:

```text
Analyze in Source Assistant
  -> choose Web Scraping
  -> analyze again inside Web Scraping
```

The correct behavior:

```text
Analyze in Source Assistant
  -> choose Web Scraping
  -> Web Scraping opens with request setup, extraction setup, Drill Chain setup, JSON-LD mappings, CSS fallbacks, and warnings already filled
```

The Web Scraping form should only re-analyze when:

```text
URL changes
request mode changes
form values change
headers or cookies change
advanced/browser mode changes
selected detected form changes
analysis expires
user explicitly clicks Re-analyze
```

When a valid analysis already exists, the Web Scraping form should show:

```text
Analysis already completed

Mkfd analyzed this source and recommended:
Drill Chain + JSON-LD.

[View analysis]
[Re-analyze Page]
```

---

## 4. Confidence and ranking model

Use both `confidence` and `rankScore`.

```text
confidence = how likely this route will work
rankScore = how strongly Mkfd recommends it compared with alternatives
```

Formula:

```text
rankScore = confidence + priorityBonus - riskPenalty
```

Confidence should be evidence-based. It should come from observable signals:

```text
existing feed parsed
sitemap parsed
calendar detected
JSON response shape
GraphQL hints
service fingerprints
forms detected
CSS selector candidates found
page-level JSON-LD found
Drill Chain links found
detail-page JSON-LD sampled
```

### Confidence bands

```text
90-100  Very likely
75-89   Good option
55-74   Possible
35-54   Fallback
0-34    Not recommended
```

### Top-level route priority

```ts
export const sourceRoutePriorityBonus: Record<SourceAssistantRouteType, number> = {
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

This lets a valid existing feed beat scraping when both are available.

---

## 5. Top-level route types

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
```

Do not make `jsonLd`, `drillChainJsonLd`, `formSubmission`, or `cssSelectors` top-level route types.

Those are internal Web Scraping plans.

```text
Top-level route:
  Web Scraping

Internal Web Scraping setup:
  Simple URL + CSS selectors
  Simple URL + JSON-LD
  Drill Chain + JSON-LD
  Drill Chain + JSON-LD with CSS fallback
  Form submission + CSS selectors
  Form submission + JSON-LD
  Manual selectors
```

This keeps the global assistant simple while still allowing Web Scraping to be very specific.

---

## 6. Shared observation model

Source Assistant should produce one reusable observation object.

```ts
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
  warnings?: SourceAssistantWarning[];
};
```

This observation powers:

```text
Source Assistant recommendations
Web Scraping form hydration
Web Scraping Analyze Page/Re-analyze Page
JSON-LD mapping editor
Drill Chain setup
Existing feed discovery
Selector suggestions
Form submission setup
Sitemap setup
REST mapping setup
GraphQL setup
```

---

## 7. Recommendation model

```ts
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
  nextStep:
    | "import"
    | "configure"
    | "chooseResource"
    | "mapFields"
    | "selectSelectors"
    | "manualSetup";
  starterConfig?: Partial<FeedConfig>;
  webScrapingPlan?: WebScrapingAnalysisPlan;
};

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
    | "url"
    | "contentType"
    | "html"
    | "linkTag"
    | "header"
    | "json"
    | "sitemap"
    | "form"
    | "jsonLd"
    | "drillChain"
    | "sampledDetailPage"
    | "schema"
    | "serviceFingerprint"
    | "calendar"
    | "selector";
  label: string;
  value: string;
};
```

---

## 8. Web Scraping plan model

A Web Scraping recommendation must include a concrete internal plan.

```ts
export type WebScrapingAnalysisPlan = {
  request: WebScrapingRequestPlan;
  extraction: WebScrapingExtractionPlan;
  discoveredFeeds: ExistingFeedCandidate[];
  jsonLd?: JsonLdAnalysisResult;
  selectors?: SelectorSuggestionResult;
  forms?: DetectedHtmlForm[];
  recommendations: WebScrapingPageAnalysisRecommendation[];
};
```

### Request plan

```ts
export type WebScrapingRequestPlan =
  | {
      mode: "simple";
      url: string;
    }
  | {
      mode: "form";
      url: string;
      selectedFormId?: string;
      formConfig: WebScrapingFormRequestConfig;
    };
```

### Extraction plan

```ts
export type WebScrapingExtractionPlan =
  | {
      mode: "existingFeed";
      feedCandidateId: string;
    }
  | {
      mode: "jsonLd";
      candidateId: string;
      config: JsonLdExtractionConfig;
    }
  | {
      mode: "jsonLdWithCssFallback";
      candidateId: string;
      config: JsonLdExtractionConfig;
      fallbackArticleConfig?: WebScrapingArticleConfig;
    }
  | {
      mode: "cssSelectors";
      articleConfig: WebScrapingArticleConfig;
    }
  | {
      mode: "manualSelectors";
    };
```

Drill Chain + JSON-LD is represented as `mode: "jsonLd"` with `scope: "detailPage"`.

```ts
{
  mode: "jsonLd",
  candidateId: "detail-page-newsarticle",
  config: {
    scope: "detailPage",
    drillChain: {
      selector: "article.card a",
      attribute: "href",
      isRelative: true,
      baseUrl: "https://example.com",
      limit: 25,
      concurrency: 3,
      timeoutMs: 15000
    },
    types: ["NewsArticle", "BlogPosting", "Article"],
    mapping: {
      title: "headline",
      description: "description",
      link: "url",
      pubDate: "datePublished",
      author: "author.name",
      enclosure: "image.url",
      guid: "@id"
    }
  }
}
```

GUI label:

```text
Drill Chain + JSON-LD
```

---

## 9. Web Scraping page-analysis recommendations

These are internal recommendations shown inside the Web Scraping form.

```ts
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
  starterConfig?: Partial<FeedConfig>;
};
```

Internal Web Scraping priority:

```text
1. Existing feed
2. Drill Chain + JSON-LD
3. Drill Chain + JSON-LD with CSS fallback
4. Page-level JSON-LD with multiple feed items
5. JSON-LD ItemList
6. JSON-LD with CSS fallback
7. CSS selectors
8. Manual selectors
```

---

## 10. Existing feed discovery

Existing feed discovery must be part of Source Assistant and Web Scraping page analysis.

Discovery sources:

```text
current URL content type
<link rel="alternate" type="application/rss+xml">
<link rel="alternate" type="application/atom+xml">
<link rel="alternate" type="application/feed+json">
common feed paths
parsed feed validity
item count
latest item date
```

Candidate model:

```ts
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
```

Scoring:

```text
+95 current URL is valid RSS/Atom/JSON Feed
+90 page declares rel=alternate RSS/Atom/JSON Feed
+80 common feed URL exists and parses
+25 feed parsed successfully
+15 feed has multiple items
+10 latest item appears recent
-20 feed has no items
-30 feed parse failed
-15 feed appears stale
```

If an existing feed is valid, it should usually be the top recommendation.

---

## 11. Page-level JSON-LD analysis

Source Assistant should parse embedded JSON-LD on the source page.

This should detect:

```text
NewsArticle
BlogPosting
Article
Event
VideoObject
PodcastEpisode
Recipe
Product
JobPosting
ItemList
WebPage
WebSite
Organization
BreadcrumbList
```

However, page-level JSON-LD on index pages is often weak. Source Assistant should not over-recommend JSON-LD when the source page only contains site-level metadata.

Low-value page-level types:

```text
WebSite
Organization
BreadcrumbList
CollectionPage
SearchAction
```

High-value item types:

```text
NewsArticle
BlogPosting
Article
Event
VideoObject
PodcastEpisode
Recipe
Product
JobPosting
```

JSON-LD analysis result:

```ts
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
```

---

## 12. Drill Chain + JSON-LD discovery

Useful JSON-LD is often found on article/detail pages, not on the index page.

Source Assistant should therefore detect and sample Drill Chain candidates.

### Drill Chain discovery pipeline

```text
1. Detect repeated listing-page item/card structures.
2. Suggest likely item/detail link selectors.
3. Extract a small number of candidate detail URLs.
4. Resolve relative URLs.
5. Fetch sampled detail pages.
6. Analyze JSON-LD on each sampled detail page.
7. Compare schema types and field mappings across samples.
8. Recommend Drill Chain + JSON-LD when detail-page structured data is consistent.
```

Recommended analysis defaults:

```text
sampleDetailPages: 3
maxSampleDetailPages: 5
analysisConcurrency: 2
analysisTimeoutMs: 10000
```

### Drill Chain candidate model

```ts
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
```

### Drill Chain + JSON-LD scoring

```text
+30 listing page has repeated item/card structure
+25 likely detail links found
+35 sampled detail pages contain NewsArticle/BlogPosting/Article
+25 sampled detail pages share consistent JSON-LD types
+25 sampled detail pages share title/link/date mappings
+15 sampled detail pages include image/enclosure
+10 sampled detail pages include author
-25 detail pages fail fetch
-20 detail pages have inconsistent schema
-20 sampled detail pages only contain WebSite/Organization/BreadcrumbList
-15 no stable title/link/date mapping found
```

Thresholds:

```text
85+ Strongly recommend Drill Chain + JSON-LD
70-84 Recommend Drill Chain + JSON-LD with CSS fallback
50-69 Show as possible
<50 Do not recommend automatically
```

### Recommendation example

```text
Web Scraping
91% · Good option

Recommended setup:
Drill Chain + JSON-LD

Why:
- The listing page contains repeated article cards.
- The listing page JSON-LD only describes the website.
- Sampled detail pages contain NewsArticle JSON-LD.
- Detail-page JSON-LD includes title, date, author, description, image, and canonical URL.
```

### Fallback example

```text
Web Scraping
78% · Good option

Recommended setup:
Drill Chain + JSON-LD with CSS fallback

Why:
- Sampled detail pages contain NewsArticle JSON-LD.
- Some detail pages are missing descriptions.
- Listing-page selectors can fill missing summary fields.
```

---

## 13. Form detection inside Source Assistant

Form detection should be part of the shared observation.

Source Assistant should detect when a web scraping route likely requires form submission first.

Examples:

```text
Search page with query form
Filter page with category fields
Result page only appears after form submission
Initial page has no repeated content but has a useful search/filter form
```

Form scoring signals:

```text
+75 useful search/filter form detected
+25 q/query/search/keyword field found
+20 filter selects found
+20 action and method are clear
-25 dynamic CSRF-like hidden field
-40 login/password form
-30 newsletter/email-only form
```

If form submission is necessary, Source Assistant should be able to recommend:

```text
Form submission + CSS selectors
Form submission + JSON-LD
Form submission + Drill Chain + JSON-LD
```

For the first implementation, prioritize:

```text
Form submission + CSS selectors
Form submission + page-level JSON-LD from result page
```

Then add Drill Chain sampling from submitted result pages later.

---

## 14. CSS selector suggestion inside Source Assistant

Selector suggestion should be part of the observation because it supports several routes.

```ts
export type SelectorSuggestionResult = {
  iteratorCandidates: SelectorCandidate[];
  linkCandidates: SelectorCandidate[];
  fieldCandidates: Record<string, SelectorCandidate[]>;
  recommendedArticleConfig?: WebScrapingArticleConfig;
  confidence: number;
  warnings: SourceAssistantWarning[];
};
```

Selector suggestions support:

```text
plain CSS selector scraping
JSON-LD with CSS fallback
Drill Chain link discovery
Drill Chain + JSON-LD
form result-page extraction
manual setup hints
```

---

## 15. Source Assistant route recommendations

### Existing feed route

Recommend when:

```text
Valid RSS, Atom, or JSON Feed is found.
```

Action:

```text
Use existing feed
```

Starter config:

```text
Existing Feed Transformer config, if implemented.
Otherwise discovered feed URL for copy/import.
```

### Sitemap route

Recommend when:

```text
sitemap.xml parses
robots.txt declares sitemap
sitemap index found
URLs are recent or article-like
```

Action:

```text
Configure sitemap
```

Starter config:

```text
Sitemap URL
include/exclude pattern suggestions
limit
optional detail extraction plan later
```

### Calendar route

Recommend when:

```text
content type is text/calendar
URL ends in .ics
response contains BEGIN:VCALENDAR
page links to .ics
```

Action:

```text
Configure calendar
```

Starter config:

```text
Calendar URL
event window
event mapping defaults
```

### REST API route

Recommend when:

```text
content type is JSON
root array or repeated items/data/results array
objects have title/name, link/url, date fields
```

Action:

```text
Map API fields
```

Starter config:

```text
baseUrl
route
method
items path
field mapping suggestions
```

### GraphQL route

Recommend when:

```text
URL looks like /graphql
GraphQL error shape found
page scripts reference GraphQL endpoint
introspection succeeds if available
```

Action:

```text
Configure GraphQL
```

Starter config:

```text
endpoint
headers if supplied
operation name if detected
```

### Service connector route

Recommend when:

```text
known service fingerprint endpoint succeeds
known title/header/path detected
known service API responds
```

Action:

```text
Configure connector
```

Starter config:

```text
service preselected
base URL
auth mode prompt
resource discovery next step
```

### Web scraping route

Recommend when:

```text
HTML page loads
no better feed/sitemap/API route dominates
page-level JSON-LD is useful
Drill Chain + detail-page JSON-LD is useful
CSS selectors are useful
form submission is useful
```

Action:

```text
Configure web scraping
```

Starter config must include:

```text
config.baseUrl
request setup
extraction mode
Drill Chain config when relevant
jsonLd config when relevant
article selectors when relevant
form submission config when relevant
analysis data for UI
```

### Change detection route

Recommend when:

```text
page loads
no repeated items are found
no strong JSON-LD route exists
no feed/API/sitemap route exists
content appears update-worthy
```

Action:

```text
Configure change detection
```

### Manual route

Always available.

Recommend more strongly when:

```text
fetch failed
auth required
all automated routes are weak
source is ambiguous
```

---

## 16. Shared utilities

Add or formalize:

```text
utilities/source-assistant/source-observer.utility.ts
utilities/source-assistant/source-assistant.utility.ts
utilities/source-assistant/recommendation-scoring.utility.ts
utilities/source-assistant/route-scorers/
utilities/source-assistant/starter-config-adapters/
utilities/feed-discovery.utility.ts
utilities/json-ld.utility.ts
utilities/json-ld-analysis.utility.ts
utilities/json-ld-drill-chain-analysis.utility.ts
utilities/form-detection.utility.ts
utilities/web-scraping-page-analysis.utility.ts
```

The key rule:

```text
Web Scraping page analysis must not duplicate Source Assistant logic.
```

It should call the same observer and recommendation builder with a narrower context.

---

## 17. Recommendation contexts

Use a context parameter.

```ts
export type RecommendationContext =
  | "sourceAssistant"
  | "webScrapingPageAnalysis";
```

```ts
export function buildRecommendations(
  observation: SourceAssistantObservation,
  context: RecommendationContext,
) {
  if (context === "sourceAssistant") {
    return buildSourceRouteRecommendations(observation);
  }

  return buildWebScrapingPageRecommendations(observation);
}
```

This gives Mkfd:

```text
one observation engine
one evidence model
one warning model
one confidence model
multiple recommendation surfaces
```

---

## 18. Backend endpoints

Use two public analysis endpoints, but shared internals.

```text
POST /source-assistant/analyze
POST /source-assistant/apply
POST /utils/analyze-web-page
```

### `/source-assistant/analyze`

Used by the Build Feed front door.

```ts
export type SourceAssistantAnalyzeRequest = {
  input: string;
  hints?: {
    expectedContent?: "articles" | "events" | "files" | "updates" | "messages" | "unknown";
    hasAuthentication?: boolean;
    preferredRoute?: SourceAssistantRouteType;
    advanced?: boolean;
  };
  requestOptions?: {
    headers?: ProtectedRecord;
    cookies?: FeedCookie[];
    userAgent?: string;
    timeoutMs?: number;
  };
};
```

Response:

```ts
export type SourceAssistantAnalyzeResponse = {
  analysisId: string;
  input: string;
  normalizedInput: string;
  analyzedAt: string;
  observation: SourceAssistantObservation;
  recommendations: SourceAssistantRecommendation[];
};
```

### `/source-assistant/apply`

Used when the user chooses a recommendation.

```ts
export type SourceAssistantApplyRequest = {
  analysisId: string;
  recommendationId: string;
  overrides?: Record<string, unknown>;
};
```

Response:

```ts
export type SourceAssistantApplyResponse = {
  routeType: SourceAssistantRouteType;
  builder:
    | "existingFeed"
    | "sitemap"
    | "calendar"
    | "restApi"
    | "graphql"
    | "serviceConnector"
    | "webScraping"
    | "changeDetection"
    | "manual";
  starterConfig: Partial<FeedConfig>;
  formValues?: Record<string, unknown>;
  webScrapingPlan?: WebScrapingAnalysisPlan;
  warnings: SourceAssistantWarning[];
};
```

### `/utils/analyze-web-page`

Used only when the user starts directly from the Web Scraping form or clicks Re-analyze.

```ts
export type WebScrapingPageAnalysisRequest = {
  url: string;
  request?: WebScrapingRequestConfig;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  advanced?: boolean;
  userAgent?: string;
  timeoutMs?: number;
};
```

Response:

```ts
export type WebScrapingPageAnalysisResponse = {
  url: string;
  finalUrl: string;
  requestMode: "simple" | "form";
  observation: SourceAssistantObservation;
  webScrapingPlan: WebScrapingAnalysisPlan;
  recommendations: WebScrapingPageAnalysisRecommendation[];
  warnings: SourceAssistantWarning[];
};
```

---

## 19. Analysis cache

Add short-lived analysis caching.

```ts
export type SourceAnalysisCacheEntry = {
  analysisId: string;
  createdAt: string;
  expiresAt: string;
  response: SourceAssistantAnalyzeResponse;
};
```

MVP:

```text
in-memory cache
TTL: 15 minutes
```

Later:

```text
SQLite runtime state
analysis history
debug snapshots
health correlation
```

Cache invalidation:

```text
URL changes
headers/cookies change
advanced mode changes
request setup changes
form values change
manual re-analysis
TTL expires
```

---

## 20. Frontend architecture

The Build Feed page should own assistant state and pass it down to builders.

```ts
export type FeedBuilderAssistantState = {
  analysis?: SourceAssistantAnalyzeResponse;
  selectedRecommendation?: SourceAssistantRecommendation;
  appliedStarterConfig?: Partial<FeedConfig>;
  webScrapingPlan?: WebScrapingAnalysisPlan;
};
```

Apply flow:

```ts
function applySourceAssistantResult(result: SourceAssistantApplyResponse) {
  setActiveBuilder(result.builder);
  reset(castStarterConfigToFormValues(result.starterConfig));

  if (result.builder === "webScraping") {
    setWebScrapingAnalysis(result.webScrapingPlan);
  }
}
```

`WebScrapingForm` props:

```ts
export type WebScrapingFormProps = {
  initialAnalysis?: WebScrapingAnalysisPlan;
  sourceAssistantAnalysis?: SourceAssistantAnalyzeResponse;
  onReanalyze?: () => Promise<WebScrapingAnalysisPlan>;
};
```

---

## 21. Frontend components

### Source Assistant components

```text
SourceAssistantPanel.tsx
SourceAssistantInput.tsx
SourceAssistantAdvancedOptions.tsx
SourceAssistantProgress.tsx
SourceRecommendationList.tsx
SourceRecommendationCard.tsx
SourceRecommendationDetails.tsx
SourceEvidenceList.tsx
SourceWarningList.tsx
SourceConfidenceBadge.tsx
```

### Shared recommendation components

These should be usable by both Source Assistant and Web Scraping Page Analysis.

```text
RecommendationCard.tsx
ConfidenceBadge.tsx
RecommendationReasons.tsx
EvidenceList.tsx
WarningList.tsx
```

### Web Scraping embedded analysis components

```text
WebScrapingAnalysisBanner.tsx
WebScrapingPageAnalysisPanel.tsx
WebScrapingAnalysisRecommendationCard.tsx
ExistingFeedCandidates.tsx
JsonLdAnalysisPanel.tsx
JsonLdCandidatePicker.tsx
JsonLdMappingEditor.tsx
JsonLdPathBrowser.tsx
JsonLdRawViewer.tsx
JsonLdFallbackSelectorEditor.tsx
JsonLdDrillChainPanel.tsx
JsonLdSampledDetailPages.tsx
ExtractionMethodSelector.tsx
```

---

## 22. Web Scraping form behavior after Source Assistant

When Web Scraping is opened from Source Assistant, show:

```text
Analysis already completed

Mkfd analyzed this source and recommended:
Drill Chain + JSON-LD.

[View analysis]
[Re-analyze Page]
```

Then preselect:

```text
Request setup:
Simple URL or detected form submission

Extraction setup:
Drill Chain + JSON-LD, JSON-LD, JSON-LD with CSS fallback, or CSS selectors

Drill Chain setup:
pre-filled link selector, attribute, base URL, limit, concurrency, timeout

JSON-LD mapping:
pre-filled paths from sampled detail pages or page-level candidates

CSS selectors:
pre-filled fallback selectors where useful

Existing feed:
shown as better-source warning if found
```

The local button should read:

```text
Re-analyze Page
```

not:

```text
Analyze Page
```

when an analysis already exists.

---

## 23. Web Scraping form behavior without Source Assistant

When the user skips Source Assistant and starts manually:

```text
Manual Setup
  -> Web Scraping
  -> enter URL
  -> Analyze Page
```

The Web Scraping form calls:

```text
POST /utils/analyze-web-page
```

This returns the same shared analysis shape, but scoped to Web Scraping.

---

## 24. Starter config adapters

Each top-level route needs an adapter.

```text
existing-feed.adapter.ts
sitemap.adapter.ts
calendar.adapter.ts
rest-api.adapter.ts
graphql.adapter.ts
service-connector.adapter.ts
web-scraping.adapter.ts
change-detection.adapter.ts
manual.adapter.ts
```

Adapter type:

```ts
export type SourceAssistantStarterConfigAdapter = {
  routeType: SourceAssistantRouteType;
  buildStarterConfig: (
    recommendation: SourceAssistantRecommendation,
    observation: SourceAssistantObservation,
    overrides?: Record<string, unknown>,
  ) => Partial<FeedConfig>;
};
```

The Web Scraping adapter must consume `webScrapingPlan`.

```ts
export function buildWebScrapingStarterConfig(
  plan: WebScrapingAnalysisPlan,
): Partial<WebScrapingFeedConfig> {
  if (plan.extraction.mode === "jsonLd") {
    return {
      feedType: "webScraping",
      config: {
        baseUrl: plan.request.url,
      },
      extraction: {
        mode: "jsonLd",
        jsonLd: plan.extraction.config,
      },
    };
  }

  if (plan.extraction.mode === "jsonLdWithCssFallback") {
    return {
      feedType: "webScraping",
      config: {
        baseUrl: plan.request.url,
      },
      extraction: {
        mode: "jsonLdWithCssFallback",
        jsonLd: plan.extraction.config,
      },
      article: plan.extraction.fallbackArticleConfig,
    };
  }

  if (plan.extraction.mode === "cssSelectors") {
    return {
      feedType: "webScraping",
      config: {
        baseUrl: plan.request.url,
      },
      extraction: {
        mode: "cssSelectors",
      },
      article: plan.extraction.articleConfig,
    };
  }

  return {
    feedType: "webScraping",
    config: {
      baseUrl: plan.request.url,
    },
    extraction: {
      mode: "cssSelectors",
    },
  };
}
```

---

## 25. Ranking examples

### Existing feed dominates

```text
Existing Feed
96% · Very likely
This page already publishes an RSS feed.

Other options:
Web Scraping with Drill Chain + JSON-LD: 91%
Web Scraping with CSS selectors: 61%
```

### Drill Chain + JSON-LD is best

```text
Web Scraping
91% · Good option

Recommended setup:
Drill Chain + JSON-LD

Reasons:
- Listing page contains repeated article links.
- Listing page JSON-LD is site-level only.
- Sampled detail pages contain NewsArticle JSON-LD.
- Detail-page JSON-LD has title, link, date, author, image, and description.
```

### Drill Chain + JSON-LD needs fallback

```text
Web Scraping
78% · Good option

Recommended setup:
Drill Chain + JSON-LD with CSS fallback

Reasons:
- Sampled detail pages contain NewsArticle JSON-LD.
- Some detail pages are missing descriptions.
- Listing-page selectors can fill missing summaries.
```

### Form submission needed

```text
Web Scraping
82% · Good option

Recommended setup:
Submit search form, then scrape result page with CSS selectors.

Reasons:
- Initial page has no repeated items.
- Search form detected.
- Submitted result page has repeated article cards.
```

---

## 26. Error and empty states

### Fetch failed

```text
Mkfd could not fetch this source.

You can:
- try advanced browser rendering
- add headers or cookies
- configure manually
```

### Authentication likely required

```text
This source appears to require authentication.

Add headers or cookies, then analyze again.
```

### No strong recommendation

```text
Mkfd did not find a strong automatic route.

Manual setup is still available, and these fallback options may work:
- Web scraping with manual selectors
- Change detection
```

### Analysis stale

```text
This analysis was created before the current source settings changed.

[Re-analyze]
```

### Detail-page sampling failed

```text
Mkfd found likely Drill Chain links, but sampled detail pages could not be fetched.

You can:
- lower concurrency
- try advanced browser rendering
- add headers or cookies
- continue with CSS selectors
```

---

## 27. Security and privacy

Rules:

```text
Do not log protected headers.
Do not log cookies.
Do not log protected form values.
Do not expose decrypted values in analysis details.
Mask protected values in evidence.
Limit response body sample size.
Limit redirects.
Limit analysis timeout.
Limit Drill Chain sample size.
Limit detail-page sampling concurrency.
Do not automatically submit detected forms without user action or explicit selected form config.
Do not fetch remote JSON-LD contexts.
Do not include secrets in starter configs returned to the browser.
```

For catalog analysis:

```text
Reject private network URLs unless explicitly local-only.
Reject protected values.
Reject cookies and auth headers.
Reject localhost/private-IP source configs for public catalog submission.
```

---

## 28. Tests

### Source Assistant tests

```text
Analyzes source and returns analysisId.
Returns sorted recommendations.
Existing feed ranks first when valid feed exists.
Sitemap ranks highly when sitemap exists.
REST API ranks highly for JSON item arrays.
Calendar ranks highly for ICS.
Web scraping ranks highly for HTML with JSON-LD or selectors.
Manual fallback appears when automated routes are weak.
Recommendations include reasons, warnings, and evidence.
Web scraping recommendation includes webScrapingPlan.
```

### Drill Chain + JSON-LD tests

```text
Detects repeated listing-page item links.
Suggests likely Drill Chain link selector.
Samples detail pages.
Analyzes JSON-LD on sampled detail pages.
Scores consistent NewsArticle detail pages highly.
Scores site-level-only detail JSON-LD low.
Warns when detail pages have inconsistent schemas.
Warns when detail-page fetches fail.
Builds Drill Chain + JSON-LD extraction plan.
Builds Drill Chain + JSON-LD with CSS fallback plan.
```

### Web Scraping plan tests

```text
High-quality page-level JSON-LD produces jsonLd extraction plan.
High-quality detail-page JSON-LD produces Drill Chain + JSON-LD plan.
Incomplete detail-page JSON-LD plus selectors produces Drill Chain + JSON-LD with fallback plan.
No JSON-LD but strong selectors produces cssSelectors plan.
Search form plus result analysis produces form request plan.
Existing feed appears as better-source internal recommendation.
```

### Apply endpoint tests

```text
Apply existingFeed returns existingFeed builder.
Apply sitemap returns sitemap builder.
Apply restApi returns REST builder and mapping form values.
Apply webScraping JSON-LD returns Web Scraping builder and extraction config.
Apply webScraping Drill Chain + JSON-LD returns Web Scraping builder, Drill Chain config, and JSON-LD mapping.
Apply webScraping CSS selectors returns Web Scraping builder and article selectors.
Apply webScraping form route returns Web Scraping builder with request.mode=form.
Apply does not re-fetch when analysis cache is valid.
```

### GUI tests

```text
Source Assistant renders above manual tabs.
Analyze Source shows progress.
Recommendations render in rank order.
Web Scraping card shows recommended internal setup.
Clicking Web Scraping opens Web Scraping form.
Web Scraping form shows analysis already completed banner.
Web Scraping form preselects request setup and extraction mode.
Drill Chain + JSON-LD opens with Drill Chain section populated.
Sampled detail pages are visible in the Web Scraping form.
JSON-LD mapping editor is prefilled from sampled detail pages.
CSS fallback selectors are prefilled when available.
Re-analyze button appears when analysis exists.
Changing URL marks analysis stale.
Manual setup remains accessible.
```

---

## 29. Implementation phases

### Phase 1: Shared models

```text
Add source-assistant.model.ts.
Add web-scraping-page-analysis.model.ts.
Add web-scraping-extraction.model.ts.
Add shared recommendation/reason/warning/evidence types.
Add WebScrapingAnalysisPlan types.
Add JsonLdDrillChainCandidate types.
```

### Phase 2: Observation engine

```text
Add source-observer.utility.ts.
Fetch source.
Collect final URL, status, content type, headers.
Parse HTML metadata.
Detect existing feeds.
Detect forms.
Analyze page-level JSON-LD.
Suggest CSS selectors.
Detect repeated listing-page item links.
Sample Drill Chain detail pages.
Analyze JSON-LD on sampled detail pages.
Analyze JSON/API shape.
Discover sitemap/calendar hints.
```

### Phase 3: Recommendation engine

```text
Add recommendation-scoring.utility.ts.
Add confidence band helper.
Add source route scorers.
Add web scraping internal scorers.
Add Drill Chain + JSON-LD scorer.
Add Drill Chain + JSON-LD with CSS fallback scorer.
Add buildRecommendations(observation, context).
```

### Phase 4: Analysis endpoints

```text
Add POST /source-assistant/analyze.
Add short-lived analysis cache.
Add POST /source-assistant/apply.
Add POST /utils/analyze-web-page.
Ensure /utils/analyze-web-page uses same observer and webScrapingPageAnalysis context.
```

### Phase 5: Starter config adapters

```text
Add route starter config adapters.
Implement Web Scraping adapter using WebScrapingAnalysisPlan.
Map Drill Chain + JSON-LD plans into extraction config.
Map starter configs to form values.
Preserve compatibility with existing CSS selector configs.
```

### Phase 6: Source Assistant GUI

```text
Add SourceAssistantPanel.
Add recommendation cards.
Add confidence badges.
Add reasons/evidence/warnings details.
Add apply behavior.
Keep manual setup available.
```

### Phase 7: Web Scraping integration

```text
Pass assistant analysis into WebScrapingForm.
Show analysis already completed banner.
Hydrate request setup.
Hydrate extraction setup.
Hydrate Drill Chain setup.
Hydrate JSON-LD mappings.
Hydrate CSS selectors.
Show Re-analyze only when needed.
```

### Phase 8: Embedded Web Scraping analysis

```text
Add Analyze Page/Re-analyze Page support.
Call /utils/analyze-web-page only when entering Web Scraping manually or when settings change.
Reuse shared recommendation components.
```

### Phase 9: Hardening

```text
Add protected value masking.
Add timeout/body/redirect limits.
Add Drill Chain sampling limits.
Add stale analysis detection.
Add tests.
Add diagnostics.
```

---

## 30. README to-do item

```md
- [ ] Source Assistant
  - Add Source Assistant as the default guided entry point on the Build Feed page.
  - Analyze a source once and produce ranked, explainable feed-building recommendations.
  - Score routes such as existing feed, sitemap, calendar, REST API, GraphQL, service connector, web scraping, change detection, and manual setup.
  - Include reasons, warnings, evidence, confidence scores, and confidence labels for each recommendation.
  - Include route-specific starter plans so selected builders can be hydrated without requiring a second analysis.
  - For Web Scraping recommendations, include request setup and extraction setup such as form submission, CSS selectors, JSON-LD, Drill Chain + JSON-LD, Drill Chain + JSON-LD with CSS fallback, or manual selectors.
  - Detect likely Drill Chain links on listing/index pages and sample detail pages for JSON-LD.
  - Prefer Drill Chain + JSON-LD when sampled detail pages contain consistent feed-relevant schema.org data.
  - Reuse the same observation and scoring engine for the Web Scraping form’s Analyze Page/Re-analyze Page workflow.
  - Keep manual source configuration available for power users.
```

---

## 31. Acceptance criteria

This feature is complete when:

```text
Build Feed shows Source Assistant as the default guided entry point.
User can enter a source and analyze it once.
Source Assistant returns ranked route recommendations.
Recommendations show confidence, confidence band, summary, reasons, warnings, and evidence.
Existing feeds are discovered and ranked before scraping when valid.
Web Scraping recommendations include a specific internal setup plan.
Source Assistant detects likely Drill Chain links on listing pages.
Source Assistant samples detail pages when appropriate.
Source Assistant analyzes JSON-LD on sampled detail pages.
Source Assistant can recommend Drill Chain + JSON-LD.
Source Assistant can recommend Drill Chain + JSON-LD with CSS fallback.
Choosing Web Scraping from Source Assistant opens the Web Scraping form without requiring a second analysis.
Web Scraping form shows the existing analysis and selected route.
Web Scraping form preselects simple URL or form submission request setup.
Web Scraping form preselects Drill Chain + JSON-LD, JSON-LD, JSON-LD with CSS fallback, CSS selectors, or manual selectors.
Drill Chain setup is populated when recommended.
Sampled detail-page JSON-LD analysis is available in the Web Scraping form.
JSON-LD mappings and CSS selectors are prefilled when available.
Manual Web Scraping users can still click Analyze Page.
Analyze Page uses the same shared observer and scoring engine as Source Assistant.
Changing relevant source settings marks the analysis stale.
Apply endpoint hydrates the correct builder and starter config.
Manual setup remains available at all times.
```

---

## Recommended first cut

Build this first:

```text
1. Source Assistant shell on Build Feed page
2. Shared observation model
3. Existing feed discovery
4. CSS selector suggestion integration
5. Page-level JSON-LD analysis
6. Drill Chain link detection
7. Detail-page JSON-LD sampling
8. Web Scraping recommendation with internal plan
9. Apply Web Scraping recommendation into WebScrapingForm without re-analysis
10. Manual Web Scraping Analyze Page as a reuse of the same analysis engine
```

Then add:

```text
Sitemap route
Calendar route
REST API mapping route
Form submission result-page analysis
GraphQL route
Service connector route
Change detection route
Analysis cache in SQLite
Advanced diagnostics
```

The central design decision is:

```text
Source Assistant is the canonical analysis engine.
Web Scraping Analyze Page is an embedded view of the same engine.
A guided user should analyze once, choose once, then configure and save.
```

The most important Web Scraping-specific insight is:

```text
Index pages are often best for discovering links.
Detail pages are often best for extracting JSON-LD.
```

So Source Assistant should be able to recommend:

```text
CSS selectors for discovery
Drill Chain for traversal
JSON-LD for extraction
CSS selectors for fallback
```