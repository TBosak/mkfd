# Sitemap Integration — Design Spec

**Date:** 2026-05-24
**Tier:** R5 New Source Types
**Status:** Approved

---

## Goal

Add `sitemap` as a first-class feed type. Sitemaps provide a website-maintained URL inventory that Mkfd can use to generate feeds, discover source URLs, extract JSON-LD from linked pages, and enable change detection. The strategic mental model:

```
Web Scraping Drill Chain:  listing page selector → detail page URL → extraction
Sitemap Drill Chain:       sitemap loc          → detail page URL → extraction
```

For many sites, sitemaps provide a more reliable URL inventory than fragile listing-page scrapers.

---

## Scope

### In scope (MVP)

- `feedType: sitemap` added to `FeedType`
- Five sitemap modes: `urlList`, `pageMetadata`, `jsonLd`, `jsonLdWithFallback`, `changeDetection`
- Sitemap parser: urlset, sitemapindex, gzip, discovery from robots.txt
- URL filters: include/exclude by keyword or regex on `loc`, `lastmod`, `changefreq`, `priority`
- Sitemap state JSON files (`./feed-state/sitemaps/{feedId}.json`) for first-seen tracking
- `POST /preview/sitemap` endpoint
- Worker branch for sitemap feeds
- `SitemapForm.tsx` builder UI
- Source Assistant sitemap detection and recommendation
- Health dashboard sitemap run stats
- `utilities/sitemap.utility.ts`, `utilities/sitemap-json-ld.utility.ts`, `utilities/page-metadata.utility.ts`

### Out of scope (post-MVP)

- Full change detection diff summaries and AI summaries
- Sitemap-assisted selector repair
- SQLite-backed sitemap state (use JSON files until SQLite substrate lands)
- Deep crawling beyond sitemap URLs
- Authenticated sitemap sources
- Remote JSON-LD context fetching

---

## Dependencies

Must be implemented first:

- JSON-LD Integration (provides `JsonLdFeedFieldMapping`, JSON-LD extraction utilities)
- Normalized Feed Item Pipeline (provides `NormalizedFeedItem`)
- Feed Config Formalization (canonical `FeedConfig` for `feedType: sitemap`)
- Source Assistant: Backend Core (for Source Assistant integration)

---

## Architecture

| Unit | File | Responsibility |
|---|---|---|
| Sitemap model | `models/sitemap.model.ts` | All sitemap types: config, entries, filters, state, run stats |
| Sitemap parser | `utilities/sitemap.utility.ts` | Parse urlset/sitemapindex, gzip, discovery, filters, sort |
| Sitemap JSON-LD | `utilities/sitemap-json-ld.utility.ts` | Sample pages, analyze JSON-LD, build feed items |
| Page metadata | `utilities/page-metadata.utility.ts` | Extract Open Graph, HTML meta, canonical URL, article dates |
| Sitemap worker | (branch in `workers/feed-updater.worker.ts`) | Sitemap feed refresh |
| Sitemap routes | `routes/sitemap.ts` | `POST /preview/sitemap`, `POST /source-assistant/sitemap` |
| Sitemap form | `frontend/src/components/forms/SitemapForm.tsx` | Sitemap builder UI |
| Sitemap tests | `tests/sitemap.test.ts` | Unit tests for parser, JSON-LD, builder, worker |

---

## Config Model

### `models/sitemap.model.ts` (new)

```ts
export type SitemapMode =
  | "urlList"
  | "pageMetadata"
  | "jsonLd"
  | "jsonLdWithFallback"
  | "changeDetection";

export type SitemapInputMode = "exact" | "discover";

export type SitemapSortOrder =
  | "lastmodDesc"
  | "lastmodAsc"
  | "firstSeenDesc"
  | "urlAsc"
  | "sitemapOrder";

export type SitemapDateStrategy =
  | "lastmodOrFirstSeen"
  | "lastmodOnly"
  | "firstSeen"
  | "currentRun"
  | "bestAvailable"
  | "jsonLdOrLastmodOrFirstSeen";

export type SitemapFilterRule = {
  type: "keyword" | "regex";
  field: "loc" | "lastmod" | "changefreq" | "priority";
  value: string;
  caseSensitive?: boolean;
};

export type SitemapFeedConfig = {
  inputMode: SitemapInputMode;
  url: string;
  mode: SitemapMode;
  maxItems: number;
  maxUrlsToScan: number;
  sortOrder: SitemapSortOrder;
  dateStrategy: SitemapDateStrategy;
  titleStrategy: "path" | "url" | "hostnameAndPath" | "bestAvailable";
  descriptionStrategy:
    | "sitemapMetadata"
    | "pageMetadata"
    | "jsonLd"
    | "bestAvailable"
    | "none";
  filters?: {
    include?: SitemapFilterRule[];
    exclude?: SitemapFilterRule[];
  };
  pageMetadata?: SitemapPageMetadataConfig;
  jsonLd?: SitemapJsonLdConfig;
  changeDetection?: SitemapChangeDetectionConfig;
};

export type SitemapPageMetadataConfig = {
  enabled: boolean;
  fetchMode: "standard" | "advanced";
  timeoutMs: number;
  concurrency: number;
};

export type SitemapJsonLdConfig = {
  enabled: boolean;
  scope: "sitemapUrls";
  sampleUrls?: number;
  fetch: {
    mode: "standard" | "advanced";
    timeoutMs: number;
    concurrency: number;
    maxPages: number;
  };
  types?: string[];
  mapping: JsonLdFeedFieldMapping;
  fallback?: {
    enabled: boolean;
    order: Array<"openGraph" | "htmlMeta" | "sitemap" | "url">;
  };
};

export type SitemapChangeDetectionConfig = {
  enabled: boolean;
  target: "fullPage" | "mainContent" | "selector";
  selector?: string;
  emitOn: "contentHashChanged";
  includeDiff: boolean;
  ignoreSelectors?: string[];
};

export type SitemapEntry = {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  sourceSitemapUrl: string;
  discoveredAt: string;
  order: number;
};

export type SitemapIndexEntry = {
  loc: string;
  lastmod?: string;
  sourceSitemapUrl: string;
};

export type SitemapParseResult = {
  type: "urlset" | "sitemapindex" | "text" | "rss" | "atom";
  entries: SitemapEntry[];
  childSitemaps: SitemapIndexEntry[];
  warnings: string[];
  stats: {
    totalUrls: number;
    urlsAfterFilters: number;
    totalChildSitemaps: number;
    fetchedChildSitemaps: number;
    failedChildSitemaps: number;
    duplicateUrls: number;
  };
};

export type SitemapFeedState = {
  urls: Record<
    string,
    {
      firstSeenAt: string;
      lastSeenAt: string;
      lastSitemapLastmod?: string;
      lastJsonLdHash?: string;
      lastContentHash?: string;
      lastEmittedAt?: string;
      lastStatusCode?: number;
      lastError?: string;
    }
  >;
};

export type SitemapRunStats = {
  feedId: string;
  startedAt: string;
  completedAt: string;
  sitemapUrl: string;
  totalUrls: number;
  urlsAfterFilters: number;
  emittedItems: number;
  newUrls: number;
  modifiedUrls: number;
  disappearedUrls: number;
  childSitemaps: number;
  failedChildSitemaps: number;
  duplicateUrls: number;
  pagesFetched?: number;
  pagesFailed?: number;
  jsonLdPagesFound?: number;
  jsonLdPagesMissing?: number;
  fallbackItems?: number;
  warnings: string[];
};

export type SitemapJsonLdSample = {
  loc: string;
  status?: number;
  success: boolean;
  jsonLdFound: boolean;
  candidateTypes: string[];
  availablePaths: JsonLdAvailablePath[];
  mappingCoverage: JsonLdFeedFieldCoverage;
  warnings: string[];
};

export type SitemapJsonLdAnalysisResult = {
  found: boolean;
  recommended: boolean;
  confidence: number;
  summary: string;
  samples: SitemapJsonLdSample[];
  mapping: JsonLdFeedFieldMapping;
  types: string[];
  missingFields: string[];
  warnings: string[];
};

export type PageMetadata = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  image?: string;
  publishedTime?: string;
  modifiedTime?: string;
  sourceTitle?: string;
  warnings: string[];
};

export type SitemapEntryPreview = {
  loc: string;
  lastmod?: string;
  included: boolean;
  includeReason?: string;
  excludeReason?: string;
  jsonLd?: {
    found: boolean;
    type?: string[];
    mappedFields?: Record<string, string>;
    warnings: string[];
  };
  pageMetadata?: PageMetadata;
  outputItem?: {
    title?: string;
    link?: string;
    pubDate?: string;
    description?: string;
    author?: string;
    enclosure?: string;
    guid?: string;
  };
};

export type SitemapPreviewResponse = {
  entries: SitemapEntryPreview[];
  warnings: string[];
  stats: SitemapParseResult["stats"];
  rssXml?: string;
};
```

`JsonLdFeedFieldMapping`, `JsonLdAvailablePath`, `JsonLdFeedFieldCoverage` are imported from `models/json-ld.model.ts` (created by JSON-LD Integration).

---

## Backend: Sitemap Parser

### `utilities/sitemap.utility.ts` (new)

```ts
export async function discoverSitemaps(siteUrl: string): Promise<string[]>;

export async function fetchAndParseSitemap(
  sitemapUrl: string,
  options: SitemapParseOptions,
): Promise<SitemapParseResult>;

export function applySitemapFilters(
  entries: SitemapEntry[],
  filters: SitemapFeedConfig["filters"],
): SitemapEntry[];

export function sortSitemapEntries(
  entries: SitemapEntry[],
  sortOrder: SitemapSortOrder,
): SitemapEntry[];
```

Discovery checks (in order):
1. Parse `robots.txt` for `Sitemap:` directives
2. Probe `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml`, `/wp-sitemap.xml`, `/post-sitemap.xml`, `/page-sitemap.xml`

Parsing behavior:
- Detect `<urlset>` (urlset file) vs. `<sitemapindex>` (index file)
- Follow child sitemaps from sitemapindex (up to `maxUrlsToScan`)
- Support gzip-compressed sitemaps (`Content-Encoding: gzip` or `.gz` extension)
- Deduplicate URLs (last-seen wins for metadata)
- Normalize `<lastmod>` to ISO 8601
- Attach `sourceSitemapUrl` and discovery timestamp

Filter rules apply to `loc`, `lastmod`, `changefreq`, or `priority` fields. Regex rules are compiled once; invalid regex produces a validation error (not a runtime crash).

---

## Backend: Sitemap JSON-LD

### `utilities/sitemap-json-ld.utility.ts` (new)

```ts
export async function analyzeSitemapJsonLd(
  entries: SitemapEntry[],
  config: SitemapFeedConfig,
): Promise<SitemapJsonLdAnalysisResult>;

export async function extractFeedItemsFromSitemapJsonLd(
  entries: SitemapEntry[],
  feedConfig: FeedConfig,
): Promise<NormalizedFeedItem[]>;

export function compareSitemapJsonLdSamples(
  samples: SitemapJsonLdSample[],
): JsonLdFeedFieldMapping;
```

Sample flow:
1. Take up to `sampleUrls` (default 5) entries from filtered set
2. Fetch each page; extract JSON-LD (reuse JSON-LD extraction from JSON-LD Integration)
3. Score candidate types for feed relevance (NewsArticle, BlogPosting, Article rank high; WebPage ranks low)
4. Build consensus mapping from sample coverage
5. Return analysis result with `confidence` (0–1) and recommended flag

Extraction flow (per entry):
1. Fetch page HTML
2. Extract JSON-LD
3. Select best-matching type from `config.jsonLd.types` (or any if not specified)
4. Map fields via `config.jsonLd.mapping`
5. Apply fallback chain if `mode === "jsonLdWithFallback"` and field is missing

Fallback chain default order: `openGraph` → `htmlMeta` → `sitemap` → `url`

Individual page fetch failures produce a warning for that entry but do not abort the run.

---

## Backend: Page Metadata

### `utilities/page-metadata.utility.ts` (new)

```ts
export function extractPageMetadata(html: string, pageUrl: string): PageMetadata;
```

Extracts:
- `<title>` tag
- `<link rel="canonical">` href
- `<meta name="description">` content
- `<meta property="og:title">` content
- `<meta property="og:description">` content
- `<meta property="og:image">` content
- `<meta property="article:published_time">` content
- `<meta property="article:modified_time">` content
- JSON-LD `headline`, `datePublished`, `dateModified`, `image.url`, `author.name` if present (quick pass, not full mapping)

Used by both `pageMetadata` sitemap mode and as fallback in `jsonLdWithFallback` mode.

---

## Backend Routes

### `routes/sitemap.ts` (new)

```ts
POST /preview/sitemap
POST /source-assistant/sitemap
```

#### `POST /preview/sitemap`

Request body: `{ config: FeedConfig }` (feedType must be `"sitemap"`)

1. Parse sitemap using config
2. Apply filters and sort
3. For each entry in first `maxItems`: build preview item based on mode
4. For JSON-LD modes: fetch up to `sampleUrls` pages, apply mapping
5. Return `SitemapPreviewResponse`

#### `POST /source-assistant/sitemap`

Triggered from Source Assistant when analyzing a URL. Discovers sitemaps, parses stats, samples JSON-LD, returns `SitemapJsonLdAnalysisResult` plus discovery list.

---

## Sitemap State

State files at `./feed-state/sitemaps/{feedId}.json`.

State persists `firstSeenAt` for each URL (used as fallback date when `<lastmod>` is absent). On each worker run:
1. Load existing state (or start empty)
2. Compare current entries to previous state → compute new/modified/disappeared counts
3. Write updated state

State accumulates indefinitely (each URL first seen is stored). Cleanup is deferred until SQLite substrate lands.

---

## Worker Integration

Branch in `workers/feed-updater.worker.ts`:

```ts
if (feed.feedType === "sitemap") {
  const result = await fetchAndParseSitemap(feed.sitemap.url, {
    maxUrlsToScan: feed.sitemap.maxUrlsToScan,
    filters: feed.sitemap.filters,
    sortOrder: feed.sitemap.sortOrder,
  });
  const entries = result.entries.slice(0, feed.sitemap.maxItems);
  const feedObject =
    feed.sitemap.mode === "jsonLd" || feed.sitemap.mode === "jsonLdWithFallback"
      ? await buildFeedFromSitemapJsonLd(entries, feed)
      : buildFeedFromSitemapEntries(entries, feed, feed.sitemap);
  await writeAllFeedFormats(feed.feedName, feedObject);
}
```

---

## Feed Builder

Two new functions in `utilities/rss-builder.utility.ts` (or a new `utilities/sitemap-builder.utility.ts`):

```ts
export function buildFeedFromSitemapEntries(
  entries: SitemapEntry[],
  config: FeedConfig,
  options: SitemapFeedConfig,
): Feed;

export async function buildFeedFromSitemapJsonLd(
  entries: SitemapEntry[],
  config: FeedConfig,
): Promise<Feed>;
```

URL-list item mapping:
- `title`: derived from `loc` using `titleStrategy` (path segment, full URL, or hostname+path)
- `link`: `loc`
- `guid`: `loc`
- `pubDate`: `lastmod` → `firstSeenAt` → current run (per `dateStrategy`)
- `description`: brief sitemap metadata summary

Fallback date precedence for `jsonLdOrLastmodOrFirstSeen`:
1. JSON-LD `datePublished`
2. JSON-LD `dateModified`
3. `article:published_time` meta
4. `article:modified_time` meta
5. Sitemap `<lastmod>`
6. `firstSeenAt` from state
7. Current run time

---

## Frontend

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this section.**

### `SitemapForm.tsx`

Sections:
1. **Sitemap Source** — radio: exact URL vs. discover from website; URL input; "Analyze Sitemap" button
2. **Discovered Sitemaps** (discovery mode only) — checkboxes for found sitemaps
3. **URL Filters** — include/exclude pattern list; keyword or regex toggle
4. **Feed Mode** — radio: URLs from sitemap / Enriched page metadata / Sitemap Drill Chain + JSON-LD / With fallback / Page content changes (disabled, "coming later")
5. **Sitemap Drill Chain + JSON-LD** (when jsonLd/jsonLdWithFallback selected) — type checkboxes, sample count, max pages, concurrency, timeout, "Analyze sampled URLs" button, sample results, mapping editor (reuse JSON-LD mapping editor from JSON-LD Integration), path browser, raw JSON-LD viewer
6. **Sorting & Limits** — sort order dropdown, max feed items, max URLs to scan
7. **Date Strategy** — dropdown
8. **Preview** — table: URL, lastmod, included/excluded, output title, JSON-LD found
9. **Save**

---

## Source Assistant Integration

When Source Assistant analyzes a website URL:
1. Call `discoverSitemaps(url)`
2. Parse stats from discovered sitemaps
3. Filter likely item URLs (exclude tag/category/author/page patterns)
4. Sample up to 5 sitemap URLs for JSON-LD analysis
5. Score result → `recommended: true` if `confidence >= 0.6`
6. Return recommendation with mode suggestion (`urlList`, `pageMetadata`, or `jsonLd`)
7. Hydrate `SitemapForm` with starter config on "Use this" click

Recommended ranking for HTML website sources:
```
Existing Feed
Sitemap Drill Chain + JSON-LD   ← this
Sitemap + Page Metadata
Sitemap URL List
Web Scraping Drill Chain + JSON-LD
Web Scraping CSS selectors
Change Detection
```

---

## Validation Rules

Validated before save and before worker run:

| Rule | Behavior |
|---|---|
| `sitemap.url` required | Error |
| `maxItems` must be 1–1000 | Error |
| `maxUrlsToScan` must be 1–10000 | Error |
| Include/exclude regex must compile | Error |
| `jsonLd.mapping` required when mode is jsonLd/jsonLdWithFallback | Error |
| `jsonLd.fetch.maxPages` must be 1–500 | Error |
| `jsonLd.fetch.concurrency` must be 1–20 | Error |
| `jsonLd.fetch.timeoutMs` must be 1000–60000 | Error |
| No include filters on large sitemap (>500 URLs) | Warning |
| No date field mapped | Warning |
| No fallback for jsonLd mode | Warning |
| Sampled pages have inconsistent JSON-LD | Warning |

---

## Testing

**Fixtures:**
- `tests/fixtures/sitemaps/basic-urlset.xml`
- `tests/fixtures/sitemaps/sitemap-index.xml`
- `tests/fixtures/sitemaps/no-lastmod.xml`
- `tests/fixtures/sitemaps/duplicate-urls.xml`
- `tests/fixtures/sitemaps/invalid.xml`
- `tests/fixtures/sitemaps/urlset.xml.gz`
- `tests/fixtures/sitemaps/robots.txt`
- `tests/fixtures/sitemap-pages/newsarticle-1.html`
- `tests/fixtures/sitemap-pages/newsarticle-2.html`
- `tests/fixtures/sitemap-pages/webpage-only.html`
- `tests/fixtures/sitemap-pages/malformed-jsonld.html`

**`tests/sitemap.test.ts`**

Parser:
- Parses urlset with loc, lastmod, changefreq, priority
- Parses sitemapindex and fetches child sitemaps
- Handles child fetch failure gracefully
- Deduplicates URLs
- Applies include regex filter
- Applies exclude keyword filter
- Sorts by lastmodDesc
- Enforces maxUrlsToScan
- Returns warnings for empty sitemap and missing lastmod
- Decompresses gzip sitemap

JSON-LD:
- Samples sitemap URLs
- Extracts JSON-LD from sampled URLs
- Detects NewsArticle on sitemap-linked pages
- Scores WebPage-only samples lower
- Builds mapping from samples
- Uses Open Graph fallback when JSON-LD description is missing
- Uses sitemap lastmod when JSON-LD date is missing
- Does not crash on malformed JSON-LD

Feed builder:
- URL-list: loc → link + guid, lastmod → pubDate
- URL-list: firstSeen fallback when lastmod absent
- URL-list: path title strategy
- JSON-LD: headline → title, datePublished → pubDate, image → enclosure
- Fallback order applied correctly
- RSS/Atom/JSON Feed outputs are valid

Page metadata:
- Extracts title, description, canonicalUrl, image, publishedTime from HTML
- Extracts og:title, og:description, og:image
- Returns empty fields when absent (no crash)

Worker:
- Sitemap feed writes RSS/Atom/JSON outputs
- Invalid sitemap URL returns useful error
- Filters excluding all URLs produce warning
- Sitemap index with one failed child still emits from successful child
- JSON-LD mode fetches pages with concurrency limit
- JSON-LD mode records page failures as warnings
- Fallback mode emits items when JSON-LD is incomplete

---

## Acceptance Criteria

- `feedType: sitemap` is recognized by the system
- User can select Sitemap in the builder
- User can enter an exact sitemap URL or discover from a website URL
- Mkfd parses urlset and sitemapindex files
- Mkfd follows child sitemaps
- URL filters by keyword and regex work
- URL-list mode generates valid RSS/Atom/JSON Feed
- Items use `lastmod` as date (with `firstSeenAt` fallback)
- JSON-LD mode fetches sitemap pages and extracts JSON-LD
- JSON-LD with fallback fills missing fields from Open Graph/HTML meta/sitemap/URL
- Preview shows matched URLs and output items
- Worker refreshes sitemap feeds on schedule
- Individual page fetch failures produce warnings, not crashes
- Source Assistant recommends Sitemap Drill Chain + JSON-LD when appropriate

---

## Design Decisions

### 1. Should change detection mode be in the MVP?

**Options:**
- A. Defer change detection to post-MVP (just include the config shape)
- B. Include change detection in MVP (hashing + emit-on-change)
- C. Include change detection in MVP but without diff output

**Chosen: A.** Change detection requires persistent hash state that benefits from the SQLite Runtime Substrate. Including it before SQLite is available means two state implementations (JSON → SQLite migration). The config shape is defined here so the feature slot exists; the worker branch will return a "not yet implemented" error for `changeDetection` mode until the follow-on work lands.

---

### 2. Should state storage be JSON files or wait for SQLite?

**Options:**
- A. JSON files at `./feed-state/sitemaps/{feedId}.json` now; migrate to SQLite later
- B. Skip state until SQLite substrate is implemented
- C. Use SQLite even before the substrate plan is implemented

**Chosen: A.** First-seen dates are critical for date stability when `<lastmod>` is absent. Without state, every URL appears newly discovered on each run. JSON files are simple and sufficient until SQLite lands. The state file format mirrors the SQLite schema design so migration is mechanical.

---

### 3. Should `page-metadata.utility.ts` be shared or sitemap-specific?

**Options:**
- A. Shared utility — usable by sitemap, web scraping fallback, and future features
- B. Inline the logic in `sitemap-json-ld.utility.ts`

**Chosen: A.** Page metadata extraction (Open Graph, HTML meta, canonical URL) is useful beyond sitemaps — web scraping fallback enrichment, Existing Feed Transformer, and Source Assistant all benefit from it. A shared utility with a clean interface (`extractPageMetadata(html, pageUrl): PageMetadata`) costs nothing extra and avoids duplication.

---

### 4. Should we add a sitemap-specific `FeedType` or reuse `webScraping` with a flag?

**Options:**
- A. New `feedType: "sitemap"` — its own builder form, worker branch, config block
- B. Flag inside `webScraping` config: `source: "sitemap"`
- C. New feed type but share the web scraping builder with a conditional section

**Chosen: A.** Sitemaps have a fundamentally different source model from web scraping. A dedicated feed type gives the feature a clean config block, its own validation, its own builder UI, and clear worker routing. Using a flag inside `webScraping` would complicate every existing web scraping codepath and produce confusing UX.

---

### 5. Should Source Assistant sitemap analysis be blocking or async?

**Options:**
- A. Async analysis via a dedicated `POST /source-assistant/sitemap` endpoint — Source Assistant calls it; UI shows progressive results
- B. Inline in the main Source Assistant analysis — one blocking call
- C. Always run sitemap discovery as part of Source Assistant but skip JSON-LD sampling unless the user requests it

**Chosen: C.** Discovery is fast (robots.txt + probe 7 paths). Always do it. JSON-LD sampling requires fetching 5 pages (slower). Run it automatically for discovered sitemaps, but the Source Assistant analysis returns a progress stream anyway. The sitemap discovery result can arrive quickly while JSON-LD sampling completes in the background.
