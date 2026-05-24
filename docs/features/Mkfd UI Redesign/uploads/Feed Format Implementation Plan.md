## Goal

For every Mkfd feed, generate and serve all three supported feed formats automatically:

```text
/public/feeds/{feedName}.xml   RSS 2.0
/public/feeds/{feedName}.atom  Atom
/public/feeds/{feedName}.json  JSON Feed
```

There should be **no user-facing option** to enable or disable formats. Mkfd builds all three every time, and the user or feed reader can choose whichever URL they want.

---

# 1. Product behavior

## Default behavior

RSS 2.0 remains the default format:

```text
/public/feeds/example.xml
```

That keeps existing readers and existing Mkfd URLs working.

Atom and JSON Feed are always available as alternate outputs:

```text
/public/feeds/example.atom
/public/feeds/example.json
```

## User-facing copy

In the UI, describe this as:

```text
Every Mkfd feed is available as RSS 2.0, Atom, and JSON Feed.
```

Do **not** add checkboxes like:

```text
[x] RSS
[x] Atom
[x] JSON
```

The feature should feel automatic.

---

# 2. Internal architecture

Refactor feed generation around this pipeline:

```text
source data
  -> normalized feed items
  -> Feed object
  -> RSS 2.0 / Atom / JSON Feed serialization
  -> write all three output files
```

The important change is to avoid source-specific code writing only one RSS XML string.

Current mindset:

```text
build RSS XML
write .xml
```

New mindset:

```text
build Feed object once
serialize it three ways
write .xml, .atom, .json
```

---

# 3. Add shared output types

Create a shared type:

```ts
export type FeedOutputUrls = {
  rss2: string;
  atom: string;
  json: string;
};

export type SerializedFeedOutputs = {
  rss2: string;
  atom: string;
  json: string;
};
```

Use `rss2` internally because it is explicit, but label it as “RSS” in the UI.

---

# 4. Add serialization helper

Create a utility in the RSS/feed builder area, likely in:

```text
utilities/rss-builder.utility.ts
```

or a new file:

```text
utilities/feed-output.utility.ts
```

Recommended helper:

```ts
import { Feed } from "feed";

export type SerializedFeedOutputs = {
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

The `feed` package supports these output formats, so this should stay very small.

---

# 5. Add shared writer helper

Create a single writer that every source type uses.

```ts
import path from "node:path";
import type { Feed } from "feed";
import { serializeAllFeedFormats } from "./feed-output.utility";

export type FeedOutputUrls = {
  rss2: string;
  atom: string;
  json: string;
};

export async function writeAllFeedFormats(
  feedName: string,
  feed: Feed,
): Promise<FeedOutputUrls> {
  const outputs = serializeAllFeedFormats(feed);
  const safeFeedName = sanitizeFeedFileName(feedName);

  await Bun.write(path.join("./public/feeds", `${safeFeedName}.xml`), outputs.rss2);
  await Bun.write(path.join("./public/feeds", `${safeFeedName}.atom`), outputs.atom);
  await Bun.write(path.join("./public/feeds", `${safeFeedName}.json`), outputs.json);

  return {
    rss2: `/public/feeds/${safeFeedName}.xml`,
    atom: `/public/feeds/${safeFeedName}.atom`,
    json: `/public/feeds/${safeFeedName}.json`,
  };
}
```

Add or reuse a filename sanitizer:

```ts
export function sanitizeFeedFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

If Mkfd already has a feed filename convention, preserve it. The key point is: one feed name maps to three files.

---

# 6. Refactor existing builder functions

The current functions are probably named around RSS, such as:

```text
buildRSS(...)
buildRSSFromApiData(...)
```

Do not force a massive rename immediately. Instead, introduce new functions and keep wrappers if needed.

## Target shape

```ts
export function buildFeedFromHtmlData(...) {
  const feed = new Feed(...);
  // add items
  return feed;
}

export function buildFeedFromStructuredData(...) {
  const feed = new Feed(...);
  // add items
  return feed;
}
```

Then old wrappers can remain temporarily:

```ts
export function buildRSSFromHtmlData(...) {
  const feed = buildFeedFromHtmlData(...);
  return feed.rss2();
}
```

This avoids breaking preview and existing worker logic all at once.

---

# 7. Update source-type generation paths

Every source type should eventually do this:

```ts
const feed = buildFeedFromSourceData(sourceData, config);
const urls = await writeAllFeedFormats(config.feedName, feed);
```

Apply this to current and future source types:

```text
Web scraping
REST API
GraphQL
Email
Calendar
Sitemap
Filesystem
Webhook
Existing feed transformer
```

For the first implementation, update only the currently implemented source paths, then make the helper mandatory for new source types.

---

# 8. Update worker output logic

Find every place that writes:

```ts
await Bun.write(`./public/feeds/${feedName}.xml`, rssXml);
```

Replace with:

```ts
const feed = buildFeedFromWhatever(...);
const urls = await writeAllFeedFormats(feedName, feed);
```

If a source path still returns RSS XML only, temporarily bridge it like this:

```ts
const feed = buildFeedFromWhatever(...);
await writeAllFeedFormats(feedName, feed);
```

Avoid generating Atom/JSON by parsing the RSS XML back in. The formats should come from the same `Feed` object.

---

# 9. Update feed creation response

When a feed is created or updated, return all three URLs.

```json
{
  "ok": true,
  "feedName": "example",
  "urls": {
    "rss2": "/public/feeds/example.xml",
    "atom": "/public/feeds/example.atom",
    "json": "/public/feeds/example.json"
  }
}
```

If the current endpoint only returns success text, keep compatibility but extend it where the frontend can use it.

Recommended response type:

```ts
export type FeedSaveResponse = {
  ok: boolean;
  feedName: string;
  urls: FeedOutputUrls;
  message?: string;
};
```

---

# 10. Update preview behavior

## MVP

Keep preview RSS-first.

Current behavior can remain:

```text
Preview shows RSS 2.0 XML
```

No user option is required for output formats.

## Better follow-up

Add preview tabs:

```text
RSS 2.0 | Atom | JSON Feed
```

Backend supports:

```text
POST /preview?format=rss2
POST /preview?format=atom
POST /preview?format=json
```

Default:

```text
rss2
```

Implementation:

```ts
type PreviewFormat = "rss2" | "atom" | "json";

function getSerializedPreview(feed: Feed, format: PreviewFormat) {
  const outputs = serializeAllFeedFormats(feed);

  if (format === "atom") return outputs.atom;
  if (format === "json") return outputs.json;
  return outputs.rss2;
}
```

No config is saved. This is only a preview display choice.

---

# 11. Update My Feeds / Active Feeds UI

Each feed should expose all three links.

## Primary action

Keep RSS as the main action:

```text
Open RSS
```

## Secondary actions

In the actions menu:

```text
Open Atom
Open JSON Feed
Copy RSS URL
Copy Atom URL
Copy JSON Feed URL
```

## Feed summary shape

Extend the feed summary response:

```ts
export type FeedSummary = {
  id: string;
  feedName: string;
  feedType: string;
  publicFeedUrl: string;
  outputUrls: FeedOutputUrls;
};
```

Where:

```ts
outputUrls: {
  rss2: `/public/feeds/${feedName}.xml`,
  atom: `/public/feeds/${feedName}.atom`,
  json: `/public/feeds/${feedName}.json`,
}
```

For backward compatibility, keep:

```ts
publicFeedUrl
```

as the RSS URL.

---

# 12. Content types

If Mkfd serves these files through Hono/static middleware, verify MIME behavior.

Preferred content types:

```text
.xml   application/rss+xml; charset=utf-8
.atom  application/atom+xml; charset=utf-8
.json  application/feed+json; charset=utf-8
```

If static middleware returns generic types, that is acceptable initially:

```text
.xml   application/xml
.json  application/json
```

But eventually it would be nice to add explicit feed routes:

```text
GET /feeds/:feedName/rss
GET /feeds/:feedName/atom
GET /feeds/:feedName/json
```

For now, file URLs are simpler and match the existing `/public/feeds` model.

---

# 13. Backward compatibility rules

Preserve these:

```text
Existing .xml feed URLs continue working.
RSS 2.0 remains the default.
Existing configs do not need changes.
No output config is required.
Preview keeps showing RSS by default.
Existing feed readers do not need to update anything.
```

Do **not** add this:

```yaml
outputs:
  rss2: true
  atom: true
  json: true
```

Do **not** make feed format a source-level option.

---

# 14. Error handling

If one serialization fails, decide whether the whole generation fails.

Recommended MVP behavior:

```text
If Feed object creation fails:
  fail generation.

If RSS/Atom/JSON serialization fails:
  fail generation and do not partially update files.
```

To avoid partial writes, serialize all first:

```ts
const outputs = serializeAllFeedFormats(feed);
```

Then write files.

Later, you can make writes atomic:

```text
write .tmp files
rename after all writes succeed
```

Atomic write helper later:

```ts
await Bun.write(`${target}.tmp`, content);
await rename(`${target}.tmp`, target);
```

---

# 15. Implementation phases

## Phase 1: Shared serialization helpers

Deliverables:

```text
SerializedFeedOutputs type
FeedOutputUrls type
serializeAllFeedFormats(feed)
writeAllFeedFormats(feedName, feed)
sanitizeFeedFileName or reuse existing filename logic
```

## Phase 2: Refactor builder return values

Deliverables:

```text
Make existing source builders able to return a Feed object
Keep old RSS-returning wrappers temporarily
Ensure web scraping still produces same RSS output
Ensure REST API still produces same RSS output
Ensure email feed path still works if applicable
```

## Phase 3: Update workers and save flow

Deliverables:

```text
Replace .xml-only writes with writeAllFeedFormats
Generate .xml, .atom, and .json on every run
Return all output URLs after save/update
Keep .xml default feed URL
```

## Phase 4: Preview support

Deliverables:

```text
Preview still defaults to RSS
Optional preview format parameter
Preview tabs later: RSS, Atom, JSON
Correct content type for preview response if practical
```

## Phase 5: My Feeds UI support

Deliverables:

```text
Feed cards show RSS as primary URL
Actions menu exposes Atom and JSON URLs
Copy actions for all three formats
Feed summary includes outputUrls
```

## Phase 6: Docs

Deliverables:

```text
README documents all three output URLs
RSS remains default
Atom and JSON Feed examples
Mention that every feed gets all three automatically
```

---

# 16. Test plan

## Unit tests

```text
serializeAllFeedFormats returns RSS XML
serializeAllFeedFormats returns Atom XML
serializeAllFeedFormats returns JSON Feed
writeAllFeedFormats writes .xml, .atom, and .json
feed filename sanitizer prevents unsafe paths
```

## Regression tests

```text
existing web scraping feed still generates valid .xml
existing REST/API feed still generates valid .xml
existing email feed still generates valid .xml
existing configs require no output-format field
```

## Integration tests

```text
creating a feed writes all three files
updating a feed rewrites all three files
worker refresh rewrites all three files
preview defaults to RSS
preview format atom returns Atom
preview format json returns JSON Feed
```

## File existence checks

After generation:

```text
/public/feeds/example.xml exists
/public/feeds/example.atom exists
/public/feeds/example.json exists
```

## Content sanity checks

```text
.xml contains RSS 2.0 structure
.atom contains Atom structure
.json parses as JSON
.json contains JSON Feed version field
```

---

# 17. README update

Add a section like:

```md
## Feed Output Formats

Mkfd automatically serves every feed in three formats:

| Format | URL |
|---|---|
| RSS 2.0 | `/public/feeds/{feedName}.xml` |
| Atom | `/public/feeds/{feedName}.atom` |
| JSON Feed | `/public/feeds/{feedName}.json` |

RSS 2.0 remains the default format and is the best choice for most feed readers. Atom and JSON Feed are generated from the same feed items and are available automatically.
```

Add example:

````md
For a feed named `github-releases`, Mkfd serves:

```text
/public/feeds/github-releases.xml
/public/feeds/github-releases.atom
/public/feeds/github-releases.json
````

````

---

# 18. UI copy

Use simple labels:

```text
RSS
Atom
JSON
````

For tooltips:

```text
RSS: Default feed URL for most readers.
Atom: Alternate XML feed format.
JSON: JSON Feed for apps and automation.
```

On feed creation success:

```text
Feed created successfully.

RSS:  /public/feeds/example.xml
Atom: /public/feeds/example.atom
JSON: /public/feeds/example.json
```

---

# 19. MVP acceptance criteria

This feature is complete when:

```text
Every generated feed writes RSS 2.0, Atom, and JSON Feed files.
The .xml URL remains RSS 2.0 and continues working.
No config option is added for output formats.
Existing configs work unchanged.
All three formats are generated from the same Feed object.
Create/update responses can return all three URLs.
My Feeds can expose copy/open actions for all three URLs.
Preview remains RSS by default.
```

---

# 20. Recommended priority

This is a small, clean **P1** feature.

It should be done when touching feed output or the My Feeds page, because the My Feeds page can immediately expose the three generated URLs.

Updated placement:

```text
P0: My Feeds / config browser
P0: Import/export
P0: Protected values
P1: Always generate RSS, Atom, and JSON Feed
P1: Community catalog
```

The main architectural rule:

> Mkfd builds one canonical feed object and serializes it into every supported format automatically.