# Feed Format Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Mkfd feed writes RSS 2.0, Atom, and JSON Feed on every run; feed history snapshots become format-agnostic item JSON; item hash tracking runs for all feeds; webhook new-item detection switches from XML diffing to hash comparison.

**Architecture:** A new `feed-output.utility.ts` adds `serializeAllFeedFormats` and `writeAllFeedFormats`. The rss-builder gains `buildFeedObject` and `buildFeedObjectFromApiData` that return a `Feed` object; existing functions become one-line wrappers. The worker's post-generation block becomes universal. `index.ts` drops the unused `feedUrl` response field, adds `feedUrls`, and gains a `?format=` param on preview.

**Security decision:** `feedId` is the immutable storage/security identifier. `writeAllFeedFormats` must reject unsafe feed ids before interpolating them into filesystem paths or public URLs. The canonical output extensions are `.xml`, `.atom`, and `.json`, and API responses should use keys `{ rss2, atom, json }`.

**Tech Stack:** Bun, TypeScript, `feed@5.1.0` (existing), `bun:test`, React, shadcn/ui

**Depends on:** SQLite Runtime Substrate + Feed History must be executed first — this plan calls `storeFeedHistory(feedId, data, "items_json")` through the runtime DB-backed store.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `utilities/feed-output.utility.ts` | `serializeAllFeedFormats`, `writeAllFeedFormats`, `extractFeedItemSnapshots`, shared output types |
| Modify | `utilities/rss-builder.utility.ts` | Add `buildFeedObject`, `buildFeedObjectFromApiData`; wrap existing functions |
| Modify | `workers/feed-updater.worker.ts` | Use new builders; universal post-generation block; hash-based webhook detection |
| Modify | `index.ts` | Drop `feedUrl`, add `feedUrls`; `?format=` on preview; `outputUrls` on feed list |
| Create | `tests/feed-output.test.ts` | Tests for output helpers |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Show all three URLs in success toast |
| Modify | `frontend/src/components/forms/FeedPreview.tsx` | Format selector (RSS / Atom / JSON) |
| Modify | `frontend/src/pages/ActiveFeedsPage.tsx` | Atom and JSON copy/open actions |

---

### Task 1: feed-output.utility.ts

**Files:**
- Create: `utilities/feed-output.utility.ts`
- Create: `tests/feed-output.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/feed-output.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Feed } from "feed";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  serializeAllFeedFormats,
  writeAllFeedFormats,
  extractFeedItemSnapshots,
} from "../utilities/feed-output.utility";

const TEST_DIR = "./public/feeds-test-tmp";

function makeFeed(): Feed {
  const feed = new Feed({
    title: "Test Feed",
    description: "A test",
    id: "https://example.com/feed",
    link: "https://example.com",
    updated: new Date("2026-01-01"),
  });
  feed.addItem({
    title: "Item One",
    id: "https://example.com/1",
    link: "https://example.com/1",
    date: new Date("2026-01-01"),
  });
  return feed;
}

beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

describe("serializeAllFeedFormats", () => {
  it("returns rss2 containing <rss", () => {
    expect(serializeAllFeedFormats(makeFeed()).rss2).toContain("<rss");
  });
  it("returns atom containing <feed", () => {
    expect(serializeAllFeedFormats(makeFeed()).atom).toContain("<feed");
  });
  it("returns json that parses as JSON Feed", () => {
    const parsed = JSON.parse(serializeAllFeedFormats(makeFeed()).json);
    expect(typeof parsed.version).toBe("string");
    expect(parsed.title).toBe("Test Feed");
  });
  it("serializes all formats before any write (idempotent)", () => {
    const f = makeFeed();
    const a = serializeAllFeedFormats(f);
    const b = serializeAllFeedFormats(f);
    expect(a.rss2).toBe(b.rss2);
  });
});

describe("writeAllFeedFormats", () => {
  it("writes .xml, .atom, and .json files", async () => {
    await writeAllFeedFormats("test-feed-id", makeFeed(), TEST_DIR);
    expect(existsSync(`${TEST_DIR}/test-feed-id.xml`)).toBe(true);
    expect(existsSync(`${TEST_DIR}/test-feed-id.atom`)).toBe(true);
    expect(existsSync(`${TEST_DIR}/test-feed-id.json`)).toBe(true);
  });
  it("returns correct URL paths", async () => {
    const urls = await writeAllFeedFormats("url-test", makeFeed(), TEST_DIR);
    expect(urls.rss2).toBe("/public/feeds/url-test.xml");
    expect(urls.atom).toBe("/public/feeds/url-test.atom");
    expect(urls.json).toBe("/public/feeds/url-test.json");
  });
  it("xml file contains RSS 2.0 content", async () => {
    await writeAllFeedFormats("content-test", makeFeed(), TEST_DIR);
    const content = await readFile(`${TEST_DIR}/content-test.xml`, "utf8");
    expect(content).toContain("<rss");
  });
});

describe("extractFeedItemSnapshots", () => {
  it("returns an array with one entry per feed item", () => {
    const snapshots = extractFeedItemSnapshots(makeFeed());
    expect(snapshots).toHaveLength(1);
  });
  it("maps item id to guid", () => {
    const snapshots = extractFeedItemSnapshots(makeFeed());
    expect(snapshots[0].guid).toBe("https://example.com/1");
  });
  it("maps item link", () => {
    const snapshots = extractFeedItemSnapshots(makeFeed());
    expect(snapshots[0].link).toBe("https://example.com/1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/feed-output.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create utilities/feed-output.utility.ts**

```typescript
// utilities/feed-output.utility.ts
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
  if (!/^[A-Za-z0-9_-]+$/.test(feedId)) {
    throw new Error(`Unsafe feedId: ${feedId}`);
  }
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/feed-output.test.ts
```

Expected: PASS

- [ ] **Step 5: Run all tests to confirm no regressions**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add utilities/feed-output.utility.ts tests/feed-output.test.ts
git commit -m "feat: add serializeAllFeedFormats, writeAllFeedFormats, extractFeedItemSnapshots"
```

---

### Task 2: buildFeedObject and buildFeedObjectFromApiData

**Files:**
- Modify: `utilities/rss-builder.utility.ts`
- Modify: `tests/rss-builder.test.ts`

- [ ] **Step 1: Verify existing rss-builder tests pass before touching the file**

```bash
bun test tests/rss-builder.test.ts
```

Expected: PASS — baseline confirmed

- [ ] **Step 2: Add failing tests for the new functions**

Append to `tests/rss-builder.test.ts`:

```typescript
import { buildFeedObject, buildFeedObjectFromApiData } from "../utilities/rss-builder.utility";
import { Feed } from "feed";

describe("buildFeedObject", () => {
  it("returns a Feed instance", async () => {
    const html = `<html><body>
      <article><h2 class="title">Story 1</h2><a class="link" href="/1">Link</a></article>
    </body></html>`;
    const config = {
      feedId: "test-obj",
      feedName: "test-obj",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://example.com" },
      article: {
        iterator: { selector: "article" },
        title: { selector: ".title" },
        link: { selector: ".link", attribute: "href", isRelative: true, baseUrl: "https://example.com" },
      },
    };
    const result = await buildFeedObject(html, config);
    expect(result.feed).toBeInstanceOf(Feed);
    expect(typeof result.feed.rss2).toBe("function");
    expect(typeof result.feed.atom1).toBe("function");
    expect(typeof result.feed.json1).toBe("function");
    expect(result.metrics).toBeDefined();
  });
});

describe("buildFeedObjectFromApiData", () => {
  it("returns a Feed instance", () => {
    const config = {
      feedId: "api-obj",
      feedName: "api-obj",
      feedType: "api",
      refreshTime: 5,
      config: { baseUrl: "https://api.example.com" },
      apiMapping: { items: "items", title: "title", link: "link" },
    };
    const data = { items: [{ title: "Post 1", link: "https://example.com/1" }] };
    const result = buildFeedObjectFromApiData(data, config);
    expect(result.feed).toBeInstanceOf(Feed);
    expect(result.metrics.itemCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test tests/rss-builder.test.ts
```

Expected: FAIL — `buildFeedObject` and `buildFeedObjectFromApiData` not exported

- [ ] **Step 4: Refactor buildRSS to use a shared internal function**

In `utilities/rss-builder.utility.ts`:

Add the new exported type after `BuildRSSResult`:

```typescript
export type BuildFeedObjectResult = {
  feed: Feed;
  metrics: BuildMetrics;
};
```

Extract the internal body of `buildRSS` into a new async function `_buildFeedFromHtml`. The function body is identical to `buildRSS` except it returns `{ feed, metrics }` instead of `{ xml: feed.rss2(), metrics }`:

```typescript
async function _buildFeedFromHtml(
  res: any,
  feedConfig: any,
  dateIndex?: Map<string, string>,
): Promise<BuildFeedObjectResult> {
  // Move all existing buildRSS body here.
  // Change the final return statements:
  //   return { xml: injectDcNamespace(feed.rss2()), metrics: {...} }
  //   → return { feed, metrics: {...} }
  // Also fix the fallback return:
  //   return { xml: fallbackFeed.rss2(), metrics: {...} }
  //   → return { feed: fallbackFeed, metrics: {...} }
}

export async function buildFeedObject(
  res: any,
  feedConfig: any,
  dateIndex?: Map<string, string>,
): Promise<BuildFeedObjectResult> {
  return _buildFeedFromHtml(res, feedConfig, dateIndex);
}

export async function buildRSS(
  res: any,
  feedConfig: any,
  dateIndex?: Map<string, string>,
): Promise<BuildRSSResult> {
  const { feed, metrics } = await _buildFeedFromHtml(res, feedConfig, dateIndex);
  return { xml: injectDcNamespace(feed.rss2()), metrics };
}
```

- [ ] **Step 5: Refactor buildRSSFromApiData similarly**

Extract the body of `buildRSSFromApiData` into `_buildFeedFromApiData`, changing the return from `{ xml: injectDcNamespace(feed.rss2()), metrics }` to `{ feed, metrics }`:

```typescript
function _buildFeedFromApiData(
  apiData: any,
  feedConfig: any,
  dateIndex?: Map<string, string>,
): BuildFeedObjectResult {
  // Move all existing buildRSSFromApiData body here.
  // Change: return { xml: injectDcNamespace(feed.rss2()), metrics: {...} }
  // To:     return { feed, metrics: {...} }
}

export function buildFeedObjectFromApiData(
  apiData: any,
  feedConfig: any,
  dateIndex?: Map<string, string>,
): BuildFeedObjectResult {
  return _buildFeedFromApiData(apiData, feedConfig, dateIndex);
}

export function buildRSSFromApiData(
  apiData: any,
  feedConfig: any,
  dateIndex?: Map<string, string>,
): BuildRSSResult {
  const { feed, metrics } = _buildFeedFromApiData(apiData, feedConfig, dateIndex);
  return { xml: injectDcNamespace(feed.rss2()), metrics };
}
```

- [ ] **Step 6: Run all rss-builder tests to verify they pass**

```bash
bun test tests/rss-builder.test.ts
```

Expected: PASS (all existing tests plus new `buildFeedObject` and `buildFeedObjectFromApiData` tests)

- [ ] **Step 7: Commit**

```bash
git add utilities/rss-builder.utility.ts tests/rss-builder.test.ts
git commit -m "feat: add buildFeedObject and buildFeedObjectFromApiData; wrap existing buildRSS functions"
```

---

### Task 3: Worker — web scraping and API paths use new builders

**Files:**
- Modify: `workers/feed-updater.worker.ts`

- [ ] **Step 1: Add imports**

At the top of `workers/feed-updater.worker.ts`, add:

```typescript
import {
  writeAllFeedFormats,
  serializeAllFeedFormats,
  extractFeedItemSnapshots,
  type FeedOutputUrls,
} from "../utilities/feed-output.utility";
import { buildFeedObject, buildFeedObjectFromApiData } from "../utilities/rss-builder.utility";
```

- [ ] **Step 2: Update the web scraping standard axios path to use buildFeedObject**

Find the standard axios fetch path (the `else` branch after FlareSolverr and Playwright, around line 138). Currently:

```typescript
const html = response.data;
lastBuildResult = await buildRSS(html, feedConfig, dateIndex);
rssXml = lastBuildResult.xml;
```

Replace with:

```typescript
const html = response.data;
const buildResult = await buildFeedObject(html, feedConfig, dateIndex);
lastBuildResult = { xml: buildResult.feed.rss2(), metrics: buildResult.metrics };
lastFeedObject = buildResult.feed;
```

Add `let lastFeedObject: import("feed").Feed | null = null;` near the top of `fetchDataAndUpdateFeed`.

- [ ] **Step 3: Update the Playwright advanced path similarly**

Find the Playwright path (`feedConfig.advanced` branch). Currently ends with:

```typescript
lastBuildResult = await buildRSS(html, feedConfig, dateIndex);
rssXml = lastBuildResult.xml;
```

Replace with:

```typescript
const buildResult = await buildFeedObject(html, feedConfig, dateIndex);
lastBuildResult = { xml: buildResult.feed.rss2(), metrics: buildResult.metrics };
lastFeedObject = buildResult.feed;
```

- [ ] **Step 4: Update the API path to use buildFeedObjectFromApiData**

Find the API path (around line 201):

```typescript
lastBuildResult = buildRSSFromApiData(apiData, feedConfig, dateIndex);
rssXml = lastBuildResult.xml;
```

Replace with:

```typescript
const buildResult = buildFeedObjectFromApiData(apiData, feedConfig, dateIndex);
lastBuildResult = { xml: buildResult.feed.rss2(), metrics: buildResult.metrics };
lastFeedObject = buildResult.feed;
```

- [ ] **Step 5: Run existing tests to confirm no regressions**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add workers/feed-updater.worker.ts
git commit -m "feat: worker web scraping and API paths use buildFeedObject / buildFeedObjectFromApiData"
```

---

### Task 4: Worker — universal post-generation block

**Files:**
- Modify: `workers/feed-updater.worker.ts`

- [ ] **Step 1: Find the existing post-generation block**

The block starting at `if (rssXml) {` (around line 205) currently:
1. Writes `.xml` file
2. `saveDateIndex`
3. If webhook: XML diff → new items → `createWebhookPayload` → `sendWebhook`
4. `storeFeedHistory`

- [ ] **Step 2: Replace the block with the new universal flow**

Replace the entire `if (rssXml) {` block with:

```typescript
if (lastFeedObject) {
  // 1. Write all three formats
  const outputUrls = await writeAllFeedFormats(feedConfig.feedId, lastFeedObject);

  // 2. Store format-agnostic snapshot
  const snapshots = extractFeedItemSnapshots(lastFeedObject);
  await storeFeedHistory(
    feedConfig.feedId,
    JSON.stringify(snapshots),
    "items_json",
  );

  // 3. Update item hash index
  try {
    await saveDateIndex(feedConfig.feedId, dateIndex);
  } catch (indexErr) {
    console.error("[Feed %s] Failed to persist date index:", feedConfig.feedId, indexErr);
  }

  // 4. Webhook delivery — only if configured
  if (feedConfig.webhook?.enabled && feedConfig.webhook?.url) {
    try {
      const {
        sendWebhook,
        createWebhookPayload,
        createJsonWebhookPayload,
      } = await import("../utilities/webhook.utility");

      // New item hashes = keys in current dateIndex that were not in knownHashes snapshot
      const newItemHashes = new Set(
        [...dateIndex.keys()].filter((k) => !knownHashes.has(k)),
      );

      // Deliver if: newItemsOnly is false (always deliver), or new items were found
      const shouldDeliver = !feedConfig.webhook.newItemsOnly || newItemHashes.size > 0;

      if (shouldDeliver) {
        // Webhook payload uses full RSS output. Previously newItemsOnly sent only new items
        // via XML diffing — that behaviour is simplified here: we gate on new items existing
        // but send the full feed. A targeted new-items-only payload can be added in a
        // future pass once item-level filtering is available on the Feed object.
        const outputs = serializeAllFeedFormats(lastFeedObject);
        const payload =
          feedConfig.webhook.format === "json"
            ? createJsonWebhookPayload(feedConfig, outputs.rss2, "automatic")
            : createWebhookPayload(feedConfig, outputs.rss2, "automatic");

        const success = await sendWebhook(feedConfig.webhook, payload);
        if (success) {
          console.log(`Webhook sent for feed ${feedConfig.feedId} (${newItemHashes.size} new items)`);
        } else {
          console.warn(`Webhook failed for feed ${feedConfig.feedId}`);
        }
      }
    } catch (webhookError) {
      console.error("[Feed %s] Webhook error:", feedConfig.feedId, webhookError);
      lastWebhookError = webhookError.message;
    }
  }

  // Keep rssXml for backward compat with metrics reporting
  rssXml = lastBuildResult?.xml ?? "";
}
```

- [ ] **Step 3: Add knownHashes capture before feed generation**

Find the `loadDateIndex` call near the top of `fetchDataAndUpdateFeed` (around line 28):

```typescript
const dateIndex = await loadDateIndex(feedConfig.feedId);
```

Add immediately after:

```typescript
const knownHashes = new Map(dateIndex); // snapshot before generation — used for new-item detection
```

- [ ] **Step 4: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add workers/feed-updater.worker.ts
git commit -m "feat: universal post-generation block writes all three formats; hash-based webhook new-item detection"
```

---

### Task 5: index.ts — save response and preview format

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add import**

```typescript
import { serializeAllFeedFormats } from "./utilities/feed-output.utility";
```

- [ ] **Step 2: Update POST / success response**

Find the success response in POST `/` (around line 563). Replace:

```typescript
return ctx.json({
  message: "RSS feed is being generated.",
  feedUrl: `public/feeds/${feedId}.xml`,
  feedId: feedId,
  config: finalFeedConfig,
});
```

With:

```typescript
return ctx.json({
  message: "Feed is being generated.",
  feedId: finalFeedConfig.feedId,
  feedUrls: {
    rss2: `/public/feeds/${finalFeedConfig.feedId}.xml`,
    atom: `/public/feeds/${finalFeedConfig.feedId}.atom`,
    json: `/public/feeds/${finalFeedConfig.feedId}.json`,
  },
  config: maskProtectedValues(finalFeedConfig),
});
```

- [ ] **Step 3: Update PUT /api/feeds/:id success response similarly**

Find the PUT success response and apply the same change — drop `feedUrl`, add `feedUrls`.

- [ ] **Step 4: Update POST /preview to support ?format= parameter**

Find the preview route. After the feed is built (wherever the current `buildRSS` or equivalent call returns `rssXml`), replace the response with:

```typescript
type PreviewFormat = "rss2" | "atom" | "json";
const format = (ctx.req.query("format") ?? "rss2") as PreviewFormat;

// Build Feed object for multi-format preview
// (replace existing buildRSS call with buildFeedObject if not already done)
const { feed } = await buildFeedObject(html, feedConfig);
const outputs = serializeAllFeedFormats(feed);
const body = outputs[format] ?? outputs.rss2;

const contentTypeMap: Record<PreviewFormat, string> = {
  rss2: "application/rss+xml; charset=utf-8",
  atom: "application/atom+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};

return ctx.text(body, 200, { "Content-Type": contentTypeMap[format] });
```

- [ ] **Step 5: Add outputUrls to GET /api/feeds response**

Find the `GET /api/feeds` handler (around line 1149). For each feed in the response array, add `outputUrls`:

```typescript
feeds.push({
  feedId: config.feedId,
  feedName: config.feedName,
  feedType: config.feedType,
  lastBuildDate,
  webhookEnabled: !!(config.webhook?.enabled && config.webhook?.url),
  outputUrls: {
    rss2: `/public/feeds/${config.feedId}.xml`,
    atom: `/public/feeds/${config.feedId}.atom`,
    json: `/public/feeds/${config.feedId}.json`,
  },
});
```

- [ ] **Step 6: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add index.ts
git commit -m "feat: save response uses feedUrls; preview supports ?format=; feed list includes outputUrls"
```

---

### Task 6: Frontend — success toast and FeedPreview format selector

**Files:**
- Modify: `frontend/src/components/forms/FeedBuilderForm.tsx`
- Modify: `frontend/src/components/forms/FeedPreview.tsx`

- [ ] **Step 1: Read FeedBuilderForm onSubmit to understand current success handling**

```bash
grep -n "alert\|toast\|feedUrl\|response.json" /home/timb/projects/mkfd/frontend/src/components/forms/FeedBuilderForm.tsx | head -15
```

- [ ] **Step 2: Update onSubmit to read feedUrls from response and show them**

In `FeedBuilderForm.tsx`, update the `onSubmit` success branch to parse the response body and show the three URLs:

```typescript
if (response.ok) {
  if (mode === "edit") {
    alert("Feed updated successfully!");
    navigate("/feeds");
  } else {
    const body = await response.json().catch(() => null);
    const urls = body?.feedUrls;
    const message = urls
      ? `Feed created!\n\nRSS:  ${urls.rss2}\nAtom: ${urls.atom}\nJSON: ${urls.json}`
      : "Feed created successfully!";
    alert(message);
    window.location.reload();
  }
}
```

- [ ] **Step 3: Read FeedPreview.tsx to understand current preview fetch**

```bash
cat /home/timb/projects/mkfd/frontend/src/components/forms/FeedPreview.tsx
```

- [ ] **Step 4: Add format selector to FeedPreview**

Add a state variable and three-button selector above the preview output:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";

// Inside FeedPreview component:
const [format, setFormat] = useState<"rss2" | "atom" | "json">("rss2");

// In the fetch call, append ?format= :
const res = await fetch(`/preview?format=${format}`, { method: "POST", ... });

// Add format selector UI above the preview content:
<div className="flex gap-2 mb-2">
  {(["rss2", "atom", "json"] as const).map((f) => (
    <Button
      key={f}
      size="sm"
      variant={format === f ? "default" : "outline"}
      onClick={() => setFormat(f)}
    >
      {f === "rss2" ? "RSS" : f === "atom" ? "Atom" : "JSON Feed"}
    </Button>
  ))}
</div>
```

- [ ] **Step 5: Start dev server and verify format selector works**

```bash
cd /home/timb/projects/mkfd/frontend && bun run dev
```

Build a feed, click Preview. Confirm:
1. Three format buttons appear (RSS, Atom, JSON Feed)
2. Clicking each re-fetches the preview with the correct format
3. RSS is selected by default
4. Success toast shows three URLs after create

Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/forms/FeedBuilderForm.tsx frontend/src/components/forms/FeedPreview.tsx
git commit -m "feat: success toast shows all three feed URLs; preview gains format selector"
```

---

### Task 7: Active Feeds page — Atom and JSON actions

**Files:**
- Modify: `frontend/src/pages/ActiveFeedsPage.tsx`

- [ ] **Step 1: Read current ActiveFeedsPage to understand feed card structure**

```bash
grep -n "feedUrl\|publicFeedUrl\|Copy\|Open\|href\|clipboard" /home/timb/projects/mkfd/frontend/src/pages/ActiveFeedsPage.tsx | head -20
```

- [ ] **Step 2: Update the page to read outputUrls from the API response**

In the feed fetch and state handling, ensure `outputUrls` is stored alongside each feed:

```typescript
type FeedItem = {
  feedId: string;
  feedName: string;
  feedType: string;
  lastBuildDate: string;
  outputUrls?: { rss2: string; atom: string; json: string };
};
```

- [ ] **Step 3: Add Atom and JSON copy/open actions to each feed card**

Where the existing RSS open/copy button is rendered, add Atom and JSON equivalents:

```tsx
{feed.outputUrls && (
  <div className="flex gap-2 flex-wrap mt-2">
    <Button size="sm" variant="outline" asChild>
      <a href={feed.outputUrls.rss2} target="_blank" rel="noopener noreferrer">Open RSS</a>
    </Button>
    <Button size="sm" variant="outline" asChild>
      <a href={feed.outputUrls.atom} target="_blank" rel="noopener noreferrer">Open Atom</a>
    </Button>
    <Button size="sm" variant="outline" asChild>
      <a href={feed.outputUrls.json} target="_blank" rel="noopener noreferrer">Open JSON</a>
    </Button>
    <Button size="sm" variant="ghost"
      onClick={() => navigator.clipboard.writeText(window.location.origin + feed.outputUrls!.rss2)}>
      Copy RSS
    </Button>
    <Button size="sm" variant="ghost"
      onClick={() => navigator.clipboard.writeText(window.location.origin + feed.outputUrls!.atom)}>
      Copy Atom
    </Button>
    <Button size="sm" variant="ghost"
      onClick={() => navigator.clipboard.writeText(window.location.origin + feed.outputUrls!.json)}>
      Copy JSON
    </Button>
  </div>
)}
```

- [ ] **Step 4: Verify in dev server**

```bash
cd /home/timb/projects/mkfd/frontend && bun run dev
```

Confirm the Active Feeds page shows Open RSS / Open Atom / Open JSON and Copy buttons for each feed that has been generated. Stop the server with Ctrl+C.

- [ ] **Step 5: Run all backend tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ActiveFeedsPage.tsx
git commit -m "feat: Active Feeds page shows open/copy actions for RSS, Atom, and JSON Feed URLs"
```
