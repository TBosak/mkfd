# Existing Feed Transformer — Design Spec

**Date:** 2026-05-23
**Tier:** R3 Transformation & Scraping Intelligence
**Status:** Approved

---

## Goal

Add `feedTransformer` as a first-class Mkfd feed type that consumes one or more existing RSS, Atom, or JSON Feed sources, merges and cleans the items, and republishes as Mkfd-managed RSS 2.0, Atom, and JSON Feed outputs. Covers both single-feed cleanup and multi-feed merging in one feature.

---

## Scope

### In scope

- `FeedTransformerSource[]` config — multiple source URLs per feed, each with own format and headers
- Configurable merge strategy: date descending, date ascending, preserve source order
- Cross-source deduplication by resolved GUID
- `existing-feed-parser.utility.ts` — fetch + parse RSS/Atom (xmldom) / JSON Feed (JSON.parse) → `NormalizedFeedItem[]`
- `feed-item-transform.utility.ts` — text, link, GUID, date transforms (pure/sync)
- `feed-item-filter.utility.ts` — include/exclude keyword/regex rules (pure/sync)
- `normalized-feed-builder.utility.ts` — `NormalizedFeedItem[]` → `Feed` object (reusable by future source types)
- `feed-transformer.utility.ts` — orchestrates the pipeline
- Worker integration in `feed-updater.worker.ts`
- `POST /api/feeds/transformer/probe` — probe a single source URL, return metadata + warnings
- Extend `POST /preview` to handle `feedType: feedTransformer`
- Extend save endpoints (`POST /`, `PUT /api/feeds/:id`) with feedTransformer validation
- `ExistingFeedTransformerForm.tsx` — 7-section builder form using builder primitives
- Activate `feedTransformer` in `TypePickerGrid` (remove "coming soon" badge)

### Out of scope

- Source Assistant integration (separate Phase 3 feature)
- Fetch retry / fallback policy (separate Phase 3 feature — Fetch Policy / Retry / Fallback)
- Selector Playground, JSON-LD extraction, arbitrary JS transforms
- Per-item manual editing
- Authentication beyond per-source headers

---

## Dependencies

- **Feed Format Refactor** must be implemented first — `writeAllFeedFormats(feedId, feed)` is called by the worker branch.
- **Builder UI Redesign** must be implemented first — `ExistingFeedTransformerForm` uses `Section`, `Field`, `FieldRow`, `KVEditor` components and slots into `FeedBuilderForm`.
- No new npm dependencies — uses `xmldom` (already imported in `index.ts`) and the `feed` npm package (already used by `rss-builder`).

---

## Design System

Frontend form uses the same shadcn blue-gray palette and `feeds-tokens.css` aliasing as the rest of the builder. No new tokens.

---

## Data Models

### `models/feed-transformer.model.ts` (new)

```ts
export type FeedTransformerSourceFormat = "auto" | "rss" | "atom" | "jsonFeed";

export type FeedTransformerSource = {
  url: string;
  format: FeedTransformerSourceFormat;
  headers?: Record<string, string>;
};

export type FeedTransformerMergeStrategy = "dateDesc" | "dateAsc" | "preserveOrder";

export type FeedTransformerFeedMetadataOverrides = {
  title?: string;
  description?: string;
  link?: string;
  language?: string;
  image?: string;
  copyright?: string;
};

export type TextTransformConfig = {
  stripHtml?: boolean;
  stripDangerousHtml?: boolean;
  normalizeWhitespace?: boolean;
  truncateCharacters?: number;
  fallbackFrom?: Array<"title" | "description" | "content" | "contentEncoded" | "summary">;
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
};

export type BasicFilterRule = {
  field: "title" | "link" | "description" | "content" | "author" | "categories";
  type: "contains" | "notContains" | "equals" | "startsWith" | "endsWith" | "regex";
  value: string;
  caseSensitive?: boolean;
};

export type BasicItemTransformConfig = {
  guidStrategy?: "existing" | "link" | "existingOrLinkHash" | "titleLinkDateHash" | "contentHash";
  dateStrategy?: "published" | "updated" | "publishedOrUpdated" | "publishedOrUpdatedOrFetched" | "fetched";
  title?: TextTransformConfig;
  description?: TextTransformConfig;
  content?: TextTransformConfig;
  link?: LinkTransformConfig;
  categories?: CategoryTransformConfig;
  filters?: {
    include?: BasicFilterRule[];
    exclude?: BasicFilterRule[];
  };
};

export type FeedTransformerConfigBlock = {
  sources: FeedTransformerSource[];
  mergeStrategy?: FeedTransformerMergeStrategy;
  maxItems?: number;
  dedupeAcrossSources?: boolean;
  feed?: FeedTransformerFeedMetadataOverrides;
  items?: BasicItemTransformConfig;
};
```

### `models/normalized-feed-item.model.ts` (new)

Shared intermediate type used by all pipeline stages. Future source types (webhook, filesystem, calendar, sitemap) should return `NormalizedFeedItem[]` where possible.

```ts
export type NormalizedFeedEnclosure = {
  url: string;
  type?: string;
  length?: number;
};

export type NormalizedFeedSource = {
  title?: string;
  url?: string;
};

export type NormalizedFeedItem = {
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
  enclosure?: NormalizedFeedEnclosure;
  source?: NormalizedFeedSource;
  raw?: unknown;
};
```

### `models/feed-config.model.ts` (modify)

Add `"feedTransformer"` to the `FeedType` union. Add `FeedTransformerFeedConfig` to the config union:

```ts
export type FeedTransformerFeedConfig = FeedConfigBase<"feedTransformer"> & {
  feedTransformer: FeedTransformerConfigBlock;
};
```

---

## Backend Utilities

### `existing-feed-parser.utility.ts`

**Responsibilities:** fetch source URL with per-source headers and a 30s timeout, detect format, parse into `NormalizedFeedItem[]`, return source metadata and warnings.

**Public API:**

```ts
export type ParseExistingFeedInput = {
  url: string;
  format: FeedTransformerSourceFormat;
  headers?: Record<string, string>;
  timeoutMs?: number;
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

export type ParsedExistingFeed = {
  detectedFormat: "rss" | "atom" | "jsonFeed";
  feed: ParsedExistingFeedMetadata;
  items: NormalizedFeedItem[];
  warnings: string[];
};

export async function parseExistingFeed(
  input: ParseExistingFeedInput,
): Promise<ParsedExistingFeed>;
```

**Format detection order:**
1. Use `input.format` if not `"auto"`
2. `application/feed+json` or JSON with `version`/`title`/`items` → JSON Feed
3. XML parse attempt → check root element: `<rss>` → RSS, `<feed xmlns="...Atom...">` → Atom
4. Fallback warning if unrecognised

**RSS field mapping:** `title`, `link`, `guid`, `description`, `content:encoded`, `pubDate`, `dc:creator` / `author`, `category[]`, `enclosure`, `source`

**Atom field mapping:** `title`, `link[rel=alternate]`, `id`, `summary`, `content`, `published`, `updated`, `author.name`, `category[term]`, `link[rel=enclosure]`

**JSON Feed field mapping:** `id`, `url`, `title`, `summary`, `content_html`, `content_text`, `date_published`, `date_modified`, `author.name` / `authors[].name`, `tags`, `attachments[0]`

Parsing uses `xmldom` `DOMParser` already imported in `index.ts`. No new dependency.

---

### `feed-item-transform.utility.ts`

**Responsibilities:** apply transforms to each `NormalizedFeedItem`, resolve GUID and date strategies. Pure synchronous function — no I/O.

**Public API:**

```ts
export type TransformFeedItemsInput = {
  items: NormalizedFeedItem[];
  config: BasicItemTransformConfig;
  fetchedAt: string;
  maxItems?: number;
};

export type TransformFeedItemsResult = {
  items: NormalizedFeedItem[];
  warnings: string[];
  stats: {
    inputItemCount: number;
    outputItemCount: number;
  };
};

export function transformFeedItems(input: TransformFeedItemsInput): TransformFeedItemsResult;
```

**Text transform order (per field):** fallback resolution → strip dangerous HTML → strip HTML → normalize whitespace → prefix → suffix → truncate

**Link transform order:** parse URL → force HTTPS → remove default tracking params → apply `allowedParams` if non-empty (removes everything not listed) → apply `blockedParams`

**Default tracking params removed:** `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `igshid`, `ref`, `ref_src`, `spm`

**GUID strategy:**
- `existing` — use `item.guid` if present, else generate `titleLinkDateHash` with warning
- `link` — use `item.link` if present, else generate hash with warning
- `existingOrLinkHash` — `guid` → `link` → `hash(title+link+pubDate)` (default)
- `titleLinkDateHash` — `hash(title + link + pubDate)`
- `contentHash` — `hash(title + link + description + content)`

**Date strategy:**
- `published` → `pubDate`
- `updated` → `updatedDate`
- `publishedOrUpdated` → `pubDate` then `updatedDate`
- `publishedOrUpdatedOrFetched` → `pubDate` then `updatedDate` then `fetchedAt` (default)
- `fetched` → `fetchedAt`

Only keep dates that parse to valid `Date` objects.

---

### `feed-item-filter.utility.ts`

**Responsibilities:** evaluate include/exclude rules. Pure synchronous — no I/O.

**Public API:**

```ts
export type FilterFeedItemsInput = {
  items: NormalizedFeedItem[];
  filters?: BasicItemTransformConfig["filters"];
};

export type FilterFeedItemsResult = {
  items: NormalizedFeedItem[];
  filteredItemCount: number;
};

export function filterFeedItems(input: FilterFeedItemsInput): FilterFeedItemsResult;
```

**Rules:**
- If include rules exist, item must match at least one.
- If exclude rules exist, item must not match any.
- Exclude wins over include.
- Missing fields do not match any rule.
- Invalid regex: log warning, skip rule (do not crash).
- `categories` field: rule matches if any category in the array matches.

---

### `normalized-feed-builder.utility.ts`

**Responsibilities:** map `NormalizedFeedItem[]` to a `Feed` object using the `feed` npm package. Apply feed-level metadata overrides. Sanitize XML-sensitive values using existing `sanitizeForXML` / `sanitizeURLForXML` helpers.

**Public API:**

```ts
export type BuildFeedFromNormalizedItemsInput = {
  feedId: string;
  feedName: string;
  serverUrl: string;
  overrides?: FeedTransformerFeedMetadataOverrides;
  sourceFeedMeta?: ParsedExistingFeedMetadata;
  items: NormalizedFeedItem[];
};

export function buildFeedFromNormalizedItems(
  input: BuildFeedFromNormalizedItemsInput,
): Feed;
```

Feed-level metadata resolution order: `overrides` → `sourceFeedMeta` (from first source) → fallback defaults. This utility is designed to be reused by future source types.

---

### `feed-transformer.utility.ts`

**Responsibilities:** orchestrate the full pipeline. Async — performs I/O (fetch sources).

**Public API:**

```ts
export type RunFeedTransformerInput = {
  config: FeedTransformerFeedConfig;
  encryptionKey: string;
  serverUrl: string;
};

export type RunFeedTransformerResult = {
  feed: Feed;
  warnings: string[];
  stats: {
    sourceCount: number;
    detectedFormats: Array<"rss" | "atom" | "jsonFeed">;
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

**Pipeline:**
1. Resolve protected header values (decrypt via `security.utility.ts`)
2. Fetch + parse all sources in parallel (`Promise.all`)
3. Merge `NormalizedFeedItem[]` arrays by `mergeStrategy` (default: `dateDesc`):
   - `dateDesc` — sort all items by resolved date descending
   - `dateAsc` — sort ascending
   - `preserveOrder` — concatenate in source array order
4. Apply transforms (`feed-item-transform`)
5. Apply filters (`feed-item-filter`)
6. Dedupe by resolved GUID if `dedupeAcrossSources !== false` (default true)
7. Cap at `maxItems` (default 50)
8. Build `Feed` object (`normalized-feed-builder`)
9. Return result — does **not** write files

---

## API Endpoints

### `POST /api/feeds/transformer/probe`

Probes a single source URL. Called per source row from the frontend "Preview source" button.

**Request body:**
```ts
{ url: string; format: FeedTransformerSourceFormat; headers?: Record<string, string> }
```

**Response (success):**
```ts
{
  detectedFormat: "rss" | "atom" | "jsonFeed";
  feed: {
    title?: string;
    description?: string;
    link?: string;
    itemCount: number;
    latestDate?: string;
  };
  warnings: string[];
}
```

**Response (failure):** structured JSON error — never a 500. Covers: unreachable URL, HTTP error status, unrecognised format, empty feed, parse error.

### `POST /preview` (extend)

When `feedType === "feedTransformer"`: runs the full pipeline and returns RSS XML. Consistent with existing preview behavior (same `text/xml` response shape).

### `POST /` and `PUT /api/feeds/:id` (extend)

Validation for `feedTransformer` configs:
- `sources` must be a non-empty array
- Each source `url` must be a valid HTTP/HTTPS URL
- Each source `format` must be `auto | rss | atom | jsonFeed`
- `maxItems` must be a positive integer if provided
- `mergeStrategy` must be `dateDesc | dateAsc | preserveOrder` if provided
- Regex `value` in filter rules must compile without error

---

## Worker Integration

New branch in `feed-updater.worker.ts`:

```ts
if (feedConfig.feedType === "feedTransformer") {
  const result = await runFeedTransformer({
    config: feedConfig,
    encryptionKey,
    serverUrl,
  });
  const urls = await writeAllFeedFormats(feedConfig.feedId, result.feed);
  await storeFeedHistory(feedConfig.feedId, urls.rss2);
  await recordFeedRun({
    feedId: feedConfig.feedId,
    status: "success",
    outputUrls: urls,
    itemCount: result.stats.outputItemCount,
    warnings: result.warnings,
    metrics: {
      sourceCount: result.stats.sourceCount,
      detectedFormats: result.stats.detectedFormats,
      inputItemCount: result.stats.inputItemCount,
      filteredItemCount: result.stats.filteredItemCount,
      dedupedItemCount: result.stats.dedupedItemCount,
    },
  });
}
```

Errors follow the same pattern as existing types — catch block posts `status: "error"` with `errorMessage` so the Health dashboard and run log surface it.

---

## Frontend Form

**File:** `frontend/src/components/forms/ExistingFeedTransformerForm.tsx`

Uses `Section`, `Field`, `FieldRow`, `KVEditor`, `StorageSelect` from `frontend/src/components/builder/`. Registered in `FeedBuilderForm.tsx` when `feedType === "feedTransformer"`.

### Sections

**Section 1 — Basic**
Feed name, category, refresh interval (minutes), tags, feed description. Identical to other feed types.

**Section 2 — Sources**
List of source rows (add/remove). Each row:
- URL input (required)
- Format select: Auto / RSS / Atom / JSON Feed
- Collapsible KVEditor for per-source headers (hidden by default)
- "Preview source" button → calls `POST /api/feeds/transformer/probe` → displays inline below row: detected format, title, item count, latest date, warnings

Merge subsection (below source rows):
- Merge strategy select: "Newest first (date desc)" / "Oldest first (date asc)" / "Preserve source order"
- Max items input
- Deduplicate across sources toggle

**Section 3 — Feed Metadata**
Toggle: "Use source feed metadata" (default, auto-fills from first probe result) vs. "Override output metadata" (shows: output title, description, link).

**Section 4 — Item Cleanup**
Strip HTML from title toggle, strip HTML from description toggle, strip dangerous HTML from content toggle, truncate description (character count input), use content as description fallback toggle, normalize whitespace toggle, title prefix input, title suffix input.

**Section 5 — Link Cleanup**
Remove tracking parameters toggle (default on), allowed query parameters input (comma-separated), blocked query parameters input (comma-separated), force HTTPS toggle.

**Section 6 — Dates & GUIDs**
Date strategy select (human-friendly labels):
- "Published date"
- "Updated date"
- "Published, then updated"
- "Published, then updated, then fetch time" (default)
- "Fetch time only"

GUID strategy select:
- "Existing GUID"
- "Link URL"
- "Existing GUID, then link or hash" (default)
- "Title + link + date hash"
- "Content hash"

**Section 7 — Filters**
Exclude rules visible by default; include rules collapsed. Each rule row: field select, match type select, value input, case-sensitive toggle. Add/remove rows per group.

### TypePickerGrid change

Remove "coming soon" badge from `feedTransformer`. Set display label to "Existing Feed".

---

## Error Handling

| Condition | User-facing message |
|---|---|
| Source URL unreachable | "Could not reach the source feed URL." |
| HTTP 4xx/5xx | "The source feed URL returned an error (HTTP {status})." |
| Unrecognised format | "Mkfd could not detect RSS, Atom, or JSON Feed data at this URL." |
| Empty feed | "The source feed parsed successfully but contains no items." |
| All items filtered out | "All source items were removed by the active filter rules." |
| Invalid dates | Warning: "Some items had invalid dates and used the configured date strategy fallback." |
| Missing GUIDs | Warning: "Some items were missing GUIDs and received generated stable IDs." |

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/feed-transformer.model.ts` | All feedTransformer types + BasicItemTransformConfig |
| Create | `models/normalized-feed-item.model.ts` | Shared normalized item type |
| Modify | `models/feed-config.model.ts` | Add feedTransformer to FeedType union + config union |
| Create | `utilities/existing-feed-parser.utility.ts` | Fetch + parse RSS/Atom/JSON → NormalizedFeedItem[] |
| Create | `utilities/feed-item-transform.utility.ts` | Text, link, GUID, date transforms (pure/sync) |
| Create | `utilities/feed-item-filter.utility.ts` | Include/exclude filter rules (pure/sync) |
| Create | `utilities/normalized-feed-builder.utility.ts` | NormalizedFeedItem[] → Feed object |
| Create | `utilities/feed-transformer.utility.ts` | Pipeline orchestrator |
| Modify | `workers/feed-updater.worker.ts` | Add feedTransformer branch |
| Modify | `index.ts` | Add /probe endpoint; extend /preview and save endpoints |
| Create | `frontend/src/components/forms/ExistingFeedTransformerForm.tsx` | 7-section builder form |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Register feedTransformer form |
| Modify | `frontend/src/components/builder/TypePickerGrid.tsx` | Activate feedTransformer type |

---

## Tests

### Unit (backend)

```text
[ ] Parse RSS feed → correct NormalizedFeedItem[] fields
[ ] Parse Atom feed → correct NormalizedFeedItem[] fields
[ ] Parse JSON Feed → correct NormalizedFeedItem[] fields
[ ] Auto-detect RSS from XML root
[ ] Auto-detect Atom from XML root
[ ] Auto-detect JSON Feed from content-type
[ ] Strip HTML from description
[ ] Truncate description to character limit
[ ] Remove default tracking params from link
[ ] allowedParams removes all params not in list
[ ] forceHttps upgrades http:// links
[ ] GUID strategy: existingOrLinkHash uses guid first
[ ] GUID strategy: titleLinkDateHash produces stable hash
[ ] Date strategy: publishedOrUpdatedOrFetched falls back correctly
[ ] Exclude filter: contains match removes item
[ ] Include filter: item must match at least one rule
[ ] Invalid regex filter: skips rule, does not crash
[ ] categories field: rule matches any category in array
[ ] mergeStrategy dateDesc: items sorted newest first
[ ] mergeStrategy preserveOrder: source order preserved
[ ] dedupeAcrossSources: removes duplicate GUIDs across sources
[ ] maxItems: output capped correctly
```

### Integration

```text
[ ] POST /api/feeds/transformer/probe returns metadata for valid RSS URL
[ ] POST /api/feeds/transformer/probe returns structured error for bad URL
[ ] POST /preview with feedType feedTransformer returns RSS XML
[ ] POST / creates feedTransformer config YAML
[ ] PUT /api/feeds/:id updates feedTransformer config
[ ] Worker generates .xml, .atom, .json outputs for feedTransformer feed
[ ] Feed history snapshot stored after worker run
[ ] Run log records sourceCount, inputItemCount, filteredItemCount
[ ] Validation rejects missing sources array
[ ] Validation rejects invalid source URL
[ ] Validation rejects bad regex in filter rule
```

### Manual smoke test

```text
[ ] TypePickerGrid shows "Existing Feed" as active (no "coming soon" badge)
[ ] Sources section: add/remove source rows
[ ] "Preview source" button shows detected format, title, item count, warnings
[ ] Merge strategy select persists to config
[ ] All 7 sections navigate correctly via SectionNav and SectionPager
[ ] Feed Metadata "use source" toggle auto-fills from first probe result
[ ] Filters section: add exclude rule, add include rule
[ ] Submit creates feedTransformer feed and navigates to /feeds
[ ] Worker refreshes feed on schedule; output files present in /public/feeds/
[ ] My Feeds shows feed with "Existing Feed" type badge
[ ] Health dashboard shows run history with item counts and warnings
```
