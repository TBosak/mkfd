# Mkfd Refined Release Approach

This document refines the Mkfd enhancement roadmap using the current repo reality and the latest agent review.

The central correction is this:

> SQLite runtime state should not remain fully deferred. The broad runtime-state vision can stay incremental, but the small SQLite substrate must move into foundation work so feed history, run history, webhook events, filesystem scan state, sitemap state, and service connector cursors do not each invent separate persistence.

Mkfd should continue to keep YAML as the portable, user-owned feed configuration format. SQLite should store runtime state only.

---

## 1. Current repo-grounded corrections

The roadmap should be updated around these repo-grounded facts.

### Already exists or is partially implemented

- Drill Chain exists and should be reused rather than rebuilt.
- Email password encryption already exists and should be generalized rather than treated as greenfield.
- Advanced scraping is Playwright / Patchright-based.
- The frontend is already React + Vite + shadcn-style components, so frontend work is component and navigation work, not a framework migration.
- Feed output currently uses feed IDs for generated feed filenames. Do not switch feed output filenames to feed names.
- Feed history currently exists as XML snapshots under `./feed-history/{feedId}.xml`.
- Feed Health / Run History appears to already introduce or depend on a persistence layer and should be reconciled with the new runtime-state substrate.

### Important correction

Do not generate feed output files from `feedName`.

Use:

```text
/public/feeds/{feedId}.xml
/public/feeds/{feedId}.atom
/public/feeds/{feedId}.json
```

`feedName` is display metadata. `feedId` is the stable identity for URLs, config association, feed history, run history, deduplication, and future state tables.

---

## 2. Architectural rule

Mkfd should separate stable configuration from volatile runtime state.

### YAML remains the source of truth for portable config

Keep these in `/app/configs/{feedId}.yaml`:

```text
feedId
feedName
feedType
enabled
refreshTime
source-specific config
RSS/feed metadata
user metadata
tags
category
favorite
origin
protected values
template-resolved values
```

### SQLite stores runtime state

Use one runtime SQLite database. The old `health.db` role becomes `runtime.db`: existing `run_logs` and `settings` stay in the same schema, and feed history/runtime-state tables are added there. This branch already has `health.db` configured but is not live, so implementation should directly update existing `lib/analytics/*`, Drizzle, Docker/env, startup, and health API touchpoints to use `runtime.db`/`RUNTIME_DB_PATH` rather than adding another DB or preserving `DB_PATH` compatibility.

Move or create these in SQLite:

```text
previous feed snapshots
parsed feed item history
feed run history (`run_logs`)
feed health state
webhook events
filesystem scan state
sitemap URL state
service connector cursors
catalog cache
source analysis cache
deduplication records
migration records
```

Do not move feed configs into SQLite. That would weaken Mkfd’s portability and make community config sharing harder.

---

## 3. Refined dependency tiers

Each tier depends on the tiers above it.

```text
TIER 0 — Foundation
  Optional Config Value Encryption
  Feed Configuration Formalization
  SQLite Runtime Substrate + Feed History Migration
  Minimal inline validation
  Small tweaks and bug fixes

TIER 1 — Output and operations
  Feed Format refactor
  Feed Config Management GUI
  Active Feeds / My Feeds redesign

TIER 2 — Scraping intelligence
  Source Assistant spine + web scraping route
  JSON-LD Integration
  Web Scraping Form Data
  Fetch Policy / Retry / Fallback
  Proxy / User-Agent Profiles

TIER 3 — Catalog and import
  Parameterized Feed Config Templates
  Community Catalog
  Service Connector GitHub Issue Template

TIER 4 — New source types
  Sitemap
  Calendar
  GraphQL
  Webhook
  Filesystem

TIER 5 — Service connectors
  Connector registry
  Jellyfin reference connector
  Additional connector presets
  Cursor/state integration
```

---

## 4. Tier 0 foundation details

Tier 0 should be small but strict. Its job is to prevent future plans from creating incompatible models.

### 4.1 Optional Config Value Encryption

This should generalize the existing encryption utility rather than replacing it.

Add a universal `ProtectedValue` model:

```ts
export type ProtectedValue =
  | {
      type: "protected";
      value: string;
    }
  | {
      type: "env";
      value: string;
      prefix?: string;
      suffix?: string;
    };
```

Use this across:

```text
headers
cookies
form fields
REST params
REST request bodies
GraphQL variables
webhook URLs
webhook headers
service connector auth
template secrets
proxy credentials
```

Rules:

```text
Plain values remain allowed where appropriate.
Sensitive-looking values should warn.
Service connector auth should require protected or env values.
Runtime resolution should happen only at execution time.
API responses should mask protected values.
Editing should preserve masked protected values unless replaced.
```

### 4.2 Feed Configuration Formalization

Add a `schemaVersion: 2` config shape that formalizes the existing structure instead of replacing it wholesale.

Use this general pattern:

```yaml
schemaVersion: 2
feedId: 042a8d6a-462c-47dd-a650-a6638ff6260f
feedName: example
feedType: webScraping
enabled: true
refreshTime: 5
reverse: false
strict: false
advanced: false

metadata: {}

config: {}
article: {}
apiMapping: {}
graphql: {}
calendar: {}
sitemap: {}
filesystem: {}
webhookFeed: {}
serviceConnector: {}

feedDescription: ""
feedGenerator: MkFD Feed Generator
feedDocs: https://www.rssboard.org/rss-specification
feedCategories: []
feedSkipHours: []
feedSkipDays: []
```

Do not force a major source model rewrite immediately. Normalize existing configs into a typed model internally.

Compatibility requirements:

```text
Existing configs without schemaVersion remain valid.
Existing feedType: api remains valid.
New REST-style configs may use feedType: rest.
Workers treat api and rest equivalently.
Existing article.pubDate and article.date must both work.
Existing email encryptedPassword remains valid.
New email configs should prefer password: ProtectedValue.
```

### 4.3 Close the web-scraping schema gap now

The config model should define request and extraction blocks before `schemaVersion: 2` ships.

Minimum web scraping additions:

```yaml
config:
  baseUrl: https://example.com/news
  request:
    mode: simple

extraction:
  mode: cssSelectors

article:
  iterator:
    selector: article
  title:
    selector: h2
  link:
    selector: a
    attribute: href
```

Form submission can later use:

```yaml
config:
  baseUrl: https://example.com/search
  request:
    mode: form
    method: POST
    actionUrl: https://example.com/search/results
    encoding: application/x-www-form-urlencoded
    fields:
      q: city council
```

JSON-LD can later use:

```yaml
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
    mapping:
      title: headline
      description: description
      link: url
      pubDate: datePublished
      author: author.name
      enclosure: image.url
      guid: "@id"
```

Legacy web scraping configs normalize as:

```text
missing extraction block -> extraction.mode = cssSelectors
legacy article selectors -> current article selectors
```

### 4.4 SQLite Runtime Substrate + Feed History Migration

This is the main roadmap refinement.

Do not build the entire future runtime-state system immediately. Build the substrate and migrate feed history first.

#### Required foundation pieces

```text
SQLite connection utility
migration runner
runtime_migrations table
existing run_logs/settings tables remain in the same DB
feed_history_snapshots table
feed_history_items table
legacy ./feed-history import
lazy fallback migration for missed legacy files
state-store interfaces for future source types
```

#### Initial schema

```sql
CREATE TABLE IF NOT EXISTS runtime_migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS feed_history_snapshots (
  feed_id TEXT PRIMARY KEY,
  format TEXT NOT NULL DEFAULT 'rss2',
  rss_xml TEXT NOT NULL,
  content_hash TEXT,
  item_count INTEGER,
  migrated_from_path TEXT,
  migrated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_history_items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  guid TEXT,
  link TEXT,
  title TEXT,
  title_hash TEXT,
  item_hash TEXT NOT NULL,
  pub_date TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source_snapshot_hash TEXT,
  UNIQUE(feed_id, item_hash)
);
```

#### Feed history store interface

```ts
export interface FeedHistoryStore {
  getPreviousFeedHistory(feedId: string): Promise<string | null>;
  storeFeedHistory(feedId: string, rssXml: string): Promise<void>;
  clearFeedHistory(feedId: string): Promise<void>;
  migrateLegacyFeedHistoryFiles(): Promise<FeedHistoryMigrationResult>;
}
```

Keep current function names as wrappers where useful so worker code does not require a large rewrite.

#### Startup migration behavior

On startup:

```text
1. Ensure SQLite exists.
2. Run migrations.
3. Scan ./feed-history/*.xml.
4. Derive feedId from each filename.
5. Validate the feedId is safe.
6. Read the XML snapshot.
7. Compute a content hash.
8. Insert into feed_history_snapshots if not already present.
9. Parse items opportunistically into feed_history_items.
10. Leave the legacy XML file in place.
11. Record migration details.
12. Log a summary.
```

Use copy-forward migration, not destructive migration.

#### Runtime fallback behavior

```text
getPreviousFeedHistory(feedId)
  -> try SQLite
  -> if missing, try ./feed-history/{feedId}.xml
  -> if found, lazily migrate it
  -> return XML
```

```text
storeFeedHistory(feedId, rssXml)
  -> write SQLite snapshot
  -> update item history
  -> optionally mirror to legacy XML for one transitional release
```

```text
clearFeedHistory(feedId)
  -> delete SQLite snapshot/items
  -> delete legacy XML if present
```

This keeps existing deployed instances safe.

### 4.5 Minimal inline validation

The full validation plan can wait, but basic guards cannot.

Implement a small validator that checks:

```text
required top-level fields
required source block for selected feedType
valid feedId
valid refreshTime
valid feedType
missing protected env values
plain sensitive values warning
catalog eligibility rules
serviceConnector configs excluded from catalog
unsupported extraction modes
```

This validator should run on:

```text
preview
save
import
catalog submission
worker startup config load
```

### 4.6 Immediate tweaks

Ship these early:

```text
Add an unfilter / clear filter action to the run log after navigating from a Feed Health card.
Remove the "View Active Feeds" footer link.
Center "Created by Tim Barani".
```

---

## 5. Tier 1 output and operations

### 5.1 Feed Format refactor

Refactor feed generation around a shared object pipeline:

```text
source data
  -> normalized feed items
  -> Feed object
  -> serialize RSS 2.0, Atom, JSON Feed
  -> write all outputs by feedId
```

Helper shape:

```ts
export type SerializedFeedOutputs = {
  rss2: string;
  atom: string;
  json: string;
};

export type FeedOutputUrls = {
  rss2: string;
  atom: string;
  json: string;
};

export function serializeAllFeedFormats(feed: Feed): SerializedFeedOutputs {
  return {
    rss2: feed.rss2(),
    atom: feed.atom1(),
    json: feed.json1(),
  };
}
```

Writer:

```ts
export async function writeAllFeedFormats(
  feedId: string,
  feed: Feed,
): Promise<FeedOutputUrls> {
  const outputs = serializeAllFeedFormats(feed);

  await Bun.write(`./public/feeds/${feedId}.xml`, outputs.rss2);
  await Bun.write(`./public/feeds/${feedId}.atom`, outputs.atom);
  await Bun.write(`./public/feeds/${feedId}.json`, outputs.json);

  return {
    rss2: `/public/feeds/${feedId}.xml`,
    atom: `/public/feeds/${feedId}.atom`,
    json: `/public/feeds/${feedId}.json`,
  };
}
```

Do not parse RSS XML back into Atom or JSON. Generate all formats from the same `Feed` object.

### 5.2 Feed Config Management GUI

Build local YAML config management before or alongside the My Feeds redesign.

MVP:

```text
list configs
view config details
edit metadata
duplicate config
export config
delete config
import YAML
validate before save
show schema version
show compatibility warnings
preserve protected values
```

### 5.3 Active Feeds / My Feeds redesign

Rename the operational page to **My Feeds**.

It should summarize installed feed configs plus runtime state.

MVP:

```text
search feeds
filter by feed type
filter enabled/disabled
tags
category
favorite
status badge
output links for RSS / Atom / JSON Feed
copy feed URLs
preview
edit
duplicate
export
delete
warning badges for protected/plain sensitive values
```

Runtime-backed fields should come from SQLite:

```text
lastRunAt
lastSuccessAt
lastErrorAt
lastErrorMessage
lastItemCount
lastNewItemCount
```

Stable organization fields stay in YAML metadata:

```text
title
description
tags
category
favorite
origin
enabled
```

---

## 6. Tier 2 scraping intelligence

### 6.1 Source Assistant spine

Build Source Assistant as the canonical analysis engine.

Core rule:

```text
Analyze once, reuse everywhere.
```

The assistant should produce a reusable observation object and ranked recommendations.

Top-level route types:

```text
existingFeed
sitemap
calendar
restApi
graphql
serviceConnector
webScraping
changeDetection
manual
```

Do not make JSON-LD or Drill Chain top-level route types. Those are internal web scraping extraction plans.

For the first phase, implement the engine and web-scraping route. Add non-web route scorers with their source types later.

Because Existing Feed Transformer is deferred, existing feed discovery should initially be detect-and-recommend only.

### 6.2 JSON-LD Integration

Add JSON-LD as a first-class web scraping extraction mode.

Supported workflows:

```text
page-level JSON-LD
Drill Chain + JSON-LD
Drill Chain + JSON-LD with CSS fallback
JSON-LD with CSS fallback
manual CSS selectors
```

Reuse Source Assistant observations instead of performing duplicate analysis.

### 6.3 Web Scraping Form Data

Support form submission as a request setup.

MVP:

```text
detect static forms
GET form submission
POST form submission
x-www-form-urlencoded
manual JSON body form
field editing
protected form field values
preview against submitted result page
worker refresh using submitted request
```

Avoid in MVP:

```text
CAPTCHA
login automation
multi-step flows
browser-driven interaction
dynamic CSRF refresh
file uploads
```

### 6.4 Fetch Policy / Retry / Fallback

Centralize fetch behavior before adding more source types.

Support:

```text
timeouts
retry count
retry backoff
user-agent selection
standard vs advanced fetch
FlareSolverr fallback
private network allow/deny
safe redirect policy
max response size
```

### 6.5 Proxy / User-Agent Profiles

Add reusable request profiles.

This reduces duplicated per-feed request configuration and improves scraping reliability.

---

## 7. Tier 3 catalog and import

### 7.1 Parameterized Feed Config Templates

Build templates before or alongside the catalog.

Templates resolve at import time. Workers should only process normal resolved feed configs.

Supported placeholders:

```text
{{ owner }}
{{ repo }}
{{ searchTerm | urlEncode }}
{{ category | slug }}
{{ secret.token }}
{{ secret.token | bearer }}
```

Supported filters:

```text
trim
lower
upper
slug
urlEncode
bearer
```

No arbitrary expressions, loops, JavaScript, or process access.

### 7.2 Community Catalog

Catalog configs should be static, remotely fetchable, and importable without app updates.

MVP:

```text
remote manifest
remote YAML fetch
local cache
preview catalog config
import with generated feedId
template variable form
catalog origin metadata
catalog eligibility checks
```

Rules:

```text
catalog configs must not include private local secrets
catalog configs must not include encrypted ciphertext
catalog configs should omit feedId
import assigns a new feedId
serviceConnector configs are excluded initially
```

### 7.3 Service Connector issue template

This can ship independently as repo hygiene. It helps collect structured requests before the connector framework is mature.

---

## 8. Tier 4 new source types

### 8.1 Sitemap

Sitemap should be first among new source types because it strengthens web discovery and Source Assistant.

Modes:

```text
urlList
pageMetadata
jsonLd
jsonLdWithFallback
changeDetection later
```

State needs:

```text
first seen URL date
last seen URL date
lastmod tracking
content hash later
sample cache
```

Use SQLite, not ad hoc JSON files.

### 8.2 Calendar

Calendar feeds are structured and relatively isolated.

MVP:

```text
public ICS URL
event window
max events
recurrence expansion
date strategy
link strategy
RSS item mapping
```

Calendar may not need much runtime state at first beyond run history and item history.

### 8.3 GraphQL

Implement after the Feed Format refactor so structured-data mapping returns a `Feed` object instead of RSS XML.

GraphQL should reuse REST/API mapping infrastructure:

```text
POST query
variables
operationName
headers
itemPath
field mapping
preview response
detect array candidates
```

### 8.4 Webhook

Webhook feeds require runtime persistence immediately.

Store events in SQLite.

Initial table direction:

```sql
CREATE TABLE IF NOT EXISTS webhook_feed_events (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  external_id TEXT,
  received_at TEXT NOT NULL,
  event_date TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  link TEXT,
  author TEXT,
  categories_json TEXT,
  severity TEXT,
  metadata_json TEXT,
  raw_payload_json TEXT,
  dedupe_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_feed_events_feed_date
ON webhook_feed_events(feed_id, event_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_feed_events_dedupe
ON webhook_feed_events(feed_id, dedupe_key);
```

MVP supports native Mkfd event JSON only.

### 8.5 Filesystem

Filesystem feeds also require runtime state.

Use SQLite for:

```text
firstSeenAt
lastSeenAt
file path
file metadata
file hash optional
last emitted hash
disappeared file tracking later
```

Avoid in MVP:

```text
OCR
PDF text extraction
DOCX extraction
live fs.watch
symlink traversal
arbitrary paths
```

Use polling on refresh interval.

---

## 9. Tier 5 service connectors

Service connectors should be normal feed configs.

No separate connector config directory. No separate connection documents.

Shape:

```yaml
feedType: serviceConnector
feedName: jellyfin-latest-movies
refreshTime: 30

metadata:
  title: Jellyfin Latest Movies
  category: media
  localOnly: true
  visibility: private

serviceConnector:
  service: jellyfin
  connection:
    label: Home Jellyfin
    auth:
      mode: apiKey
      fields:
        apiKey:
          type: protected
          value: ENC:...
    settings:
      baseUrl: http://jellyfin:8096
      allowPrivateNetwork: true
  resource:
    type: library
    id: movies
    label: Movies
  preset: latestItems
  options:
    maxItems: 50
  cursor:
    strategy: latestTimestamp
    field: DateCreated
```

State should go to SQLite:

```text
service
resource type
resource id
preset
cursor
lastSeenId
lastSeenAt
lastFetchedAt
rate limit state
```

Start with Jellyfin as the reference connector.

---

## 10. Runtime state tables to reserve

The foundation does not need to implement all of these immediately, but the schema direction should be consistent.

Recommended runtime tables:

```text
run_logs
feed_run_outputs
feed_run_warnings
feed_history_snapshots
feed_history_items
webhook_feed_events
filesystem_scan_entries
sitemap_url_state
service_connector_state
catalog_cache_entries
source_analysis_cache
connector_cursors
runtime_migrations
```

The important rule:

```text
Every new runtime-state feature extends SQLite instead of creating a separate JSONL or file-state store.
```

---

## 11. Implementation order checklist

### Foundation checklist

```text
[ ] Add universal ProtectedValue model
[ ] Add protected value utility
[ ] Preserve masked protected values on edit
[ ] Add schemaVersion 2 FeedConfig model
[ ] Add request/extraction blocks for web scraping
[ ] Add compatibility normalizer for legacy configs
[ ] Add minimal validator
[ ] Add SQLite runtime utility
[ ] Add migration runner
[ ] Add feed_history_snapshots
[ ] Add feed_history_items
[ ] Add legacy feed-history migration
[ ] Add lazy legacy feed-history fallback
[ ] Update workers to use FeedHistoryStore
[ ] Keep output filenames feedId-based
[ ] Fix footer
[ ] Add run-log unfilter action
```

### Output and operations checklist

```text
[ ] Refactor RSS builders to return Feed objects
[ ] Add serializeAllFeedFormats
[ ] Add writeAllFeedFormats(feedId, feed)
[ ] Update current source paths
[ ] Return RSS / Atom / JSON URLs from save endpoints
[ ] Add config list endpoint
[ ] Add config export / duplicate / delete endpoints
[ ] Add My Feeds page
[ ] Add feed output URL controls
[ ] Add metadata editing
```

### Scraping intelligence checklist

```text
[ ] Add SourceAssistantObservation model
[ ] Add SourceAssistantRecommendation model
[ ] Add existing feed discovery
[ ] Add page JSON-LD parsing
[ ] Reuse current selector suggestion engine
[ ] Add Drill Chain detail-page sampling
[ ] Hydrate Web Scraping form from analysis
[ ] Add JSON-LD mapping UI
[ ] Add form detection endpoint
[ ] Add form request execution path
```

### Catalog checklist

```text
[ ] Add template model
[ ] Add template parser
[ ] Add template renderer
[ ] Add dynamic import form
[ ] Add catalog manifest
[ ] Add catalog fetch/cache
[ ] Add import endpoint
[ ] Add catalog page
[ ] Add catalog eligibility checks
```

### New source type checklist

```text
[ ] Add Sitemap source
[ ] Add Calendar source
[ ] Add GraphQL source
[ ] Add Webhook source with SQLite events
[ ] Add Filesystem source with SQLite scan state
```

### Connector checklist

```text
[ ] Add service connector model
[ ] Add connector registry
[ ] Add protected connector auth
[ ] Add connector state table
[ ] Add Jellyfin connector
[ ] Add connector UI flow
```

---

## 12. Summary

The refined approach is:

```text
Keep YAML portable.
Move runtime state to SQLite.
Make feed history migration the first SQLite deliverable.
Keep feedId as the stable identity everywhere.
Generalize existing encryption instead of rebuilding it.
Formalize existing config shapes before expanding source types.
Refactor feed output before GraphQL and future structured sources.
Build Source Assistant once and reuse its observations.
Let each new source type extend the shared config, output, validation, and runtime-state layers.
```

This keeps Mkfd from becoming a pile of feature-specific implementations and moves it toward a coherent self-hosted feed engineering workbench.
