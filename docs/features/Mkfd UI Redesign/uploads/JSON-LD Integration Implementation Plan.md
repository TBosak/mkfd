## Goal

Add JSON-LD structured data extraction as a first-class capability inside Mkfd’s **Web Scraping** feed type.

JSON-LD should support three major workflows:

```text
1. Page-level JSON-LD extraction
2. Drill Chain + JSON-LD extraction from detail pages
3. JSON-LD with CSS selector fallback
```

This implementation must reuse **Source Assistant** as the canonical analysis engine.

The user should be able to:

```text
Analyze a source once
  -> receive a Web Scraping recommendation
  -> open the Web Scraping form already configured
  -> inspect JSON-LD candidates and mappings
  -> adjust Drill Chain settings if needed
  -> preview
  -> save
```

The core product decision:

```text
CSS selectors are not always the extraction answer.
For many article/listing pages, CSS selectors are best for discovery, Drill Chains are best for traversal, and JSON-LD is best for detail-page metadata extraction.
```

---

## 1. Core concepts

### Request setup

Request setup answers:

```text
How does Mkfd get the initial HTML?
```

Supported request modes:

```text
Simple URL
Form submission
```

### Extraction setup

Extraction setup answers:

```text
How does Mkfd turn the fetched HTML into feed items?
```

Supported extraction modes:

```text
CSS selectors
JSON-LD on this page
Drill Chain + JSON-LD
Drill Chain + JSON-LD with CSS fallback
JSON-LD with CSS fallback
Manual selectors
```

### Drill Chain role

A Drill Chain is the bridge between listing pages and detail pages.

```text
Listing page:
  useful for finding item links

Drill Chain:
  follows item links

Detail page:
  often contains the useful JSON-LD
```

Common high-quality workflow:

```text
CSS selectors for item discovery
  -> Drill Chain follows article links
  -> JSON-LD extracts detail-page metadata
  -> CSS selectors fill missing fields when needed
```

---

## 2. Source Assistant integration

JSON-LD analysis should not be implemented as a separate, duplicate analysis system.

Source Assistant should perform the canonical analysis and pass Web Scraping-specific setup into the Web Scraping form.

### Analyze once

If the user starts with Source Assistant:

```text
Source Assistant analyzes source
  -> recommends Web Scraping with Drill Chain + JSON-LD
  -> Web Scraping form opens with Drill Chain, JSON-LD mappings, and fallback selectors prefilled
```

The Web Scraping form should not require a second analysis.

It should only re-analyze when:

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

### Shared Source Assistant data

The Web Scraping form should receive:

```text
existing feed candidates
page-level JSON-LD analysis
Drill Chain JSON-LD candidates
sampled detail-page results
suggested JSON-LD mappings
selector suggestions
fallback selector candidates
detected forms
recommendation reasons
warnings
evidence
```

---

## 3. Web Scraping recommendation hierarchy

Inside Source Assistant and Web Scraping page analysis, recommendations should generally rank like this:

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

Existing feed discovery comes first because Mkfd should not encourage scraping when a page already publishes RSS, Atom, or JSON Feed.

Drill Chain + JSON-LD should usually rank above page-level JSON-LD for index/listing pages because useful JSON-LD is often on detail pages, not index pages.

---

## 4. User-facing Web Scraping layout

The Web Scraping form should be organized as a guided workflow:

```text
Web Scraping

1. Source / Request Setup
2. Page Analysis
3. Extraction Setup
4. Drill Chain Setup
5. JSON-LD Mapping
6. CSS Fallbacks
7. Preview
8. Save
```

### Section 1: Source / Request Setup

```text
Target URL
[ https://example.com/news ]

Request mode
(•) Simple URL
( ) Submit a form first

[Analyze Page]
```

If Source Assistant already analyzed the page:

```text
Analysis already completed

Mkfd analyzed this source and recommended:
Drill Chain + JSON-LD.

[View analysis]
[Re-analyze Page]
```

### Section 2: Page Analysis

Show a summary of what Mkfd found:

```text
Page analysis

Better source:
✓ Existing RSS feed found

Structured data:
✓ Page-level JSON-LD found, but mostly site metadata
✓ Detail-page JSON-LD found on sampled article pages

Selectors:
✓ Repeated article cards found
✓ Article link selector found

Forms:
No useful forms detected
```

Then show ranked recommendations:

```text
Recommended path

1. Existing feed
   96% · Very likely
   This page already publishes an RSS feed.
   [Use existing feed]

2. Drill Chain + JSON-LD
   91% · Good option
   Listing page links lead to detail pages with NewsArticle JSON-LD.
   [Use Drill Chain + JSON-LD]

3. CSS selectors
   67% · Possible
   Repeated article cards were found.
   [Use selectors]
```

### Section 3: Extraction Setup

```text
Extraction method

( ) CSS selectors
( ) JSON-LD on this page
(•) Drill Chain + JSON-LD from detail pages
( ) Drill Chain + JSON-LD with CSS fallback
( ) Manual selectors
```

---

## 5. Drill Chain Setup

When `Drill Chain + JSON-LD` is selected, show a dedicated Drill Chain section.

```text
Drill Chain

Mkfd will use selectors on the listing page to find detail-page links, then extract JSON-LD from each linked page.

Item/link selector
[ article.card a ]

Attribute
[ href ]

Base URL
[ https://example.com ]

Limit per refresh
[ 25 ]

Concurrency
[ 3 ]

Timeout
[ 15000 ]

[Analyze sampled detail pages]
```

If Source Assistant already sampled detail pages:

```text
Drill Chain analysis already completed

Mkfd sampled 3 detail pages and found consistent NewsArticle JSON-LD.

[View sampled pages]
[Re-analyze detail pages]
```

### Sampled detail pages display

```text
Sampled detail pages

✓ /news/article-1
  Found: NewsArticle
  Fields: headline, description, datePublished, author.name, image.url, url

✓ /news/article-2
  Found: NewsArticle
  Fields: headline, description, datePublished, author.name, image.url, url

✓ /news/article-3
  Found: NewsArticle
  Fields: headline, description, datePublished, author.name, image.url, url

Recommended mapping:
Title -> headline
Description -> description
Link -> url
Date -> datePublished
Author -> author.name
Enclosure -> image.url
GUID -> @id
```

If detail pages are inconsistent:

```text
Detail-page JSON-LD is inconsistent

Mkfd found JSON-LD on sampled pages, but field availability differs.

Warnings:
- Article 1 has datePublished, but Article 2 does not.
- Article 3 has image as a string instead of an object.
- Description is missing from 2 of 3 sampled pages.

Recommended setup:
Drill Chain + JSON-LD with CSS fallback
```

---

## 6. JSON-LD candidate picker

JSON-LD pages often contain multiple nodes:

```text
WebSite
Organization
BreadcrumbList
CollectionPage
NewsArticle
BlogPosting
Article
VideoObject
ItemList
```

The GUI should show useful candidates first.

```text
Structured data candidates

● NewsArticle
  91% · Best match
  “City Council Approves Budget”
  Fields: headline, description, datePublished, author, image, url

○ ItemList
  76% · Possible
  24 listed items
  Fields: itemListElement.item.url, itemListElement.name

○ WebPage
  42% · Fallback
  Page-level metadata only

Hidden supporting data:
  Organization, WebSite, BreadcrumbList
```

For Drill Chain + JSON-LD, the candidate picker should be based on sampled detail pages, not only the index page.

---

## 7. JSON-LD mapping editor

The mapping editor should expose hidden JSON-LD data in a friendly feed-field layout.

```text
JSON-LD mapping from detail pages

Detected type:
NewsArticle

Feed field       JSON-LD path              Preview
Title            [ headline ▼ ]            City Council Approves Budget
Description      [ description ▼ ]         The council voted...
Link             [ url ▼ ]                 https://example.com/news/budget
Date             [ datePublished ▼ ]       2026-05-17T10:00:00Z
Author           [ author.name ▼ ]         Jane Doe
Enclosure        [ image.url ▼ ]           https://example.com/image.jpg
GUID             [ @id ▼ ]                 https://example.com/news/budget
Categories       [ articleSection ▼ ]      Local Government
```

Each mapping row should include:

```text
feed field label
selected JSON-LD path dropdown
preview value
status indicator
clear button
```

Status examples:

```text
✓ Found
⚠ Missing in current sample
⚠ Value looks generic
⚠ Date parse warning
```

Required or near-required fields:

```text
Title
Link or GUID
```

Strongly recommended fields:

```text
Date
Description
```

Optional fields:

```text
Author
Enclosure
Categories
Content
Source
Latitude
Longitude
```

---

## 8. Available paths browser

The path browser should let users inspect hidden JSON-LD data without reading raw JSON first.

For Drill Chain JSON-LD, users should be able to switch between sampled detail pages.

```text
Available JSON-LD paths

Preview sample:
[ Article 1 ▼ ]

Search paths...
[ author ]

Path                         Preview                         Suggested field
@type                        NewsArticle                     -
headline                     City Council Approves Budget    Title
description                  The council voted...            Description
datePublished                2026-05-17T10:00:00Z            Date
dateModified                 2026-05-17T13:00:00Z            Date
author.name                  Jane Doe                        Author
publisher.name               Example News                    Source Title
image.url                    https://example.com/image.jpg   Enclosure
mainEntityOfPage.@id         https://example.com/news/...    Link
articleSection               Local Government                Categories
keywords.0                   budget                          Categories
```

Clicking a path should allow assignment:

```text
Assign author.name to:
[ Author ]
[ Source Title ]
[ Cancel ]
```

---

## 9. Raw JSON-LD viewer

Raw JSON-LD should be available but collapsed by default.

```text
[View raw JSON-LD from sampled detail pages]

Sample:
[ Article 1 ▼ ]

JSON-LD block 1
JSON-LD block 2
Normalized nodes
```

The default workflow should be:

```text
candidate picker
  -> mapping table
  -> path browser
  -> raw JSON only if needed
```

---

## 10. CSS fallback UI

For `Drill Chain + JSON-LD with CSS fallback`, show fallback selector configuration.

There are two possible fallback locations:

```text
Listing-page fallback
Detail-page fallback
```

For the first release, prioritize listing-page fallback because the listing page is already fetched and parsed.

```text
Fallback selectors

Use CSS selectors when detail-page JSON-LD fields are missing.

Feed field       Primary source                Fallback source
Title            Detail JSON-LD headline       Listing selector: article.card h2
Description      Detail JSON-LD description    Listing selector: article.card p.summary
Link             Detail JSON-LD url            Listing selector: article.card a href
Date             Detail JSON-LD datePublished  Listing selector: article.card time datetime
Author           Detail JSON-LD author.name    Detail selector later
Enclosure        Detail JSON-LD image.url       Detail selector later
```

MVP:

```text
Support listing-page CSS fallback first.
Support detail-page CSS fallback after core Drill Chain JSON-LD works.
```

Preview should show source attribution:

```text
Item preview

Title: City Council Approves Budget
Source: JSON-LD headline

Description: The council voted...
Source: CSS fallback article.card p.summary

Date: 2026-05-17
Source: JSON-LD datePublished
```

---

## 11. Config model

Add an `extraction` block to Web Scraping configs.

Existing CSS selector configs remain valid. If `extraction` is missing, normalize to:

```yaml
extraction:
  mode: cssSelectors
```

### CSS selector mode

```yaml
feedType: webScraping
config:
  baseUrl: https://example.com/news

extraction:
  mode: cssSelectors

article:
  iterator:
    selector: article.card
  title:
    selector: h2
  link:
    selector: a
    attribute: href
  pubDate:
    selector: time
    attribute: datetime
```

### Page-level JSON-LD

```yaml
feedType: webScraping
config:
  baseUrl: https://example.com/news

extraction:
  mode: jsonLd
  jsonLd:
    scope: page
    candidateId: jsonld-node-1
    types:
      - NewsArticle
      - BlogPosting
      - Article
    mapping:
      title: headline
      description: description
      link: url
      pubDate: datePublished
      author: author.name
      enclosure: image.url
      categories: articleSection
      guid: "@id"
```

### Drill Chain + JSON-LD

```yaml
feedType: webScraping
config:
  baseUrl: https://example.com/news

extraction:
  mode: jsonLd
  jsonLd:
    scope: detailPage
    drillChain:
      selector: article.card a
      attribute: href
      isRelative: true
      baseUrl: https://example.com
      limit: 25
      concurrency: 3
      timeoutMs: 15000
    types:
      - NewsArticle
      - BlogPosting
      - Article
    mapping:
      title: headline
      description: description
      link: url
      pubDate: datePublished
      author: author.name
      enclosure: image.url
      guid: "@id"

article:
  iterator:
    selector: article.card
  title:
    selector: h2
  description:
    selector: p.summary
  link:
    selector: a
    attribute: href
    isRelative: true
    baseUrl: https://example.com
```

### Drill Chain + JSON-LD with fallback

```yaml
feedType: webScraping
config:
  baseUrl: https://example.com/news

extraction:
  mode: jsonLdWithCssFallback
  jsonLd:
    scope: detailPage
    fallbackToSelectors: true
    drillChain:
      selector: article.card a
      attribute: href
      isRelative: true
      baseUrl: https://example.com
      limit: 25
      concurrency: 3
      timeoutMs: 15000
    types:
      - NewsArticle
      - BlogPosting
      - Article
    mapping:
      title: headline
      description: description
      link: url
      pubDate: datePublished
      author: author.name
      enclosure: image.url
      guid: "@id"

article:
  iterator:
    selector: article.card
  title:
    selector: h2
  description:
    selector: p.summary
  link:
    selector: a
    attribute: href
    isRelative: true
    baseUrl: https://example.com
```

### JSON-LD ItemList

```yaml
feedType: webScraping
config:
  baseUrl: https://example.com/news

extraction:
  mode: jsonLd
  jsonLd:
    scope: itemList
    candidateId: jsonld-itemlist-1
    itemPath: itemListElement
    itemValuePath: item
    mapping:
      title: name
      link: url
      pubDate: datePublished
    drillChain:
      selector: article.card a
      attribute: href
      isRelative: true
      baseUrl: https://example.com
      limit: 25
      concurrency: 3
      timeoutMs: 15000
```

---

## 12. TypeScript models

Create:

```text
models/web-scraping-extraction.model.ts
```

```ts
export type WebScrapingExtractionMode =
  | "cssSelectors"
  | "jsonLd"
  | "jsonLdWithCssFallback";

export type WebScrapingExtractionConfig = {
  mode: WebScrapingExtractionMode;
  jsonLd?: JsonLdExtractionConfig;
};

export type JsonLdExtractionScope =
  | "page"
  | "detailPage"
  | "itemList"
  | "auto";

export type JsonLdExtractionConfig = {
  scope: JsonLdExtractionScope;
  candidateId?: string;
  types?: string[];
  itemPath?: string;
  itemValuePath?: string;
  mapping: JsonLdFeedFieldMapping;
  fallbackToSelectors?: boolean;
  drillChain?: JsonLdDrillChainConfig;
};

export type JsonLdDrillChainConfig = {
  selector: string;
  attribute?: string;
  isRelative?: boolean;
  baseUrl?: string;
  limit?: number;
  concurrency?: number;
  timeoutMs?: number;
};

export type JsonLdFeedFieldMapping = {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  author?: string;
  enclosure?: string;
  categories?: string;
  contentEncoded?: string;
  guid?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  lat?: string;
  long?: string;
};
```

Update Web Scraping config type:

```ts
export type WebScrapingFeedConfig = FeedConfigBase<"webScraping"> & {
  config: WebScrapingSourceConfig;
  extraction?: WebScrapingExtractionConfig;
  article?: WebScrapingArticleConfig;
};
```

Normalize missing extraction:

```ts
export function normalizeWebScrapingExtraction(
  config: WebScrapingFeedConfig,
): WebScrapingFeedConfig {
  return {
    ...config,
    extraction: config.extraction ?? {
      mode: "cssSelectors",
    },
  };
}
```

---

## 13. JSON-LD analysis model

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

export type JsonLdNodeSummary = {
  id: string;
  type: string[];
  label: string;
  path: string;
  fieldCount: number;
  feedFieldCoverage: JsonLdFeedFieldCoverage;
  preview: Record<string, unknown>;
  availablePaths: JsonLdAvailablePath[];
  raw?: unknown;
};

export type JsonLdExtractionCandidate = {
  id: string;
  scope: JsonLdExtractionScope;
  confidence: number;
  label: string;
  summary: string;
  nodeIds: string[];
  mapping: JsonLdFeedFieldMapping;
  missingFields: string[];
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

export type JsonLdFeedFieldCoverage = {
  title: boolean;
  description: boolean;
  link: boolean;
  pubDate: boolean;
  author: boolean;
  enclosure: boolean;
  categories: boolean;
};

export type JsonLdAvailablePath = {
  path: string;
  valueType:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "date"
    | "url";
  preview: string;
  suggestedFeedField?: keyof JsonLdFeedFieldMapping;
};
```

---

## 14. Backend utilities

Add:

```text
utilities/json-ld.utility.ts
utilities/json-ld-analysis.utility.ts
utilities/json-ld-drill-chain-analysis.utility.ts
utilities/json-ld-extractor.utility.ts
utilities/web-scraping-extractor.utility.ts
```

### `json-ld.utility.ts`

Responsibilities:

```text
Extract JSON-LD script blocks
Parse JSON safely
Normalize arrays and @graph
Normalize ItemList and ListItem shapes
Flatten available paths
Read values by path
Normalize common schema.org shapes
```

Functions:

```ts
export function extractJsonLdBlocks(html: string): unknown[];

export function normalizeJsonLdBlocks(blocks: unknown[]): JsonLdNode[];

export function flattenJsonLdPaths(node: JsonLdNode): JsonLdAvailablePath[];

export function getJsonLdValue(node: JsonLdNode, path: string): unknown;

export function normalizeJsonLdType(value: unknown): string[];

export function normalizeJsonLdImage(value: unknown): string | undefined;

export function normalizeJsonLdAuthor(value: unknown): string | undefined;

export function normalizeJsonLdUrl(value: unknown): string | undefined;
```

Must handle:

```text
single object
array of objects
@graph
ItemList.itemListElement
ListItem.item
image as string/object/array
author as string/object/array
mainEntityOfPage as string/object
HTML entities inside JSON-LD
malformed JSON-LD blocks
```

Do not fetch remote JSON-LD contexts in the MVP.

### `json-ld-analysis.utility.ts`

Responsibilities:

```text
Find feed-relevant JSON-LD nodes
Score node usefulness
Suggest feed field mappings
Generate extraction candidates
Expose available paths
Generate warnings
```

Function:

```ts
export function analyzeJsonLdForFeedExtraction(
  html: string,
  options?: JsonLdAnalysisOptions,
): JsonLdAnalysisResult;
```

### `json-ld-drill-chain-analysis.utility.ts`

Responsibilities:

```text
Use selector candidates to discover detail links
Sample detail pages
Run JSON-LD analysis on sampled pages
Compare schema consistency
Suggest Drill Chain + JSON-LD mappings
Generate Drill Chain candidates
```

Functions:

```ts
export async function analyzeJsonLdDrillChainCandidates(
  html: string,
  pageUrl: string,
  options: JsonLdDrillChainAnalysisOptions,
): Promise<JsonLdDrillChainCandidate[]>;

export function extractDrillChainUrls(
  html: string,
  drillChain: JsonLdDrillChainConfig,
): string[];

export function compareSampledDetailPageMappings(
  sampledPages: JsonLdSampledDetailPage[],
): JsonLdFeedFieldMapping;
```

Suggested defaults:

```text
sampleDetailPages: 3
maxSampleDetailPages: 5
analysisConcurrency: 2
analysisTimeoutMs: 10000
```

### `json-ld-extractor.utility.ts`

Responsibilities:

```text
Extract normalized feed items from JSON-LD
Support page scope
Support detailPage scope
Support itemList scope
Support CSS fallback
Return diagnostics
```

Functions:

```ts
export async function extractFeedItemsFromJsonLd(
  html: string,
  config: JsonLdExtractionConfig,
  context: JsonLdExtractionContext,
): Promise<NormalizedFeedItem[]>;

export async function extractFeedItemsFromJsonLdDrillChain(
  listingHtml: string,
  config: JsonLdExtractionConfig,
  feedConfig: WebScrapingFeedConfig,
): Promise<NormalizedFeedItem[]>;
```

### `web-scraping-extractor.utility.ts`

Use extraction mode to choose the extraction path.

```ts
export async function extractWebScrapingItems(
  html: string,
  feedConfig: WebScrapingFeedConfig,
): Promise<NormalizedFeedItem[]> {
  const mode = feedConfig.extraction?.mode ?? "cssSelectors";

  if (mode === "cssSelectors") {
    return extractFeedItemsFromCssSelectors(html, feedConfig);
  }

  if (mode === "jsonLd") {
    return extractFeedItemsFromJsonLd(html, feedConfig.extraction?.jsonLd, {
      feedConfig,
    });
  }

  if (mode === "jsonLdWithCssFallback") {
    return extractFeedItemsFromJsonLdWithCssFallback(html, feedConfig);
  }

  throw new Error(`Unsupported web scraping extraction mode: ${mode}`);
}
```

---

## 15. Runtime Drill Chain + JSON-LD pipeline

```text
fetch listing page
  -> extract item/detail URLs using drillChain.selector
  -> resolve URLs
  -> apply limit
  -> fetch detail pages with concurrency
  -> parse JSON-LD from each detail page
  -> choose matching JSON-LD node/type
  -> map JSON-LD paths to feed fields
  -> apply CSS fallback fields when enabled
  -> normalize feed items
  -> build feed
```

Pseudo-function:

```ts
export async function extractFeedItemsFromJsonLdDrillChain(
  listingHtml: string,
  config: JsonLdExtractionConfig,
  feedConfig: WebScrapingFeedConfig,
): Promise<NormalizedFeedItem[]> {
  if (!config.drillChain) {
    throw new Error("JSON-LD detailPage extraction requires a drillChain config");
  }

  const urls = extractDrillChainUrls(listingHtml, config.drillChain);

  const limitedUrls = urls.slice(0, config.drillChain.limit ?? 25);

  const detailPages = await fetchDetailPages(limitedUrls, {
    concurrency: config.drillChain.concurrency ?? 3,
    timeoutMs: config.drillChain.timeoutMs ?? 15000,
  });

  return detailPages.flatMap((page) =>
    extractFeedItemsFromJsonLd(page.html, config, {
      feedConfig,
      sourceUrl: page.url,
    }),
  );
}
```

---

## 16. Field mapping defaults

### Title

```text
headline
name
alternateName
```

### Description

```text
description
abstract
articleBody
text
```

### Link

```text
url
mainEntityOfPage.@id
mainEntityOfPage
@id
```

### Published date

```text
datePublished
dateCreated
uploadDate
startDate
dateModified
```

### Author

```text
author.name
author.0.name
creator.name
publisher.name
```

### Enclosure

```text
image
image.url
image.0.url
thumbnailUrl
primaryImageOfPage.url
```

### Categories

```text
articleSection
keywords
about.name
genre
category
```

### GUID

```text
@id
url
mainEntityOfPage.@id
```

---

## 17. JSON-LD confidence scoring

### Page-level JSON-LD

```text
+35 NewsArticle, BlogPosting, Article
+35 Event, VideoObject, PodcastEpisode, Recipe, Product, JobPosting when relevant
+30 ItemList with URLs
+15 WebPage
-20 Organization-only
-20 WebSite-only
-15 BreadcrumbList-only
+25 title/headline/name
+20 link/url/mainEntityOfPage
+20 datePublished/dateCreated/startDate
+15 description
+10 author
+10 image/enclosure
+10 category/articleSection/keywords
-20 missing title or link
-15 no date field
-15 site-level JSON-LD only
-20 malformed JSON-LD blocks
```

Thresholds:

```text
80+ recommend JSON-LD
60-79 recommend JSON-LD with CSS fallback
40-59 show as auxiliary option
<40 hide behind advanced details unless user opens JSON-LD panel
```

### Drill Chain + JSON-LD

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
85+ strongly recommend Drill Chain + JSON-LD
70-84 recommend Drill Chain + JSON-LD with CSS fallback
50-69 show as possible
<50 do not recommend automatically
```

---

## 18. Page analysis endpoint

Keep:

```text
POST /utils/analyze-web-page
```

But treat it as a Source Assistant reuse endpoint.

Request:

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

Behavior:

```text
If request.mode is simple, fetch the target URL.
If request.mode is form, submit the form and analyze the result page.
Run existing feed discovery.
Run page-level JSON-LD analysis.
Run form detection.
Run CSS selector suggestion.
Run Drill Chain detail-page JSON-LD sampling where appropriate.
Build WebScrapingAnalysisPlan.
Return shared observation and web scraping recommendations.
```

---

## 19. Source Assistant apply behavior

When applying a Web Scraping recommendation, the backend should return the Web Scraping plan and starter config.

```ts
export type SourceAssistantApplyResponse = {
  routeType: SourceAssistantRouteType;
  builder:
    | "webScraping"
    | "restApi"
    | "sitemap"
    | "calendar"
    | "existingFeed"
    | "manual";
  starterConfig: Partial<FeedConfig>;
  formValues?: Record<string, unknown>;
  webScrapingPlan?: WebScrapingAnalysisPlan;
  warnings: SourceAssistantWarning[];
};
```

Frontend behavior:

```text
set active builder to Web Scraping
reset form with starterConfig/formValues
store webScrapingPlan in WebScrapingForm state
show analysis already completed banner
avoid calling Analyze Page again
```

---

## 20. Preview behavior

Preview must work regardless of extraction mode.

For Drill Chain + JSON-LD preview:

```text
Preview items

Title: City Council Approves Budget
Source: Detail JSON-LD headline

Description: The council voted...
Source: Detail JSON-LD description

Date: 2026-05-17
Source: Detail JSON-LD datePublished

Author: Jane Doe
Source: Detail JSON-LD author.name

Image: https://example.com/image.jpg
Source: Detail JSON-LD image.url
```

For fallback:

```text
Description: The council voted...
Source: Listing CSS fallback article.card p.summary
```

Diagnostics model:

```ts
export type FeedItemExtractionDiagnostic = {
  itemIndex: number;
  extractionMode: WebScrapingExtractionMode;
  fieldSources: Record<
    string,
    "jsonLd" | "detailJsonLd" | "cssSelector" | "listingCssFallback" | "detailCssFallback" | "missing"
  >;
  warnings: SourceAssistantWarning[];
};
```

---

## 21. Validation rules

For `extraction.mode = jsonLd`:

```text
jsonLd config is required
mapping is required
scope must be valid
at least title and link or guid should be mapped
```

For `jsonLd.scope = detailPage`:

```text
drillChain is required
drillChain.selector is required
drillChain.attribute defaults to href
drillChain.limit must be bounded
drillChain.concurrency must be bounded
drillChain.timeoutMs must be bounded
at least one schema type should be selected
```

For `jsonLdWithCssFallback`:

```text
jsonLd config is required
fallbackToSelectors should be true
article fallback config should exist
warn if CSS iterator is missing
warn if no fallback selectors are configured
```

Warnings:

```text
No date field mapped
No description mapped
Only one JSON-LD item detected
Mapping path was not found in latest analysis
Multiple candidate nodes found but no candidate was selected
No sampled detail pages succeeded
Sampled detail pages did not contain JSON-LD
Only site-level JSON-LD found on sampled detail pages
Mappings were inconsistent across samples
High detail-page limit may slow refreshes
```

Backward compatibility:

```text
Existing CSS selector configs continue to run.
Missing extraction config means cssSelectors.
article.pubDate and article.date aliases continue to normalize.
```

---

## 22. Security and performance

Rules:

```text
Do not fetch remote JSON-LD contexts.
Limit JSON-LD script block size.
Limit number of JSON-LD blocks parsed.
Limit Drill Chain sample size.
Limit detail-page fetch count.
Limit detail-page concurrency.
Respect timeout/retry policy.
Do not log protected headers/cookies/form values.
Mask protected values in analysis details.
Do not expose decrypted values in evidence.
```

Suggested defaults:

```text
maxJsonLdBlockBytes: 500000
maxJsonLdBlocks: 20
analysis.sampleDetailPages: 3
analysis.maxSampleDetailPages: 5
analysis.detailConcurrency: 2
analysis.detailTimeoutMs: 10000
runtime.drillChain.limit: 25
runtime.drillChain.concurrency: 3
runtime.drillChain.timeoutMs: 15000
```

---

## 23. Frontend components

Add:

```text
WebScrapingAnalysisBanner.tsx
WebScrapingPageAnalysisPanel.tsx
WebScrapingAnalysisRecommendationCard.tsx
ExistingFeedCandidates.tsx
ExtractionMethodSelector.tsx
JsonLdAnalysisPanel.tsx
JsonLdCandidatePicker.tsx
JsonLdMappingEditor.tsx
JsonLdPathBrowser.tsx
JsonLdRawViewer.tsx
JsonLdFallbackSelectorEditor.tsx
JsonLdDrillChainPanel.tsx
JsonLdSampledDetailPages.tsx
```

Reuse:

```text
RecommendationCard.tsx
ConfidenceBadge.tsx
RecommendationReasons.tsx
EvidenceList.tsx
WarningList.tsx
```

---

## 24. GUI acceptance criteria

The GUI portion is complete when:

```text
Web Scraping form can receive Source Assistant analysis.
Web Scraping form does not re-analyze when valid Source Assistant analysis exists.
Web Scraping form shows an Analysis already completed banner.
User can view page analysis recommendations.
Existing feed candidates appear before extraction choices.
User can choose CSS selectors.
User can choose JSON-LD on this page.
User can choose Drill Chain + JSON-LD.
User can choose Drill Chain + JSON-LD with CSS fallback.
Drill Chain section exposes selector, attribute, base URL, limit, concurrency, and timeout.
Sampled detail-page JSON-LD results are visible to the user.
JSON-LD candidate picker sorts useful nodes first.
JSON-LD mapping editor shows feed fields, JSON-LD paths, and preview values.
Available path browser exposes hidden JSON-LD data.
Path browser can switch between sampled detail pages.
Raw JSON-LD viewer is available but collapsed by default.
Fallback selector editor shows which fields need fallback.
Preview shows extracted values and field sources.
Changing URL/request settings marks analysis stale and shows Re-analyze.
```

---

## 25. Tests

### Source Assistant reuse tests

```text
Source Assistant web scraping recommendation includes WebScrapingAnalysisPlan.
Applying Web Scraping recommendation does not trigger second analysis.
Web Scraping form receives and displays existing analysis.
Changing URL marks analysis stale.
Manual Web Scraping Analyze Page uses same analysis engine.
```

### JSON-LD utility tests

```text
Extracts single JSON-LD object.
Extracts JSON-LD arrays.
Extracts @graph nodes.
Extracts ItemList entries.
Handles malformed blocks gracefully.
Normalizes @type.
Normalizes image string/object/array.
Normalizes author string/object/array.
Reads nested paths.
Flattens available paths.
```

### JSON-LD analysis tests

```text
Detects NewsArticle.
Detects BlogPosting.
Detects Article.
Detects Event.
Detects VideoObject.
Detects JobPosting.
Scores Organization-only low.
Scores WebSite-only low.
Suggests headline as title.
Suggests url as link.
Suggests datePublished as pubDate.
Suggests author.name as author.
Suggests image.url as enclosure.
Creates ItemList candidate.
Warns when title or link is missing.
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

### Extraction tests

```text
Extracts item from page-level JSON-LD.
Extracts multiple JSON-LD items.
Extracts ItemList entries.
Fetches detail pages and extracts JSON-LD.
Uses CSS fallback for missing fields.
Produces diagnostics for field sources.
Does not crash on malformed JSON-LD.
```

### GUI tests

```text
JSON-LD recommendation renders.
Drill Chain + JSON-LD recommendation renders.
Candidate picker sorts feed-relevant nodes first.
Sampled detail pages render.
Mapping editor displays suggested mappings.
Path browser lists flattened JSON-LD paths.
Path browser can switch sampled pages.
Clicking path assigns it to feed field.
Raw viewer is collapsed by default.
Fallback selectors appear for Drill Chain + JSON-LD with fallback.
Preview displays JSON-LD and CSS field sources.
```

---

## 26. Implementation phases

### Phase 1: Shared model updates

```text
Add web-scraping-extraction.model.ts.
Add JSON-LD analysis types.
Add JsonLdDrillChainCandidate types.
Add WebScrapingAnalysisPlan support.
Extend SourceAssistantRecommendation with webScrapingPlan.
Normalize missing extraction to cssSelectors.
```

### Phase 2: JSON-LD parser and analyzer

```text
Add json-ld.utility.ts.
Add json-ld-analysis.utility.ts.
Parse blocks, @graph, arrays, ItemList.
Flatten paths.
Suggest mappings.
Score candidates.
```

### Phase 3: Drill Chain + JSON-LD analysis

```text
Add json-ld-drill-chain-analysis.utility.ts.
Use selector candidates to discover detail links.
Sample detail pages.
Analyze JSON-LD on sampled pages.
Compare field mapping consistency.
Generate Drill Chain candidates.
```

### Phase 4: Source Assistant integration

```text
Add page-level JSON-LD analysis to source observation.
Add Drill Chain + JSON-LD candidates to source observation.
Add existing feed discovery to observation.
Add selector summary to observation.
Build WebScrapingAnalysisPlan during source analysis.
Return plan with Web Scraping recommendation.
```

### Phase 5: Web page analysis endpoint

```text
Add /utils/analyze-web-page.
Reuse Source Assistant observer.
Use webScrapingPageAnalysis recommendation context.
Return WebScrapingAnalysisPlan.
```

### Phase 6: Web Scraping GUI integration

```text
Pass Source Assistant analysis into WebScrapingForm.
Show analysis already completed banner.
Add page analysis panel.
Add extraction method selector.
Avoid duplicate analysis.
```

### Phase 7: JSON-LD and Drill Chain GUI

```text
Add candidate picker.
Add Drill Chain setup panel.
Add sampled detail pages display.
Add mapping editor.
Add available paths browser.
Add raw JSON-LD viewer.
Add fallback selector editor.
```

### Phase 8: Runtime extraction

```text
Add json-ld-extractor.utility.ts.
Add web-scraping-extractor.utility.ts.
Route extraction by mode.
Support page-level JSON-LD.
Support Drill Chain + JSON-LD.
Support Drill Chain + JSON-LD with CSS fallback.
Support JSON-LD with CSS fallback.
```

### Phase 9: Preview and diagnostics

```text
Preview normalized items from JSON-LD.
Show field source diagnostics.
Show fallback usage.
Show sampled detail-page warnings.
Show missing mapping warnings.
```

### Phase 10: Validation and hardening

```text
Add JSON-LD config validation.
Add Drill Chain config validation.
Add size/concurrency limits.
Add malformed JSON-LD fixtures.
Add Drill Chain sampling fixtures.
Add tests.
```

---

## 27. README to-do item

```md
- [ ] JSON-LD structured data extraction for web scraping feeds
  - Reuse Source Assistant as the canonical page analysis engine.
  - Let Source Assistant analyze a source once and pass Web Scraping request/extraction plans into the Web Scraping form.
  - Detect existing RSS, Atom, and JSON Feed options before recommending scraping.
  - Parse embedded JSON-LD and identify feed-relevant schema.org nodes.
  - Recognize that listing-page JSON-LD is often weak and detail-page JSON-LD is often stronger.
  - Add Drill Chain + JSON-LD as a first-class web scraping workflow.
  - Let Mkfd use listing-page selectors to discover detail-page links, then extract JSON-LD from each detail page.
  - Expose sampled detail-page JSON-LD candidates, paths, previews, and mappings in the GUI.
  - Support extraction modes for CSS selectors, JSON-LD, Drill Chain + JSON-LD, and JSON-LD with CSS fallback.
  - Avoid duplicate analysis when the user enters Web Scraping from Source Assistant.
  - Use JSON-LD extraction in preview and worker feed generation.
```

---

## 28. Acceptance criteria

This feature is complete when:

```text
Source Assistant detects JSON-LD as part of normal source analysis.
Source Assistant samples Drill Chain detail pages when a listing page has likely item links.
Source Assistant can recommend Drill Chain + JSON-LD.
Source Assistant can recommend Drill Chain + JSON-LD with CSS fallback.
Source Assistant Web Scraping recommendations include a specific extraction plan.
Choosing Web Scraping from Source Assistant opens the Web Scraping form without a second analysis.
Existing feeds are shown before JSON-LD and selector recommendations.
JSON-LD candidates are detected, scored, and exposed to the user.
Sampled detail-page JSON-LD candidates are visible to the user.
JSON-LD mapping editor allows users to map hidden structured data to feed fields.
Available path browser exposes all useful JSON-LD paths.
Raw JSON-LD can be viewed for debugging.
Users can choose JSON-LD on this page.
Users can choose Drill Chain + JSON-LD.
Users can choose Drill Chain + JSON-LD with CSS fallback.
Saved YAML includes extraction.mode and jsonLd config.
Saved YAML includes drillChain config when using detail-page JSON-LD.
Existing CSS selector configs remain valid.
Preview works with JSON-LD extraction.
Preview works with Drill Chain + JSON-LD extraction.
Workers generate feeds from JSON-LD extraction.
Malformed JSON-LD does not crash analysis or feed generation.
```

---

## Recommended first cut

Build the first version in this order:

```text
1. JSON-LD parser and analyzer
2. Add JSON-LD analysis to Source Assistant observation
3. Existing feed discovery in shared analysis
4. Selector-based link discovery for Drill Chain candidates
5. Detail-page JSON-LD sampling
6. Add WebScrapingAnalysisPlan to Source Assistant recommendations
7. Web Scraping form consumes Source Assistant analysis without re-analysis
8. Drill Chain + JSON-LD GUI
9. JSON-LD candidate picker and mapping editor
10. Page-level JSON-LD extraction
11. Drill Chain + JSON-LD runtime extraction
12. JSON-LD with CSS fallback
```

The most important mental model is:

```text
Index pages are usually for discovery.
Detail pages are usually for structured extraction.
```

Mkfd should turn that into a first-class workflow:

```text
CSS selectors for discovery
Drill Chain for traversal
JSON-LD for extraction
CSS selectors for fallback
```