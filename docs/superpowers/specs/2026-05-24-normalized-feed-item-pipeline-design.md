# Normalized Feed Item Pipeline — Design Spec

**Date:** 2026-05-24
**Tier:** R2 Output & Operations
**Status:** Approved

---

## Goal

Define and standardize the shared item pipeline:

```text
source data -> NormalizedFeedItem[] -> Feed object -> RSS/Atom/JSON outputs
```

This removes source-specific output shaping drift and provides a common contract for current and future source types.

---

## Scope

### In scope

- Shared normalized item model
- Shared feed builder from normalized items
- Integration contract for existing and future source paths
- Basic normalization rules (IDs, dates, text fields, categories, enclosure mapping)
- Tests for deterministic feed object generation

### Out of scope

- Source-specific fetch/extraction implementations
- Advanced item transforms/filtering policy (transformer-specific specs own that)
- Output serialization implementation (`writeAllFeedFormats`) beyond integration points

---

## Core Types

### `models/normalized-feed-item.model.ts`

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
```

---

## Shared Builder Contract

### `utilities/normalized-feed-builder.utility.ts`

```ts
export type BuildFeedFromNormalizedItemsInput = {
  feedId: string;
  feedName: string;
  serverUrl?: string;
  feedMetadata: FeedRssMetadata;
  sourceUrl?: string;
  overrides?: {
    title?: string;
    description?: string;
    link?: string;
    language?: string;
    image?: string;
    copyright?: string;
    generator?: string;
  };
  sourceFeedMeta?: {
    title?: string;
    description?: string;
    siteUrl?: string;
    language?: string;
  };
  items: NormalizedFeedItem[];
};

export function buildFeedFromNormalizedItems(
  input: BuildFeedFromNormalizedItemsInput,
): Feed;
```

### Required behavior

- `feedId` is identity; `feedName` is display fallback.
- Feed title resolution order:
  1. explicit override
  2. source feed metadata title
  3. `feedName`
- Item GUID/ID fallback is deterministic when source lacks one.
- Date resolution uses `pubDate`, then `updatedDate` when needed.
- Enclosures/categories map consistently across all source types.
- XML/HTML-sensitive values are sanitized before serialization layer usage.

---

## Consumers

The following features should consume this shared model/builder, not redefine equivalents:

- Existing Feed Transformer
- Webhook feed
- Filesystem feed
- Sitemap/Calendar/GraphQL feeds
- Service connectors
- Future Source Assistant apply targets

---

## Dependencies and Ordering

Depends on:

- Feed Configuration Formalization
- Feed Format Refactor (`writeAllFeedFormats(feedId, feed)`)

Must be completed before:

- Existing Feed Transformer final integration
- Source types that produce multi-format output through shared builder

---

## Acceptance Criteria

- A shared `NormalizedFeedItem` model exists in one canonical file.
- A shared `buildFeedFromNormalizedItems` utility exists and is used by transformer/source codepaths.
- No new source feature introduces a parallel ad-hoc item-to-feed builder.
- Tests verify stable output for title/date/guid/enclosure/category mapping.
