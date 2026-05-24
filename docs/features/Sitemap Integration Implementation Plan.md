## Goal

Add Sitemap integration and Sitemap feeds to Mkfd as a first-class feed source.

The goal should be bigger than “parse sitemap.xml.” Sitemaps should become:

> A first-class feed source, a source discovery tool, and a reliability layer for page-monitoring, structured extraction, and feed repair.

Sitemaps are valuable because they provide a website-maintained URL inventory. Each sitemap entry has a required `<loc>` URL and may include metadata such as `<lastmod>`, `<changefreq>`, and `<priority>`.

Mkfd should use sitemaps to:

- generate simple feeds from sitemap URLs
- discover useful source URLs from a website
- fetch sitemap-linked pages and extract metadata
- fetch sitemap-linked pages and extract JSON-LD
- use sitemap URLs as a Drill Chain source
- power future change detection
- improve Source Assistant recommendations
- provide a more stable alternative to fragile listing-page scraping

The key mental model:

```text
Web Scraping Drill Chain:
  listing page selector -> detail page URL -> extraction

Sitemap Drill Chain:
  sitemap loc -> detail page URL -> extraction
````

For many sites, the best Mkfd route will be:

```text
Sitemap for URL inventory
JSON-LD for detail-page extraction
Open Graph, HTML meta, sitemap data, and URL-derived values for fallback
RSS, Atom, and JSON Feed for output
```

---

## 1. MVP scope

The first release should support:

```text
1. Enter exact sitemap URL.
2. Discover sitemap URLs from a website URL.
3. Parse sitemap urlset files.
4. Parse sitemap index files.
5. Follow child sitemaps.
6. Support gzip-compressed sitemaps.
7. Filter URLs by include/exclude patterns.
8. Preview matching URLs.
9. Generate feed items from matching sitemap entries.
10. Refresh sitemap feeds on interval.
11. Use <lastmod> as the default item date when available.
12. Optionally fetch sitemap URLs for page metadata enrichment.
13. Optionally fetch sitemap URLs for JSON-LD extraction.
14. Support Sitemap Drill Chain + JSON-LD as a first-class feed mode.
```

Delay these until core sitemap feeds work:

```text
full change detection
diff summaries
sitemap-assisted selector repair
sitemap-backed catalog templates
AI summaries
deep crawling beyond sitemap URLs
authenticated sitemap sources
advanced JSON-LD semantic expansion
remote JSON-LD context fetching
```

---

## 2. Feed type

Add `sitemap` as a first-class feed type.

```ts
export type FeedType =
  | "webScraping"
  | "api"
  | "rest"
  | "graphql"
  | "email"
  | "calendar"
  | "sitemap"
  | "filesystem"
  | "webhook"
  | "serviceConnector"
  | "existingFeed"
  | "changeDetection";
```

Sitemap should have its own builder form. It should not be buried inside Web Scraping because its source model is different.

Recommended source tabs:

```text
Web Scraping | REST API | Email | Calendar | Sitemap | GraphQL
```

Sitemap feeds need controls for:

```text
sitemap URL
discovery mode
URL filters
feed mode
date strategy
sort order
max URLs
page metadata enrichment
JSON-LD extraction
change detection
```

---

## 3. Sitemap modes

Add these sitemap modes:

```ts
export type SitemapMode =
  | "urlList"
  | "pageMetadata"
  | "jsonLd"
  | "jsonLdWithFallback"
  | "changeDetection";
```

### URL list mode

Each sitemap URL becomes one feed item.

|Feed field|Source|
|---|---|
|title|URL path or hostname + path|
|link|sitemap `<loc>`|
|guid|sitemap `<loc>`|
|pubDate|sitemap `<lastmod>` or first-seen date|
|description|sitemap metadata summary|

Example output:

```xml
<item>
  <title>/news/city-council-agenda</title>
  <link>https://example.gov/news/city-council-agenda</link>
  <guid>https://example.gov/news/city-council-agenda</guid>
  <pubDate>Fri, 15 May 2026 12:00:00 GMT</pubDate>
  <description>Discovered from sitemap. Last modified: 2026-05-15.</description>
</item>
```

This should be the fastest sitemap mode and the simplest fallback.

### Page metadata mode

The sitemap provides URLs. Mkfd fetches each page and extracts common metadata:

```text
<title>
canonical URL
meta description
Open Graph title
Open Graph description
Open Graph image
article published time
article modified time
basic JSON-LD headline/date/image if present
```

This produces better items than URL-list mode without requiring the user to map JSON-LD manually.

### JSON-LD mode

The sitemap provides URLs. Mkfd fetches each URL and extracts JSON-LD from the linked page.

This is the sitemap equivalent of Drill Chain + JSON-LD:

```text
sitemap URL inventory
  -> filter likely item/detail URLs
  -> fetch each URL
  -> parse JSON-LD
  -> map JSON-LD fields to feed fields
  -> emit feed items
```

This mode is important because sitemap URLs often point directly to detail pages, and detail pages are where JSON-LD is usually most useful.

### JSON-LD with fallback mode

Same as JSON-LD mode, but missing JSON-LD fields can be filled from:

```text
Open Graph
HTML meta
sitemap metadata
URL-derived values
```

Default fallback order:

```text
JSON-LD
Open Graph
HTML meta
sitemap metadata
URL-derived fallback
```

### Change detection mode

The sitemap provides URL inventory. Mkfd stores hashes of normalized page content and emits a feed item when content changes.

This should come after sitemap state and feed health tracking are in place.

---

## 4. Config shape

Use a nested `sitemap` block.

```yaml
feedType: sitemap
feedName: city-notices
refreshTime: 60

sitemap:
  inputMode: exact
  url: https://example.gov/sitemap.xml
  mode: urlList
  maxItems: 50
  maxUrlsToScan: 500
  sortOrder: lastmodDesc
  dateStrategy: lastmodOrFirstSeen
  titleStrategy: path
  descriptionStrategy: sitemapMetadata

  filters:
    include:
      - type: regex
        field: loc
        value: "/news|/notices|/agendas"
    exclude:
      - type: regex
        field: loc
        value: "/tag/|/category/|/author/"

  pageMetadata:
    enabled: false
    fetchMode: standard
    timeoutMs: 10000
    concurrency: 5

  jsonLd:
    enabled: false

  changeDetection:
    enabled: false
```

---

## 5. Sitemap Drill Chain + JSON-LD config

For JSON-LD mode:

```yaml
feedType: sitemap
feedName: city-news-jsonld
refreshTime: 60

sitemap:
  inputMode: exact
  url: https://example.gov/sitemap.xml
  mode: jsonLd
  maxItems: 50
  maxUrlsToScan: 500
  sortOrder: lastmodDesc
  dateStrategy: jsonLdOrLastmodOrFirstSeen
  titleStrategy: bestAvailable
  descriptionStrategy: bestAvailable

  filters:
    include:
      - type: regex
        field: loc
        value: "/news|/press-releases|/notices"
    exclude:
      - type: regex
        field: loc
        value: "/tag/|/category/|/author/"

  jsonLd:
    enabled: true
    scope: sitemapUrls
    sampleUrls: 5
    fetch:
      mode: standard
      timeoutMs: 15000
      concurrency: 3
      maxPages: 50
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
```

For JSON-LD with fallback:

```yaml
feedType: sitemap
feedName: city-news-jsonld-fallback
refreshTime: 60

sitemap:
  inputMode: exact
  url: https://example.gov/sitemap.xml
  mode: jsonLdWithFallback
  maxItems: 50
  maxUrlsToScan: 500
  sortOrder: lastmodDesc
  dateStrategy: jsonLdOrLastmodOrFirstSeen
  titleStrategy: bestAvailable
  descriptionStrategy: bestAvailable

  filters:
    include:
      - type: regex
        field: loc
        value: "/news|/press-releases|/notices"
    exclude:
      - type: regex
        field: loc
        value: "/tag/|/category/|/author/"

  jsonLd:
    enabled: true
    scope: sitemapUrls
    sampleUrls: 5
    fetch:
      mode: standard
      timeoutMs: 15000
      concurrency: 3
      maxPages: 50
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
    fallback:
      enabled: true
      order:
        - openGraph
        - htmlMeta
        - sitemap
        - url
```

In the GUI, label this mode:

```text
Sitemap Drill Chain + JSON-LD
```

Explanation text:

```text
Mkfd will use sitemap URLs as the Drill Chain, fetch each page, and extract JSON-LD from the detail page.
```

---

## 6. Shared type definitions

Create or extend sitemap model definitions.

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
  fetch: SitemapJsonLdFetchConfig;
  types?: string[];
  mapping: JsonLdFeedFieldMapping;
  fallback?: SitemapJsonLdFallbackConfig;
};

export type SitemapJsonLdFetchConfig = {
  mode: "standard" | "advanced";
  timeoutMs: number;
  concurrency: number;
  maxPages: number;
};

export type SitemapJsonLdFallbackConfig = {
  enabled: boolean;
  order: Array<"openGraph" | "htmlMeta" | "sitemap" | "url">;
};

export type SitemapChangeDetectionConfig = {
  enabled: boolean;
  target: "fullPage" | "mainContent" | "selector";
  selector?: string;
  emitOn: "contentHashChanged";
  includeDiff: boolean;
  ignoreSelectors?: string[];
};
```

Reuse the JSON-LD field mapping type from the Web Scraping JSON-LD plan:

```ts
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

---

## 7. Drill Chain abstraction

Sitemap and Web Scraping can share an internal Drill Chain concept, but they use different discovery sources.

```ts
export type DrillChainSource =
  | {
      type: "selector";
      selector: string;
      attribute?: string;
      isRelative?: boolean;
      baseUrl?: string;
    }
  | {
      type: "sitemap";
      sitemapUrl: string;
      filters?: SitemapFeedConfig["filters"];
    };
```

For sitemap feeds, the Drill Chain source is the parsed sitemap entries:

```text
sitemap loc -> detail URL -> JSON-LD extraction
```

No CSS selector is needed because `<loc>` is already the detail URL.

---

## 8. Sitemap form layout

Create:

```text
frontend/src/components/forms/SitemapForm.tsx
```

Recommended sections:

```text
Sitemap Source
Sitemap Analysis
URL Filters
Feed Mode
Sitemap Drill Chain + JSON-LD
Page Metadata Fallback
Sorting and Limits
Preview
Save
```

### Sitemap Source

```text
Sitemap source

( ) Exact sitemap URL
( ) Discover from website URL

URL
[ https://example.com/sitemap.xml ]

[ Analyze Sitemap ]
```

### Discovered sitemaps

For discovery mode:

```text
Found sitemaps

[x] https://example.com/sitemap.xml
[ ] https://example.com/post-sitemap.xml
[ ] https://example.com/page-sitemap.xml
[ ] https://example.com/category-sitemap.xml
```

### URL filters

```text
Include URL patterns
[ /news/ ]
[ /blog/ ]

Exclude URL patterns
[ /tag/ ]
[ /author/ ]
[ /category/ ]
```

Support keyword first, regex second.

### Feed Mode

```text
What should this feed contain?

( ) URLs from sitemap
( ) Enriched page metadata
(•) Sitemap Drill Chain + JSON-LD
( ) Sitemap Drill Chain + JSON-LD with fallback
( ) Page content changes
```

Disable unavailable modes until implemented:

```text
Page content changes - coming later
```

### Sorting and limits

```text
Sort by
[ Last modified newest first ]

Max feed items
[ 50 ]

Max sitemap URLs to scan
[ 500 ]
```

### Date strategy

```text
Date strategy
[ JSON-LD date, sitemap lastmod, otherwise first seen ]
[ Sitemap lastmod, otherwise first seen ]
[ First seen by Mkfd ]
[ Current run time ]
```

---

## 9. Sitemap Drill Chain + JSON-LD GUI

When selected, show:

```text
Sitemap Drill Chain + JSON-LD

Mkfd will use sitemap URLs as the Drill Chain, fetch each page, and extract JSON-LD from the detail page.

JSON-LD types
[x] NewsArticle
[x] BlogPosting
[x] Article
[ ] Event
[ ] VideoObject
[ ] Product
[ ] JobPosting

Sample URLs for analysis
[ 5 ]

Max pages per refresh
[ 50 ]

Concurrency
[ 3 ]

Timeout
[ 15000 ]

[Analyze sampled sitemap URLs]
```

### Sample results

```text
Sampled sitemap URLs

✓ https://example.gov/news/article-1
  Found: NewsArticle
  Fields: headline, description, datePublished, author.name, image.url, url

✓ https://example.gov/news/article-2
  Found: NewsArticle
  Fields: headline, description, datePublished, author.name, image.url, url

⚠ https://example.gov/news/article-3
  Found: WebPage only
  Warning: No feed-relevant JSON-LD found
```

### Mapping editor

Reuse the same JSON-LD mapping editor from Web Scraping.

```text
JSON-LD mapping from sitemap URLs

Detected type:
NewsArticle

Feed field       JSON-LD path              Preview
Title            [ headline ▼ ]            City Council Approves Budget
Description      [ description ▼ ]         The council voted...
Link             [ url ▼ ]                 https://example.gov/news/budget
Date             [ datePublished ▼ ]       2026-05-17T10:00:00Z
Author           [ author.name ▼ ]         Jane Doe
Enclosure        [ image.url ▼ ]           https://example.gov/image.jpg
GUID             [ @id ▼ ]                 https://example.gov/news/budget
Categories       [ articleSection ▼ ]      Local Government
```

### Path browser

Reuse the JSON-LD path browser.

```text
Available JSON-LD paths

Preview sample:
[ URL 1 ▼ ]

headline
description
datePublished
dateModified
author.name
publisher.name
image.url
mainEntityOfPage.@id
articleSection
keywords.0
keywords.1
```

### Raw JSON-LD viewer

Collapsed by default:

```text
[View raw JSON-LD from sampled sitemap URLs]
```

---

## 10. Fallback behavior

For Sitemap Drill Chain + JSON-LD with fallback, use fallback sources in this order by default:

```text
JSON-LD
Open Graph
HTML meta
sitemap metadata
URL-derived fallback
```

### Title fallback

```text
1. JSON-LD headline/name
2. og:title
3. <title>
4. URL path
```

### Description fallback

```text
1. JSON-LD description
2. og:description
3. meta[name=description]
4. sitemap metadata summary
5. none
```

### Date fallback

```text
1. JSON-LD datePublished
2. JSON-LD dateModified
3. article:published_time
4. article:modified_time
5. sitemap <lastmod>
6. first seen
7. current run
```

### Image fallback

```text
1. JSON-LD image
2. og:image
3. first article image later
```

### Link fallback

```text
1. JSON-LD url
2. canonical URL
3. sitemap loc
```

### GUID fallback

```text
1. JSON-LD @id
2. JSON-LD url
3. canonical URL
4. sitemap loc
```

---

## 11. Sitemap parser utility

Create:

```text
utilities/sitemap.utility.ts
```

Responsibilities:

```text
detect sitemap type
parse urlset
parse sitemapindex
fetch child sitemaps
support gzip-compressed sitemaps
discover sitemaps from robots.txt
dedupe URLs
normalize entries
apply filters
sort entries
return stats and warnings
```

Internal models:

```ts
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
```

Utility API:

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

Discovery should check:

```text
/robots.txt
/sitemap.xml
/sitemap_index.xml
/sitemap-index.xml
/wp-sitemap.xml
/post-sitemap.xml
/page-sitemap.xml
```

---

## 12. Sitemap JSON-LD utility

Create:

```text
utilities/sitemap-json-ld.utility.ts
```

Responsibilities:

```text
sample sitemap URLs
fetch sampled pages
run JSON-LD analysis
compare mappings across sampled URLs
recommend JSON-LD mode or fallback mode
extract feed items from sitemap URLs using JSON-LD
```

Functions:

```ts
export async function analyzeSitemapJsonLd(
  entries: SitemapEntry[],
  config: SitemapFeedConfig,
): Promise<SitemapJsonLdAnalysisResult>;

export async function extractFeedItemsFromSitemapJsonLd(
  entries: SitemapEntry[],
  feedConfig: SitemapFeedConfig,
): Promise<NormalizedFeedItem[]>;

export function compareSitemapJsonLdSamples(
  samples: SitemapJsonLdSample[],
): JsonLdFeedFieldMapping;
```

Models:

```ts
export type SitemapJsonLdAnalysisResult = {
  found: boolean;
  recommended: boolean;
  confidence: number;
  summary: string;
  samples: SitemapJsonLdSample[];
  mapping: JsonLdFeedFieldMapping;
  types: string[];
  missingFields: string[];
  warnings: SourceAssistantWarning[];
};

export type SitemapJsonLdSample = {
  loc: string;
  status?: number;
  success: boolean;
  jsonLdFound: boolean;
  candidateTypes: string[];
  availablePaths: JsonLdAvailablePath[];
  mappingCoverage: JsonLdFeedFieldCoverage;
  warnings: SourceAssistantWarning[];
};
```

---

## 13. Page metadata utility

Create:

```text
utilities/page-metadata.utility.ts
```

Extract:

```text
<title>
canonical URL
meta[name=description]
meta[property=og:title]
meta[property=og:description]
meta[property=og:image]
meta[property=article:published_time]
meta[property=article:modified_time]
JSON-LD headline/datePublished/dateModified/image/author when available
```

Functions:

```ts
export function extractPageMetadata(
  html: string,
  pageUrl: string,
): PageMetadata;

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
```

Page metadata should be usable both by:

```text
pageMetadata sitemap mode
jsonLdWithFallback sitemap mode
future web scraping fallback enrichment
```

---

## 14. Preview endpoint

Add a sitemap-specific preview endpoint.

```text
POST /preview/sitemap
```

Response:

```ts
export type SitemapPreviewResponse = {
  entries: SitemapEntryPreview[];
  warnings: string[];
  stats: SitemapParseResult["stats"];
  rssXml?: string;
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
    warnings: SourceAssistantWarning[];
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
```

Preview UI should show both raw sitemap matching and output item preview.

```text
Matched 87 URLs
Showing first 50 feed items

| Lastmod | URL | JSON-LD | Output title | Included | Reason |
|---|---|---|---|---|---|
```

For JSON-LD mode, preview should show field source attribution:

```text
Title: City Council Approves Budget
Source: JSON-LD headline

Date: 2026-05-17
Source: JSON-LD datePublished

Description: The council voted...
Source: Open Graph fallback
```

---

## 15. Feed builder path

Do not force sitemap data through the web scraping builder.

Add sitemap-specific feed item generation.

In:

```text
utilities/rss-builder.utility.ts
```

Add:

```ts
export function buildFeedFromSitemapEntries(
  entries: SitemapEntry[],
  config: FeedConfig,
  options: SitemapBuildOptions,
): Feed;

export async function buildFeedFromSitemapJsonLd(
  entries: SitemapEntry[],
  config: FeedConfig,
): Promise<Feed>;
```

URL-list mapping:

```ts
function sitemapEntryToFeedItem(entry: SitemapEntry, config: SitemapFeedConfig) {
  const url = entry.loc;
  const title = titleFromUrl(url, config.titleStrategy);
  const date = dateFromSitemapEntry(entry, config.dateStrategy);

  return {
    title,
    id: url,
    link: url,
    date,
    description: buildSitemapDescription(entry),
  };
}
```

JSON-LD mapping:

```text
fetch sitemap URL page
parse JSON-LD
select matching JSON-LD type
map configured JSON-LD paths
apply fallback if enabled
build normalized item
```

The builder should output a `Feed` object so the shared output writer can serialize:

```text
RSS 2.0
Atom
JSON Feed
```

---

## 16. Worker support

Update:

```text
workers/feed-updater.worker.ts
```

Add a sitemap branch:

```ts
if (feed.feedType === "sitemap") {
  const result = await fetchAndParseSitemap(feed.sitemap.url, {
    maxUrlsToScan: feed.sitemap.maxUrlsToScan,
    filters: feed.sitemap.filters,
    sortOrder: feed.sitemap.sortOrder,
  });

  const entries = result.entries.slice(0, feed.sitemap.maxItems);

  const feedObject =
    feed.sitemap.mode === "jsonLd" ||
    feed.sitemap.mode === "jsonLdWithFallback"
      ? await buildFeedFromSitemapJsonLd(entries, feed)
      : buildFeedFromSitemapEntries(entries, feed, feed.sitemap);

  await writeAllFeedFormats(feed.feedName, feedObject);

  postRunStats({
    feedId: feed.feedId,
    totalUrls: result.stats.totalUrls,
    urlsAfterFilters: result.stats.urlsAfterFilters,
    emittedItems: entries.length,
    warnings: result.warnings,
  });
}
```

Worker warnings should include:

```text
sitemap fetch failed
sitemap XML invalid
sitemap index child failed
no URLs found
filters excluded all URLs
no <lastmod> values found
all <lastmod> values are identical
sitemap exceeds configured scan limit
duplicate URLs removed
JSON-LD not found on sampled URLs
JSON-LD mapping failed for some URLs
page metadata fallback used
individual page fetch failed
```

---

## 17. Sitemap state

Sitemap feeds benefit from persistent state.

If SQLite is available, store sitemap state there. If not, use JSON initially.

JSON fallback:

```text
./feed-state/sitemaps/{feedId}.json
```

Shape:

```ts
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
```

State enables:

```text
first-seen date fallback
new URL count
disappeared URL count
modified URL count
JSON-LD change tracking
page fetch diagnostics
change detection later
health dashboard metrics
```

---

## 18. Source Assistant integration

Source Assistant should detect and recommend sitemap routes.

When analyzing a website URL, it should:

```text
discover sitemaps
parse sitemap stats
filter likely item URLs
sample sitemap URLs
run JSON-LD analysis on sampled sitemap pages
determine whether Sitemap URL List, Sitemap + Page Metadata, or Sitemap Drill Chain + JSON-LD is best
compare sitemap route quality against web scraping route quality
hydrate Sitemap builder with a starter config
```

Source Assistant recommendation example:

```text
Sitemap Feed
88% · Good option

Recommended setup:
Sitemap Drill Chain + JSON-LD

Why:
- Found sitemap with 1,284 URLs.
- 342 URLs match article-like paths.
- Sampled sitemap URLs contain NewsArticle JSON-LD.
- JSON-LD includes title, date, author, image, and canonical URL.
```

If a sitemap exists and sitemap URL samples contain rich JSON-LD, this should usually outrank Web Scraping because the sitemap provides a more reliable URL inventory than listing-page selectors.

Recommended ranking for HTML website sources:

```text
Existing Feed
Sitemap Drill Chain + JSON-LD
Sitemap + Page Metadata
Sitemap URL List
Web Scraping Drill Chain + JSON-LD
Web Scraping CSS selectors
Change Detection
Manual
```

---

## 19. Change detection mode

After sitemap state and health stats are in place, add change detection.

Pipeline:

```text
fetch sitemap
apply filters
select URLs
fetch pages
extract content target
normalize content
hash normalized content
compare to previous hash
emit item if changed
persist new hash
```

Content targets:

```text
fullPageText
mainContent
cssSelector
xpath later
```

RSS item for changed page:

```text
Title:
Page changed: {page title or URL path}

Link:
URL

Date:
change detection time

Description:
Content changed since the previous check.
```

Later additions:

```text
textual diff
changed snippets
AI summary
```

---

## 20. Health dashboard integration

Sitemap feeds should produce rich operational stats.

```ts
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
```

Dashboard card example:

```text
City Notices
Status: Healthy
Mode: Sitemap Drill Chain + JSON-LD
URLs found: 1,284
Matched filters: 87
Pages fetched: 50
JSON-LD found: 46
Fallback used: 4
Items emitted: 50
Last success: 2026-05-15 11:20
Warnings: 2
```

---

## 21. Validation rules

Validate sitemap configs before save and before worker execution.

General sitemap validation:

```text
sitemap.url is required
maxItems must be bounded
maxUrlsToScan must be bounded
sortOrder must be valid
dateStrategy must be valid
include/exclude regex rules must compile
```

JSON-LD sitemap validation:

```text
jsonLd.enabled must be true for jsonLd modes
jsonLd.mapping is required
jsonLd.fetch.maxPages must be bounded
jsonLd.fetch.concurrency must be bounded
jsonLd.fetch.timeoutMs must be bounded
at least title and link or guid should be mapped
fallback order must only include supported sources
```

Warnings:

```text
No include filters are set for a large sitemap.
No date field is mapped.
No fallback is configured for JSON-LD mode.
Sitemap lastmod values are missing.
Sitemap lastmod values are identical.
Sampled pages have inconsistent JSON-LD.
Sampled pages only contain WebPage/WebSite/Organization JSON-LD.
```

---

## 22. Tests

### Fixtures

```text
tests/fixtures/sitemaps/basic-urlset.xml
tests/fixtures/sitemaps/sitemap-index.xml
tests/fixtures/sitemaps/no-lastmod.xml
tests/fixtures/sitemaps/duplicate-urls.xml
tests/fixtures/sitemaps/invalid.xml
tests/fixtures/sitemaps/large-sitemap-sample.xml
tests/fixtures/sitemaps/urlset.xml.gz
tests/fixtures/sitemaps/robots.txt
tests/fixtures/sitemap-pages/newsarticle-1.html
tests/fixtures/sitemap-pages/newsarticle-2.html
tests/fixtures/sitemap-pages/webpage-only.html
tests/fixtures/sitemap-pages/malformed-jsonld.html
```

### Parser tests

```text
parses urlset
parses loc
parses lastmod
parses changefreq
parses priority
parses sitemapindex
fetches child sitemaps
handles child fetch failure
dedupes URLs
applies include filters
applies exclude filters
sorts by lastmod desc
enforces maxUrlsToScan
returns warnings for empty sitemap
returns warnings for missing lastmod
```

### JSON-LD sitemap tests

```text
samples sitemap URLs
extracts JSON-LD from sampled URLs
detects NewsArticle on sitemap-linked pages
scores consistent JSON-LD samples highly
scores WebPage-only samples lower
builds JSON-LD mapping from samples
uses Open Graph fallback when JSON-LD description is missing
uses sitemap lastmod when JSON-LD date is missing
uses sitemap loc when JSON-LD link is missing
does not crash on malformed JSON-LD
```

### Feed builder tests

```text
sitemap entry becomes feed item
loc becomes link
loc becomes guid
lastmod becomes pubDate
first seen fallback works
URL path title strategy works
JSON-LD headline becomes title
JSON-LD datePublished becomes pubDate
JSON-LD image becomes enclosure
fallback order works
RSS output remains valid
Atom output remains valid
JSON Feed output remains valid
```

### Worker tests

```text
sitemap feed writes RSS/Atom/JSON outputs
invalid sitemap returns useful error
filters excluding all URLs produce warning
sitemap index with one failed child still emits from successful child
JSON-LD mode fetches pages with concurrency limit
JSON-LD mode records page failures
fallback mode emits items when JSON-LD is incomplete
```

---

## 23. Implementation phases

### Phase 1: Sitemap parser and discovery

```text
Add sitemap.utility.ts.
Parse urlset.
Parse sitemapindex.
Discover sitemaps from robots.txt.
Probe common sitemap paths.
Support gzip sitemap files.
Normalize sitemap entries.
Deduplicate URLs.
Apply filters.
Sort entries.
Return warnings and stats.
Add parser tests.
```

### Phase 2: Sitemap URL-list feeds

```text
Add feedType: sitemap.
Add SitemapForm.tsx.
Add sitemap config model.
Add preview support.
Add worker support.
Add buildFeedFromSitemapEntries.
Write RSS/Atom/JSON Feed outputs.
Add README docs.
```

### Phase 3: Sitemap state and health stats

```text
Track first-seen and last-seen timestamps.
Track new URL count.
Track modified URL count.
Track disappeared URL count.
Track duplicate URL count.
Track failed child sitemap count.
Surface warnings in logs or UI.
Prepare for SQLite runtime state.
```

### Phase 4: Sitemap Drill Chain + JSON-LD

```text
Add sitemap-json-ld.utility.ts.
Sample sitemap URLs.
Analyze JSON-LD on sampled pages.
Compare field mapping consistency.
Suggest JSON-LD mappings.
Add Sitemap Drill Chain + JSON-LD mode.
Add Sitemap Drill Chain + JSON-LD with fallback mode.
Add mapping editor.
Add path browser.
Add raw JSON-LD viewer.
Add JSON-LD preview diagnostics.
Add JSON-LD feed builder path.
```

### Phase 5: Page metadata fallback and enrichment

```text
Add page-metadata.utility.ts.
Extract Open Graph fields.
Extract HTML meta fields.
Extract canonical URL.
Extract image enclosure.
Extract article published/modified meta fields.
Use page metadata as fallback for JSON-LD mode.
Support pageMetadata mode directly.
```

### Phase 6: Change detection mode

```text
Add content normalization.
Add content hashing.
Track previous content hashes.
Emit item on hash change.
Add basic changed-page feed item.
Support ignored selectors.
Add optional simple diff later.
```

### Phase 7: Source Assistant integration

```text
Discover sitemap during source analysis.
Parse sitemap stats.
Sample sitemap URLs for JSON-LD.
Recommend Sitemap Drill Chain + JSON-LD when appropriate.
Compare sitemap route against web scraping route.
Hydrate Sitemap builder from Source Assistant.
Avoid duplicate analysis when opening Sitemap builder from Source Assistant.
```

---

## 24. README update

Add:

```md
## 🗺️ Sitemap Feeds

Mkfd can generate feeds from XML sitemaps. This is useful for websites that do not provide RSS, documentation sites, public notices, changelogs, government pages, and other sources where new or modified pages are listed in a sitemap.

Sitemap feeds can:
- create feed items from sitemap URLs
- filter URLs by keyword or regex
- use `<lastmod>` as the item date
- follow sitemap indexes
- enrich items by fetching page metadata
- use sitemap URLs as a Drill Chain and extract JSON-LD from each linked page
- optionally emit items when page content changes
```

Example:

```yaml
feedType: sitemap
feedName: city-news
refreshTime: 60

sitemap:
  inputMode: exact
  url: https://example.gov/sitemap.xml
  mode: jsonLdWithFallback
  maxItems: 50
  maxUrlsToScan: 500
  sortOrder: lastmodDesc
  dateStrategy: jsonLdOrLastmodOrFirstSeen
  filters:
    include:
      - type: regex
        field: loc
        value: "/news|/notices|/agendas"
    exclude:
      - type: regex
        field: loc
        value: "/tag/|/category/|/author/"
  jsonLd:
    enabled: true
    scope: sitemapUrls
    fetch:
      mode: standard
      timeoutMs: 15000
      concurrency: 3
      maxPages: 50
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
    fallback:
      enabled: true
      order:
        - openGraph
        - htmlMeta
        - sitemap
        - url
```

---

## 25. Acceptance criteria

Sitemap integration is MVP-complete when:

```text
User can select Sitemap as a feed type.
User can enter a sitemap URL.
User can discover sitemap URLs from a website URL.
Mkfd can parse urlset files.
Mkfd can parse sitemapindex files.
Mkfd can follow child sitemaps.
Mkfd can filter URLs by include/exclude rules.
Mkfd can preview matching URLs.
Mkfd can generate valid RSS/Atom/JSON Feed output from sitemap entries.
Worker can refresh sitemap feeds on schedule.
Generated URL-list items use loc as link and GUID.
Generated URL-list items use lastmod as date when available.
Missing lastmod falls back safely.
Invalid sitemap errors are understandable.
Sitemap warnings are visible somewhere.
```

Sitemap Drill Chain + JSON-LD is complete when:

```text
User can select Sitemap Drill Chain + JSON-LD mode.
User can select Sitemap Drill Chain + JSON-LD with fallback mode.
Mkfd can sample sitemap URLs and inspect JSON-LD.
Mkfd can suggest JSON-LD mappings from sampled sitemap pages.
User can inspect sampled JSON-LD paths.
User can view raw JSON-LD from sampled pages.
Mkfd can fetch sitemap URLs and extract JSON-LD during preview.
Mkfd can fetch sitemap URLs and extract JSON-LD during worker refresh.
Fallback mode can fill missing fields from Open Graph, HTML meta, sitemap metadata, or URL-derived values.
Preview shows field source diagnostics.
Failures on individual pages do not crash the whole feed.
Source Assistant can recommend Sitemap Drill Chain + JSON-LD.
```

---

## Strategic recommendation

Build Sitemap integration in layers:

```text
1. Sitemap URL-list feeds
2. Sitemap state and health stats
3. Sitemap Drill Chain + JSON-LD
4. Page metadata fallback/enrichment
5. Change detection feeds
6. Source Assistant integration
7. Feed repair and selector suggestion integration
```

The strategic value is that sitemaps can become Mkfd’s most reliable URL discovery mechanism.

For many sites, the best Mkfd route will be:

```text
Sitemap for URL inventory
JSON-LD for detail-page extraction
Open Graph/meta/sitemap data for fallback
RSS/Atom/JSON Feed for output
```

Long term, sitemaps should power one of Mkfd’s clearest differentiators:

> Mkfd discovers, monitors, enriches, repairs, and transforms website URL inventories into reliable feeds.