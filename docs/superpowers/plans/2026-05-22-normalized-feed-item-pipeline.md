# Normalized Feed Item Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `NormalizedFeedItem[] -> Feed object -> RSS/Atom/JSON` into a shared Phase 2 pipeline before transformer and future source-type work.

**Architecture:** A shared model captures normalized item fields from web scraping, REST/API, email, existing-feed transformer, and future source types. A shared builder converts those items into a `Feed` object. Source-specific code remains responsible for extraction/fetching; output code remains responsible for serialization and `writeAllFeedFormats(feedId, feed)`.

**Security decision:** `feedId` remains the storage/security identifier and is passed separately to output writers. `feedName` is display/title fallback only. The normalized item shape must not carry protected config values, request headers, cookies, or resolved secrets.

**Tech Stack:** Bun, TypeScript, `feed@5.1.0`, `bun:test`

**Depends on:** Feed Config Formalization and Feed Format Refactor. Existing Feed Transformer, Source Assistant apply-target work, JSON-LD extraction, GraphQL, Sitemap, Calendar, Webhook, and Filesystem source types depend on this.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/normalized-feed-item.model.ts` | Shared normalized item, enclosure, and source types |
| Create | `utilities/normalized-feed-builder.utility.ts` | Build a `Feed` object from normalized items and feed metadata |
| Create | `tests/normalized-feed-builder.test.ts` | Unit tests for title/link/guid/date/enclosure mapping |
| Modify | `utilities/rss-builder.utility.ts` | Optionally route existing builders through normalized items when practical |

---

### Task 1: Shared model

- [ ] Add `NormalizedFeedItem` with `title`, `link`, `description`, `content`, `guid`, `pubDate`, `author`, `categories`, `image`, `enclosure`, and `source`.
- [ ] Add `NormalizedFeedEnclosure` and `NormalizedFeedSource`.
- [ ] Keep the model source-agnostic and free of fetch/config secrets.

### Task 2: Shared builder

- [ ] Add `buildFeedFromNormalizedItems({ feedId, feedName, serverUrl, metadata, sourceFeedMeta, overrides, items })`.
- [ ] Use metadata/override title first, then source title, then `feedName`.
- [ ] Use stable GUID fallback when the item lacks a GUID.
- [ ] Preserve enclosures and categories.
- [ ] Return a `Feed` object only; do not write files in this utility.

### Task 3: Tests

- [ ] Builds a valid `Feed` object from normalized items.
- [ ] Falls back to `feedName` only for display title, not output identity.
- [ ] Maps dates, GUIDs, categories, and enclosures.
- [ ] Does not expose protected values or request metadata.

### Task 4: Migrate Existing Feed Transformer to shared pipeline

**Files:**
- Modify: `utilities/existing-feed-transformer.utility.ts` (or equivalent)

- [ ] Find all local definitions of `NormalizedFeedItem` or equivalent item-builder types inside the Existing Feed Transformer.
- [ ] Delete those local definitions.
- [ ] Add import of `NormalizedFeedItem`, `NormalizedFeedEnclosure`, `NormalizedFeedSource` from `models/normalized-feed-item.model.ts`.
- [ ] Replace calls to any local feed-builder function with `buildFeedFromNormalizedItems(...)` from `utilities/normalized-feed-builder.utility.ts`.
- [ ] Run existing transformer tests to confirm no regression:
```bash
bun test tests/existing-feed-transformer.test.ts
```
Expected: PASS with no behavior change.

- [ ] Commit:
```bash
git add utilities/existing-feed-transformer.utility.ts models/normalized-feed-item.model.ts utilities/normalized-feed-builder.utility.ts
git commit -m "refactor: migrate existing-feed-transformer to shared normalized item pipeline"
```

> **Note for future source types:** Web Scraping, JSON-LD, GraphQL, Sitemap, Calendar, and all other source implementations must return `NormalizedFeedItem[]` and call `buildFeedFromNormalizedItems`. Do not reintroduce local item/feed-builder duplicates.
