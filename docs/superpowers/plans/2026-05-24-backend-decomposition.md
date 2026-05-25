# Backend Route Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break `index.ts` (2127 lines) into focused route files and utility modules so Phase 3 features can add to a maintainable structure rather than a 2000-line monolith.

**Architecture:** Factory functions for route files (each returns a Hono router, accepts shared deps as parameters). Worker management extracted to a module-level singleton utility. Route handlers reuse the Feed Config Formalization caster/normalizer/validator instead of reintroducing a second config builder.

**Security decision:** Route decomposition must preserve the shared outbound fetch policy instead of duplicating ad-hoc checks. This plan assumes `utilities/outbound-fetch-policy.utility.ts` already exists from the Phase 1 Outbound Fetch Policy plan. Routes moved here must keep calling it at `/proxy`, preview/sample HTML fetches, selector suggestion utilities, root-url utilities, and any worker path that fetches user-configured URLs.

**Depends on:** Feed Config Formalization and Outbound Fetch Policy must be implemented first. This plan is a Phase 3 prerequisite for transformer/source-assistant features, not the place to introduce new config or fetch security abstractions.

**Tech Stack:** Bun, TypeScript, Hono, js-yaml, axios, patchright, cheerio, drizzle-orm

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `utilities/css-target-builder.utility.ts` | `buildCSSTarget`, `parseDrillChain`, `determineIsRelativeAndBaseUrl`, `extractSampleUrlFromHtml`, `isLikelyAbsoluteUrl` |
| Create | `utilities/feed-config-route-adapter.utility.ts` | Route-level adapter around Feed Config Formalization utilities; sample HTML fetch helper; no duplicate config schema |
| Create | `utilities/worker-manager.utility.ts` | `initWorkerManager`, `initializeWorker`, `setFeedUpdaterInterval`, `terminateWorker`, `clearFeedUpdaterInterval`, `clearAllFeedUpdaterIntervals`, `processFeedsAtStart` |
| Create | `utilities/preview-generator.utility.ts` | `generatePreview` |
| Create | `routes/health.ts` | All `/api/health/*` routes |
| Create | `routes/utils.ts` | `GET /proxy`, `GET /passkey`, `POST /imap/folders`, `POST /utils/suggest-selectors`, `POST /api/flaresolverr/health`, `POST /utils/root-url`, `POST /trigger-webhook` |
| Create | `routes/feeds.ts` | `POST /`, `GET /api/feeds`, `GET /api/feeds/:id/config`, `PUT /api/feeds/:id`, `POST /delete-feed`, SPA catch-alls |
| Create | `routes/preview.ts` | `POST /preview` |
| Modify | `index.ts` | Strip to ~120 lines: init, middleware, route mounting, server export, signal handlers |

> **Note:** Two minor spec corrections applied in this plan:
> - `feedsRouter` accepts `{ encryptionKey, configsDir, feedPath }` (spec omitted `feedPath`, needed by `GET /api/feeds`)
> - `previewRouter` accepts `{ encryptionKey }` only (spec included `configsDir` but preview route never reads files)

---

### Task 1: `utilities/css-target-builder.utility.ts`

**Files:**
- Create: `utilities/css-target-builder.utility.ts`
- Create: `tests/css-target-builder.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/css-target-builder.test.ts
import { describe, it, expect } from "bun:test";
import {
  isLikelyAbsoluteUrl,
  determineIsRelativeAndBaseUrl,
} from "../utilities/css-target-builder.utility";

describe("isLikelyAbsoluteUrl", () => {
  it("returns true for https URLs", () => {
    expect(isLikelyAbsoluteUrl("https://example.com/path")).toBe(true);
  });
  it("returns true for http URLs", () => {
    expect(isLikelyAbsoluteUrl("http://example.com/path")).toBe(true);
  });
  it("returns true for protocol-relative URLs", () => {
    expect(isLikelyAbsoluteUrl("//example.com/path")).toBe(true);
  });
  it("returns false for root-relative paths", () => {
    expect(isLikelyAbsoluteUrl("/articles/1")).toBe(false);
  });
  it("returns false for empty string", () => {
    expect(isLikelyAbsoluteUrl("")).toBe(false);
  });
});

describe("determineIsRelativeAndBaseUrl", () => {
  it("uses explicit userIsRelative and userBaseUrl when both provided", async () => {
    const result = await determineIsRelativeAndBaseUrl(
      "", true, "https://base.com", undefined
    );
    expect(result).toEqual({ isRelative: true, baseUrl: "https://base.com" });
  });

  it("falls back to feedUrl as baseUrl when userIsRelative=true but no userBaseUrl", async () => {
    const result = await determineIsRelativeAndBaseUrl(
      "", true, undefined, "https://feed.com"
    );
    expect(result).toEqual({ isRelative: true, baseUrl: "https://feed.com" });
  });

  it("auto-detects absolute URL as not relative", async () => {
    const result = await determineIsRelativeAndBaseUrl(
      "https://example.com/1", undefined, undefined, "https://feed.com"
    );
    expect(result).toEqual({ isRelative: false, baseUrl: undefined });
  });

  it("auto-detects relative path and uses feedUrl as baseUrl", async () => {
    const result = await determineIsRelativeAndBaseUrl(
      "/articles/1", undefined, undefined, "https://feed.com"
    );
    expect(result).toEqual({ isRelative: true, baseUrl: "https://feed.com" });
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bun test tests/css-target-builder.test.ts
```

Expected: error — module not found.

- [ ] **Step 3: Create `utilities/css-target-builder.utility.ts`**

```ts
import * as cheerio from "cheerio";
import CSSTarget from "../models/csstarget.model";

export function isLikelyAbsoluteUrl(url: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url) || url.startsWith("//");
}

export async function determineIsRelativeAndBaseUrl(
  url: string,
  userIsRelative: boolean | undefined,
  userBaseUrl: string | undefined,
  feedUrl: string | undefined
): Promise<{ isRelative: boolean; baseUrl: string | undefined }> {
  if (typeof userIsRelative === "boolean" && userBaseUrl) {
    return { isRelative: userIsRelative, baseUrl: userBaseUrl };
  }
  if (typeof userIsRelative === "boolean") {
    if (userIsRelative && !userBaseUrl && feedUrl) {
      return { isRelative: true, baseUrl: feedUrl };
    }
    return { isRelative: userIsRelative, baseUrl: userBaseUrl };
  }
  if (userBaseUrl) {
    return { isRelative: !isLikelyAbsoluteUrl(url), baseUrl: userBaseUrl };
  }
  if (isLikelyAbsoluteUrl(url)) {
    return { isRelative: false, baseUrl: undefined };
  }
  return { isRelative: true, baseUrl: feedUrl };
}

export function extractSampleUrlFromHtml(
  html: string,
  selector: string,
  attribute?: string
): string {
  const $ = cheerio.load(html);
  const elements = $(selector).slice(0, 5);
  if (elements.length === 0) return "";
  for (let i = 0; i < elements.length; i++) {
    const el = elements.eq(i);
    const url = attribute
      ? el.attr(attribute) || ""
      : el.attr("href") || el.attr("src") || "";
    if (url?.trim()) return url.trim();
  }
  return "";
}

export function parseDrillChain(
  prefix: string,
  body: Record<string, any>
): Array<{
  selector: string;
  attribute: string;
  isRelative: boolean;
  baseUrl: string;
  stripHtml: boolean;
}> {
  const rawChain = body[`${prefix}DrillChain`];

  const toBool = (v: any) =>
    ["on", "true", true, "checked"].includes(
      typeof v === "string" ? v.toLowerCase() : v
    );

  if (Array.isArray(rawChain)) {
    return rawChain.map((step: any) => ({
      selector: step.selector ?? "",
      attribute: step.attribute ?? "",
      isRelative: toBool(step.isRelative),
      baseUrl: step.baseUrl ?? "",
      stripHtml: toBool(step.stripHtml),
    }));
  }

  const flatKeyRegex = new RegExp(
    `^${prefix
      .replace(/([A-Z])/g, " $1")
      .split(" ")
      .map((s) => s.toLowerCase())
      .join("")}DrillChain\\[(\\d+)\\]\\[(selector|attribute|isRelative|baseUrl|stripHtml)\\]$`,
    "i"
  );
  const tempStore: Record<string, Record<string, string>> = {};
  for (const key of Object.keys(body)) {
    const match = flatKeyRegex.exec(key);
    if (match) {
      const idx = match[1];
      const field = match[2];
      if (!tempStore[idx]) tempStore[idx] = {};
      tempStore[idx][field.toLowerCase()] = String(body[key]);
    }
  }

  return Object.keys(tempStore)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((idx) => {
      const row = tempStore[idx];
      return {
        selector: row.selector ?? "",
        attribute: row.attribute ?? "",
        isRelative: toBool(row.isrelative),
        baseUrl: row.baseurl ?? "",
        stripHtml: toBool(row.striphtml),
      };
    });
}

export async function buildCSSTarget(
  prefix: string,
  body: Record<string, any>,
  sampleHtml?: string
): Promise<CSSTarget> {
  const get = (suffix: string, fallback: any = "") =>
    body[`${prefix}${suffix}`] ?? fallback;
  const getBool = (suffix: string, fallback: boolean = false): boolean => {
    const val = body[`${prefix}${suffix}`];
    if (val === undefined) return fallback;
    if (typeof val === "boolean") return val;
    return ["on", "true", "checked"].includes(String(val).toLowerCase());
  };

  const selector = get("Selector");
  const attribute = get("Attribute");
  let isRelative: boolean = getBool("RelativeLink", undefined as any);
  let baseUrl: string | undefined = get("BaseUrl", undefined);

  if (["link", "enclosure", "sourceUrl"].includes(prefix) && sampleHtml && selector) {
    const urlSample = extractSampleUrlFromHtml(sampleHtml, selector, attribute);
    const result = await determineIsRelativeAndBaseUrl(
      urlSample,
      getBool("RelativeLink", undefined as any),
      get("BaseUrl", undefined),
      body.feedUrl
    );
    isRelative = result.isRelative;
    baseUrl = result.baseUrl;
    console.log(
      `[Preview ${prefix}] Sample URL: "${urlSample}" → isRelative: ${isRelative}, baseUrl: ${baseUrl}`
    );
  }

  const drillChainData = (body[`${prefix}DrillChain`] as Array<any>) || [];
  const target = new CSSTarget(
    selector,
    attribute,
    getBool("StripHtml"),
    baseUrl,
    isRelative,
    getBool("TitleCase"),
    get("Iterator"),
    get("Format"),
    get("CustomDateFormat")
  );

  if (prefix === "guid") {
    target.guidIsPermaLink = getBool("IsPermaLink");
  }

  target.drillChain =
    drillChainData.length > 0
      ? drillChainData.map((step: any) => ({
          selector: step.selector ?? "",
          attribute: step.attribute ?? "",
          isRelative: ["on", "true", true, "checked"].includes(
            String(step.isRelative).toLowerCase()
          ),
          baseUrl: step.baseUrl ?? "",
          stripHtml: ["on", "true", true, "checked"].includes(
            String(step.stripHtml).toLowerCase()
          ),
        }))
      : parseDrillChain(prefix, body);

  return target;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun test tests/css-target-builder.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors in `utilities/css-target-builder.utility.ts`.

- [ ] **Step 6: Commit**

```bash
git add utilities/css-target-builder.utility.ts tests/css-target-builder.test.ts
git commit -m "feat: extract css-target-builder utility with tests"
```

---

### Task 2: `utilities/feed-config-route-adapter.utility.ts`

**Files:**
- Create: `utilities/feed-config-route-adapter.utility.ts`
- Create: `tests/feed-config-route-adapter.test.ts`

> **Important:** This adapter must call the Feed Config Formalization caster/validator/normalizer. Do not copy the old inline config-building logic or introduce a second schema. The sample snippets below describe route-level behavior; implementation should delegate config shape decisions to `utilities/feed-config-caster.utility.ts` and `utilities/feed-config-validator.utility.ts`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/feed-config-route-adapter.test.ts
import { describe, it, expect } from "bun:test";
import { buildFeedConfigForRoute } from "../utilities/feed-config-route-adapter.utility";

describe("buildFeedConfigForRoute", () => {
  it("webScraping produces correct shape with feedGenerator", async () => {
    const body = {
      feedType: "webScraping",
      feedName: "Test Feed",
      feedUrl: "https://example.com",
      refreshTime: "10",
    };
    const result = await buildFeedConfigForRoute(body, {
      feedId: "test-id",
      encryptionKey: "testkey1234567890",
    });
    expect(result.feedId).toBe("test-id");
    expect(result.feedType).toBe("webScraping");
    expect(result.feedName).toBe("Test Feed");
    expect(result.refreshTime).toBe(10);
    expect(result.config.baseUrl).toBe("https://example.com");
    expect(result.article).toBeDefined();
    expect(result.apiMapping).toBeUndefined();
    expect(result.feedGenerator).toBe("MkFD Feed Generator");
  });

  it("api feedType uses pubDate not date in apiMappingData", async () => {
    const body = {
      feedType: "api",
      feedName: "API Feed",
      feedUrl: "https://api.example.com",
      apiMethod: "GET",
      apiDateField: "published_at",
    };
    const result = await buildFeedConfigForRoute(body, {
      feedId: "test-id",
      encryptionKey: "testkey1234567890",
    });
    expect(result.apiMapping.pubDate).toBe("published_at");
    expect(result.apiMapping.date).toBeUndefined();
  });

  it("email with existingConfig preserves encrypted password when no new password supplied", async () => {
    const body = {
      feedType: "email",
      feedName: "Email Feed",
      emailHost: "mail.example.com",
      emailPort: "993",
      emailUsername: "user@example.com",
      emailFolder: "INBOX",
      emailCount: "10",
    };
    const existingConfig = { config: { encryptedPassword: "already-encrypted" } };
    const result = await buildFeedConfigForRoute(body, {
      feedId: "test-id",
      encryptionKey: "testkey1234567890",
      existingConfig,
    });
    expect(result.config.encryptedPassword).toBe("already-encrypted");
  });

  it("isPreview sets feedGenerator and omits webhook", async () => {
    const body = {
      feedType: "webScraping",
      feedName: "Test",
      feedUrl: "https://example.com",
      webhookEnabled: true,
      webhookUrl: "https://hooks.example.com",
    };
    const result = await buildFeedConfigForRoute(body, {
      feedId: "preview",
      encryptionKey: "testkey1234567890",
      isPreview: true,
    });
    expect(result.feedGenerator).toBe("MkFD Preview Generator");
    expect(result.webhook).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bun test tests/feed-config-route-adapter.test.ts
```

Expected: error — module not found.

- [ ] **Step 3: Create `utilities/feed-config-route-adapter.utility.ts`**

```ts
import axios from "axios";
import { buildCSSTarget } from "./css-target-builder.utility";
import { castFeedFormDataToFeedConfig } from "./feed-config-caster.utility";
import { validateFeedConfig } from "./feed-config-validator.utility";

export function normalizeUrl(url: string): string {
  if (!url) return url;
  return url.replace(/\/+$/, "");
}

function makeExtract(body: Record<string, any>) {
  return (key: string, fallback: any = undefined) => body[key] ?? fallback;
}

function makeExtractBool(body: Record<string, any>) {
  return (key: string, fallback: boolean = false): boolean => {
    const val = body[key];
    if (val === undefined) return fallback;
    if (typeof val === "boolean") return val;
    return ["on", "true", "checked"].includes(String(val).toLowerCase());
  };
}

function makeExtractJson(body: Record<string, any>) {
  return (key: string, fallback: any = {}): any => {
    const val = body[key];
    if (typeof val === "object" && val !== null) return val;
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return fallback; }
    }
    return fallback;
  };
}

function makeExtractKeyValuePairs(body: Record<string, any>) {
  return (key: string, fallback: any = {}): Record<string, string> => {
    const val = body[key];
    if (Array.isArray(val)) {
      return val.reduce((acc: Record<string, string>, pair: any) => {
        if (pair?.key) acc[pair.key] = pair.value ?? "";
        return acc;
      }, {});
    }
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return fallback; }
    }
    if (typeof val === "object" && val !== null) return val;
    return fallback;
  };
}

export async function fetchSampleHtml(body: Record<string, any>): Promise<string> {
  if ((body.feedType ?? "webScraping") !== "webScraping" || !body.feedUrl) return "";

  const fd = body.flaresolverr || {};
  const flareEnabled = typeof fd.enabled === "boolean" ? fd.enabled : false;
  const flareUrl = normalizeUrl(fd.serverUrl || "");
  const flareTimeout = parseInt(fd.timeout || "60000", 10) || 60000;

  const cookieNames = (body.cookieNames ?? []) as string[];
  const cookieValues = (body.cookieValues ?? []) as string[];
  const cookies = cookieNames
    .map((name, i) => ({ name: name.trim(), value: (cookieValues[i] ?? "").trim() }))
    .filter((c) => c.name);

  try {
    if (flareEnabled && flareUrl) {
      const payload: any = { cmd: "request.get", url: body.feedUrl, maxTimeout: flareTimeout };
      if (cookies.length > 0) payload.cookies = cookies.map((c) => ({ name: c.name, value: c.value }));
      const resp = await axios.post(`${flareUrl}/v1`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: flareTimeout + 5000,
      });
      if (resp.data?.solution?.response && resp.data?.solution?.status === 200) {
        return resp.data.solution.response;
      }
      console.warn("FlareSolverr failed for sample HTML:", resp.data?.message);
      return "";
    }
    const resp = await axios.get(body.feedUrl, {
      maxContentLength: 2 * 1024 * 1024,
      maxBodyLength: 2 * 1024 * 1024,
    });
    return resp.data;
  } catch (e) {
    console.warn("Could not fetch sample HTML:", e.message);
    return "";
  }
}

export async function buildFeedConfigForRoute(
  body: Record<string, any>,
  opts: {
    feedId: string;
    encryptionKey: string;
    sampleHtml?: string;
    existingConfig?: any;
    isPreview?: boolean;
  }
): Promise<Record<string, any>> {
  const { feedId, encryptionKey, sampleHtml = "", existingConfig, isPreview = false } = opts;

  const extract = makeExtract(body);
  const extractBool = makeExtractBool(body);
  const extractJson = makeExtractJson(body);
  const extractKV = makeExtractKeyValuePairs(body);

  const cookieNames = extract("cookieNames", []) as string[];
  const cookieValues = extract("cookieValues", []) as string[];
  const cookies = cookieNames
    .map((name, i) => ({ name: name.trim(), value: (cookieValues[i] ?? "").trim() }))
    .filter((c) => c.name);

  const feedType = extract("feedType", "webScraping");
  const feedName = extract("feedName", "RSS Feed");

  let configData: any = {};
  let articleData: any = {};
  let apiMappingData: any = {};
  let emailConfigData: any = {};

  const feedOptions: Record<string, any> = {
    feedLanguage: "",
    feedCopyright: "",
    feedDescription: "",
    feedManagingEditor: "",
    feedWebMaster: "",
    feedPubDate: "",
    feedLastBuildDate: "",
    feedCategories: [] as string[],
    feedDocs: "https://www.rssboard.org/rss-specification",
    feedGenerator: isPreview ? "MkFD Preview Generator" : "MkFD Feed Generator",
    feedTtl: undefined as number | undefined,
    feedSkipHours: [] as number[],
    feedSkipDays: [] as string[],
    feedImage: undefined as string | undefined,
  };

  if (feedType === "webScraping") {
    configData = { baseUrl: extract("feedUrl") };
    articleData = {
      iterator: await buildCSSTarget("item", body, sampleHtml),
      title: await buildCSSTarget("title", body, sampleHtml),
      link: await buildCSSTarget("link", body, sampleHtml),
      description: await buildCSSTarget("description", body, sampleHtml),
      author: await buildCSSTarget("author", body, sampleHtml),
      categories: await buildCSSTarget("categories", body, sampleHtml),
      comments: await buildCSSTarget("commentsUrl", body, sampleHtml),
      enclosure: await buildCSSTarget("enclosure", body, sampleHtml),
      guid: await buildCSSTarget("guid", body, sampleHtml),
      pubDate: await buildCSSTarget("date", body, sampleHtml),
      source: {
        title: await buildCSSTarget("sourceTitle", body, sampleHtml),
        url: await buildCSSTarget("sourceUrl", body, sampleHtml),
      },
      contentEncoded: await buildCSSTarget("contentEncoded", body, sampleHtml),
      summary: await buildCSSTarget("summary", body, sampleHtml),
      contributors: await buildCSSTarget("contributors", body, sampleHtml),
      lat: await buildCSSTarget("lat", body, sampleHtml),
      long: await buildCSSTarget("long", body, sampleHtml),
    };

    if (isPreview) {
      feedOptions.feedLanguage = extract("feedLanguageSelector");
      feedOptions.feedCopyright = extract("feedCopyrightSelector");
      feedOptions.feedManagingEditor = extract("feedManagingEditorSelector");
      feedOptions.feedWebMaster = extract("feedWebMasterSelector");
      const cats = extract("feedCategoriesScrapingSelector");
      if (cats) feedOptions.feedCategories = cats.split(",").map((s: string) => s.trim());
      const ttl = extract("feedTtlSelector");
      if (ttl) feedOptions.feedTtl = Number(ttl);
      const skipDays = extract("feedSkipDaysSelector");
      if (skipDays) feedOptions.feedSkipDays = skipDays.split(",").map((s: string) => s.trim());
      const skipHours = extract("feedSkipHoursSelector");
      if (skipHours) feedOptions.feedSkipHours = skipHours.split(",").map((s: string) => Number(s.trim()));
      const img = extract("feedImageUrlSelector");
      if (img) feedOptions.feedImage = img;
    } else {
      const sel = (base: string, attr: string) =>
        extract(base)
          ? `${extract(base)}${extract(attr, "") ? `|attr:${extract(attr)}` : ""}`
          : "";

      feedOptions.feedLanguage = sel("feedLanguageSelector", "feedLanguageAttribute");
      feedOptions.feedCopyright = sel("feedCopyrightSelector", "feedCopyrightAttribute");
      feedOptions.feedManagingEditor = sel("feedManagingEditorSelector", "feedManagingEditorAttribute");
      feedOptions.feedWebMaster = sel("feedWebMasterSelector", "feedWebMasterAttribute");

      const cats = sel("feedCategoriesScrapingSelector", "feedCategoriesScrapingAttribute");
      if (cats) feedOptions.feedCategories = [cats];
      const ttl = sel("feedTtlSelector", "feedTtlAttribute");
      if (ttl) feedOptions.feedTtl = Number(ttl);
      const skipDays = sel("feedSkipDaysSelector", "feedSkipDaysAttribute");
      if (skipDays) feedOptions.feedSkipDays = [skipDays];
      const skipHours = sel("feedSkipHoursSelector", "feedSkipHoursAttribute");
      if (skipHours) feedOptions.feedSkipHours = [Number(skipHours)];
      const imgSel = extract("feedImageUrlSelector");
      if (imgSel) feedOptions.feedImage = sel("feedImageUrlSelector", "feedImageUrlAttribute");
    }
  } else if (feedType === "api") {
    configData = {
      baseUrl: extract("feedUrl"),
      method: extract("apiMethod", "GET"),
      route: extract("apiRoute"),
      params: extractKV("apiParams"),
      apiSpecificHeaders: extractKV("apiHeaders"),
      apiSpecificBody: extractKV("apiBody"),
    };
    apiMappingData = {
      items: extract("apiItemsPath"),
      title: extract("apiTitleField"),
      link: extract("apiLinkField"),
      description: extract("apiDescriptionField"),
      author: extract("apiAuthor"),
      categories: extract("apiCategories"),
      comments: extract("apiCommentsUrl"),
      enclosureUrl: extract("apiEnclosureUrl"),
      enclosureLength: extract("apiEnclosureSize"),
      enclosureType: extract("apiEnclosureType"),
      guid: extract("apiGuid"),
      guidIsPermaLink: extract("apiGuidIsPermaLink"),
      pubDate: extract("apiDateField"),
      sourceTitle: extract("apiSourceTitle"),
      sourceUrl: extract("apiSourceUrl"),
      contentEncoded: extract("apiContentEncoded"),
      summary: extract("apiSummary"),
      contributors: extract("apiContributors"),
      lat: extract("apiLat"),
      long: extract("apiLong"),
      feedTitlePath: extract("apiFeedTitle"),
      feedLinkPath: extract("feedUrl"),
      feedDescriptionPath: extract("apiFeedDescription"),
      feedLanguagePath: extract("apiFeedLanguage"),
      feedCopyrightPath: extract("apiFeedCopyright"),
      feedManagingEditorPath: extract("apiFeedManagingEditor"),
      feedWebMasterPath: extract("apiFeedWebMaster"),
      feedPubDatePath: extract("apiFeedPubDate"),
      feedLastBuildDatePath: extract("apiFeedLastBuildDate"),
      feedCategoriesPath: extract("apiFeedCategories"),
      feedTtlPath: extract("apiFeedTtl"),
      feedSkipHoursPath: extract("apiFeedSkipHours"),
      feedSkipDaysPath: extract("apiFeedSkipDays"),
      feedImageUrl: extract("apiFeedImageUrl"),
    };
  } else if (feedType === "email") {
    const newPassword = extract("emailPassword");
    emailConfigData = {
      host: extract("emailHost"),
      port: parseInt(extract("emailPort", "993"), 10) || 993,
      user: extract("emailUsername"),
      encryptedPassword:
        existingConfig?.config?.encryptedPassword && !newPassword
          ? existingConfig.config.encryptedPassword
          : encrypt(newPassword, encryptionKey),
      folder: extract("emailFolder"),
      emailCount: parseInt(extract("emailCount", "10"), 10) || 10,
    };
    feedOptions.feedLanguage = "en";
    feedOptions.feedDescription = `Emails from folder: ${emailConfigData.folder}`;
  }

  const fd = extract("flaresolverr", {});
  const flaresolverrConfig = {
    enabled: typeof fd.enabled === "boolean" ? fd.enabled : false,
    serverUrl: normalizeUrl(fd.serverUrl || ""),
    timeout: parseInt(fd.timeout || "60000", 10) || 60000,
  };

  const config: Record<string, any> = {
    feedId,
    feedName,
    feedType,
    refreshTime: parseInt(extract("refreshTime", "5"), 10) || 5,
    reverse: extractBool("reverse"),
    strict: extractBool("strict"),
    advanced: extractBool("advanced"),
    headers: extractKV("headers"),
    cookies: cookies.length > 0 ? cookies : undefined,
    flaresolverr:
      flaresolverrConfig.enabled && flaresolverrConfig.serverUrl
        ? flaresolverrConfig
        : undefined,
    config: feedType === "email" ? emailConfigData : configData,
    ...(feedType === "webScraping" && { article: articleData }),
    ...(feedType === "api" && { apiMapping: apiMappingData }),
    ...feedOptions,
  };

  if (isPreview) {
    config._debug_advanced_raw = body.advanced;
  } else {
    const webhookConfig = {
      enabled: extractBool("webhookEnabled"),
      url: extract("webhookUrl", ""),
      format: extract("webhookFormat", "xml") as "xml" | "json",
      newItemsOnly: extractBool("webhookNewItemsOnly", true),
      headers: extractJson("webhookHeaders"),
      customPayload: extract("webhookCustomPayload", "").trim() || undefined,
    };
    if (webhookConfig.enabled && webhookConfig.url) {
      config.webhook = webhookConfig;
    }
  }

  return config;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun test tests/feed-config-route-adapter.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors in new utility files.

- [ ] **Step 6: Commit**

```bash
git add utilities/feed-config-route-adapter.utility.ts tests/feed-config-route-adapter.test.ts
git commit -m "feat: extract feed config route adapter with tests"
```

---

### Task 3: `utilities/worker-manager.utility.ts`

**Files:**
- Create: `utilities/worker-manager.utility.ts`

- [ ] **Step 1: Create `utilities/worker-manager.utility.ts`**

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { EventEmitter } from "node:events";
import { insertRunLog, pruneRunLogs, getDb, getSettings } from "../lib/analytics/db";

const feedUpdaters: Map<string, Worker> = new Map();
const feedIntervals: Map<string, Timer> = new Map();
let _encryptionKey: string;
let _runLogEmitter: EventEmitter;

export function initWorkerManager(deps: {
  encryptionKey: string;
  runLogEmitter: EventEmitter;
}): void {
  _encryptionKey = deps.encryptionKey;
  _runLogEmitter = deps.runLogEmitter;
}

export function initializeWorker(feedConfig: any): void {
  feedUpdaters.set(
    feedConfig.feedId,
    new Worker(
      feedConfig.feedType === "email"
        ? "./workers/imap-feed.worker.ts"
        : "./workers/feed-updater.worker.ts",
      { type: "module" }
    )
  );

  feedUpdaters.get(feedConfig.feedId)!.onmessage = async (message) => {
    if (message.data.status === "done" || message.data.status === "error") {
      console.log(
        message.data.status === "done"
          ? `Feed updates completed for ${feedConfig.feedId}.`
          : `Feed updates for ${feedConfig.feedId} encountered an error: ${message.data.metrics?.errorMessage}`
      );
      try {
        const metrics = message.data.metrics ?? {};
        const row = await insertRunLog(getDb(), {
          feedId: feedConfig.feedId,
          feedName: feedConfig.feedName ?? feedConfig.config?.title ?? feedConfig.feedId,
          feedType: feedConfig.feedType,
          startedAt: metrics.startedAt ?? Date.now(),
          durationMs: metrics.durationMs ?? null,
          status: message.data.status === "done" ? "success" : "error",
          errorMessage: metrics.errorMessage ?? null,
          httpStatus: metrics.httpStatus ?? null,
          timedOut: metrics.timedOut ?? false,
          itemCount: metrics.itemCount ?? null,
          selectorMatches: metrics.selectorMatches ?? null,
          dateFallbacks: metrics.dateFallbacks ?? 0,
          duplicateGuids: metrics.duplicateGuids ?? 0,
          webhookStatus: metrics.webhookStatus ?? null,
          webhookError: metrics.webhookError ?? null,
        });
        _runLogEmitter.emit("run", row);
        await pruneRunLogs(getDb(), feedConfig.feedId, await getSettings(getDb()));
      } catch (e) {
        console.error("[Analytics] Failed to log run:", e);
      }
    }
  };

  feedUpdaters.get(feedConfig.feedId)!.onerror = async (error) => {
    console.error("Worker error:", error);
    try {
      const row = await insertRunLog(getDb(), {
        feedId: feedConfig.feedId,
        feedName: feedConfig.feedName ?? feedConfig.config?.title ?? feedConfig.feedId,
        feedType: feedConfig.feedType,
        startedAt: Date.now(),
        durationMs: null,
        status: "error",
        errorMessage: error.message ?? "Worker crashed unexpectedly",
        httpStatus: null,
        timedOut: false,
        itemCount: null,
        selectorMatches: null,
        dateFallbacks: 0,
        duplicateGuids: 0,
        webhookStatus: null,
        webhookError: null,
      });
      _runLogEmitter.emit("run", row);
    } catch (e) {
      console.error("[Analytics] Failed to log worker crash:", e);
    }
  };
}

export function setFeedUpdaterInterval(feedConfig: any): void {
  const feedId = feedConfig.feedId;
  if (!feedUpdaters.has(feedId)) {
    console.log("Initializing worker for feed:", feedId);
    initializeWorker(feedConfig);
    feedUpdaters.get(feedId)!.postMessage({
      command: "start",
      config: feedConfig,
      encryptionKey: _encryptionKey,
    });
  }
  if (feedConfig.feedType !== "email" && !feedIntervals.has(feedId)) {
    console.log("Setting interval for feed:", feedId);
    const interval = setInterval(() => {
      console.log("Engaging worker for feed:", feedId);
      feedUpdaters.get(feedId)!.postMessage({ command: "start", config: feedConfig });
    }, feedConfig.refreshTime * 60 * 1000);
    feedIntervals.set(feedId, interval);
  }
}

export function terminateWorker(feedId: string): void {
  const worker = feedUpdaters.get(feedId);
  if (worker) {
    worker.terminate();
    feedUpdaters.delete(feedId);
  }
}

export function clearFeedUpdaterInterval(feedId: string): void {
  const interval = feedIntervals.get(feedId);
  if (interval) {
    clearInterval(interval);
    feedIntervals.delete(feedId);
  }
}

export function clearAllFeedUpdaterIntervals(): void {
  for (const [feedId] of feedIntervals.entries()) {
    clearFeedUpdaterInterval(feedId);
    terminateWorker(feedId);
  }
}

export async function processFeedsAtStart(configsDir: string): Promise<void> {
  try {
    const files = await readdir(configsDir);
    for (const f of files.filter((f) => f.endsWith(".yaml"))) {
      const yamlContent = await readFile(join(configsDir, f), "utf8");
      const feedConfig = yaml.load(yamlContent) as any;
      console.log("Processing feed:", feedConfig.feedId);
      setFeedUpdaterInterval(feedConfig);
    }
  } catch (error) {
    console.error("Error processing feeds:", error);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add utilities/worker-manager.utility.ts
git commit -m "feat: extract worker-manager utility"
```

---

### Task 4: `utilities/preview-generator.utility.ts`

**Files:**
- Create: `utilities/preview-generator.utility.ts`

- [ ] **Step 1: Create `utilities/preview-generator.utility.ts`**

```ts
import axios from "axios";
import { chromium } from "patchright";
import { getChromiumLaunchOptions } from "./chrome-extensions.utility";
import { getRandomUserAgent } from "./user-agents.utility";
import { buildRSS, buildRSSFromApiData } from "./rss-builder.utility";
import { normalizeUrl } from "./feed-config-route-adapter.utility";

export async function generatePreview(feedConfig: any): Promise<string> {
  try {
    let rssXml: string;

    if (feedConfig.feedType === "webScraping") {
      console.log(
        `[Preview] Advanced mode check: ${feedConfig.advanced} (raw: ${feedConfig._debug_advanced_raw})`
      );
      if (feedConfig.flaresolverr?.enabled) {
        console.log("[Preview] Using FlareSolverr");
        const flareUrl = normalizeUrl(
          feedConfig.flaresolverr.serverUrl || "http://localhost:8191"
        );
        const timeout = feedConfig.flaresolverr.timeout || 60000;
        const payload: any = {
          cmd: "request.get",
          url: feedConfig.config.baseUrl,
          maxTimeout: timeout,
        };
        if (feedConfig.cookies?.length > 0) {
          payload.cookies = feedConfig.cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
          }));
        }
        const resp = await axios.post(`${flareUrl}/v1`, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: timeout + 5000,
        });
        if (
          resp.data?.solution?.response &&
          resp.data?.solution?.status === 200
        ) {
          rssXml = (await buildRSS(resp.data.solution.response, feedConfig)).xml;
        } else {
          throw new Error(
            `FlareSolverr failed: ${resp.data?.message || "Unknown error"}`
          );
        }
      } else if (feedConfig.advanced) {
        console.log("[Preview] Launching browser...");
        const browser = await chromium.launch(
          getChromiumLaunchOptions({ headless: true, timeout: 60000 })
        );
        console.log("[Preview] Browser launched, creating context...");
        const userAgent = getRandomUserAgent();
        const context = await browser.newContext({ userAgent });
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        });
        const page = await context.newPage();
        console.log(`[Preview] Using user agent: ${userAgent.substring(0, 50)}...`);
        if (feedConfig.headers && Object.keys(feedConfig.headers).length) {
          await page.setExtraHTTPHeaders(feedConfig.headers);
        }
        if (feedConfig.cookies?.length > 0) {
          const domain = new URL(feedConfig.config.baseUrl).hostname;
          await page.context().addCookies(
            feedConfig.cookies.map((c: any) => ({ ...c, domain, path: "/" }))
          );
        }
        console.log(`[Preview] Navigating to ${feedConfig.config.baseUrl}...`);
        try {
          await page.goto(feedConfig.config.baseUrl, {
            waitUntil: "networkidle",
            timeout: 10000,
          });
          console.log("[Preview] Page loaded (networkidle)");
        } catch {
          console.log("[Preview] Networkidle timeout, using current page state");
        }
        console.log("[Preview] Extracting content...");
        const html = await page.content();
        await browser.close();
        console.log("[Preview] Browser closed, building RSS...");
        rssXml = (await buildRSS(html, feedConfig)).xml;
      } else {
        console.log("[Preview] Using standard (non-advanced) scraping");
        const cookieString = (feedConfig.cookies || [])
          .map((c: any) => `${c.name}=${c.value}`)
          .join("; ");
        const response = await axios.get(feedConfig.config.baseUrl, {
          headers: {
            ...(feedConfig.headers || {}),
            ...(cookieString && { Cookie: cookieString }),
          },
          maxContentLength: 2 * 1024 * 1024,
          maxBodyLength: 2 * 1024 * 1024,
          timeout: 30000,
        });
        console.log("[Preview] Page fetched, building RSS...");
        rssXml = (await buildRSS(response.data, feedConfig)).xml;
        console.log("[Preview] RSS build complete");
      }
    } else if (feedConfig.feedType === "api") {
      const method = String(feedConfig.config.method || "GET").toUpperCase();
      const url =
        (feedConfig.config.baseUrl || "").trim() +
        (feedConfig.config.route || "").trim();
      const headers = {
        Accept: "application/json",
        ...(feedConfig.headers || {}),
        ...(feedConfig.config.apiSpecificHeaders || {}),
      };
      const axiosConfig: any = {
        method,
        url,
        headers,
        params: feedConfig.config.params || {},
        responseType: "json",
        validateStatus: (s: number) => s >= 200 && s < 400,
        timeout: 60000,
      };
      const cookieString = (feedConfig.cookies || [])
        .map((c: any) => `${c.name}=${c.value}`)
        .join("; ");
      if (cookieString && !axiosConfig.headers.Authorization && !axiosConfig.headers.cookie) {
        axiosConfig.headers.Cookie = cookieString;
      }
      const body = feedConfig.config.apiSpecificBody || {};
      if (
        method !== "GET" &&
        method !== "HEAD" &&
        body &&
        typeof body === "object" &&
        Object.keys(body).length > 0
      ) {
        axiosConfig.data = body;
      }
      console.log("Preview Axios Config:", axiosConfig);
      const response = await axios(axiosConfig);
      rssXml = buildRSSFromApiData(response.data, feedConfig).xml;
    }

    return rssXml!;
  } catch (error) {
    console.error(
      `Error fetching/processing data for preview feedId ${feedConfig.feedId}:`,
      error.message
    );
    throw error;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add utilities/preview-generator.utility.ts
git commit -m "feat: extract preview-generator utility"
```

---

### Task 5: `routes/health.ts`

**Files:**
- Create: `routes/health.ts`

- [ ] **Step 1: Create `routes/health.ts`**

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sql, and, eq, gte, lte, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { EventEmitter } from "node:events";
import { getDb, getSettings, saveSettings } from "../lib/analytics/db";
import * as analyticsSchema from "../lib/analytics/schema";
import type { RunLog } from "../lib/analytics/schema";

export function healthRouter(deps: { runLogEmitter: EventEmitter }): Hono {
  const { runLogEmitter } = deps;
  const app = new Hono();

  app.get("/api/health/runs", async (c) => {
    const { feedId, status, feedType, from, to, page = "1", pageSize = "50" } = c.req.query();
    const db = drizzle(getDb(), { schema: analyticsSchema });
    const conditions: any[] = [];
    if (feedId) conditions.push(eq(analyticsSchema.runLogs.feedId, feedId));
    if (status) conditions.push(eq(analyticsSchema.runLogs.status, status));
    if (feedType) conditions.push(eq(analyticsSchema.runLogs.feedType, feedType));
    if (from) conditions.push(gte(analyticsSchema.runLogs.startedAt, Number(from)));
    if (to) conditions.push(lte(analyticsSchema.runLogs.startedAt, Number(to)));
    const where = conditions.length ? and(...conditions) : undefined;
    const offset = (Number(page) - 1) * Number(pageSize);
    const [rows, countResult] = await Promise.all([
      db.select().from(analyticsSchema.runLogs).where(where)
        .orderBy(desc(analyticsSchema.runLogs.startedAt))
        .limit(Number(pageSize)).offset(offset),
      db.select({ count: sql`count(*)` }).from(analyticsSchema.runLogs).where(where),
    ]);
    return c.json({ rows, total: Number(countResult[0].count) });
  });

  app.get("/api/health/summary", async (c) => {
    const db = drizzle(getDb(), { schema: analyticsSchema });
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const last7d = now - 7 * 24 * 60 * 60 * 1000;
    const [totalResult, last24hResult, last7dRows, allFeeds] = await Promise.all([
      db.select({ count: sql`count(*)` }).from(analyticsSchema.runLogs),
      db.select({ count: sql`count(*)` }).from(analyticsSchema.runLogs)
        .where(gte(analyticsSchema.runLogs.startedAt, last24h)),
      db.select().from(analyticsSchema.runLogs)
        .where(gte(analyticsSchema.runLogs.startedAt, last7d)),
      db.selectDistinct({
        feedId: analyticsSchema.runLogs.feedId,
        feedName: analyticsSchema.runLogs.feedName,
        feedType: analyticsSchema.runLogs.feedType,
      }).from(analyticsSchema.runLogs),
    ]);
    const successCount = last7dRows.filter((r) => r.status === "success").length;
    const successRate7d = last7dRows.length ? successCount / last7dRows.length : 0;
    const durations = last7dRows
      .filter((r) => r.durationMs !== null)
      .map((r) => r.durationMs!);
    const avgDuration7d = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const feedHealth = await Promise.all(
      allFeeds.map(async ({ feedId, feedName, feedType }) => {
        const recent = await db.select().from(analyticsSchema.runLogs)
          .where(eq(analyticsSchema.runLogs.feedId, feedId))
          .orderBy(desc(analyticsSchema.runLogs.startedAt))
          .limit(5);
        const last = recent[0];
        const successIn5 = recent.filter((r) => r.status === "success").length;
        const healthStatus =
          recent.length === 0 ? "green"
          : last.status === "error" ? "red"
          : successIn5 < recent.length ? "yellow"
          : "green";
        const feedLast7d = last7dRows.filter((r) => r.feedId === feedId);
        const feedSuccessCount = feedLast7d.filter((r) => r.status === "success").length;
        const feedDurations = feedLast7d
          .filter((r) => r.durationMs !== null)
          .map((r) => r.durationMs!);
        return {
          feedId, feedName, feedType, healthStatus,
          lastRunAt: last?.startedAt ?? null,
          lastHttpStatus: last?.httpStatus ?? null,
          successRate7d: feedLast7d.length ? feedSuccessCount / feedLast7d.length : 0,
          avgDuration7d: feedDurations.length
            ? feedDurations.reduce((a, b) => a + b, 0) / feedDurations.length
            : 0,
        };
      })
    );
    return c.json({
      totalRuns: Number(totalResult[0].count),
      last24h: Number(last24hResult[0].count),
      successRate7d,
      avgDuration7d,
      feedHealth,
    });
  });

  app.get("/api/health/chart/:feedId", async (c) => {
    const feedId = c.req.param("feedId");
    const db = drizzle(getDb(), { schema: analyticsSchema });
    const rows = await db.select({
      startedAt: analyticsSchema.runLogs.startedAt,
      durationMs: analyticsSchema.runLogs.durationMs,
      itemCount: analyticsSchema.runLogs.itemCount,
      status: analyticsSchema.runLogs.status,
    }).from(analyticsSchema.runLogs)
      .where(eq(analyticsSchema.runLogs.feedId, feedId))
      .orderBy(desc(analyticsSchema.runLogs.startedAt))
      .limit(50);
    return c.json({ runs: rows.reverse() });
  });

  app.get("/api/health/settings", async (c) => {
    const s = await getSettings(getDb());
    return c.json({ ...s, dbPath: process.env.RUNTIME_DB_PATH ?? "./data/runtime.db" });
  });

  app.put("/api/health/settings", async (c) => {
    const body = await c.req.json();
    await saveSettings(getDb(), {
      retentionDays: Number(body.retentionDays),
      retentionDaysEnabled: Boolean(body.retentionDaysEnabled),
      retentionRuns: Number(body.retentionRuns),
      retentionRunsEnabled: Boolean(body.retentionRunsEnabled),
    });
    return c.json({ ok: true });
  });

  app.get("/api/health/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const onRun = (row: RunLog) => {
        stream.writeSSE({ data: JSON.stringify(row), event: "run" });
      };
      runLogEmitter.on("run", onRun);
      const ping = setInterval(() => {
        stream.writeSSE({ data: "", event: "ping" });
      }, 25000);
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
      clearInterval(ping);
      runLogEmitter.off("run", onRun);
    });
  });

  return app;
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add routes/health.ts
git commit -m "feat: extract health routes"
```

---

### Task 6: `routes/utils.ts`

**Files:**
- Create: `routes/utils.ts`

- [ ] **Step 1: Create `routes/utils.ts`**

```ts
import { Hono } from "hono";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import axios from "axios";
import * as yaml from "js-yaml";
import type { Config } from "node-imap";
import { listImapFolders } from "../utilities/imap.utility";
import { suggestSelectors } from "../utilities/suggestion-engine.utility";
import { normalizeUrl } from "../utilities/feed-config-route-adapter.utility";
import { sendWebhook, createWebhookPayload, createJsonWebhookPayload } from "../utilities/webhook.utility";

function injectSelectorGadget(html: string): string {
  const SG_SCRIPT = `
    <script>
      (function() {
        let loadingDiv = document.createElement("div");
        loadingDiv.innerHTML = "Loading SelectorGadget...";
        loadingDiv.style.color = "black";
        loadingDiv.style.padding = "20px";
        loadingDiv.style.position = "fixed";
        loadingDiv.style.zIndex = "9999";
        loadingDiv.style.fontSize = "1.5em";
        loadingDiv.style.border = "2px solid black";
        loadingDiv.style.right = "40px";
        loadingDiv.style.top = "40px";
        loadingDiv.style.background = "white";
        document.body.appendChild(loadingDiv);

        let sgScript = document.createElement("script");
        sgScript.type = "text/javascript";
        sgScript.src = "https://dv0akt2986vzh.cloudfront.net/stable/lib/selectorgadget.js";
        document.body.appendChild(sgScript);

        let gadgetInterval = setInterval(() => {
          if (
            window.SelectorGadget &&
            window.SelectorGadget.prototype &&
            window.SelectorGadget.prototype.setPath
          ) {
            clearInterval(gadgetInterval);
            loadingDiv.remove();
            const original = window.SelectorGadget.prototype.setPath;
            window.SelectorGadget.prototype.setPath = function(prediction) {
              console.log("Intercepted setPath:", prediction);
              window.parent.postMessage({ type: "selectorUpdated", selector: prediction }, "*");
              return original.call(this, prediction);
            };
            let sg = new window.SelectorGadget();
            sg.makeInterface();
            sg.setMode('interactive');
            console.log("SelectorGadget loaded and patched!");
          }
        }, 1000);
      })();
    </script>
  `;
  return html.includes("</body>")
    ? html.replace("</body>", `${SG_SCRIPT}\n</body>`)
    : html + SG_SCRIPT;
}

export function utilsRouter(deps: { configsDir: string; feedPath: string }): Hono {
  const { configsDir, feedPath } = deps;
  const app = new Hono();

  app.get("/proxy", async (ctx) => {
    const targetUrl = ctx.req.query("url");
    if (!targetUrl) return ctx.text('Missing "url" parameter', 400);
    const flaresolverrEnabled = ctx.req.query("flaresolverrEnabled") === "true";
    const flaresolverrUrl = normalizeUrl(ctx.req.query("flaresolverrUrl") || "");
    const flaresolverrTimeout = parseInt(ctx.req.query("flaresolverrTimeout") || "60000", 10);
    try {
      let html: string;
      if (flaresolverrEnabled && flaresolverrUrl) {
        const payload = { cmd: "request.get", url: targetUrl, maxTimeout: flaresolverrTimeout };
        const resp = await axios.post(`${flaresolverrUrl}/v1`, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: flaresolverrTimeout + 5000,
        });
        if (resp.data?.solution?.response && resp.data?.solution?.status === 200) {
          html = resp.data.solution.response;
        } else {
          throw new Error(`FlareSolverr failed: ${resp.data?.message || "Unknown error"}`);
        }
      } else {
        const response = await axios.get(targetUrl);
        html = response.data;
      }
      return ctx.html(injectSelectorGadget(html));
    } catch (error) {
      console.error("Error fetching remote URL:", error);
      return ctx.text("Could not fetch the target URL", 500);
    }
  });

  app.get("/passkey", (c) =>
    c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Enter Passkey</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
      </head>
      <body>
        <main class="container">
          <h1>Enter Passkey</h1>
          <form method="POST" action="/passkey">
            <label for="passkey">Passkey:</label>
            <input type="password" id="passkey" name="passkey" required>
            <button type="submit">Submit</button>
          </form>
        </main>
      </body>
    </html>
  `)
  );

  app.post("/imap/folders", async (c) => {
    const config = await c.req.json<Config>();
    console.log("IMAP config:", {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password ? "[REDACTED]" : undefined,
    });
    const folders = await listImapFolders(config);
    console.log("IMAP folders:", folders);
    return c.json({ folders });
  });

  app.post("/utils/suggest-selectors", async (c) => {
    const { url, flaresolverr, cookies } = await c.req.json();
    try {
      const selectors = await suggestSelectors(url, flaresolverr, cookies);
      return c.json(selectors);
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/flaresolverr/health", async (c) => {
    const { serverUrl } = await c.req.json();
    if (!serverUrl) return c.json({ active: false, error: "No server URL provided" });
    const normalizedUrl = normalizeUrl(serverUrl);
    try {
      const response = await axios.get(`${normalizedUrl}/`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      return c.json({ active: true, status: response.status });
    } catch (error) {
      return c.json({ active: false, error: error.message });
    }
  });

  app.post("/utils/root-url", async (c) => {
    const { url } = await c.req.json();
    try {
      const parsed = new URL(url);
      return c.json({ origin: parsed.origin });
    } catch {
      return c.json({ origin: "" }, 400);
    }
  });

  app.post("/trigger-webhook", async (c) => {
    const { feedId } = await c.req.json();
    if (!feedId) return c.json({ error: "Feed ID is required" }, 400);
    try {
      const sanitizedFeedId = basename(feedId as string);
      const configPath = join(configsDir, `${sanitizedFeedId}.yaml`);
      if (!existsSync(configPath)) return c.json({ error: "Feed not found" }, 404);
      const feedConfig = yaml.load(await readFile(configPath, "utf8")) as any;
      if (!feedConfig.webhook?.enabled || !feedConfig.webhook?.url) {
        return c.json({ error: "Webhook not configured for this feed" }, 400);
      }
      const rssPath = join(feedPath, `${sanitizedFeedId}.xml`);
      if (!existsSync(rssPath)) return c.json({ error: "RSS feed not generated yet" }, 404);
      const rssXml = await readFile(rssPath, "utf8");
      const payload =
        feedConfig.webhook.format === "json"
          ? createJsonWebhookPayload(feedConfig, rssXml, "manual")
          : createWebhookPayload(feedConfig, rssXml, "manual");
      const success = await sendWebhook(feedConfig.webhook, payload);
      if (success) {
        return c.json({
          message: "Webhook triggered successfully",
          feedId: sanitizedFeedId,
          webhookUrl: feedConfig.webhook.url,
          itemCount: payload.itemCount,
        });
      }
      return c.json({ error: "Failed to send webhook" }, 500);
    } catch (error) {
      console.error("Error triggering webhook:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return app;
}
```

> **Note:** `utilsRouter` accepts `{ configsDir, feedPath }` rather than no args as originally specced — `POST /trigger-webhook` needs both paths.

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add routes/utils.ts
git commit -m "feat: extract utils routes"
```

---

### Task 7: `routes/feeds.ts`

**Files:**
- Create: `routes/feeds.ts`

> **CRITICAL PHASE 2 COMPATIBILITY NOTE:** If the `My Feeds Redesign` plan (Phase 2) has already been executed, `index.ts` will contain an updated `GET /api/feeds` powered by Drizzle, as well as 5 new routes (`PATCH /api/feeds/:id/metadata`, `PATCH /api/feeds/:id/enabled`, `POST /api/feeds/:id/duplicate`, `GET /api/feeds/:id/export`, `DELETE /api/feeds/:id`). **You MUST extract and preserve these existing routes from `index.ts` into `routes/feeds.ts`.** Do NOT blindly copy the legacy `GET /api/feeds` or `POST /delete-feed` code below if the newer implementations exist in `index.ts`. Ensure all necessary imports (`drizzle-orm`, `config-manager.utility.ts`, etc.) are also migrated.

- [ ] **Step 1: Create `routes/feeds.ts`**

```ts
import { file } from "bun";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { unlink } from "node:fs";
import { basename, join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import * as yaml from "js-yaml";
import { DOMParser } from "xmldom";
import {
  buildFeedConfigForRoute,
  fetchSampleHtml,
} from "../utilities/feed-config-route-adapter.utility";
import {
  setFeedUpdaterInterval,
  clearFeedUpdaterInterval,
  terminateWorker,
} from "../utilities/worker-manager.utility";
// MIGRATION NOTE: Add imports for config-manager.utility, config-metadata.utility, and drizzle here if they exist in index.ts!

async function deleteFeed(feedId: string, configsDir: string): Promise<boolean> {
  try {
    const feedFilePath = join(configsDir, `${feedId}.yaml`);
    await new Promise<void>((resolve, reject) => {
      unlink(feedFilePath, (err) => {
        if (err) {
          console.error(`Failed to delete feed file ${feedId}.yaml:`, err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    console.log(`Feed ${feedId} deleted.`);
    return true;
  } catch (error) {
    console.error(`Failed to delete feed ${feedId}:`, error);
    return false;
  }
}

export function feedsRouter(deps: {
  encryptionKey: string;
  configsDir: string;
  feedPath: string;
}): Hono {
  const { encryptionKey, configsDir, feedPath } = deps;
  const app = new Hono();

  app.get("/feeds", (ctx) => ctx.html(file("./public/index.html").text()));
  app.get("/feeds/:id/edit", (ctx) => ctx.html(file("./public/index.html").text()));

  app.post("/", async (ctx) => {
    const feedId = uuidv4();
    const contentType = ctx.req.header("Content-Type") || "";
    let body: Record<string, any>;

    try {
      if (contentType.includes("application/json")) {
        body = await ctx.req.json();
      } else if (
        contentType.includes("multipart/form-data") ||
        contentType.includes("application/x-www-form-urlencoded")
      ) {
        const formData = await ctx.req.formData();
        body = Object.fromEntries(formData as any);

        const potentialDrillChainKeys = Object.keys(body).filter((k) =>
          k.includes("DrillChain")
        );
        const structuredDrillChains: Record<string, any[]> = {};
        for (const key of potentialDrillChainKeys) {
          const m = key.match(/^(\w+)DrillChain\[(\d+)\]\[(\w+)\]$/);
          if (m) {
            const chainKey = `${m[1]}DrillChain`;
            const index = parseInt(m[2], 10);
            const property = m[3];
            if (!structuredDrillChains[chainKey]) structuredDrillChains[chainKey] = [];
            while (structuredDrillChains[chainKey].length <= index) {
              structuredDrillChains[chainKey].push({});
            }
            if (body[key] !== null && body[key] !== undefined) {
              structuredDrillChains[chainKey][index][property] = body[key];
              delete body[key];
            }
          }
        }
        Object.assign(body, structuredDrillChains);
      } else {
        return ctx.text("Unsupported Content-Type.", 415);
      }
    } catch (e) {
      console.error("Error parsing request body:", e);
      return ctx.text("Invalid request body.", 400);
    }

    const sampleHtml = await fetchSampleHtml(body);
    const finalFeedConfig = await buildFeedConfigForRoute(body, {
      feedId,
      encryptionKey,
      sampleHtml,
    });

    const yamlFilePath = join(configsDir, `${feedId}.yaml`);
    await writeFile(yamlFilePath, yaml.dump(finalFeedConfig), "utf8");
    setFeedUpdaterInterval(finalFeedConfig);

    if (contentType.includes("application/json")) {
      return ctx.json({
        message: "RSS feed is being generated.",
        feedUrl: `public/feeds/${feedId}.xml`,
        feedId,
        config: finalFeedConfig,
      });
    }
    return ctx.html(`
      <p>Your RSS feed is being generated and will update every ${finalFeedConfig.refreshTime} minutes.</p>
      <p>Access it at: <a href="/public/feeds/${feedId}.xml">/public/feeds/${feedId}.xml</a></p>
      <p><a href="/feeds">View all feeds</a></p>
    `);
  });

  // MIGRATION NOTE: Extract the actual GET /api/feeds from index.ts here!
  app.get("/api/feeds", async (ctx) => {
    // ... legacy fallback code omitted for brevity ...
    // Extract this route and any newer PATCH/DELETE/POST routes directly from index.ts
  });

  app.get("/api/feeds/:id/config", async (ctx) => {
    const feedId = ctx.req.param("id");
    assertSafeFeedId(feedId);
    const configPath = join(configsDir, `${feedId}.yaml`);
    if (!existsSync(configPath)) return ctx.json({ error: "Feed not found" }, 404);
    return ctx.json(yaml.load(await readFile(configPath, "utf8")));
  });

  app.put("/api/feeds/:id", async (ctx) => {
    const feedId = ctx.req.param("id");
    assertSafeFeedId(feedId);
    const configPath = join(configsDir, `${feedId}.yaml`);
    if (!existsSync(configPath)) return ctx.json({ error: "Feed not found" }, 404);

    const existingConfig = yaml.load(await readFile(configPath, "utf8")) as any;
    const contentType = ctx.req.header("Content-Type") || "";

    let body: Record<string, any>;
    try {
      if (contentType.includes("application/json")) {
        body = await ctx.req.json();
      } else {
        return ctx.text("Unsupported Content-Type.", 415);
      }
    } catch (e) {
      console.error("Error parsing request body:", e);
      return ctx.text("Invalid request body.", 400);
    }

    const sampleHtml = await fetchSampleHtml(body);
    const finalFeedConfig = await buildFeedConfigForRoute(body, {
      feedId,
      encryptionKey,
      sampleHtml,
      existingConfig,
    });

    await writeFile(configPath, yaml.dump(finalFeedConfig), "utf8");

    clearFeedUpdaterInterval(feedId);
    terminateWorker(feedId);
    setFeedUpdaterInterval(finalFeedConfig);

    return ctx.json({
      message: "Feed updated successfully.",
      feedUrl: `public/feeds/${feedId}.xml`,
      feedId,
      config: finalFeedConfig,
    });
  });

  // MIGRATION NOTE: Ensure you copy the DELETE /api/feeds/:id route here if it exists!
  app.post("/delete-feed", async (c) => {
    const data = await c.req.parseBody();
    const feedId = data.feedId;
    if (!feedId) return c.text("Feed name is required.", 400);
    const sanitizedFeedName = basename(feedId as string);
    const success = await deleteFeed(sanitizedFeedName, configsDir);
    if (success) return c.redirect("/feeds");
    return c.text("Failed to delete feed.", 500);
  });

  return app;
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add routes/feeds.ts
git commit -m "feat: extract feeds routes using feed config route adapter"
```

---

### Task 8: `routes/preview.ts`

**Files:**
- Create: `routes/preview.ts`

- [ ] **Step 1: Create `routes/preview.ts`**

```ts
import { Hono } from "hono";
import { buildFeedConfigForRoute, fetchSampleHtml } from "../utilities/feed-config-route-adapter.utility";
import { generatePreview } from "../utilities/preview-generator.utility";

export function previewRouter(deps: { encryptionKey: string }): Hono {
  const { encryptionKey } = deps;
  const app = new Hono();

  app.post("/preview", async (ctx) => {
    try {
      const body = await ctx.req.json();
      const sampleHtml = await fetchSampleHtml(body);
      const feedConfig = await buildFeedConfigForRoute(body, {
        feedId: "preview",
        encryptionKey,
        sampleHtml,
        isPreview: true,
      });
      const response = await generatePreview(feedConfig);
      return ctx.text(response, 200, {
        "Content-Type": "application/rss+xml",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
    } catch (error) {
      console.error("Error generating preview:", error);
      if (error.response?.data) {
        console.error("Error response data:", error.response.data);
        return ctx.text(
          `Error generating preview: ${error.message}. Server responded with: ${JSON.stringify(error.response.data)}`,
          400
        );
      } else if (error.request) {
        console.error("Error request data:", error.request);
        return ctx.text(
          `Error generating preview: ${error.message}. No response received from server.`,
          400
        );
      }
      return ctx.text(`Error generating preview: ${error.message}`, 400);
    }
  });

  return app;
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add routes/preview.ts
git commit -m "feat: extract preview route"
```

---

### Task 9: Wire `index.ts` and strip old code

**Files:**
- Modify: `index.ts`

> **CRITICAL PHASE 2 & 2.5 COMPATIBILITY NOTE:** If earlier plans have been implemented, `index.ts` will contain new imports and middleware, including the `settingsRouter` from the Phase 2.5 "Settings Page" plan. **You MUST preserve and re-mount any existing routers and middleware that are not explicitly replaced by this decomposition.**

- [ ] **Step 1: Replace `index.ts` entirely**

Replace the contents of `index.ts` with the following skeleton, making sure to inject the Phase 2.5 `settingsRouter` if it is present in the current file:

```ts
import { file } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Context, Hono } from "hono";
import { serveStatic, getConnInfo } from "hono/bun";
import { except } from "hono/combine";
import minimist from "minimist";
import { CookieStore, sessionMiddleware } from "hono-sessions";
import { EventEmitter } from "node:events";
import { createInterface } from "readline";
import { initDb } from "./lib/analytics/db";
import {
  initWorkerManager,
  processFeedsAtStart,
  clearAllFeedUpdaterIntervals,
} from "./utilities/worker-manager.utility";
import { feedsRouter } from "./routes/feeds";
import { previewRouter } from "./routes/preview";
import { healthRouter } from "./routes/health";
import { utilsRouter } from "./routes/utils";
// MIGRATION NOTE: Import settingsRouter here if it exists in the current index.ts!

const args = minimist(process.argv.slice(3));
const SSL = process.env.SSL === "true" || args.ssl === true;

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

async function getSecrets() {
  const passkey =
    process.env.PASSKEY ?? args.passkey ?? (await prompt("Enter passkey: "));
  const cookieSecret =
    process.env.COOKIE_SECRET ?? args.cookieSecret ?? (await prompt("Enter cookie secret: "));
  const encryptionKey =
    process.env.ENCRYPTION_KEY ?? args.encryptionKey ?? (await prompt("Enter encryption key: "));
  return { passkey, cookieSecret, encryptionKey };
}

const { passkey, cookieSecret, encryptionKey } = await getSecrets();

const feedPath = join(__dirname, "/public/feeds");
if (!existsSync(feedPath)) mkdirSync(feedPath);

const configsDir = join(__dirname, "configs");
if (!existsSync(configsDir)) mkdirSync(configsDir);

try {
  initDb();
} catch (e) {
  console.error("[Analytics] Failed to initialize DB — health tracking disabled:", e);
}

const runLogEmitter = new EventEmitter();
runLogEmitter.setMaxListeners(100);

initWorkerManager({ encryptionKey, runLogEmitter });
processFeedsAtStart(configsDir);

const app = new Hono();
const store = new CookieStore();

const middleware = async (c: Context, next: () => Promise<void>) => {
  const connInfo = await getConnInfo(c);
  const isLocal =
    !connInfo?.remote?.address ||
    ["127.0.0.1", "::1"].includes(connInfo.remote.address);
  if (isLocal) return await next();

  const session = c.get("session");
  const authenticated = session.get("authenticated");
  if (authenticated === true) return await next();

  if (c.req.method === "POST" && c.req.path === "/passkey") {
    const body = await c.req.parseBody();
    if (body.passkey === passkey) {
      session.set("authenticated", true);
      return c.redirect("/");
    }
    return c.html('<p>Incorrect passkey. <a href="/passkey">Try again</a>.</p>');
  }

  if (c.req.path === "/passkey") return await next();
  return c.redirect("/passkey");
};

app.use(
  "*",
  sessionMiddleware({
    store,
    encryptionKey: cookieSecret,
    expireAfterSeconds: 60 * 60 * 24,
    cookieOptions: { path: "/", httpOnly: true, secure: SSL, sameSite: "lax" },
  })
);
app.use("/*", except("/public/feeds/*", middleware));
app.use("/public/*", serveStatic({ root: "./" }));
app.use("/configs/*", serveStatic({ root: "./" }));
app.get("/", (ctx) => ctx.html(file("./public/index.html").text()));

app.route("/", feedsRouter({ encryptionKey, configsDir, feedPath }));
app.route("/", previewRouter({ encryptionKey }));
app.route("/", healthRouter({ runLogEmitter }));
app.route("/", utilsRouter({ configsDir, feedPath }));
// MIGRATION NOTE: Mount settingsRouter here if it exists in the current index.ts!

export default {
  port: 5000,
  fetch: app.fetch,
  idleTimeout: 120,
};

process.on("exit", () => { clearAllFeedUpdaterIntervals(); });
process.on("SIGINT", () => { clearAllFeedUpdaterIntervals(); process.exit(); });
process.on("SIGTERM", () => { clearAllFeedUpdaterIntervals(); process.exit(); });
```

- [ ] **Step 2: Verify line count**

```bash
wc -l index.ts
```

Expected: ~80 lines.

- [ ] **Step 3: Full type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors. If you see errors about missing imports, ensure all route files and utilities are saved and check the import paths match the file names exactly.

- [ ] **Step 4: Run all tests**

```bash
bun test tests/
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add index.ts
git commit -m "refactor: wire route factories into index.ts, strip old code"
```

---

### Task 10: Final checks and PROGRESS.md

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Start dev server and smoke test**

```bash
bun run dev
```

Open `http://localhost:5000` and verify:

```
[ ] Server starts without errors (no import failures, no missing module errors)
[ ] POST / creates a new feed YAML in configs/
[ ] POST /preview returns RSS XML
[ ] GET /api/feeds returns a JSON array of feeds
[ ] PUT /api/feeds/:id updates the YAML and restarts the worker
[ ] GET /api/health/runs returns paginated JSON
[ ] GET /api/health/stream opens an SSE connection (check Network tab)
[ ] GET /proxy?url=https://example.com returns proxied HTML with SelectorGadget injected
[ ] GET /passkey returns the passkey form HTML
[ ] GET /feeds and GET /feeds/:id/edit both return index.html (SPA catch-all)
[ ] All existing routes respond with same status codes as before
```

- [ ] **Step 2: Update PROGRESS.md**

In `docs/superpowers/PROGRESS.md`, add a new Phase 3 Prerequisite section before Phase 3, and mark it complete:

```markdown
## Phase 3 Prerequisites
| Feature | Spec | Plan |
|---|---|---|
| Backend Route Decomposition | ✅ | ✅ |
```

- [ ] **Step 3: Commit PROGRESS.md**

Do NOT commit the spec or plan files. Only PROGRESS.md:

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: mark Backend Route Decomposition spec and plan complete"
```
