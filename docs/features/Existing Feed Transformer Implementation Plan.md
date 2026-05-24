## Goal

Add `feedTransformer` as a first-class Mkfd feed type that consumes an existing RSS, Atom, or JSON Feed source, normalizes its items, applies practical cleanup and filtering rules, and republishes it as Mkfd-managed RSS 2.0, Atom, and JSON Feed outputs.

This should not ship as a simple passthrough proxy. The MVP should include enough lightweight field transformation to solve real feed pain:

```text
Existing feed is available, but it is messy.
Existing feed is RSS-only, but I want Atom and JSON Feed too.
Existing feed has bad descriptions.
Existing feed includes tracking parameters.
Existing feed has missing GUIDs.
Existing feed has bad or inconsistent dates.
Existing feed includes sponsored/noisy items.
Existing feed needs feed-level metadata cleanup.
```

The first version should be called and positioned as:

> Existing Feed Transformer

It should become the apply target for Source Assistant when an existing RSS, Atom, or JSON Feed is detected.

---

## 1. Product behavior

### MVP user flow

```text
User opens Build Feed
User enters a source URL
Source Assistant detects an existing feed
User chooses "Create cleaned Mkfd feed"
Mkfd opens the Existing Feed Transformer form
User reviews source feed details
User configures basic cleanup rules
User previews transformed output
User saves the feed
Mkfd refreshes it on interval like other feed types
Mkfd writes RSS, Atom, and JSON Feed outputs
```

Manual setup should also be available:

```text
Build Feed
  -> Existing Feed
  -> Source feed URL
  -> Preview
  -> Cleanup rules
  -> Save
```

### MVP should support

```text
RSS 2.0 input
Atom input
JSON Feed input
source format auto-detection
feed-level metadata override
item normalization
description/content cleanup
title prefix/suffix
link cleanup
tracking parameter removal
date normalization/fallback
GUID strategy
include/exclude keyword filters
category cleanup
max item limit
preview transformed output
scheduled refresh
run history
feed history/new-item tracking
RSS/Atom/JSON output
```

### MVP should not support yet

```text
full generic field-transformer engine
arbitrary JavaScript expressions
AI rewriting/summarization
complex conditional transforms
XPath transforms
multi-source feed merging
feed item enrichment from linked pages
per-item manual editing
authentication-heavy source feeds
private feed cookie flows
```

Authentication can be added later through shared protected headers/cookies once the request profile work is in place.

---

## 2. Roadmap placement

Place this after the Feed Format refactor and normalized item model, but before Source Assistant is considered complete.

Recommended placement:

```text
TIER 1 — Output and operations
  Feed Format refactor
  Normalized feed item pipeline
  Feed Config Management GUI
  My Feeds redesign

TIER 2 — Scraping intelligence and transformation
  Existing Feed Transformer
  Source Assistant existing-feed apply target
  JSON-LD Integration
  Web Scraping Form Data
```

Reason:

```text
Feed Format gives every Mkfd feed RSS/Atom/JSON outputs.
Existing Feed Transformer uses the same normalized item pipeline future source types need.
Source Assistant becomes more useful because detected feeds have a real Mkfd apply target.
```

---

## 3. Config shape

Add `feedTransformer` as a first-class `feedType`.

### Minimal config

```yaml
schemaVersion: 2
feedId: 042a8d6a-462c-47dd-a650-a6638ff6260f
feedName: cleaned-example-feed
feedType: feedTransformer
enabled: true
refreshTime: 15
reverse: false
strict: false
advanced: false

metadata:
  title: Cleaned Example Feed
  description: Existing feed cleaned and republished by Mkfd.
  category: news
  tags:
    - transformed
    - existing-feed
  origin:
    type: sourceAssistant

feedTransformer:
  sourceUrl: https://example.com/feed.xml
  sourceFormat: auto
  maxItems: 50

  feed:
    title: Cleaned Example Feed
    description: Existing feed cleaned and republished by Mkfd.
    link: https://example.com

  items:
    guidStrategy: existingOrLinkHash
    dateStrategy: publishedOrUpdatedOrFetched

    title:
      stripHtml: true

    description:
      stripHtml: true
      truncateCharacters: 800
      fallbackFrom:
        - content
        - summary

    content:
      stripDangerousHtml: true

    link:
      removeTrackingParams: true
      forceHttps: false
      allowedParams: []

    categories:
      normalizeWhitespace: true
      dedupe: true

    filters:
      exclude:
        - field: title
          type: contains
          value: sponsored
          caseSensitive: false
        - field: categories
          type: contains
          value: advertisement
          caseSensitive: false
```

### Notes

Use `feedId` for output filenames:

```text
/public/feeds/{feedId}.xml
/public/feeds/{feedId}.atom
/public/feeds/{feedId}.json
```

Do not use `feedName` for output filenames.

---

## 4. Type model

Add or update:

```text
models/feed-transformer.model.ts
models/normalized-feed-item.model.ts
models/feed-config.model.ts
```

### Feed type

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
  | "feedTransformer";
```

### Feed config union

```ts
export type FeedTransformerFeedConfig = FeedConfigBase<"feedTransformer"> & {
  feedTransformer: FeedTransformerConfigBlock;
};
```

### Feed transformer config

```ts
export type FeedTransformerSourceFormat =
  | "auto"
  | "rss"
  | "atom"
  | "jsonFeed";

export type FeedTransformerConfigBlock = {
  sourceUrl: string;
  sourceFormat: FeedTransformerSourceFormat;
  maxItems?: number;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  feed?: FeedTransformerFeedMetadataOverrides;
  items?: BasicItemTransformConfig;
};

export type FeedTransformerFeedMetadataOverrides = {
  title?: string;
  description?: string;
  link?: string;
  language?: string;
  image?: string;
  copyright?: string;
  generator?: string;
};
```

### Normalized item model

Create a shared normalized item model instead of making feedTransformer-specific item types.

```ts
export type NormalizedFeedItem = {
  id?: string;
  guid?: string;
  title: string;
  link?: string;
  description?: string;
  content?: string;
  contentEncoded?: string;
  summary?: string;
  author?: string;
  pubDate?: string;
  updatedDate?: string;
  categories?: string[];
  contributors?: string[];
  enclosure?: NormalizedFeedEnclosure;
  source?: NormalizedFeedSource;
  raw?: unknown;
};

export type NormalizedFeedEnclosure = {
  url: string;
  type?: string;
  length?: number;
};

export type NormalizedFeedSource = {
  title?: string;
  url?: string;
};
```

Future source types should also return `NormalizedFeedItem[]` where possible.

---

## 5. Basic transform model

This should be lightweight and intentionally smaller than a future universal field-transformer engine.

```ts
export type BasicItemTransformConfig = {
  guidStrategy?:
    | "existing"
    | "link"
    | "existingOrLinkHash"
    | "titleLinkDateHash"
    | "contentHash";

  dateStrategy?:
    | "published"
    | "updated"
    | "publishedOrUpdated"
    | "publishedOrUpdatedOrFetched"
    | "fetched";

  title?: TextTransformConfig;
  description?: TextTransformConfig;
  content?: TextTransformConfig;
  link?: LinkTransformConfig;
  categories?: CategoryTransformConfig;
  filters?: BasicItemFilterConfig;
};

export type TextTransformConfig = {
  stripHtml?: boolean;
  stripDangerousHtml?: boolean;
  normalizeWhitespace?: boolean;
  truncateCharacters?: number;
  fallbackFrom?: Array<
    | "title"
    | "description"
    | "content"
    | "contentEncoded"
    | "summary"
  >;
  prefix?: string;
  suffix?: string;
};

export type LinkTransformConfig = {
  removeTrackingParams?: boolean;
  allowedParams?: string[];
  blockedParams?: string[];
  forceHttps?: boolean;
};

export type CategoryTransformConfig = {
  normalizeWhitespace?: boolean;
  dedupe?: boolean;
  lowercase?: boolean;
  include?: string[];
  exclude?: string[];
};

export type BasicItemFilterConfig = {
  include?: BasicFilterRule[];
  exclude?: BasicFilterRule[];
};

export type BasicFilterRule = {
  field:
    | "title"
    | "link"
    | "description"
    | "content"
    | "author"
    | "categories";
  type:
    | "contains"
    | "notContains"
    | "equals"
    | "startsWith"
    | "endsWith"
    | "regex";
  value: string;
  caseSensitive?: boolean;
};
```

---

## 6. Backend files

Add:

```text
utilities/existing-feed-parser.utility.ts
utilities/feed-transformer.utility.ts
utilities/feed-item-transform.utility.ts
utilities/feed-item-filter.utility.ts
utilities/normalized-feed-builder.utility.ts
models/feed-transformer.model.ts
models/normalized-feed-item.model.ts
```

Update:

```text
models/feed-config.model.ts
utilities/rss-builder.utility.ts
utilities/feed-output.utility.ts
feed-updater.worker.ts
index.ts
```

---

## 7. Existing feed parser utility

Create:

```text
utilities/existing-feed-parser.utility.ts
```

Responsibilities:

```text
fetch source feed
detect source format
parse RSS
parse Atom
parse JSON Feed
normalize items
return source metadata
return warnings
```

### Public API

```ts
export type ParseExistingFeedInput = {
  sourceUrl: string;
  sourceFormat: FeedTransformerSourceFormat;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type ParsedExistingFeed = {
  sourceUrl: string;
  detectedFormat: "rss" | "atom" | "jsonFeed";
  feed: ParsedExistingFeedMetadata;
  items: NormalizedFeedItem[];
  warnings: string[];
};

export type ParsedExistingFeedMetadata = {
  title?: string;
  description?: string;
  link?: string;
  language?: string;
  image?: string;
  updatedDate?: string;
  generator?: string;
};

export async function parseExistingFeed(
  input: ParseExistingFeedInput,
): Promise<ParsedExistingFeed>;
```

### Format detection

Detection order:

```text
explicit sourceFormat if not auto
content-type header
JSON parse attempt for JSON Feed
XML parse attempt
RSS root detection
Atom root detection
```

Rules:

```text
application/feed+json -> JSON Feed
application/json with version/title/items -> JSON Feed
rss/channel -> RSS
feed xmlns="http://www.w3.org/2005/Atom" -> Atom
```

Do not rely only on content type because many sites serve feeds as `text/xml`, `application/xml`, or even `text/plain`.

### RSS normalization

Map common RSS item fields:

```text
item.title -> title
item.link -> link
item.guid -> guid
item.description -> description
content:encoded -> contentEncoded
item.pubDate -> pubDate
item.author or dc:creator -> author
item.category -> categories
enclosure url/type/length -> enclosure
source -> source
```

### Atom normalization

Map common Atom entry fields:

```text
entry.title -> title
entry.link rel=alternate href -> link
entry.id -> guid
entry.summary -> summary/description
entry.content -> content
entry.published -> pubDate
entry.updated -> updatedDate
entry.author.name -> author
entry.category term/label -> categories
entry.link rel=enclosure -> enclosure
```

### JSON Feed normalization

Map JSON Feed item fields:

```text
item.id -> guid
item.url -> link
item.external_url -> source.url if url also exists
item.title -> title
item.summary -> summary/description
item.content_html -> contentEncoded
item.content_text -> description
item.date_published -> pubDate
item.date_modified -> updatedDate
item.author.name -> author
item.authors[].name -> contributors/author
item.tags -> categories
item.attachments[0] -> enclosure
```

### Parser dependency strategy

Prefer avoiding a large dependency if the existing `xmldom` and DOM parsing are sufficient for MVP.

If parsing becomes brittle, add a dedicated feed parsing dependency in a separate commit and wrap it behind `parseExistingFeed` so the rest of Mkfd does not care.

---

## 8. Feed item transform utility

Create:

```text
utilities/feed-item-transform.utility.ts
```

Responsibilities:

```text
apply text transforms
apply link transforms
apply category transforms
apply date strategy
apply GUID strategy
limit items
dedupe items
produce warnings
```

### Public API

```ts
export type TransformFeedItemsInput = {
  items: NormalizedFeedItem[];
  config: BasicItemTransformConfig;
  fetchedAt: string;
  sourceUrl: string;
  maxItems?: number;
};

export type TransformFeedItemsResult = {
  items: NormalizedFeedItem[];
  warnings: string[];
  stats: {
    inputItemCount: number;
    outputItemCount: number;
    filteredItemCount: number;
    dedupedItemCount: number;
  };
};

export function transformFeedItems(
  input: TransformFeedItemsInput,
): TransformFeedItemsResult;
```

### Text transform order

Apply transforms in this order:

```text
fallback
strip dangerous HTML
strip HTML
normalize whitespace
prefix
suffix
truncate
```

### Link transform order

Apply transforms in this order:

```text
parse URL
force HTTPS if enabled
remove blocked tracking params
apply allowed params if specified
return normalized URL
```

Default tracking params to remove:

```text
utm_source
utm_medium
utm_campaign
utm_term
utm_content
utm_id
fbclid
gclid
mc_cid
mc_eid
igshid
ref
ref_src
spm
```

If `allowedParams` is provided and non-empty, remove all query params except those listed.

### Date strategy

```ts
export function resolveItemDate(
  item: NormalizedFeedItem,
  strategy: BasicItemTransformConfig["dateStrategy"],
  fetchedAt: string,
): string | undefined;
```

Rules:

```text
published -> item.pubDate
updated -> item.updatedDate
publishedOrUpdated -> pubDate then updatedDate
publishedOrUpdatedOrFetched -> pubDate then updatedDate then fetchedAt
fetched -> fetchedAt
```

Only keep dates that parse into valid dates.

### GUID strategy

```ts
export function resolveItemGuid(
  item: NormalizedFeedItem,
  strategy: BasicItemTransformConfig["guidStrategy"],
): string;
```

Rules:

```text
existing -> guid if present, otherwise generated hash warning
link -> link if present, otherwise generated hash warning
existingOrLinkHash -> guid, then link, then hash
titleLinkDateHash -> hash(title + link + pubDate)
contentHash -> hash(title + link + description + content)
```

---

## 9. Feed item filter utility

Create:

```text
utilities/feed-item-filter.utility.ts
```

Responsibilities:

```text
evaluate include rules
evaluate exclude rules
support text and category fields
return filtered items
return counts
```

Rules:

```text
If include rules exist, item must match at least one include rule.
If exclude rules exist, item must not match any exclude rule.
Exclude wins over include.
Missing fields do not match.
Regex errors should produce validation errors before runtime.
```

API:

```ts
export type FilterFeedItemsInput = {
  items: NormalizedFeedItem[];
  filters?: BasicItemFilterConfig;
};

export type FilterFeedItemsResult = {
  items: NormalizedFeedItem[];
  filteredItemCount: number;
};

export function filterFeedItems(
  input: FilterFeedItemsInput,
): FilterFeedItemsResult;
```

---

## 10. Normalized feed builder

Create:

```text
utilities/normalized-feed-builder.utility.ts
```

Responsibilities:

```text
build a Feed object from normalized items
apply feed-level metadata
sanitize XML-sensitive values
map enclosures
map categories
support RSS/Atom/JSON serialization through shared output helper
```

API:

```ts
export type BuildFeedFromNormalizedItemsInput = {
  feedId: string;
  feedName: string;
  sourceUrl?: string;
  feedMetadata: FeedRssMetadata;
  overrides?: FeedTransformerFeedMetadataOverrides;
  items: NormalizedFeedItem[];
};

export function buildFeedFromNormalizedItems(
  input: BuildFeedFromNormalizedItemsInput,
): Feed;
```

This utility should be reusable by:

```text
feedTransformer
webhook
filesystem
service connectors
sitemap URL list mode
calendar
future existing-feed transformer enhancements
```

---

## 11. Feed transformer runner

Create:

```text
utilities/feed-transformer.utility.ts
```

Responsibilities:

```text
resolve protected values
parse source feed
apply transformations
build Feed object
return output data and run stats
```

API:

```ts
export type RunFeedTransformerInput = {
  config: FeedTransformerFeedConfig;
  encryptionKey: string;
};

export type RunFeedTransformerResult = {
  feed: Feed;
  source: {
    url: string;
    detectedFormat: "rss" | "atom" | "jsonFeed";
    itemCount: number;
  };
  warnings: string[];
  stats: {
    inputItemCount: number;
    outputItemCount: number;
    filteredItemCount: number;
    dedupedItemCount: number;
  };
};

export async function runFeedTransformer(
  input: RunFeedTransformerInput,
): Promise<RunFeedTransformerResult>;
```

Flow:

```text
normalize config
resolve protected headers/cookies
fetch source feed
parse source feed
transform/filter items
build Feed object
return Feed object and stats
```

Do not write output files inside this utility. The worker should write output through `writeAllFeedFormats(feedId, feed)`.

---

## 12. Worker integration

Update `feed-updater.worker.ts`.

Add handling:

```ts
if (config.feedType === "feedTransformer") {
  const result = await runFeedTransformer({
    config,
    encryptionKey,
  });

  const urls = await writeAllFeedFormats(config.feedId, result.feed);

  await storeFeedHistory(config.feedId, result.feed.rss2());

  await recordFeedRun({
    feedId: config.feedId,
    status: "success",
    outputUrls: urls,
    itemCount: result.stats.outputItemCount,
    warnings: result.warnings,
  });
}
```

Actual implementation should avoid calling `rss2()` twice if the output helper already serialized the feed. Prefer returning serialized outputs from `writeAllFeedFormats` or adding a `storeFeedHistory` call that receives the RSS output from the writer result.

Recommended final flow:

```text
runFeedTransformer -> Feed
writeAllFeedFormats -> serialized outputs + URLs
storeFeedHistory(feedId, outputs.rss2)
record run
```

---

## 13. Preview endpoint integration

Update `/preview` to support `feedType: feedTransformer`.

Preview should:

```text
parse source feed
apply transformations
return RSS preview XML by default
return warnings/stats in headers or structured JSON later
```

Recommended request:

```json
{
  "feedType": "feedTransformer",
  "feedName": "cleaned-example-feed",
  "feedTransformer": {
    "sourceUrl": "https://example.com/feed.xml",
    "sourceFormat": "auto",
    "maxItems": 50,
    "items": {
      "description": {
        "stripHtml": true,
        "truncateCharacters": 800
      },
      "link": {
        "removeTrackingParams": true
      }
    }
  }
}
```

MVP can keep returning XML text for consistency with existing preview behavior.

A later improvement can return:

```ts
export type FeedPreviewResponse = {
  format: "rss2";
  xml: string;
  warnings: string[];
  stats: Record<string, unknown>;
};
```

---

## 14. Save endpoint integration

When saving a `feedTransformer` config:

```text
validate sourceUrl
validate sourceFormat
validate maxItems
validate regex filters
normalize transform config defaults
assign feedId if missing
write YAML config
optionally run immediate preview/generation
return output URLs
```

Default config values:

```ts
export const defaultFeedTransformerConfig: FeedTransformerConfigBlock = {
  sourceUrl: "",
  sourceFormat: "auto",
  maxItems: 50,
  items: {
    guidStrategy: "existingOrLinkHash",
    dateStrategy: "publishedOrUpdatedOrFetched",
    description: {
      stripHtml: false,
      normalizeWhitespace: true,
    },
    link: {
      removeTrackingParams: true,
    },
    categories: {
      normalizeWhitespace: true,
      dedupe: true,
    },
  },
};
```

---

## 15. Frontend form

Add:

```text
frontend/src/components/forms/ExistingFeedTransformerForm.tsx
```

Update `FeedBuilderForm.tsx` to include a new tab once the source type is enabled.

### Tab label

```text
Existing Feed
```

Avoid exposing the internal phrase `feedTransformer` in the UI.

### Form sections

```text
Source Feed
Feed Metadata
Item Cleanup
Link Cleanup
Dates and GUIDs
Filters
Preview
Save
```

### Source Feed section

Fields:

```text
Source feed URL
Source format: Auto / RSS / Atom / JSON Feed
Max items
Fetch source / Preview source
```

Display after source preview:

```text
Detected format
Source title
Source description
Source item count
Latest item date
Warnings
```

### Feed Metadata section

Fields:

```text
Output feed title
Output feed description
Output feed link
Category
Tags
```

Add option:

```text
Use source feed metadata
Override output metadata
```

### Item Cleanup section

Fields:

```text
Title prefix
Title suffix
Strip HTML from title
Strip HTML from description
Truncate description characters
Use content as description fallback
Strip dangerous HTML from content
Normalize whitespace
```

### Link Cleanup section

Fields:

```text
Remove tracking parameters
Allowed query parameters
Blocked query parameters
Force HTTPS
```

### Dates and GUIDs section

Fields:

```text
Date strategy
GUID strategy
```

Recommended labels:

```text
Date strategy:
- Published date
- Updated date
- Published, then updated
- Published, then updated, then fetch time

GUID strategy:
- Existing GUID
- Link
- Existing GUID, then link/hash
- Title + link + date hash
- Content hash
```

### Filters section

MVP can use simple rows:

```text
Include rules
Exclude rules

Field: title/link/description/author/categories
Match: contains/equals/starts with/ends with/regex
Value
Case sensitive
```

Start with exclude rules visible and include rules collapsed.

### Preview section

Show:

```text
input item count
output item count
filtered count
deduped count
detected format
warnings
RSS XML preview
```

Later, add item table preview.

---

## 16. Source Assistant integration

Update existing feed discovery so each valid discovered feed can offer two actions:

```text
Use original feed URL
Create cleaned Mkfd feed
```

### Recommendation behavior

If Source Assistant detects a valid existing feed:

```text
routeType: existingFeed
confidence: 90+
nextStep: configure
starterConfig.feedType: feedTransformer
starterConfig.feedTransformer.sourceUrl: discoveredFeed.url
starterConfig.feedTransformer.sourceFormat: detectedFormat or auto
```

### UI copy

```text
Existing feed found

This page already publishes a feed. Mkfd can wrap it as a managed feed, clean up item fields, remove tracking links, normalize dates, and republish it as RSS, Atom, and JSON Feed.

[Use original feed]
[Create cleaned Mkfd feed]
```

### Starter config

```ts
export function createFeedTransformerStarterConfig(
  candidate: ExistingFeedCandidate,
): Partial<FeedTransformerFeedConfig> {
  return {
    feedType: "feedTransformer",
    feedName: candidate.title
      ? slugify(candidate.title)
      : "existing-feed",
    feedTransformer: {
      sourceUrl: candidate.url,
      sourceFormat: candidate.format === "unknown"
        ? "auto"
        : candidate.format,
      maxItems: 50,
      items: {
        guidStrategy: "existingOrLinkHash",
        dateStrategy: "publishedOrUpdatedOrFetched",
        link: {
          removeTrackingParams: true,
        },
        categories: {
          normalizeWhitespace: true,
          dedupe: true,
        },
      },
    },
    metadata: {
      origin: {
        type: "sourceAssistant",
      },
    },
  };
}
```

Map Source Assistant format names cleanly:

```text
rss -> rss
atom -> atom
jsonFeed -> jsonFeed
unknown -> auto
```

---

## 17. Validation

Add feedTransformer checks to the minimal inline validator.

Required errors:

```text
feedTransformer.sourceUrl is required
feedTransformer.sourceUrl must be a valid HTTP/HTTPS URL
feedTransformer.sourceFormat must be auto/rss/atom/jsonFeed
feedTransformer.maxItems must be positive if provided
filter regex values must compile
GUID strategy must be supported
date strategy must be supported
```

Warnings:

```text
sourceUrl points to localhost/private IP and feed is public
source feed has zero items
source feed title is missing
source feed items are missing dates
source feed items are missing GUIDs and links
description truncation is very low
raw HTML content is preserved
```

Save should not require fetching the source URL, but preview and first run should surface fetch/parse failures clearly.

---

## 18. Runtime state

Existing Feed Transformer should use the same runtime-state substrate as other source types.

Use:

```text
feed_runs
feed_history_snapshots
feed_history_items
```

Do not create a separate feed-transformer state file.

Track:

```text
detected source format
source item count
output item count
filtered count
deduped count
latest item date
warnings
fetch duration
parse duration
transform duration
```

This makes the My Feeds page and Feed Health page useful for transformed feeds.

---

## 19. Error handling

Handle these cases clearly:

```text
source URL unreachable
HTTP 401/403
HTTP 404
HTTP 429
non-feed response
invalid XML
invalid JSON Feed
empty feed
unsupported feed format
malformed dates
missing item titles
all items filtered out
duplicate items after GUID strategy
```

Recommended user-facing messages:

```text
Could not fetch the source feed.
The source URL responded, but Mkfd could not detect RSS, Atom, or JSON Feed data.
The source feed parsed successfully but contains no items.
All source items were removed by filters.
Some items had invalid dates and used the configured fallback date strategy.
Some items were missing GUIDs and received generated stable IDs.
```

---

## 20. Security considerations

MVP should be conservative.

Rules:

```text
Only fetch HTTP/HTTPS source URLs.
Apply existing SSRF/private-network policy when available.
Do not execute scripts from feed content.
Sanitize generated feed XML.
Strip dangerous HTML when configured.
Do not expose protected headers/cookies in API responses.
Mask protected values in config edit responses.
Limit response size.
Set fetch timeout.
```

Feed content can contain HTML. Mkfd should preserve HTML only when explicitly configured and should sanitize invalid XML characters before output.

---

## 21. Test plan

### Unit tests

```text
detect RSS feed
detect Atom feed
detect JSON Feed
normalize RSS items
normalize Atom entries
normalize JSON Feed items
strip HTML
truncate text
remove tracking parameters
apply allowed parameters
normalize categories
resolve date strategies
resolve GUID strategies
include filters
exclude filters
regex filter validation
dedupe items
```

### Integration tests

```text
preview transformed RSS feed
save feedTransformer config
worker generates RSS/Atom/JSON outputs
feed history snapshot is stored
new item count works after source changes
Source Assistant starter config hydrates form
invalid source feed returns useful error
```

### Compatibility tests

```text
feedId output filenames are preserved
existing feed history store still works
metadata overrides do not break RSS output
missing optional transform block uses defaults
```

---

## 22. Implementation phases

### Phase 1 — Models and normalized pipeline

Done when:

```text
FeedTransformer config model exists.
NormalizedFeedItem model exists.
FeedConfig union includes feedTransformer.
Basic transform config types exist.
Minimal validation handles feedTransformer.
```

### Phase 2 — Existing feed parsing

Done when:

```text
RSS input parses into NormalizedFeedItem[].
Atom input parses into NormalizedFeedItem[].
JSON Feed input parses into NormalizedFeedItem[].
Auto-detection works for common feeds.
Parser returns source metadata and warnings.
```

### Phase 3 — Basic transforms and filters

Done when:

```text
Text cleanup works.
Link cleanup works.
Date strategy works.
GUID strategy works.
Include/exclude filters work.
Stats are returned.
```

### Phase 4 — Feed object output

Done when:

```text
Normalized items build a Feed object.
Feed Format helper writes RSS/Atom/JSON outputs by feedId.
Preview returns transformed RSS XML.
Worker can generate transformed feeds on interval.
```

### Phase 5 — Frontend form

Done when:

```text
Existing Feed tab exists.
User can enter source URL.
User can preview source feed metadata.
User can configure cleanup rules.
User can preview transformed output.
User can save feedTransformer config.
```

### Phase 6 — Source Assistant apply target

Done when:

```text
Existing feed discovery offers Create cleaned Mkfd feed.
Starter config hydrates Existing Feed form.
Detected source URL and format are prefilled.
User can preview and save without re-entering data.
```

### Phase 7 — My Feeds and Health integration

Done when:

```text
feedTransformer appears in My Feeds.
Type badge shows Existing Feed.
Output links show RSS/Atom/JSON.
Run history shows source format and item counts.
Warnings appear in feed status.
```

---

## 23. Suggested first vertical slice

Build the first slice as:

```text
RSS source only
auto-detect RSS
normalize title/link/guid/description/pubDate/categories/enclosure
strip description HTML
remove tracking params from links
existingOrLinkHash GUID strategy
publishedOrUpdatedOrFetched date strategy
preview RSS
save YAML
worker writes RSS/Atom/JSON
```

Then add:

```text
Atom parsing
JSON Feed parsing
filters
Source Assistant apply
frontend polish
```

This reduces risk while still proving the full pipeline.

---

## 24. Definition of done

The feature is done when:

```text
A user can paste an existing RSS/Atom/JSON Feed URL.
Mkfd detects and previews the source feed.
The user can apply basic cleanup rules.
The user can filter unwanted items.
The user can save it as a normal feed config.
The worker refreshes it on schedule.
Mkfd publishes RSS, Atom, and JSON Feed outputs using feedId filenames.
Run history and feed history work.
Source Assistant can turn an existing-feed recommendation into a configured feedTransformer draft.
```

---

## 25. Future enhancements

After MVP, expand toward the full transformer system:

```text
Reusable cross-source field transforms
Reusable cross-source filtering rules
Regex replace transforms
template-based field rewriting
category mapping
feed merging
feed splitting
linked-page enrichment
Open Graph fallback from linked pages
JSON-LD fallback from linked pages
AI summary cleanup
per-feed transform presets
community catalog transformer recipes
```

The MVP should avoid blocking on these. It should establish the normalized item pipeline and prove that Mkfd can turn an existing feed into a cleaner, monitored, multi-format Mkfd-managed feed.
