# Existing Feed Transformer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **UI implementation:** For Task 9 (React form component), use **superpowers:frontend-design** to validate visual designs before writing final component code.

**Goal:** Add `feedTransformer` as a first-class feed type that fetches, merges, cleans, and republishes one or more existing RSS/Atom/JSON Feed sources as Mkfd-managed RSS, Atom, and JSON Feed outputs with configurable merge strategy.

**Architecture:** A five-stage pipeline (fetch+parse → merge → transform → filter → build) implemented as four isolated utilities orchestrated by `feed-transformer.utility.ts`. The worker calls the orchestrator and writes output files. A new probe endpoint lets the frontend preview any source URL before saving. The frontend form uses section-based builder primitives from the completed Builder UI Redesign.

**Security decision:** Existing-feed source URLs and probe URLs must use the shared outbound fetch policy. By default, MkFD blocks loopback, private RFC1918/ULA networks, link-local ranges, multicast/reserved ranges, and known cloud metadata hosts/IPs. Admins can intentionally allow LAN/self-hosted sources with `ALLOW_PRIVATE_FETCHES=true` or a per-host allowlist such as `OUTBOUND_FETCH_ALLOWLIST=nas.local,10.0.0.5`. Redirect targets must be revalidated after each redirect.

**Tech Stack:** Bun, TypeScript, `xmldom` (already in project — `DOMParser`), `feed` npm package (already in project), `striptags` (already in project), `node:crypto` `createHash` (already used), Hono, React 18, react-hook-form `useFieldArray`, shadcn/ui builder components

**Preconditions — these must be implemented before this plan:**
- **Feed Config Formalization (Phase 1)** — provides `FeedConfigBase<T>` and `FeedType` union in `models/feed-config.model.ts`
- **Outbound Fetch Policy (Phase 1)** — provides `assertOutboundFetchAllowed` for probe/parser fetches and redirect validation
- **Feed Format Refactor (Phase 2)** — provides `writeAllFeedFormats(feedId, feed)` returning `{ rss2: string, atom: string, json: string }` in the worker utilities and writing `.xml`, `.atom`, and `.json` files
- **Normalized Feed Item Pipeline (Phase 2)** — provides the shared `NormalizedFeedItem` model and `buildFeedFromNormalizedItems` utility adopted by all source types
- **My Feeds Redesign (Phase 2)** — required for final dashboard badge/status acceptance checks; backend transformer work may start without it if the My Feeds integration task is deferred
- **Builder UI Redesign (Phase 2)** — provides `Section`, `Field`, `FieldRow`, `KVEditor`, `StorageSelect` in `frontend/src/components/builder/` and the `BuilderSection` type in `frontend/src/pages/BuildFeedPage.tsx`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/feed-transformer.model.ts` | All feedTransformer config types + BasicItemTransformConfig |
| Create | `models/normalized-feed-item.model.ts` | Shared normalized item type used across pipeline stages |
| Modify | `models/feed-config.model.ts` | Add `"feedTransformer"` to FeedType union; add FeedTransformerFeedConfig |
| Create | `utilities/feed-item-filter.utility.ts` | Include/exclude filter rules (pure/sync) |
| Create | `utilities/feed-item-transform.utility.ts` | Text, link, GUID, date transforms (pure/sync) |
| Create | `utilities/existing-feed-parser.utility.ts` | Fetch + parse RSS/Atom/JSON → NormalizedFeedItem[] |
| Create | `utilities/normalized-feed-builder.utility.ts` | NormalizedFeedItem[] → Feed object |
| Create | `utilities/feed-transformer.utility.ts` | Pipeline orchestrator (async) |
| Modify | `workers/feed-updater.worker.ts` | Add feedTransformer branch |
| Modify | `index.ts` | Add /api/feeds/transformer/probe; extend generatePreview; add save validation |
| Create | `tests/feed-item-filter.test.ts` | Unit tests for filter utility |
| Create | `tests/feed-item-transform.test.ts` | Unit tests for transform utility |
| Create | `tests/existing-feed-parser.test.ts` | Unit tests for parser (inline XML/JSON fixtures) |
| Create | `tests/normalized-feed-builder.test.ts` | Unit tests for feed builder |
| Create | `frontend/src/components/forms/ExistingFeedTransformerForm.tsx` | 7-section builder form |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Register feedTransformer form sections |
| Modify | `frontend/src/components/builder/TypePickerGrid.tsx` | Activate feedTransformer type |
| Modify | `frontend/src/pages/BuildFeedPage.tsx` | Add feedTransformer section definitions |

---

### Task 1: Data models

**Files:**
- Create: `models/feed-transformer.model.ts`
- Create: `models/normalized-feed-item.model.ts`
- Modify: `models/feed-config.model.ts`

- [ ] **Step 1: Create `models/feed-transformer.model.ts`**

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

- [ ] **Step 2: Create `models/normalized-feed-item.model.ts`**

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

- [ ] **Step 3: Add `feedTransformer` to `models/feed-config.model.ts`**

Open `models/feed-config.model.ts`. Add `"feedTransformer"` to the `FeedType` union and add the config variant. The additions look like:

```ts
// In the FeedType union, add:
| "feedTransformer"

// Add this new config type:
import type { FeedTransformerConfigBlock } from "./feed-transformer.model";

export type FeedTransformerFeedConfig = FeedConfigBase<"feedTransformer"> & {
  feedTransformer: FeedTransformerConfigBlock;
};

// In the FeedConfig union type, add:
| FeedTransformerFeedConfig
```

- [ ] **Step 4: Type-check**

```bash
cd /home/timb/projects/mkfd && bun run tsc --noEmit 2>&1 | head -30
```

Expected: no errors from the new model files.

- [ ] **Step 5: Commit**

```bash
git add models/feed-transformer.model.ts models/normalized-feed-item.model.ts models/feed-config.model.ts
git commit -m "feat: add feedTransformer and NormalizedFeedItem type models"
```

---

### Task 2: Feed item filter utility (TDD)

**Files:**
- Create: `utilities/feed-item-filter.utility.ts`
- Create: `tests/feed-item-filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/feed-item-filter.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { filterFeedItems } from "../utilities/feed-item-filter.utility";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

const item = (overrides: Partial<NormalizedFeedItem> = {}): NormalizedFeedItem => ({
  title: "Test Title",
  ...overrides,
});

describe("filterFeedItems", () => {
  test("returns all items when no filters provided", () => {
    const items = [item(), item({ title: "Other" })];
    const result = filterFeedItems({ items });
    expect(result.items).toHaveLength(2);
    expect(result.filteredItemCount).toBe(0);
  });

  test("exclude contains: removes matching item", () => {
    const items = [item({ title: "Sponsored Post" }), item({ title: "Regular Post" })];
    const result = filterFeedItems({
      items,
      filters: { exclude: [{ field: "title", type: "contains", value: "sponsored", caseSensitive: false }] },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Regular Post");
    expect(result.filteredItemCount).toBe(1);
  });

  test("include: keeps only items matching at least one rule", () => {
    const items = [item({ title: "Tech News" }), item({ title: "Sports Update" })];
    const result = filterFeedItems({
      items,
      filters: { include: [{ field: "title", type: "contains", value: "tech", caseSensitive: false }] },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Tech News");
    expect(result.filteredItemCount).toBe(1);
  });

  test("exclude wins over include", () => {
    const items = [item({ title: "Tech Sponsored Post" })];
    const result = filterFeedItems({
      items,
      filters: {
        include: [{ field: "title", type: "contains", value: "tech", caseSensitive: false }],
        exclude: [{ field: "title", type: "contains", value: "sponsored", caseSensitive: false }],
      },
    });
    expect(result.items).toHaveLength(0);
    expect(result.filteredItemCount).toBe(1);
  });

  test("categories field: matches if any category in array satisfies rule", () => {
    const items = [
      item({ categories: ["tech", "gadgets"] }),
      item({ categories: ["sports"] }),
    ];
    const result = filterFeedItems({
      items,
      filters: { exclude: [{ field: "categories", type: "contains", value: "tech", caseSensitive: false }] },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].categories).toEqual(["sports"]);
  });

  test("invalid regex: skips rule without throwing", () => {
    const items = [item()];
    const result = filterFeedItems({
      items,
      filters: { exclude: [{ field: "title", type: "regex", value: "[invalid" }] },
    });
    expect(result.items).toHaveLength(1);
  });

  test("missing field does not match rule", () => {
    const items = [item({ description: undefined })];
    const result = filterFeedItems({
      items,
      filters: { exclude: [{ field: "description", type: "contains", value: "anything" }] },
    });
    expect(result.items).toHaveLength(1);
  });

  test("notContains type: keeps items that do not contain value", () => {
    const items = [item({ title: "Ad: Buy now" }), item({ title: "Normal post" })];
    const result = filterFeedItems({
      items,
      filters: { include: [{ field: "title", type: "notContains", value: "ad:", caseSensitive: false }] },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Normal post");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/timb/projects/mkfd && bun test tests/feed-item-filter.test.ts 2>&1 | head -20
```

Expected: FAIL — `Cannot find module '../utilities/feed-item-filter.utility'`

- [ ] **Step 3: Create `utilities/feed-item-filter.utility.ts`**

```ts
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import type { BasicFilterRule, BasicItemTransformConfig } from "../models/feed-transformer.model";

export type FilterFeedItemsInput = {
  items: NormalizedFeedItem[];
  filters?: BasicItemTransformConfig["filters"];
};

export type FilterFeedItemsResult = {
  items: NormalizedFeedItem[];
  filteredItemCount: number;
};

export function filterFeedItems(input: FilterFeedItemsInput): FilterFeedItemsResult {
  const { items, filters } = input;
  if (!filters || (!filters.include?.length && !filters.exclude?.length)) {
    return { items, filteredItemCount: 0 };
  }

  const before = items.length;
  const kept = items.filter((item) => {
    if (filters.exclude?.length) {
      const excluded = filters.exclude.some((rule) => matchesRule(item, rule));
      if (excluded) return false;
    }
    if (filters.include?.length) {
      return filters.include.some((rule) => matchesRule(item, rule));
    }
    return true;
  });

  return { items: kept, filteredItemCount: before - kept.length };
}

function matchesRule(item: NormalizedFeedItem, rule: BasicFilterRule): boolean {
  if (rule.field === "categories") {
    const cats = item.categories || [];
    return cats.some((cat) => matchValue(cat, rule));
  }
  const value = (item as Record<string, unknown>)[rule.field] as string | undefined;
  if (!value) return false;
  return matchValue(value, rule);
}

function matchValue(value: string, rule: BasicFilterRule): boolean {
  const v = rule.caseSensitive ? value : value.toLowerCase();
  const r = rule.caseSensitive ? rule.value : rule.value.toLowerCase();

  switch (rule.type) {
    case "contains": return v.includes(r);
    case "notContains": return !v.includes(r);
    case "equals": return v === r;
    case "startsWith": return v.startsWith(r);
    case "endsWith": return v.endsWith(r);
    case "regex": {
      try {
        return new RegExp(rule.value, rule.caseSensitive ? "" : "i").test(value);
      } catch {
        return false;
      }
    }
    default: return false;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/timb/projects/mkfd && bun test tests/feed-item-filter.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-item-filter.utility.ts tests/feed-item-filter.test.ts
git commit -m "feat: add feed-item-filter utility with TDD"
```

---

### Task 3: Feed item transform utility (TDD)

**Files:**
- Create: `utilities/feed-item-transform.utility.ts`
- Create: `tests/feed-item-transform.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/feed-item-transform.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { transformFeedItems } from "../utilities/feed-item-transform.utility";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

const item = (overrides: Partial<NormalizedFeedItem> = {}): NormalizedFeedItem => ({
  title: "Test Title",
  ...overrides,
});

const now = "2024-01-17T00:00:00Z";

describe("text transforms", () => {
  test("stripHtml removes HTML tags from description", () => {
    const result = transformFeedItems({
      items: [item({ description: "<p>Hello <b>world</b></p>" })],
      config: { description: { stripHtml: true } },
      fetchedAt: now,
    });
    expect(result.items[0].description).toBe("Hello world");
  });

  test("truncateCharacters caps description length", () => {
    const result = transformFeedItems({
      items: [item({ description: "A".repeat(200) })],
      config: { description: { truncateCharacters: 100 } },
      fetchedAt: now,
    });
    expect(result.items[0].description!.length).toBe(100);
  });

  test("fallbackFrom content when description is missing", () => {
    const result = transformFeedItems({
      items: [item({ description: undefined, content: "From content field" })],
      config: { description: { fallbackFrom: ["content"] } },
      fetchedAt: now,
    });
    expect(result.items[0].description).toBe("From content field");
  });

  test("prefix and suffix applied to title", () => {
    const result = transformFeedItems({
      items: [item({ title: "Article" })],
      config: { title: { prefix: "[TECH] ", suffix: " (RSS)" } },
      fetchedAt: now,
    });
    expect(result.items[0].title).toBe("[TECH] Article (RSS)");
  });

  test("normalizeWhitespace collapses spaces", () => {
    const result = transformFeedItems({
      items: [item({ description: "hello   world\n\nfoo" })],
      config: { description: { normalizeWhitespace: true } },
      fetchedAt: now,
    });
    expect(result.items[0].description).toBe("hello world foo");
  });
});

describe("link transforms", () => {
  test("removeTrackingParams strips UTM params", () => {
    const result = transformFeedItems({
      items: [item({ link: "https://example.com/post?utm_source=twitter&id=123" })],
      config: { link: { removeTrackingParams: true } },
      fetchedAt: now,
    });
    expect(result.items[0].link).toBe("https://example.com/post?id=123");
  });

  test("allowedParams removes all params not in list", () => {
    const result = transformFeedItems({
      items: [item({ link: "https://example.com/post?id=123&ref=abc&source=rss" })],
      config: { link: { allowedParams: ["id"] } },
      fetchedAt: now,
    });
    expect(result.items[0].link).toBe("https://example.com/post?id=123");
  });

  test("forceHttps upgrades http links", () => {
    const result = transformFeedItems({
      items: [item({ link: "http://example.com/post" })],
      config: { link: { forceHttps: true } },
      fetchedAt: now,
    });
    expect(result.items[0].link).toBe("https://example.com/post");
  });

  test("invalid URL is left unchanged", () => {
    const result = transformFeedItems({
      items: [item({ link: "not-a-url" })],
      config: { link: { removeTrackingParams: true } },
      fetchedAt: now,
    });
    expect(result.items[0].link).toBe("not-a-url");
  });
});

describe("GUID strategy", () => {
  test("existingOrLinkHash: uses existing guid first", () => {
    const result = transformFeedItems({
      items: [item({ guid: "my-guid", link: "https://example.com" })],
      config: { guidStrategy: "existingOrLinkHash" },
      fetchedAt: now,
    });
    expect(result.items[0].guid).toBe("my-guid");
  });

  test("existingOrLinkHash: falls back to link when no guid", () => {
    const result = transformFeedItems({
      items: [item({ guid: undefined, link: "https://example.com/post" })],
      config: { guidStrategy: "existingOrLinkHash" },
      fetchedAt: now,
    });
    expect(result.items[0].guid).toBe("https://example.com/post");
  });

  test("titleLinkDateHash: same input produces same hash", () => {
    const base = item({ title: "My Post", link: "https://example.com", pubDate: "2024-01-01" });
    const r1 = transformFeedItems({ items: [{ ...base }], config: { guidStrategy: "titleLinkDateHash" }, fetchedAt: now });
    const r2 = transformFeedItems({ items: [{ ...base }], config: { guidStrategy: "titleLinkDateHash" }, fetchedAt: now });
    expect(r1.items[0].guid).toBe(r2.items[0].guid);
    expect(r1.items[0].guid).toBeTruthy();
  });
});

describe("date strategy", () => {
  test("publishedOrUpdatedOrFetched uses pubDate when valid", () => {
    const result = transformFeedItems({
      items: [item({ pubDate: "2024-01-15T00:00:00Z", updatedDate: "2024-01-16T00:00:00Z" })],
      config: { dateStrategy: "publishedOrUpdatedOrFetched" },
      fetchedAt: now,
    });
    expect(result.items[0].pubDate).toBe("2024-01-15T00:00:00Z");
  });

  test("publishedOrUpdatedOrFetched falls back to fetchedAt when no valid dates", () => {
    const result = transformFeedItems({
      items: [item({ pubDate: undefined, updatedDate: undefined })],
      config: { dateStrategy: "publishedOrUpdatedOrFetched" },
      fetchedAt: now,
    });
    expect(result.items[0].pubDate).toBe(now);
  });

  test("fetched always uses fetchedAt", () => {
    const result = transformFeedItems({
      items: [item({ pubDate: "2024-01-01T00:00:00Z" })],
      config: { dateStrategy: "fetched" },
      fetchedAt: now,
    });
    expect(result.items[0].pubDate).toBe(now);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/timb/projects/mkfd && bun test tests/feed-item-transform.test.ts 2>&1 | head -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `utilities/feed-item-transform.utility.ts`**

```ts
import { createHash } from "node:crypto";
import striptags from "striptags";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import type {
  BasicItemTransformConfig,
  TextTransformConfig,
  LinkTransformConfig,
  CategoryTransformConfig,
} from "../models/feed-transformer.model";

const DEFAULT_TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "fbclid", "gclid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src", "spm",
];

export type TransformFeedItemsInput = {
  items: NormalizedFeedItem[];
  config: BasicItemTransformConfig;
  fetchedAt: string;
};

export type TransformFeedItemsResult = {
  items: NormalizedFeedItem[];
  warnings: string[];
};

export function transformFeedItems(input: TransformFeedItemsInput): TransformFeedItemsResult {
  const { items, config, fetchedAt } = input;
  const warnings: string[] = [];

  const transformed = items.map((item): NormalizedFeedItem => {
    const out = { ...item };

    out.title = applyTextTransform(out.title, config.title, out) ?? out.title;
    out.description = applyTextTransform(out.description, config.description, out);
    out.content = applyTextTransform(out.content, config.content, out);
    out.link = applyLinkTransform(out.link, config.link);
    out.categories = applyCategoryTransform(out.categories, config.categories);
    out.guid = resolveGuid(out, config.guidStrategy);
    out.pubDate = resolveDate(out, config.dateStrategy, fetchedAt);

    return out;
  });

  return { items: transformed, warnings };
}

function applyTextTransform(
  value: string | undefined,
  config: TextTransformConfig | undefined,
  item: NormalizedFeedItem,
): string | undefined {
  if (!config) return value;

  let result = value;

  if ((result === undefined || result === "") && config.fallbackFrom) {
    for (const field of config.fallbackFrom) {
      const fallback = (item as Record<string, unknown>)[field] as string | undefined;
      if (fallback) { result = fallback; break; }
    }
  }

  if (result === undefined) return undefined;

  if (config.stripDangerousHtml) result = stripDangerousHtml(result);
  if (config.stripHtml) result = striptags(result);
  if (config.normalizeWhitespace) result = result.replace(/\s+/g, " ").trim();
  if (config.prefix) result = config.prefix + result;
  if (config.suffix) result = result + config.suffix;
  if (config.truncateCharacters && result.length > config.truncateCharacters) {
    result = result.slice(0, config.truncateCharacters);
  }

  return result;
}

function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "");
}

function applyLinkTransform(link: string | undefined, config: LinkTransformConfig | undefined): string | undefined {
  if (!config || !link) return link;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }

  if (config.forceHttps && url.protocol === "http:") url.protocol = "https:";

  if (config.allowedParams && config.allowedParams.length > 0) {
    const allowed = new Set(config.allowedParams);
    for (const key of [...url.searchParams.keys()]) {
      if (!allowed.has(key)) url.searchParams.delete(key);
    }
  } else {
    if (config.removeTrackingParams !== false) {
      for (const p of DEFAULT_TRACKING_PARAMS) url.searchParams.delete(p);
    }
    for (const p of config.blockedParams ?? []) url.searchParams.delete(p);
  }

  return url.toString();
}

function applyCategoryTransform(
  categories: string[] | undefined,
  config: CategoryTransformConfig | undefined,
): string[] | undefined {
  if (!config || !categories) return categories;
  let result = [...categories];
  if (config.normalizeWhitespace) result = result.map((c) => c.replace(/\s+/g, " ").trim());
  if (config.lowercase) result = result.map((c) => c.toLowerCase());
  if (config.dedupe) result = [...new Set(result)];
  return result;
}

function resolveGuid(item: NormalizedFeedItem, strategy: BasicItemTransformConfig["guidStrategy"]): string {
  const strat = strategy ?? "existingOrLinkHash";
  switch (strat) {
    case "existing":
      return item.guid || hash(item.title + (item.link ?? "") + (item.pubDate ?? ""));
    case "link":
      return item.link || hash(item.title + (item.link ?? "") + (item.pubDate ?? ""));
    case "existingOrLinkHash":
      return item.guid || item.link || hash(item.title + (item.link ?? "") + (item.pubDate ?? ""));
    case "titleLinkDateHash":
      return hash(item.title + (item.link ?? "") + (item.pubDate ?? ""));
    case "contentHash":
      return hash(item.title + (item.link ?? "") + (item.description ?? "") + (item.content ?? ""));
    default:
      return item.guid || hash(item.title + (item.link ?? "") + (item.pubDate ?? ""));
  }
}

function resolveDate(
  item: NormalizedFeedItem,
  strategy: BasicItemTransformConfig["dateStrategy"],
  fetchedAt: string,
): string | undefined {
  const strat = strategy ?? "publishedOrUpdatedOrFetched";
  const valid = (d: string | undefined): boolean => !!d && !isNaN(new Date(d).getTime());

  switch (strat) {
    case "published": return valid(item.pubDate) ? item.pubDate : undefined;
    case "updated": return valid(item.updatedDate) ? item.updatedDate : undefined;
    case "publishedOrUpdated":
      return valid(item.pubDate) ? item.pubDate : (valid(item.updatedDate) ? item.updatedDate : undefined);
    case "publishedOrUpdatedOrFetched":
      return valid(item.pubDate) ? item.pubDate : (valid(item.updatedDate) ? item.updatedDate : fetchedAt);
    case "fetched": return fetchedAt;
    default:
      return valid(item.pubDate) ? item.pubDate : fetchedAt;
  }
}

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/timb/projects/mkfd && bun test tests/feed-item-transform.test.ts
```

Expected: all 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-item-transform.utility.ts tests/feed-item-transform.test.ts
git commit -m "feat: add feed-item-transform utility with TDD"
```

---

### Task 4: Existing feed parser utility (TDD)

**Files:**
- Create: `utilities/existing-feed-parser.utility.ts`
- Create: `tests/existing-feed-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/existing-feed-parser.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  parseRSSXml,
  parseAtomXml,
  parseJsonFeedText,
  detectFeedFormat,
} from "../utilities/existing-feed-parser.utility";

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test feed</description>
    <item>
      <title>Post One</title>
      <link>https://example.com/post-1</link>
      <guid>guid-abc-123</guid>
      <description>Description one</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
      <dc:creator>Author Name</dc:creator>
      <category>Tech</category>
      <category>Web</category>
      <enclosure url="https://example.com/audio.mp3" type="audio/mpeg" length="1234"/>
    </item>
  </channel>
</rss>`;

const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Test Feed</title>
  <link href="https://example.com"/>
  <updated>2024-01-01T00:00:00Z</updated>
  <entry>
    <id>https://example.com/entry-1</id>
    <title>Entry One</title>
    <link href="https://example.com/entry-1"/>
    <published>2024-01-01T00:00:00Z</published>
    <updated>2024-01-02T00:00:00Z</updated>
    <summary>Summary one</summary>
    <author><name>Entry Author</name></author>
    <category term="science"/>
  </entry>
</feed>`;

const JSON_FEED_TEXT = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  title: "JSON Test Feed",
  home_page_url: "https://example.com",
  items: [{
    id: "item-1",
    url: "https://example.com/item-1",
    title: "Item One",
    summary: "Summary text",
    date_published: "2024-01-01T00:00:00Z",
    authors: [{ name: "JSON Author" }],
    tags: ["tech", "web"],
  }],
});

describe("parseRSSXml", () => {
  test("extracts feed metadata", () => {
    const { meta } = parseRSSXml(RSS_XML);
    expect(meta.title).toBe("Test Feed");
    expect(meta.link).toBe("https://example.com");
    expect(meta.description).toBe("A test feed");
  });

  test("extracts item fields: title, link, guid, description, pubDate, author, categories", () => {
    const { items } = parseRSSXml(RSS_XML);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.title).toBe("Post One");
    expect(item.link).toBe("https://example.com/post-1");
    expect(item.guid).toBe("guid-abc-123");
    expect(item.description).toBe("Description one");
    expect(item.author).toBe("Author Name");
    expect(item.categories).toContain("Tech");
    expect(item.categories).toContain("Web");
  });

  test("extracts enclosure", () => {
    const { items } = parseRSSXml(RSS_XML);
    expect(items[0].enclosure?.url).toBe("https://example.com/audio.mp3");
    expect(items[0].enclosure?.type).toBe("audio/mpeg");
    expect(items[0].enclosure?.length).toBe(1234);
  });
});

describe("parseAtomXml", () => {
  test("extracts feed metadata", () => {
    const { meta } = parseAtomXml(ATOM_XML);
    expect(meta.title).toBe("Atom Test Feed");
  });

  test("extracts entry fields: id, title, link, summary, published, updatedDate, author, categories", () => {
    const { items } = parseAtomXml(ATOM_XML);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.guid).toBe("https://example.com/entry-1");
    expect(item.title).toBe("Entry One");
    expect(item.link).toBe("https://example.com/entry-1");
    expect(item.description).toBe("Summary one");
    expect(item.author).toBe("Entry Author");
    expect(item.pubDate).toBe("2024-01-01T00:00:00Z");
    expect(item.updatedDate).toBe("2024-01-02T00:00:00Z");
    expect(item.categories).toContain("science");
  });
});

describe("parseJsonFeedText", () => {
  test("extracts feed metadata", () => {
    const { meta } = parseJsonFeedText(JSON_FEED_TEXT);
    expect(meta.title).toBe("JSON Test Feed");
    expect(meta.link).toBe("https://example.com");
  });

  test("extracts item fields: id, url, title, summary, date_published, authors, tags", () => {
    const { items } = parseJsonFeedText(JSON_FEED_TEXT);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.guid).toBe("item-1");
    expect(item.link).toBe("https://example.com/item-1");
    expect(item.title).toBe("Item One");
    expect(item.description).toBe("Summary text");
    expect(item.author).toBe("JSON Author");
    expect(item.pubDate).toBe("2024-01-01T00:00:00Z");
    expect(item.categories).toEqual(["tech", "web"]);
  });
});

describe("detectFeedFormat", () => {
  test("detects RSS from XML content", () => {
    expect(detectFeedFormat(RSS_XML, "text/xml", "auto")).toBe("rss");
  });

  test("detects Atom from XML content", () => {
    expect(detectFeedFormat(ATOM_XML, "application/xml", "auto")).toBe("atom");
  });

  test("detects JSON Feed from JSON content", () => {
    expect(detectFeedFormat(JSON_FEED_TEXT, "application/json", "auto")).toBe("jsonFeed");
  });

  test("explicit format overrides auto-detection", () => {
    expect(detectFeedFormat(RSS_XML, "text/xml", "atom")).toBe("atom");
  });

  test("detects JSON Feed from content-type application/feed+json", () => {
    expect(detectFeedFormat(JSON_FEED_TEXT, "application/feed+json", "auto")).toBe("jsonFeed");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/timb/projects/mkfd && bun test tests/existing-feed-parser.test.ts 2>&1 | head -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `utilities/existing-feed-parser.utility.ts`**

```ts
import { DOMParser } from "xmldom";
import type { NormalizedFeedItem, NormalizedFeedEnclosure } from "../models/normalized-feed-item.model";
import type { FeedTransformerSourceFormat } from "../models/feed-transformer.model";

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

export type ParseExistingFeedInput = {
  url: string;
  format: FeedTransformerSourceFormat;
  headers?: Record<string, string>;
  timeoutMs?: number;
  allowPrivateFetches?: boolean;
  allowlistHosts?: string[];
};

export async function parseExistingFeed(input: ParseExistingFeedInput): Promise<ParsedExistingFeed> {
  const { url, format, headers = {}, timeoutMs = 30000 } = input;
  const warnings: string[] = [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let responseText: string;
  let contentType: string;

  try {
    await assertOutboundFetchAllowed(url, {
      allowPrivateFetches: input.allowPrivateFetches,
      allowlistHosts: input.allowlistHosts,
    });
    const res = await fetch(url, { headers, signal: controller.signal, redirect: "manual" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    contentType = res.headers.get("content-type") || "";
    responseText = await res.text();
  } catch (err: any) {
    clearTimeout(timer);
    throw new Error(`Could not fetch source feed: ${err.message}`);
  }

  const detectedFormat = detectFeedFormat(responseText, contentType, format);

  if (detectedFormat === "rss") {
    const { meta, items } = parseRSSXml(responseText);
    if (items.length === 0) warnings.push("Source feed parsed successfully but contains no items.");
    return { detectedFormat, feed: meta, items, warnings };
  }
  if (detectedFormat === "atom") {
    const { meta, items } = parseAtomXml(responseText);
    if (items.length === 0) warnings.push("Source feed parsed successfully but contains no items.");
    return { detectedFormat, feed: meta, items, warnings };
  }
  if (detectedFormat === "jsonFeed") {
    const { meta, items } = parseJsonFeedText(responseText);
    if (items.length === 0) warnings.push("Source feed parsed successfully but contains no items.");
    return { detectedFormat, feed: meta, items, warnings };
  }

  throw new Error("Mkfd could not detect RSS, Atom, or JSON Feed data at this URL.");
}

export function detectFeedFormat(
  text: string,
  contentType: string,
  explicit: FeedTransformerSourceFormat,
): "rss" | "atom" | "jsonFeed" {
  if (explicit !== "auto") return explicit as "rss" | "atom" | "jsonFeed";

  if (contentType.includes("application/feed+json")) return "jsonFeed";

  try {
    const parsed = JSON.parse(text);
    if (parsed.version && Array.isArray(parsed.items)) return "jsonFeed";
  } catch {}

  const trimmed = text.trimStart().toLowerCase();
  if (trimmed.includes("<rss ") || trimmed.includes("<rss>")) return "rss";
  if (trimmed.includes('xmlns="http://www.w3.org/2005/atom"') || trimmed.startsWith("<feed")) return "atom";

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const root = doc.documentElement?.tagName?.toLowerCase();
    if (root === "rss") return "rss";
    if (root === "feed") return "atom";
  } catch {}

  throw new Error("Mkfd could not detect RSS, Atom, or JSON Feed data at this URL.");
}

export function parseRSSXml(xml: string): { meta: ParsedExistingFeedMetadata; items: NormalizedFeedItem[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const channel = doc.getElementsByTagName("channel")[0];
  if (!channel) return { meta: {}, items: [] };

  const getDirectChild = (parent: Element, tagName: string): string | undefined => {
    const nodes = parent.childNodes;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeName === tagName) return nodes[i].textContent?.trim() || undefined;
    }
    return undefined;
  };

  const imageEl = channel.getElementsByTagName("image")[0];
  const meta: ParsedExistingFeedMetadata = {
    title: getDirectChild(channel as unknown as Element, "title"),
    description: getDirectChild(channel as unknown as Element, "description"),
    link: getDirectChild(channel as unknown as Element, "link"),
    language: getDirectChild(channel as unknown as Element, "language"),
    image: imageEl?.getElementsByTagName("url")[0]?.textContent?.trim(),
    updatedDate: getDirectChild(channel as unknown as Element, "lastBuildDate") || getDirectChild(channel as unknown as Element, "pubDate"),
    generator: getDirectChild(channel as unknown as Element, "generator"),
  };

  const itemEls = channel.getElementsByTagName("item");
  const items: NormalizedFeedItem[] = [];

  for (let i = 0; i < itemEls.length; i++) {
    const el = itemEls[i];
    const getText = (tag: string) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;

    const dcCreator =
      el.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "creator")[0]?.textContent?.trim() ||
      el.getElementsByTagName("dc:creator")[0]?.textContent?.trim();

    const contentEncoded =
      el.getElementsByTagNameNS("http://purl.org/rss/1.0/modules/content/", "encoded")[0]?.textContent?.trim() ||
      el.getElementsByTagName("content:encoded")[0]?.textContent?.trim();

    const catEls = el.getElementsByTagName("category");
    const categories: string[] = [];
    for (let j = 0; j < catEls.length; j++) {
      const c = catEls[j].textContent?.trim();
      if (c) categories.push(c);
    }

    const encEl = el.getElementsByTagName("enclosure")[0];
    const enclosure: NormalizedFeedEnclosure | undefined = encEl
      ? {
          url: encEl.getAttribute("url") || "",
          type: encEl.getAttribute("type") || undefined,
          length: parseInt(encEl.getAttribute("length") || "0", 10) || 0,
        }
      : undefined;

    const srcEl = el.getElementsByTagName("source")[0];

    items.push({
      guid: getText("guid"),
      title: getText("title") || "",
      link: getText("link"),
      description: getText("description"),
      contentEncoded,
      author: getText("author") || dcCreator,
      pubDate: getText("pubDate"),
      categories: categories.length > 0 ? categories : undefined,
      enclosure: enclosure?.url ? enclosure : undefined,
      source: srcEl ? { title: srcEl.textContent?.trim(), url: srcEl.getAttribute("url") || undefined } : undefined,
    });
  }

  return { meta, items };
}

export function parseAtomXml(xml: string): { meta: ParsedExistingFeedMetadata; items: NormalizedFeedItem[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const feed = doc.documentElement;
  if (!feed) return { meta: {}, items: [] };

  const getText = (parent: Element, tag: string) =>
    parent.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;

  const feedLinkEls = feed.getElementsByTagName("link");
  let feedLink: string | undefined;
  for (let i = 0; i < feedLinkEls.length; i++) {
    if (!feedLinkEls[i].getAttribute("rel") || feedLinkEls[i].getAttribute("rel") === "alternate") {
      feedLink = feedLinkEls[i].getAttribute("href") || undefined;
      break;
    }
  }

  const meta: ParsedExistingFeedMetadata = {
    title: getText(feed, "title"),
    description: getText(feed, "subtitle"),
    link: feedLink,
    language: feed.getAttribute("xml:lang") || undefined,
    updatedDate: getText(feed, "updated"),
    generator: getText(feed, "generator"),
  };

  const entryEls = feed.getElementsByTagName("entry");
  const items: NormalizedFeedItem[] = [];

  for (let i = 0; i < entryEls.length; i++) {
    const entry = entryEls[i];
    const getT = (tag: string) => entry.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;

    const linkEls = entry.getElementsByTagName("link");
    let link: string | undefined;
    let enclosure: NormalizedFeedEnclosure | undefined;
    for (let j = 0; j < linkEls.length; j++) {
      const rel = linkEls[j].getAttribute("rel");
      if (!rel || rel === "alternate") link = link || linkEls[j].getAttribute("href") || undefined;
      if (rel === "enclosure") {
        enclosure = {
          url: linkEls[j].getAttribute("href") || "",
          type: linkEls[j].getAttribute("type") || undefined,
          length: parseInt(linkEls[j].getAttribute("length") || "0", 10) || 0,
        };
      }
    }

    const catEls = entry.getElementsByTagName("category");
    const categories: string[] = [];
    for (let j = 0; j < catEls.length; j++) {
      const term = catEls[j].getAttribute("term") || catEls[j].getAttribute("label") || catEls[j].textContent?.trim();
      if (term) categories.push(term);
    }

    const authorName = entry.getElementsByTagName("author")[0]?.getElementsByTagName("name")[0]?.textContent?.trim();
    const summary = getT("summary");
    const content = entry.getElementsByTagName("content")[0]?.textContent?.trim();

    items.push({
      guid: getT("id"),
      title: getT("title") || "",
      link,
      description: summary,
      content,
      summary,
      author: authorName,
      pubDate: getT("published"),
      updatedDate: getT("updated"),
      categories: categories.length > 0 ? categories : undefined,
      enclosure: enclosure?.url ? enclosure : undefined,
    });
  }

  return { meta, items };
}

export function parseJsonFeedText(jsonText: string): { meta: ParsedExistingFeedMetadata; items: NormalizedFeedItem[] } {
  const data = JSON.parse(jsonText);

  const meta: ParsedExistingFeedMetadata = {
    title: data.title,
    description: data.description,
    link: data.home_page_url || data.feed_url,
    language: data.language,
    image: data.icon || data.favicon,
  };

  const rawItems: unknown[] = Array.isArray(data.items) ? data.items : [];
  const items: NormalizedFeedItem[] = rawItems.map((raw: any): NormalizedFeedItem => {
    const attachment = Array.isArray(raw.attachments) && raw.attachments.length > 0 ? raw.attachments[0] : null;
    let author: string | undefined;
    if (raw.author?.name) author = raw.author.name;
    else if (Array.isArray(raw.authors) && raw.authors.length > 0) author = raw.authors[0]?.name;

    return {
      guid: raw.id ? String(raw.id) : undefined,
      title: raw.title || "",
      link: raw.url,
      description: raw.summary || raw.content_text,
      contentEncoded: raw.content_html,
      author,
      pubDate: raw.date_published,
      updatedDate: raw.date_modified,
      categories: Array.isArray(raw.tags) ? raw.tags : undefined,
      enclosure: attachment?.url
        ? { url: attachment.url, type: attachment.mime_type, length: attachment.size_in_bytes || 0 }
        : undefined,
    };
  });

  return { meta, items };
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/timb/projects/mkfd && bun test tests/existing-feed-parser.test.ts
```

Expected: all 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add utilities/existing-feed-parser.utility.ts tests/existing-feed-parser.test.ts
git commit -m "feat: add existing-feed-parser utility with TDD (RSS/Atom/JSON Feed)"
```

---

### Task 5: Normalized feed builder utility (TDD)

**Files:**
- Create: `utilities/normalized-feed-builder.utility.ts`
- Create: `tests/normalized-feed-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/normalized-feed-builder.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { buildFeedFromNormalizedItems } from "../utilities/normalized-feed-builder.utility";

const BASE = {
  feedId: "test-id",
  feedName: "my-feed",
  serverUrl: "http://localhost:5000",
};

describe("buildFeedFromNormalizedItems", () => {
  test("uses override title over source metadata", () => {
    const feed = buildFeedFromNormalizedItems({
      ...BASE,
      overrides: { title: "Override Title" },
      sourceFeedMeta: { title: "Source Title" },
      items: [],
    });
    expect(feed.rss2()).toContain("Override Title");
    expect(feed.rss2()).not.toContain("Source Title");
  });

  test("falls back to source metadata when no override", () => {
    const feed = buildFeedFromNormalizedItems({
      ...BASE,
      sourceFeedMeta: { title: "Source Title", description: "Source desc" },
      items: [],
    });
    expect(feed.rss2()).toContain("Source Title");
  });

  test("falls back to feedName when no title in meta or override", () => {
    const feed = buildFeedFromNormalizedItems({ ...BASE, items: [] });
    expect(feed.rss2()).toContain("my-feed");
  });

  test("maps item title, link, description to feed item", () => {
    const feed = buildFeedFromNormalizedItems({
      ...BASE,
      items: [{
        title: "Test Item",
        link: "https://example.com/post",
        guid: "guid-1",
        description: "Test description",
        pubDate: "2024-01-01T00:00:00Z",
      }],
    });
    const xml = feed.rss2();
    expect(xml).toContain("Test Item");
    expect(xml).toContain("https://example.com/post");
    expect(xml).toContain("Test description");
  });

  test("maps item categories to feed categories", () => {
    const feed = buildFeedFromNormalizedItems({
      ...BASE,
      items: [{ title: "Post", categories: ["tech", "web"] }],
    });
    const xml = feed.rss2();
    expect(xml).toContain("tech");
    expect(xml).toContain("web");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/timb/projects/mkfd && bun test tests/normalized-feed-builder.test.ts 2>&1 | head -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `utilities/normalized-feed-builder.utility.ts`**

```ts
import { Feed } from "feed";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import type { FeedTransformerFeedMetadataOverrides } from "../models/feed-transformer.model";
import type { ParsedExistingFeedMetadata } from "./existing-feed-parser.utility";
import { sanitizeForXML, sanitizeURLForXML } from "./xml-sanitizer.utility";

export type BuildFeedFromNormalizedItemsInput = {
  feedId: string;
  feedName: string;
  serverUrl: string;
  overrides?: FeedTransformerFeedMetadataOverrides;
  sourceFeedMeta?: ParsedExistingFeedMetadata;
  items: NormalizedFeedItem[];
};

export function buildFeedFromNormalizedItems(input: BuildFeedFromNormalizedItemsInput): Feed {
  const { feedId, feedName, serverUrl, overrides, sourceFeedMeta, items } = input;

  const title = overrides?.title || sourceFeedMeta?.title || feedName;
  const description = overrides?.description || sourceFeedMeta?.description || "";
  const link = overrides?.link || sourceFeedMeta?.link || "";
  const language = overrides?.language || sourceFeedMeta?.language;
  const image = overrides?.image || sourceFeedMeta?.image;
  const copyright = overrides?.copyright || "";

  const feed = new Feed({
    id: sanitizeURLForXML(`${serverUrl}/public/feeds/${feedId}.xml`),
    title: sanitizeForXML(title),
    link: sanitizeURLForXML(link),
    description: sanitizeForXML(description),
    language: language ? sanitizeForXML(language) : undefined,
    image: image ? sanitizeURLForXML(image) : undefined,
    copyright: sanitizeForXML(copyright),
    generator: "Generated by mkfd",
    updated: new Date(),
    feedLinks: {
      rss: sanitizeURLForXML(`${serverUrl}/public/feeds/${feedId}.xml`),
    },
  });

  for (const item of items) {
    const dateStr = item.pubDate || item.updatedDate;
    const date = dateStr && !isNaN(new Date(dateStr).getTime()) ? new Date(dateStr) : new Date();

    const feedItem: any = {
      id: sanitizeForXML(item.guid || item.link || ""),
      title: sanitizeForXML(item.title),
      link: sanitizeURLForXML(item.link || ""),
      date,
      description: item.description ? sanitizeForXML(item.description) : undefined,
      content: item.content ? sanitizeForXML(item.content) : undefined,
    };

    if (item.author) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.author.trim())) {
        feedItem.author = [{ email: item.author }];
      } else {
        feedItem.extensions = feedItem.extensions || [];
        feedItem.extensions.push({ name: "dc:creator", objects: sanitizeForXML(item.author) });
      }
    }

    if (item.categories?.length) {
      feedItem.category = item.categories.map((name) => ({ name: sanitizeForXML(name) }));
    }

    if (item.enclosure?.url) {
      feedItem.enclosure = {
        url: sanitizeURLForXML(item.enclosure.url),
        type: item.enclosure.type || "application/octet-stream",
        length: item.enclosure.length || 0,
      };
    }

    if (item.contentEncoded) {
      feedItem.extensions = feedItem.extensions || [];
      feedItem.extensions.push({ name: "content:encoded", objects: sanitizeForXML(item.contentEncoded) });
    }

    feed.addItem(feedItem);
  }

  return feed;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/timb/projects/mkfd && bun test tests/normalized-feed-builder.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add utilities/normalized-feed-builder.utility.ts tests/normalized-feed-builder.test.ts
git commit -m "feat: add normalized-feed-builder utility with TDD"
```

---

### Task 6: Feed transformer orchestrator

**Files:**
- Create: `utilities/feed-transformer.utility.ts`

- [ ] **Step 1: Create `utilities/feed-transformer.utility.ts`**

```ts
import type { Feed } from "feed";
import type { FeedTransformerFeedConfig } from "../models/feed-config.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import { parseExistingFeed, type ParsedExistingFeedMetadata } from "./existing-feed-parser.utility";
import { transformFeedItems } from "./feed-item-transform.utility";
import { filterFeedItems } from "./feed-item-filter.utility";
import { buildFeedFromNormalizedItems } from "./normalized-feed-builder.utility";

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

export async function runFeedTransformer(input: RunFeedTransformerInput): Promise<RunFeedTransformerResult> {
  const { config, serverUrl } = input;
  const block = config.feedTransformer;
  const fetchedAt = new Date().toISOString();
  const allWarnings: string[] = [];

  // 1. Fetch + parse all sources in parallel
  const parseResults = await Promise.all(
    block.sources.map((source) =>
      parseExistingFeed({
        url: source.url,
        format: source.format,
        headers: source.headers,
        timeoutMs: 30000,
      })
    )
  );

  const detectedFormats = parseResults.map((r) => r.detectedFormat);
  parseResults.forEach((r) => allWarnings.push(...r.warnings));
  const inputItemCount = parseResults.reduce((sum, r) => sum + r.items.length, 0);

  // 2. Merge by strategy (default: dateDesc)
  const strategy = block.mergeStrategy ?? "dateDesc";
  let merged: NormalizedFeedItem[];
  if (strategy === "preserveOrder") {
    merged = parseResults.flatMap((r) => r.items);
  } else {
    merged = parseResults.flatMap((r) => r.items).sort((a, b) => {
      const ta = new Date(a.pubDate || a.updatedDate || 0).getTime();
      const tb = new Date(b.pubDate || b.updatedDate || 0).getTime();
      return strategy === "dateDesc" ? tb - ta : ta - tb;
    });
  }

  // 3. Transform
  const transformResult = transformFeedItems({
    items: merged,
    config: block.items || {},
    fetchedAt,
  });
  allWarnings.push(...transformResult.warnings);

  // 4. Filter
  const filterResult = filterFeedItems({
    items: transformResult.items,
    filters: block.items?.filters,
  });

  // 5. Dedupe by resolved GUID (default: true)
  let deduped = filterResult.items;
  let dedupedItemCount = 0;
  if (block.dedupeAcrossSources !== false) {
    const seen = new Set<string>();
    const before = deduped.length;
    deduped = deduped.filter((item) => {
      const key = item.guid || item.link || "";
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    dedupedItemCount = before - deduped.length;
  }

  // 6. Cap at maxItems
  const maxItems = block.maxItems ?? 50;
  deduped = deduped.slice(0, maxItems);

  // 7. Build Feed object
  const sourceFeedMeta: ParsedExistingFeedMetadata | undefined = parseResults[0]?.feed;
  const feed = buildFeedFromNormalizedItems({
    feedId: config.feedId,
    feedName: config.feedName,
    serverUrl,
    overrides: block.feed,
    sourceFeedMeta,
    items: deduped,
  });

  return {
    feed,
    warnings: allWarnings,
    stats: {
      sourceCount: block.sources.length,
      detectedFormats,
      inputItemCount,
      outputItemCount: deduped.length,
      filteredItemCount: filterResult.filteredItemCount,
      dedupedItemCount,
    },
  };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/timb/projects/mkfd && bun run tsc --noEmit 2>&1 | grep -i "feed-transformer\|normalized-feed\|feed-item"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add utilities/feed-transformer.utility.ts
git commit -m "feat: add feed-transformer orchestrator utility"
```

---

### Task 7: API — probe endpoint, preview extension, save validation

**Files:**
- Modify: `routes/feeds.ts`
- Modify: `utilities/preview-generator.utility.ts`

- [ ] **Step 1: Add the probe endpoint to `routes/feeds.ts`**

In `routes/feeds.ts`, add this route inside the `feedsRouter` factory, before the final `return app;` statement:

```ts
app.post("/api/feeds/transformer/probe", async (ctx) => {
  try {
    const body = await ctx.req.json();
    const { url, format = "auto", headers = {} } = body as {
      url: string;
      format?: string;
      headers?: Record<string, string>;
    };

    if (!url || !/^https?:\/\//i.test(url)) {
      return ctx.json({ error: "url must be a valid HTTP/HTTPS URL" }, 400);
    }
    const { assertOutboundFetchAllowed } = await import("../utilities/outbound-fetch-policy.utility");
    await assertOutboundFetchAllowed(url, {
      allowPrivateFetches: process.env.ALLOW_PRIVATE_FETCHES === "true",
      allowlistHosts: (process.env.OUTBOUND_FETCH_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });

    const { parseExistingFeed } = await import("../utilities/existing-feed-parser.utility");
    const result = await parseExistingFeed({
      url,
      format: format as any,
      headers,
      timeoutMs: 15000,
      allowPrivateFetches: process.env.ALLOW_PRIVATE_FETCHES === "true",
      allowlistHosts: (process.env.OUTBOUND_FETCH_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });

    const latestDate = result.items
      .map((i) => i.pubDate || i.updatedDate)
      .filter(Boolean)
      .sort()
      .reverse()[0];

    return ctx.json({
      detectedFormat: result.detectedFormat,
      feed: {
        title: result.feed.title,
        description: result.feed.description,
        link: result.feed.link,
        itemCount: result.items.length,
        latestDate,
      },
      warnings: result.warnings,
    });
  } catch (err: any) {
    return ctx.json({ error: err.message || "Failed to probe source feed" }, 400);
  }
});
```

- [ ] **Step 2: Extend `generatePreview` in `utilities/preview-generator.utility.ts`**

In `utilities/preview-generator.utility.ts`, find the `generatePreview` function. Add a `feedTransformer` branch before the final `return rssXml!;` statement (or inside the `if/else` block):

```ts
// Inside generatePreview, add after the existing feedType branches:
if (feedConfig.feedType === "feedTransformer") {
  const { runFeedTransformer } = await import("./feed-transformer.utility");
  const serverUrl = process.env.SERVER_URL || "http://localhost:5000";
  const result = await runFeedTransformer({
    config: feedConfig,
    encryptionKey: (feedConfig as any).encryptionKey || "", // Ensure key is passed if needed
    serverUrl,
  });
  return result.feed.rss2();
}
```

- [ ] **Step 3: Add feedTransformer validation to the save routes in `routes/feeds.ts`**

In `routes/feeds.ts`, find the `POST /` handler and the `PUT /api/feeds/:id` handler. In both, add feedTransformer extraction and validation after the existing `feedType === "email"` branches:

```ts
// After the existing else if (feedType === "email") block in both POST / and PUT /api/feeds/:id:
else if (feedType === "feedTransformer") {
  const ftBlock = extract("feedTransformer", {});
  const sources = ftBlock.sources;

  if (!Array.isArray(sources) || sources.length === 0) {
    return ctx.json({ error: "feedTransformer.sources must be a non-empty array" }, 400);
  }
  for (const src of sources) {
    if (!src.url || !/^https?:\/\//i.test(src.url)) {
      return ctx.json({ error: `Invalid source URL: ${src.url}` }, 400);
    }
    const validFormats = ["auto", "rss", "atom", "jsonFeed"];
    if (src.format && !validFormats.includes(src.format)) {
      return ctx.json({ error: `Invalid source format: ${src.format}` }, 400);
    }
  }
  if (ftBlock.maxItems !== undefined && (typeof ftBlock.maxItems !== "number" || ftBlock.maxItems < 1)) {
    return ctx.json({ error: "feedTransformer.maxItems must be a positive integer" }, 400);
  }
  const validMerge = ["dateDesc", "dateAsc", "preserveOrder"];
  if (ftBlock.mergeStrategy && !validMerge.includes(ftBlock.mergeStrategy)) {
    return ctx.json({ error: `Invalid mergeStrategy: ${ftBlock.mergeStrategy}` }, 400);
  }
  // Validate regex filter rules
  const filterRules = [
    ...(ftBlock.items?.filters?.include || []),
    ...(ftBlock.items?.filters?.exclude || []),
  ];
```
  for (const rule of filterRules) {
    if (rule.type === "regex") {
      try { new RegExp(rule.value); } catch {
        return ctx.json({ error: `Invalid regex in filter rule: ${rule.value}` }, 400);
      }
    }
  }
}
```

Also add `feedTransformer` to the YAML config object that gets written to disk. In both `POST /` and `PUT /api/feeds/:id`, in the section that builds the config object before `yaml.dump`, add:

```ts
...(feedType === "feedTransformer" && { feedTransformer: extract("feedTransformer", {}) }),
```

- [ ] **Step 4: Type-check**

```bash
cd /home/timb/projects/mkfd && bun run tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 5: Smoke test the probe endpoint**

Start the server: `bun run index.ts` (in a separate terminal)

```bash
curl -s -X POST http://localhost:5000/api/feeds/transformer/probe \
  -H "Content-Type: application/json" \
  -d '{"url":"https://feeds.feedburner.com/TechCrunch","format":"auto"}' | head -c 300
```

Expected: JSON response with `detectedFormat`, `feed.title`, `feed.itemCount`.

- [ ] **Step 6: Commit**

```bash
git add routes/feeds.ts utilities/preview-generator.utility.ts
git commit -m "feat: add probe endpoint and feedTransformer support in preview/save"
```

---

### Task 8: Worker integration

**Files:**
- Modify: `workers/feed-updater.worker.ts`

- [ ] **Step 1: Add feedTransformer branch to the worker**

In `workers/feed-updater.worker.ts`, inside `fetchDataAndUpdateFeed`, add after the `else if (feedConfig.feedType === "api")` block:

```ts
else if (feedConfig.feedType === "feedTransformer") {
  const { runFeedTransformer } = await import("../utilities/feed-transformer.utility");
  const serverUrl = feedConfig.serverUrl || process.env.SERVER_URL || "http://localhost:5000";

  const result = await runFeedTransformer({
    config: feedConfig,
    encryptionKey: feedConfig.encryptionKey || "",
    serverUrl,
  });

  // writeAllFeedFormats is provided by Feed Format Refactor (Phase 2)
  const { writeAllFeedFormats } = await import("../utilities/feed-output.utility");
  const outputs = await writeAllFeedFormats(feedConfig.feedId, result.feed);

  await storeFeedHistory(feedConfig.feedId, JSON.stringify(result.items), "items_json");

  self.postMessage({
    status: "done",
    feedId: feedConfig.feedId,
    metrics: {
      startedAt,
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      timedOut: false,
      itemCount: result.stats.outputItemCount,
      selectorMatches: null,
      dateFallbacks: 0,
      duplicateGuids: result.stats.dedupedItemCount,
      webhookStatus: "skipped",
      webhookError: null,
      errorMessage: null,
      // feedTransformer-specific metrics
      sourceCount: result.stats.sourceCount,
      detectedFormats: result.stats.detectedFormats,
      inputItemCount: result.stats.inputItemCount,
      filteredItemCount: result.stats.filteredItemCount,
      warnings: result.warnings,
    },
  });
  return;
}
```

Note: `writeAllFeedFormats` is imported from `utilities/feed-output.utility` — the path provided by the Feed Format Refactor plan. If that plan used a different path, update the import accordingly.

- [ ] **Step 2: Type-check**

```bash
cd /home/timb/projects/mkfd && bun run tsc --noEmit 2>&1 | head -20
```

Expected: no errors in the worker file.

- [ ] **Step 3: Commit**

```bash
git add workers/feed-updater.worker.ts
git commit -m "feat: add feedTransformer branch to feed-updater worker"
```

---

### Task 9: Frontend form

**Files:**
- Create: `frontend/src/components/forms/ExistingFeedTransformerForm.tsx`
- Modify: `frontend/src/components/forms/FeedBuilderForm.tsx`
- Modify: `frontend/src/components/builder/TypePickerGrid.tsx`
- Modify: `frontend/src/pages/BuildFeedPage.tsx`

**Precondition:** Builder UI Redesign must be implemented. Verify these files exist before starting:
- `frontend/src/components/builder/Section.tsx`
- `frontend/src/components/builder/Field.tsx`
- `frontend/src/components/builder/FieldRow.tsx`
- `frontend/src/components/builder/KVEditor.tsx`

- [ ] **Step 1: Create `ExistingFeedTransformerForm.tsx`**

```tsx
import React, { useState } from "react";
import { useFieldArray, Controller, type Control, type UseFormRegister, type UseFormWatch, type UseFormSetValue } from "react-hook-form";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { FieldRow } from "@/components/builder/FieldRow";
import { KVEditor } from "@/components/builder/KVEditor";
import { Rss, Link2, Wand2, Filter, Calendar, FileText, Settings } from "lucide-react";

type ProbeResult = {
  detectedFormat?: string;
  feed?: { title?: string; description?: string; link?: string; itemCount?: number; latestDate?: string };
  warnings?: string[];
  error?: string;
};

interface ExistingFeedTransformerFormProps {
  control: Control<any>;
  register: UseFormRegister<any>;
  watch: UseFormWatch<any>;
  setValue: UseFormSetValue<any>;
  activeSection?: string;
}

export const ExistingFeedTransformerForm: React.FC<ExistingFeedTransformerFormProps> = ({
  control, register, watch, setValue, activeSection,
}) => {
  const show = (id: string) => !activeSection || activeSection === id;
  const [probeResults, setProbeResults] = useState<Record<number, ProbeResult>>({});
  const [probeLoading, setProbeLoading] = useState<Record<number, boolean>>({});
  const [showInclude, setShowInclude] = useState(false);

  const { fields: sourceFields, append: appendSource, remove: removeSource } = useFieldArray({
    control, name: "feedTransformer.sources",
  });
  const { fields: excludeFields, append: appendExclude, remove: removeExclude } = useFieldArray({
    control, name: "feedTransformer.items.filters.exclude",
  });
  const { fields: includeFields, append: appendInclude, remove: removeInclude } = useFieldArray({
    control, name: "feedTransformer.items.filters.include",
  });

  const handleProbe = async (index: number) => {
    const sources = watch("feedTransformer.sources") || [];
    const src = sources[index];
    if (!src?.url) return;
    setProbeLoading((p) => ({ ...p, [index]: true }));
    try {
      const res = await fetch("/api/feeds/transformer/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: src.url, format: src.format || "auto" }),
      });
      const data = await res.json();
      setProbeResults((p) => ({ ...p, [index]: data }));
    } catch {
      setProbeResults((p) => ({ ...p, [index]: { error: "Could not reach probe endpoint" } }));
    } finally {
      setProbeLoading((p) => ({ ...p, [index]: false }));
    }
  };

  const emptyRule = () => ({ field: "title" as const, type: "contains" as const, value: "", caseSensitive: false });

  return (
    <>
      {/* Section 1: Basic */}
      {show("basic") && (
        <Section icon={<Settings className="h-4 w-4" />} title="Basic" sub="Feed name, category, and schedule">
          <Field label="Feed name" required>
            <Input {...register("feedName")} placeholder="my-cleaned-feed" />
          </Field>
          <FieldRow cols={2}>
            <Field label="Category">
              <Input {...register("metadata.category")} placeholder="news" />
            </Field>
            <Field label="Refresh interval (minutes)">
              <Input type="number" {...register("refreshTime", { valueAsNumber: true })} defaultValue={15} />
            </Field>
          </FieldRow>
          <Field label="Tags" hint="Comma-separated">
            <Input {...register("metadata.tags")} placeholder="rss, cleaned" />
          </Field>
          <Field label="Description">
            <Input {...register("metadata.description")} />
          </Field>
        </Section>
      )}

      {/* Section 2: Sources */}
      {show("sources") && (
        <Section icon={<Rss className="h-4 w-4" />} title="Sources" sub="One or more feed URLs to merge">
          <div className="flex flex-col gap-4">
            {sourceFields.map((field, index) => (
              <div key={field.id} className="border rounded-lg p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Source {index + 1}</span>
                  {sourceFields.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeSource(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <FieldRow cols={2}>
                  <Field label="URL" required>
                    <Input {...register(`feedTransformer.sources.${index}.url`)} placeholder="https://example.com/feed.xml" />
                  </Field>
                  <Field label="Format">
                    <Controller
                      control={control}
                      name={`feedTransformer.sources.${index}.format`}
                      defaultValue="auto"
                      render={({ field: f }) => (
                        <Select value={f.value} onValueChange={f.onChange}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto-detect</SelectItem>
                            <SelectItem value="rss">RSS</SelectItem>
                            <SelectItem value="atom">Atom</SelectItem>
                            <SelectItem value="jsonFeed">JSON Feed</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                </FieldRow>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Headers (optional)</summary>
                  <div className="mt-2">
                    <Controller
                      control={control}
                      name={`feedTransformer.sources.${index}.headers`}
                      defaultValue={[]}
                      render={({ field: f }) => (
                        <KVEditor rows={f.value || []} onChange={f.onChange} keyPlaceholder="Header name" valuePlaceholder="Value" showStorage addLabel="Add header" />
                      )}
                    />
                  </div>
                </details>
                <div className="flex flex-col gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => handleProbe(index)} disabled={probeLoading[index]}>
                    {probeLoading[index] ? "Probing…" : "Preview source"}
                  </Button>
                  {probeResults[index] && (
                    <div className="text-sm rounded-md bg-muted/50 p-3">
                      {probeResults[index].error ? (
                        <p className="text-destructive">{probeResults[index].error}</p>
                      ) : (
                        <>
                          <p><span className="font-medium">Format:</span> {probeResults[index].detectedFormat}</p>
                          {probeResults[index].feed?.title && <p><span className="font-medium">Title:</span> {probeResults[index].feed!.title}</p>}
                          <p><span className="font-medium">Items:</span> {probeResults[index].feed?.itemCount}</p>
                          {probeResults[index].feed?.latestDate && <p><span className="font-medium">Latest:</span> {probeResults[index].feed!.latestDate}</p>}
                          {probeResults[index].warnings?.map((w, i) => (
                            <p key={i} className="text-yellow-600 dark:text-yellow-400">{w}</p>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => appendSource({ url: "", format: "auto", headers: [] })}>
              <Plus className="h-4 w-4 mr-2" /> Add source
            </Button>
          </div>

          <div className="mt-6 border-t pt-4 flex flex-col gap-3">
            <p className="text-sm font-medium">Merge settings</p>
            <FieldRow cols={2}>
              <Field label="Merge strategy">
                <Controller
                  control={control}
                  name="feedTransformer.mergeStrategy"
                  defaultValue="dateDesc"
                  render={({ field: f }) => (
                    <Select value={f.value} onValueChange={f.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dateDesc">Newest first (date desc)</SelectItem>
                        <SelectItem value="dateAsc">Oldest first (date asc)</SelectItem>
                        <SelectItem value="preserveOrder">Preserve source order</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Max items">
                <Input type="number" {...register("feedTransformer.maxItems", { valueAsNumber: true })} defaultValue={50} />
              </Field>
            </FieldRow>
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="feedTransformer.dedupeAcrossSources"
                defaultValue={true}
                render={({ field: f }) => (
                  <Checkbox id="dedupe" checked={f.value} onCheckedChange={f.onChange} />
                )}
              />
              <Label htmlFor="dedupe">Deduplicate items across sources</Label>
            </div>
          </div>
        </Section>
      )}

      {/* Section 3: Feed Metadata */}
      {show("metadata") && (
        <Section icon={<FileText className="h-4 w-4" />} title="Feed Metadata" sub="Override output feed title and description">
          <Field label="Output title" hint="Leave blank to use source feed title">
            <Input {...register("feedTransformer.feed.title")} />
          </Field>
          <Field label="Output description">
            <Input {...register("feedTransformer.feed.description")} />
          </Field>
          <Field label="Output link">
            <Input {...register("feedTransformer.feed.link")} placeholder="https://example.com" />
          </Field>
        </Section>
      )}

      {/* Section 4: Item Cleanup */}
      {show("item-cleanup") && (
        <Section icon={<Wand2 className="h-4 w-4" />} title="Item Cleanup" sub="Strip, truncate, and normalize item fields">
          <div className="flex flex-col gap-2">
            {[
              { name: "feedTransformer.items.title.stripHtml", label: "Strip HTML from title" },
              { name: "feedTransformer.items.description.stripHtml", label: "Strip HTML from description" },
              { name: "feedTransformer.items.content.stripDangerousHtml", label: "Strip dangerous HTML from content (scripts, iframes)" },
              { name: "feedTransformer.items.description.normalizeWhitespace", label: "Normalize whitespace" },
            ].map(({ name, label }) => (
              <div key={name} className="flex items-center gap-2">
                <Controller control={control} name={name} defaultValue={false}
                  render={({ field: f }) => <Checkbox id={name} checked={f.value} onCheckedChange={f.onChange} />}
                />
                <Label htmlFor={name}>{label}</Label>
              </div>
            ))}
          </div>
          <FieldRow cols={2}>
            <Field label="Truncate description (characters)" hint="0 = no limit">
              <Input type="number" {...register("feedTransformer.items.description.truncateCharacters", { valueAsNumber: true })} defaultValue={0} />
            </Field>
            <div className="flex items-center gap-2 mt-6">
              <Controller control={control} name="feedTransformer.items.description.fallbackFrom"
                defaultValue={[]}
                render={({ field: f }) => (
                  <Checkbox id="descFallback" checked={f.value?.includes("content")}
                    onCheckedChange={(v) => f.onChange(v ? ["content"] : [])} />
                )}
              />
              <Label htmlFor="descFallback">Use content as description fallback</Label>
            </div>
          </FieldRow>
          <FieldRow cols={2}>
            <Field label="Title prefix">
              <Input {...register("feedTransformer.items.title.prefix")} placeholder="[SOURCE] " />
            </Field>
            <Field label="Title suffix">
              <Input {...register("feedTransformer.items.title.suffix")} />
            </Field>
          </FieldRow>
        </Section>
      )}

      {/* Section 5: Link Cleanup */}
      {show("link-cleanup") && (
        <Section icon={<Link2 className="h-4 w-4" />} title="Link Cleanup" sub="Remove tracking parameters and normalize links">
          <div className="flex items-center gap-2">
            <Controller control={control} name="feedTransformer.items.link.removeTrackingParams" defaultValue={true}
              render={({ field: f }) => <Checkbox id="trackingParams" checked={f.value} onCheckedChange={f.onChange} />}
            />
            <Label htmlFor="trackingParams">Remove tracking parameters (UTM, fbclid, gclid…)</Label>
          </div>
          <div className="flex items-center gap-2">
            <Controller control={control} name="feedTransformer.items.link.forceHttps" defaultValue={false}
              render={({ field: f }) => <Checkbox id="forceHttps" checked={f.value} onCheckedChange={f.onChange} />}
            />
            <Label htmlFor="forceHttps">Force HTTPS</Label>
          </div>
          <Field label="Allowed query parameters" hint="Comma-separated. If set, removes all other params.">
            <Input {...register("feedTransformer.items.link.allowedParams")} placeholder="id, slug" />
          </Field>
          <Field label="Blocked query parameters" hint="Comma-separated extra params to remove">
            <Input {...register("feedTransformer.items.link.blockedParams")} />
          </Field>
        </Section>
      )}

      {/* Section 6: Dates & GUIDs */}
      {show("dates-guids") && (
        <Section icon={<Calendar className="h-4 w-4" />} title="Dates & GUIDs" sub="How item dates and stable IDs are resolved">
          <FieldRow cols={2}>
            <Field label="Date strategy">
              <Controller control={control} name="feedTransformer.items.dateStrategy" defaultValue="publishedOrUpdatedOrFetched"
                render={({ field: f }) => (
                  <Select value={f.value} onValueChange={f.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="published">Published date</SelectItem>
                      <SelectItem value="updated">Updated date</SelectItem>
                      <SelectItem value="publishedOrUpdated">Published, then updated</SelectItem>
                      <SelectItem value="publishedOrUpdatedOrFetched">Published, then updated, then fetch time</SelectItem>
                      <SelectItem value="fetched">Fetch time only</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="GUID strategy">
              <Controller control={control} name="feedTransformer.items.guidStrategy" defaultValue="existingOrLinkHash"
                render={({ field: f }) => (
                  <Select value={f.value} onValueChange={f.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="existing">Existing GUID</SelectItem>
                      <SelectItem value="link">Link URL</SelectItem>
                      <SelectItem value="existingOrLinkHash">Existing GUID, then link or hash</SelectItem>
                      <SelectItem value="titleLinkDateHash">Title + link + date hash</SelectItem>
                      <SelectItem value="contentHash">Content hash</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </FieldRow>
        </Section>
      )}

      {/* Section 7: Filters */}
      {show("filters") && (
        <Section icon={<Filter className="h-4 w-4" />} title="Filters" sub="Include or exclude items by field content">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Exclude rules</p>
            {excludeFields.map((field, index) => (
              <FilterRuleRow
                key={field.id}
                prefix={`feedTransformer.items.filters.exclude.${index}`}
                register={register}
                control={control}
                onRemove={() => removeExclude(index)}
              />
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => appendExclude(emptyRule())}>
              <Plus className="h-4 w-4 mr-1" /> Add exclude rule
            </Button>
          </div>

          <div className="flex flex-col gap-3 mt-4">
            <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowInclude((v) => !v)}>
              {showInclude ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Include rules
            </button>
            {showInclude && (
              <>
                {includeFields.map((field, index) => (
                  <FilterRuleRow
                    key={field.id}
                    prefix={`feedTransformer.items.filters.include.${index}`}
                    register={register}
                    control={control}
                    onRemove={() => removeInclude(index)}
                  />
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => appendInclude(emptyRule())}>
                  <Plus className="h-4 w-4 mr-1" /> Add include rule
                </Button>
              </>
            )}
          </div>
        </Section>
      )}
    </>
  );
};

function FilterRuleRow({
  prefix,
  register,
  control,
  onRemove,
}: {
  prefix: string;
  register: UseFormRegister<any>;
  control: Control<any>;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Controller control={control} name={`${prefix}.field`} defaultValue="title"
        render={({ field: f }) => (
          <Select value={f.value} onValueChange={f.onChange}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["title", "link", "description", "content", "author", "categories"].map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <Controller control={control} name={`${prefix}.type`} defaultValue="contains"
        render={({ field: f }) => (
          <Select value={f.value} onValueChange={f.onChange}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["contains", "notContains", "equals", "startsWith", "endsWith", "regex"].map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <Input className="flex-1 min-w-32" {...register(`${prefix}.value`)} placeholder="value" />
      <div className="flex items-center gap-1">
        <Controller control={control} name={`${prefix}.caseSensitive`} defaultValue={false}
          render={({ field: f }) => <Checkbox id={`${prefix}.cs`} checked={f.value} onCheckedChange={f.onChange} />}
        />
        <Label htmlFor={`${prefix}.cs`} className="text-xs">Case</Label>
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Register feedTransformer sections in `BuildFeedPage.tsx`**

Open `frontend/src/pages/BuildFeedPage.tsx`. In the `SECTIONS_BY_TYPE` (or equivalent) constant, add:

```ts
feedTransformer: [
  { id: "basic", label: "Basic", icon: "Settings" },
  { id: "sources", label: "Sources", icon: "Rss" },
  { id: "metadata", label: "Feed Metadata", icon: "FileText" },
  { id: "item-cleanup", label: "Item Cleanup", icon: "Wand2" },
  { id: "link-cleanup", label: "Link Cleanup", icon: "Link2" },
  { id: "dates-guids", label: "Dates & GUIDs", icon: "Calendar" },
  { id: "filters", label: "Filters", icon: "Filter" },
],
```

- [ ] **Step 3: Register form in `FeedBuilderForm.tsx`**

Open `frontend/src/components/forms/FeedBuilderForm.tsx`. Add import and register `ExistingFeedTransformerForm` alongside the existing form types. Find the section that renders the active form (the `show(id)` routing block) and add:

```tsx
import { ExistingFeedTransformerForm } from "./ExistingFeedTransformerForm";

// In the render block, add alongside WebScrapingForm, APIForm, EmailForm:
{feedType === "feedTransformer" && (
  <ExistingFeedTransformerForm
    control={control}
    register={register}
    watch={watch}
    setValue={setValue}
    activeSection={activeSection}
  />
)}
```

- [ ] **Step 4: Activate feedTransformer in `TypePickerGrid.tsx`**

Open `frontend/src/components/builder/TypePickerGrid.tsx`. Find the entry for `feedTransformer` (currently marked as `comingSoon: true` or similar). Change it to active with label "Existing Feed":

```ts
// Change from:
{ id: "feedTransformer", label: "Feed Transformer", comingSoon: true }
// To:
{ id: "feedTransformer", label: "Existing Feed", comingSoon: false }
```

- [ ] **Step 5: Type-check the frontend**

```bash
cd /home/timb/projects/mkfd/frontend && bun run tsc --noEmit
```

Expected: clean output. Fix any type errors before continuing.

- [ ] **Step 6: Start dev server and smoke test**

```bash
cd /home/timb/projects/mkfd/frontend && bun run dev
```

Open `http://localhost:5173` and verify:

```
[ ] TypePickerGrid shows "Existing Feed" as active (no "coming soon" badge)
[ ] Clicking "Existing Feed" enters section navigator with 7 sections
[ ] Sources section: "Add source" button adds a URL row
[ ] "Preview source" button calls probe and shows metadata inline
[ ] Merge strategy select persists (dateDesc/dateAsc/preserveOrder)
[ ] All 7 sections reachable via SectionNav and SectionPager
[ ] Filters section: exclude rules visible by default, include rules collapsed
[ ] Adding an exclude rule row shows field/type/value/case inputs
[ ] Submit creates feed and navigates to /feeds
[ ] Feed appears in My Feeds with "Existing Feed" type badge
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/forms/ExistingFeedTransformerForm.tsx \
        frontend/src/components/forms/FeedBuilderForm.tsx \
        frontend/src/components/builder/TypePickerGrid.tsx \
        frontend/src/pages/BuildFeedPage.tsx
git commit -m "feat: add ExistingFeedTransformerForm and activate feedTransformer type"
```

---

### Task 10: Final checks and PROGRESS.md

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Run all tests**

```bash
cd /home/timb/projects/mkfd && bun test tests/feed-item-filter.test.ts tests/feed-item-transform.test.ts tests/existing-feed-parser.test.ts tests/normalized-feed-builder.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Full type check**

```bash
cd /home/timb/projects/mkfd && bun run tsc --noEmit && echo "Backend OK"
cd /home/timb/projects/mkfd/frontend && bun run tsc --noEmit && echo "Frontend OK"
```

Expected: both print "OK".

- [ ] **Step 3: End-to-end worker smoke test**

Create a test config at `configs/test-transformer.yaml`:

```yaml
schemaVersion: 2
feedId: test-transformer-001
feedName: test-transformed
feedType: feedTransformer
enabled: true
refreshTime: 60

feedTransformer:
  sources:
    - url: https://feeds.feedburner.com/TechCrunch
      format: auto
  mergeStrategy: dateDesc
  maxItems: 10
  dedupeAcrossSources: true
  items:
    guidStrategy: existingOrLinkHash
    dateStrategy: publishedOrUpdatedOrFetched
    link:
      removeTrackingParams: true
    description:
      stripHtml: true
      truncateCharacters: 500
```

Start the server (`bun run index.ts`) and trigger a manual run via the Health dashboard or directly call the worker. Verify:
- `public/feeds/test-transformer-001.xml` created
- `public/feeds/test-transformer-001.atom` created
- `public/feeds/test-transformer-001.json` created
- Health dashboard shows the run in the log with itemCount > 0

Delete the test config after verifying: `rm configs/test-transformer.yaml`

- [ ] **Step 4: Update PROGRESS.md**

In `docs/superpowers/PROGRESS.md`, change:

```
| Existing Feed Transformer | ⬜ | ⬜ |
```

to:

```
| Existing Feed Transformer | ✅ | ✅ |
```

- [ ] **Step 5: Final commit**

```bash
git add tests/ utilities/ models/ workers/ routes/feeds.ts frontend/src/
git commit -m "feat: Existing Feed Transformer — multi-source merge, cleanup, and republish"
```

## Implementation Notes - 2026-05-25

- Implemented feedTransformer parser/transform/filter/orchestrator, worker integration, probe endpoint, preview support, validation/normalization/casting, and builder UI.
- Builder UI now exposes seven steps: Basic, Sources, Merge, Transform, Filters, Feed Metadata, Output.
- Verification: `bun test tests/feed-item-filter.test.ts tests/feed-item-transform.test.ts tests/existing-feed-parser.test.ts tests/normalized-feed-builder.test.ts`, `bun test tests/`, and `cd frontend && bun run build` pass.
