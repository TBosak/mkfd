# Feed Format Refactor — Design Spec

**Date:** 2026-05-22
**Tier:** R2 Output & Operations
**Status:** Approved

---

## Goal

Every Mkfd-generated feed automatically outputs RSS 2.0 (`.xml`), Atom (`.atom`), and JSON Feed (`.json`) from a single `Feed` object. No per-feed config option controls format output. Feed history snapshots switch from RSS XML to a format-agnostic JSON item array. Item hash tracking and feed snapshots run for every feed, not just webhook-enabled ones. Webhook new-item detection switches from XML diffing to item hash comparison.

---

## Scope

### In scope

- `utilities/feed-output.utility.ts` — new file: `SerializedFeedOutputs`, `FeedOutputUrls`, `FeedItemSnapshot`, `serializeAllFeedFormats`, `writeAllFeedFormats`, `extractFeedItemSnapshots`
- `utilities/rss-builder.utility.ts` — add `buildFeedObject` and `buildFeedObjectFromApiData` returning `{ feed: Feed, metrics: BuildMetrics }`; existing `buildRSS` / `buildRSSFromApiData` become one-line wrappers
- `workers/feed-updater.worker.ts` — universal post-generation flow; hash-based webhook new-item detection; `.atom` and `.json` written for all feeds
- `index.ts` — `feedUrls: { rss2, atom, json }` in save/update responses; `?format=rss2|atom|json` on preview endpoint
- Frontend success toast shows all three URLs
- `FeedPreview` component gains a format selector (RSS / Atom / JSON)
- `GET /api/feeds` response includes `outputUrls` per feed
- Active Feeds page adds basic Atom and JSON copy/open actions

### Out of scope

- Email feed worker — runs in a separate Node process; multi-format output addressed when email is refactored
- My Feeds Redesign full UI — the Redesign spec owns card layout; this spec only adds `outputUrls` to the data and basic actions
- MIME type route overrides (e.g. `GET /feeds/:id/rss`) — static file serving is acceptable for now
- Atomic file writes (write to `.tmp` then rename) — deferred to a future hardening pass
- Feed format config options (`outputs.rss2: true`) — explicitly not added; all three formats are always written

---

## Output Helpers

### `utilities/feed-output.utility.ts` (new)

```ts
import { mkdirSync } from "node:fs";
import type { Feed } from "feed";

export type SerializedFeedOutputs = { rss2: string; atom: string; json: string };
export type FeedOutputUrls        = { rss2: string; atom: string; json: string };

export type FeedItemSnapshot = {
  guid?:    string;
  link?:    string;
  title?:   string;
  pubDate?: string;
};

export function serializeAllFeedFormats(feed: Feed): SerializedFeedOutputs {
  // Serialize all before any write — if any format throws, no files are touched
  return {
    rss2: feed.rss2(),
    atom: feed.atom1(),
    json: feed.json1(),
  };
}

export async function writeAllFeedFormats(
  feedId: string,
  feed: Feed,
  outputDir = "./public/feeds",
): Promise<FeedOutputUrls> {
  mkdirSync(outputDir, { recursive: true });
  const outputs = serializeAllFeedFormats(feed);
  await Bun.write(`${outputDir}/${feedId}.xml`,  outputs.rss2);
  await Bun.write(`${outputDir}/${feedId}.atom`, outputs.atom);
  await Bun.write(`${outputDir}/${feedId}.json`, outputs.json);
  return {
    rss2: `/public/feeds/${feedId}.xml`,
    atom: `/public/feeds/${feedId}.atom`,
    json: `/public/feeds/${feedId}.json`,
  };
}

export function extractFeedItemSnapshots(feed: Feed): FeedItemSnapshot[] {
  return feed.items.map((item) => ({
    guid:    item.id,
    link:    item.link,
    title:   item.title,
    pubDate: item.date?.toISOString(),
  }));
}
```

`serializeAllFeedFormats` is called before any Bun.write so a serialization failure leaves all three existing files untouched.

---

## Builder Additions

### `utilities/rss-builder.utility.ts` (extended)

New exported type:

```ts
export type BuildFeedObjectResult = {
  feed: Feed;
  metrics: BuildMetrics;
};
```

New functions — the internal Feed construction logic moves into these; the originals become wrappers:

```ts
export async function buildFeedObject(
  html: unknown,
  feedConfig: unknown,
  dateIndex?: Map<string, string>,
): Promise<BuildFeedObjectResult>

export async function buildFeedObjectFromApiData(
  apiData: unknown,
  feedConfig: unknown,
  dateIndex?: Map<string, string>,
): Promise<BuildFeedObjectResult>
```

Existing functions become one-line wrappers — no callers break:

```ts
export async function buildRSS(html, feedConfig, dateIndex?): Promise<BuildRSSResult> {
  const { feed, metrics } = await buildFeedObject(html, feedConfig, dateIndex);
  return { xml: feed.rss2(), metrics };
}

export async function buildRSSFromApiData(apiData, feedConfig, dateIndex?): Promise<BuildRSSResult> {
  const { feed, metrics } = await buildFeedObjectFromApiData(apiData, feedConfig, dateIndex);
  return { xml: feed.rss2(), metrics };
}
```

---

## Worker Update

### `workers/feed-updater.worker.ts`

The post-generation block becomes universal — runs for every feed type after the `Feed` object is built, regardless of whether a webhook is configured:

```ts
// After feed is built:
const outputs     = serializeAllFeedFormats(feed);           // get strings for history + webhook
const outputUrls  = await writeAllFeedFormats(feedConfig.feedId, feed);
const snapshots   = extractFeedItemSnapshots(feed);
await storeFeedHistory(
  feedConfig.feedId,
  JSON.stringify(snapshots),
  "items_json",
);

// Detect new items using hash comparison (replaces XML diffing)
const newItems = currentRawItems.filter((item) => !knownHashes.has(makeItemKey(item)));
await saveDateIndex(feedConfig.feedId, updatedDateIndex);

// Webhook delivery — only if configured
if (webhookConfig?.enabled && webhookConfig?.url && newItems.length > 0) {
  // Use existing createWebhookPayload / createJsonWebhookPayload depending on webhook format
  // Pass the RSS output from writeAllFeedFormats for payload construction (existing signature)
  await sendWebhook(webhookConfig, payload);
}
```

**Key change:** `loadDateIndex` is called before feed generation (to get `knownHashes`). New items are those whose `makeItemKey` result is not in `knownHashes`. `storeFeedHistory` and `saveDateIndex` run unconditionally for all feeds — webhook delivery is the only conditional step.

**Email feed:** The email worker runs in a separate Node process (`workers/imap-feed.worker.ts`). Multi-format output and universal history tracking for email are out of scope for this plan and addressed when the email worker is refactored.

---

## Save Response + Preview Format

### `index.ts` — POST `/` and PUT `/api/feeds/:id`

Response shape — `feedUrl` dropped entirely (nothing reads it):

```ts
return c.json({
  message: "Feed is being generated.",
  feedId: config.feedId,
  feedUrls: {
    rss2: `/public/feeds/${config.feedId}.xml`,
    atom: `/public/feeds/${config.feedId}.atom`,
    json: `/public/feeds/${config.feedId}.json`,
  },
  config: maskProtectedValues(config),
});
```

### `index.ts` — POST `/preview`

Optional `?format=rss2|atom|json` query param, defaulting to `rss2`:

```ts
type PreviewFormat = "rss2" | "atom" | "json";

const format = (c.req.query("format") ?? "rss2") as PreviewFormat;
const outputs = serializeAllFeedFormats(feed);
const body = outputs[format] ?? outputs.rss2;

const contentType: Record<PreviewFormat, string> = {
  rss2: "application/rss+xml; charset=utf-8",
  atom: "application/atom+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};

return c.text(body, 200, { "Content-Type": contentType[format] });
```

### Frontend — success toast

After a successful feed create or update, the toast/alert shows all three URLs. The `FeedPreview` component gains a three-option format selector (RSS / Atom / JSON) that appends `?format=` to the preview request URL.

---

## My Feeds UI

### `GET /api/feeds` response

Each feed summary object gains:

```ts
outputUrls: {
  rss2: `/public/feeds/${feedId}.xml`,
  atom: `/public/feeds/${feedId}.atom`,
  json: `/public/feeds/${feedId}.json`,
}
```

These are derived from `feedId` — no additional DB queries needed.

### Active Feeds page

Two additional actions alongside the existing RSS link/copy button:

- **Open Atom** — opens `outputUrls.atom` in a new tab
- **Copy Atom URL** — copies `outputUrls.atom` to clipboard
- **Open JSON Feed** — opens `outputUrls.json` in a new tab
- **Copy JSON Feed URL** — copies `outputUrls.json` to clipboard

Exact component placement is left loose — the My Feeds Redesign spec will restructure this page. This spec only ensures the actions exist and the data flows correctly.

---

## What This Spec Does Not Cover

- Email worker multi-format output — separate refactor
- My Feeds Redesign card layout — My Feeds spec owns that
- MIME type route overrides for feed URLs
- Atomic file writes
- Feed format config options — explicitly never added; all three formats always written
- `feedUrl` in save response — dropped; nothing was consuming it
