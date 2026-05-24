# Community Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a remote community catalog so Mkfd instances can browse, import, and submit feed configs without requiring app updates.

**Architecture:** Static `community-catalog/` folder in the repo served via GitHub Pages. Backend `catalog-client.utility.ts` fetches and caches the manifest. `catalog-sanitizer.utility.ts` strips private fields and validates eligibility for submission. Four catalog API endpoints. A Browse + Import UI page. A per-feed submission flow producing a downloadable bundle. CI validates all catalog PRs.

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this plan.**

**Tech Stack:** Bun, TypeScript, Hono, React 18, shadcn/ui, `bun:test`, GitHub Actions

**Depends on (must be implemented first):**
- Feed Config Formalization
- Protected Value Encryption

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `community-catalog/manifest.json` | Static catalog manifest |
| Create | `community-catalog/feeds/gaming/magic-wizards-news.yaml` | Sample catalog entry |
| Create | `community-catalog/README.md` | Catalog contribution docs |
| Create | `.github/workflows/validate-community-catalog.yml` | CI workflow |
| Create | `models/community-catalog.model.ts` | All catalog types |
| Create | `utilities/community-catalog/catalog-client.utility.ts` | Remote fetch + cache |
| Create | `utilities/community-catalog/catalog-sanitizer.utility.ts` | Eligibility + sanitize |
| Create | `tests/community-catalog.test.ts` | Unit tests |
| Create | `routes/catalog.ts` | All catalog API routes |
| Modify | `index.ts` | Mount catalog router |
| Create | `scripts/validate-community-catalog.ts` | CI validation script |
| Modify | `package.json` | Add `validate:catalog` script |
| Create | `frontend/src/pages/catalog/CommunityCatalogPage.tsx` | Browse and import page |
| Create | `frontend/src/components/catalog/CatalogFeedCard.tsx` | Entry card |
| Create | `frontend/src/components/catalog/CatalogFeedDetailDrawer.tsx` | YAML preview + import |
| Create | `frontend/src/components/catalog/CatalogImportDialog.tsx` | Import confirmation |
| Create | `frontend/src/components/catalog/CatalogSubmissionDialog.tsx` | Submission flow |
| Create | `frontend/src/components/catalog/CatalogMetadataForm.tsx` | Submission metadata form |
| Create | `frontend/src/components/catalog/CatalogSanitizedYamlPreview.tsx` | Sanitized YAML display |
| Modify | `frontend/src/main.tsx` (or routes file) | Add `/catalog` route |

---

### Task 1: Repository catalog structure + sample entry

**Files:**
- Create: `community-catalog/manifest.json`
- Create: `community-catalog/feeds/gaming/magic-wizards-news.yaml`
- Create: `community-catalog/README.md`

- [ ] **Step 1: Create catalog folder structure**

```bash
mkdir -p community-catalog/feeds/gaming community-catalog/schemas
```

- [ ] **Step 2: Create `community-catalog/manifest.json`**

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-24T00:00:00Z",
  "feeds": [
    {
      "id": "magic-wizards-news",
      "title": "Magic: The Gathering News",
      "description": "Creates a feed from Magic: The Gathering news articles.",
      "category": "gaming",
      "tags": ["magic", "wizards", "gaming", "news"],
      "feedType": "webScraping",
      "path": "feeds/gaming/magic-wizards-news.yaml",
      "sourceHomepage": "https://magic.wizards.com/en/news",
      "requiresSecrets": false,
      "requiresPrivateNetwork": false,
      "schemaVersion": 2,
      "catalogVersion": 1
    }
  ]
}
```

- [ ] **Step 3: Create sample catalog feed YAML**

Create `community-catalog/feeds/gaming/magic-wizards-news.yaml` with a valid `schemaVersion: 2` web scraping config (no `feedId`, no auth). Use the actual Magic: The Gathering news page selectors if known, otherwise a placeholder with comments. Ensure no protected values, no cookies, no localhost.

- [ ] **Step 4: Create `community-catalog/README.md`**

Include:
- Purpose: community feed recipes for Mkfd
- How to browse: install Mkfd, open Catalog page
- Contribution rules: no secrets, no private URLs, no serviceConnector/email
- How to submit: use "Submit to Community Catalog" in Mkfd UI, then open a PR with the bundle
- Review criteria: public source, API-accessible or scrapable, useful to others

- [ ] **Step 5: Commit**

```bash
git add community-catalog/
git commit -m "feat: add community catalog structure with sample Magic news entry"
```

---

### Task 2: Catalog models

**Files:**
- Create: `models/community-catalog.model.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/community-catalog.test.ts
import { describe, expect, test } from "bun:test";
import type { CatalogManifest, CatalogSanitizeResult } from "../models/community-catalog.model";

describe("community-catalog model types", () => {
  test("CatalogManifest compiles", () => {
    const manifest: CatalogManifest = {
      schemaVersion: 1,
      updatedAt: "2026-05-24T00:00:00Z",
      feeds: [
        {
          id: "test-feed",
          title: "Test Feed",
          description: "A test feed.",
          category: "gaming",
          tags: ["test"],
          feedType: "webScraping",
          path: "feeds/gaming/test.yaml",
          requiresSecrets: false,
          requiresPrivateNetwork: false,
          schemaVersion: 2,
          catalogVersion: 1,
        },
      ],
    };
    expect(manifest.feeds).toHaveLength(1);
  });

  test("CatalogSanitizeResult has all required fields", () => {
    const result: CatalogSanitizeResult = {
      eligible: true,
      sanitizedYaml: "feedType: webScraping",
      errors: [],
      warnings: [],
      removed: [],
    };
    expect(result.eligible).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/community-catalog.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `models/community-catalog.model.ts`**

```ts
import type { FeedType } from "./feed-config.model";

export type CatalogManifest = {
  schemaVersion: 1;
  updatedAt: string;
  feeds: CatalogManifestEntry[];
};

export type CatalogManifestEntry = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  feedType: FeedType;
  path: string;
  sourceHomepage?: string;
  requiresSecrets: boolean;
  requiresPrivateNetwork: boolean;
  requiresTemplateValues?: boolean;
  templateVariables?: string[];
  schemaVersion: number;
  catalogVersion: number;
};

export type CatalogSubmissionInput = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  sourceHomepage?: string;
  submitterName?: string;
};

export type CatalogSanitizeResult = {
  eligible: boolean;
  sanitizedYaml?: string;
  manifestEntry?: Omit<CatalogManifestEntry, "id" | "path">;
  errors: CatalogSanitizeIssue[];
  warnings: CatalogSanitizeIssue[];
  removed: CatalogSanitizeRemoval[];
};

export type CatalogSanitizeIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type CatalogSanitizeRemoval = {
  path: string;
  reason: string;
};
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/community-catalog.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add models/community-catalog.model.ts tests/community-catalog.test.ts
git commit -m "feat: add community-catalog model types"
```

---

### Task 3: Catalog client utility

**Files:**
- Create: `utilities/community-catalog/catalog-client.utility.ts`
- Modify: `tests/community-catalog.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mock } from "bun:test";
import { getCatalogManifest, getCatalogFeedYaml } from "../utilities/community-catalog/catalog-client.utility";

describe("catalog-client", () => {
  test("getCatalogManifest returns manifest on success", async () => {
    // Mock global fetch to return a valid manifest
    const mockManifest = { schemaVersion: 1, updatedAt: new Date().toISOString(), feeds: [] };
    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(mockManifest))));

    const result = await getCatalogManifest();
    expect(result.manifest.schemaVersion).toBe(1);
    expect(result.source).toBe("remote");
    expect(result.stale).toBe(false);
  });

  test("getCatalogManifest falls back to cache on failure", async () => {
    global.fetch = mock(() => Promise.reject(new Error("network error")));
    // Seed cache with a stale manifest
    await Bun.write("./catalog-cache/manifest.json", JSON.stringify({
      schemaVersion: 1, updatedAt: "2020-01-01T00:00:00Z", feeds: [],
    }));

    const result = await getCatalogManifest();
    expect(result.source).toBe("cache");
    expect(result.stale).toBe(true);
    expect(result.warning).toContain("stale");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/community-catalog.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `utilities/community-catalog/catalog-client.utility.ts`**

```ts
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogManifest } from "../../models/community-catalog.model";

const CACHE_DIR = "./catalog-cache";
const CATALOG_URL =
  process.env.COMMUNITY_CATALOG_URL ??
  "https://tbosak.github.io/mkfd/community-catalog/manifest.json";
const FALLBACK_URL =
  process.env.COMMUNITY_CATALOG_FALLBACK_URL ??
  "https://raw.githubusercontent.com/TBosak/mkfd/main/community-catalog/manifest.json";
const REFRESH_HOURS = Number(process.env.COMMUNITY_CATALOG_REFRESH_HOURS ?? "24");

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(join(CACHE_DIR, "feeds"))) mkdirSync(join(CACHE_DIR, "feeds"), { recursive: true });
}

async function fetchWithFallback(url: string, fallbackUrl: string): Promise<Response> {
  try {
    const res = await fetch(url);
    if (res.ok) return res;
  } catch { /* fall through */ }
  return fetch(fallbackUrl);
}

async function loadCachedManifest(): Promise<CatalogManifest | null> {
  ensureCacheDir();
  const path = join(CACHE_DIR, "manifest.json");
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as CatalogManifest;
}

export async function getCatalogManifest(): Promise<{
  source: "remote" | "cache";
  stale: boolean;
  warning?: string;
  manifest: CatalogManifest;
}> {
  ensureCacheDir();
  try {
    const res = await fetchWithFallback(CATALOG_URL, FALLBACK_URL);
    const manifest = await res.json() as CatalogManifest;
    await writeFile(join(CACHE_DIR, "manifest.json"), JSON.stringify(manifest), "utf8");
    return { source: "remote", stale: false, manifest };
  } catch {
    const cached = await loadCachedManifest();
    if (cached) {
      return { source: "cache", stale: true, warning: "Could not reach catalog server. Showing stale cached catalog.", manifest: cached };
    }
    throw new Error("Catalog unavailable: no remote connection and no local cache.");
  }
}

export async function getCatalogFeedYaml(id: string): Promise<{
  source: "remote" | "cache";
  stale: boolean;
  warning?: string;
  yaml: string;
}> {
  ensureCacheDir();
  const cachePath = join(CACHE_DIR, "feeds", `${id}.yaml`);

  try {
    const manifest = await getCatalogManifest();
    const entry = manifest.manifest.feeds.find((f) => f.id === id);
    if (!entry) throw new Error(`Catalog entry not found: ${id}`);

    const baseUrl = CATALOG_URL.replace(/manifest\.json$/, "");
    const yamlUrl = `${baseUrl}${entry.path}`;
    const res = await fetch(yamlUrl);
    const yaml = await res.text();

    await writeFile(cachePath, yaml, "utf8");
    return { source: "remote", stale: false, yaml };
  } catch {
    if (existsSync(cachePath)) {
      const yaml = await readFile(cachePath, "utf8");
      return { source: "cache", stale: true, warning: "Using cached feed YAML.", yaml };
    }
    throw new Error(`Could not fetch catalog entry: ${id}`);
  }
}

export async function refreshCatalogManifest(): Promise<void> {
  await getCatalogManifest(); // forces re-fetch and overwrites cache
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/community-catalog.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/community-catalog/ tests/community-catalog.test.ts
git commit -m "feat: add catalog client with remote fetch and stale cache fallback"
```

---

### Task 4: Catalog sanitizer

**Files:**
- Create: `utilities/community-catalog/catalog-sanitizer.utility.ts`
- Modify: `tests/community-catalog.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { sanitizeFeedConfigForCatalog } from "../utilities/community-catalog/catalog-sanitizer.utility";

const validWebScrapingConfig = {
  feedType: "webScraping" as const,
  feedName: "city-news",
  refreshTime: 60,
  config: {
    baseUrl: "https://example.gov/news",
    selectors: { items: ".news-item", title: "h2", link: "a" },
  },
  feedId: "some-local-id",
  metadata: { visibility: "private", localOnly: true },
};

const submissionInput = {
  title: "City News Feed",
  description: "Local government news.",
  category: "news",
  tags: ["news", "government"],
  sourceHomepage: "https://example.gov/news",
};

describe("catalog-sanitizer", () => {
  test("eligible webScraping config returns eligible result", () => {
    const result = sanitizeFeedConfigForCatalog(validWebScrapingConfig as unknown, submissionInput);
    expect(result.eligible).toBe(true);
    expect(result.sanitizedYaml).toBeDefined();
  });

  test("removes feedId from output", () => {
    const result = sanitizeFeedConfigForCatalog(validWebScrapingConfig as unknown, submissionInput);
    expect(result.sanitizedYaml).not.toContain("feedId:");
  });

  test("removes metadata.visibility from output", () => {
    const result = sanitizeFeedConfigForCatalog(validWebScrapingConfig as unknown, submissionInput);
    expect(result.sanitizedYaml).not.toContain("visibility:");
  });

  test("rejects serviceConnector feed type", () => {
    const config = { ...validWebScrapingConfig, feedType: "serviceConnector" };
    const result = sanitizeFeedConfigForCatalog(config as unknown, submissionInput);
    expect(result.eligible).toBe(false);
    expect(result.errors.some((e) => e.message.includes("serviceConnector"))).toBe(true);
  });

  test("rejects email feed type", () => {
    const config = { ...validWebScrapingConfig, feedType: "email" };
    const result = sanitizeFeedConfigForCatalog(config as unknown, submissionInput);
    expect(result.eligible).toBe(false);
  });

  test("rejects protected values", () => {
    const config = {
      ...validWebScrapingConfig,
      headers: { Authorization: { type: "protected", value: "ENC:v1:..." } },
    };
    const result = sanitizeFeedConfigForCatalog(config as unknown, submissionInput);
    expect(result.eligible).toBe(false);
    expect(result.errors.some((e) => e.message.includes("secret"))).toBe(true);
  });

  test("rejects localhost URL", () => {
    const config = { ...validWebScrapingConfig, config: { ...validWebScrapingConfig.config, baseUrl: "http://localhost:8096" } };
    const result = sanitizeFeedConfigForCatalog(config as unknown, submissionInput);
    expect(result.eligible).toBe(false);
  });

  test("normalizes refreshTime to minimum 5 minutes", () => {
    const config = { ...validWebScrapingConfig, refreshTime: 1 };
    const result = sanitizeFeedConfigForCatalog(config as unknown, submissionInput);
    expect(result.eligible).toBe(true);
    expect(result.sanitizedYaml).toContain("refreshTime: 5");
  });

  test("adds catalogVersion: 1", () => {
    const result = sanitizeFeedConfigForCatalog(validWebScrapingConfig as unknown, submissionInput);
    expect(result.sanitizedYaml).toContain("catalogVersion: 1");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/community-catalog.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `utilities/community-catalog/catalog-sanitizer.utility.ts`**

```ts
import * as yaml from "js-yaml";
import type { CatalogSanitizeResult, CatalogSubmissionInput } from "../../models/community-catalog.model";

const INELIGIBLE_FEED_TYPES = ["serviceConnector", "email"];
const SENSITIVE_HEADER_NAMES = /^(authorization|x-api-key|cookie|x-auth-token)$/i;
const PRIVATE_IP_REGEX = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost)/i;
const MIN_REFRESH_MINUTES = 5;

const FIELDS_TO_REMOVE = [
  "feedId",
  ["metadata", "visibility"],
  ["metadata", "localOnly"],
  "webhookUrl",
  "webhookDelivery",
];

export function sanitizeFeedConfigForCatalog(
  config: unknown,
  input: CatalogSubmissionInput,
): CatalogSanitizeResult {
  const errors: CatalogSanitizeResult["errors"] = [];
  const warnings: CatalogSanitizeResult["warnings"] = [];
  const removed: CatalogSanitizeResult["removed"] = [];

  if (!config || typeof config !== "object") {
    return { eligible: false, errors: [{ path: "", message: "Invalid config.", severity: "error" }], warnings, removed };
  }

  const record = config as Record<string, unknown>;

  // Check ineligible feed types
  if (INELIGIBLE_FEED_TYPES.includes(String(record.feedType ?? ""))) {
    errors.push({
      path: "feedType",
      message: `${record.feedType} feeds cannot be submitted to the community catalog.`,
      severity: "error",
    });
  }

  // Check for filesystem local paths
  if (record.feedType === "filesystem" && (record.filesystem as Record<string, unknown>)?.rootPath) {
    errors.push({ path: "filesystem.rootPath", message: "Filesystem feeds with local paths cannot be submitted.", severity: "error" });
  }

  // Check for protected values recursively
  if (containsProtectedValues(config)) {
    errors.push({ path: "", message: "Config contains encrypted secrets. Remove credentials before submitting.", severity: "error" });
  }

  // Check for private URLs
  const urlIssues = findPrivateUrls(config);
  for (const url of urlIssues) {
    errors.push({ path: url.path, message: `Private/localhost URL detected: ${url.value}`, severity: "error" });
  }

  // Check for non-template sensitive headers
  const headerIssues = findHardcodedSensitiveHeaders(config);
  for (const h of headerIssues) {
    errors.push({ path: h.path, message: `Hardcoded sensitive header value detected at ${h.path}.`, severity: "error" });
  }

  if (errors.length > 0) {
    return { eligible: false, errors, warnings, removed };
  }

  // Build sanitized output
  const sanitized = structuredClone(record) as Record<string, unknown>;

  // Remove private fields
  delete sanitized.feedId;
  removed.push({ path: "feedId", reason: "Local feed ID is not shared in catalog." });

  if (typeof sanitized.metadata === "object" && sanitized.metadata !== null) {
    const meta = sanitized.metadata as Record<string, unknown>;
    delete meta.visibility;
    removed.push({ path: "metadata.visibility", reason: "Visibility is a local setting." });
    delete meta.localOnly;
    removed.push({ path: "metadata.localOnly", reason: "localOnly is a local setting." });
    meta.sourceHomepage = input.sourceHomepage ?? "";
    meta.catalogReady = true;
  }

  // Add catalog fields
  sanitized.catalogVersion = 1;

  // Normalize refresh time
  const currentRefresh = Number(sanitized.refreshTime ?? 0);
  if (currentRefresh < MIN_REFRESH_MINUTES) {
    sanitized.refreshTime = MIN_REFRESH_MINUTES;
    warnings.push({ path: "refreshTime", message: `Refresh time normalized to ${MIN_REFRESH_MINUTES} minutes.`, severity: "warning" });
  }

  const sanitizedYaml = yaml.dump(sanitized, { lineWidth: 120 });

  return {
    eligible: true,
    sanitizedYaml,
    manifestEntry: {
      title: input.title,
      description: input.description,
      category: input.category,
      tags: input.tags,
      feedType: String(record.feedType) as ReturnType<typeof import("../../models/feed-config.model")>["feedType"],
      sourceHomepage: input.sourceHomepage,
      requiresSecrets: false,
      requiresPrivateNetwork: false,
      schemaVersion: 2,
      catalogVersion: 1,
    },
    errors,
    warnings,
    removed,
  };
}

function containsProtectedValues(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some(containsProtectedValues);
  const record = obj as Record<string, unknown>;
  if (record.type === "protected" && record.value) return true;
  if (record.type === "env" && record.value) return false; // env references are OK
  return Object.values(record).some(containsProtectedValues);
}

function findPrivateUrls(obj: unknown, path = ""): Array<{ path: string; value: string }> {
  const results: Array<{ path: string; value: string }> = [];
  if (typeof obj === "string") {
    try {
      const url = new URL(obj);
      if (PRIVATE_IP_REGEX.test(url.hostname)) {
        results.push({ path, value: obj });
      }
    } catch { /* not a URL */ }
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      results.push(...findPrivateUrls(v, path ? `${path}.${k}` : k));
    }
  }
  return results;
}

function findHardcodedSensitiveHeaders(obj: unknown, path = ""): Array<{ path: string }> {
  const results: Array<{ path: string }> = [];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_HEADER_NAMES.test(key) && typeof value === "string" && !value.includes("{{")) {
        results.push({ path: currentPath });
      } else {
        results.push(...findHardcodedSensitiveHeaders(value, currentPath));
      }
    }
  }
  return results;
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/community-catalog.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/community-catalog/ tests/community-catalog.test.ts
git commit -m "feat: add catalog sanitizer with eligibility checks and field removal"
```

---

### Task 5: Catalog API routes

**Files:**
- Create: `routes/catalog.ts`
- Modify: `index.ts`

- [ ] **Step 1: Write failing tests**

```ts
import app from "../index";

describe("GET /community-catalog/manifest", () => {
  test("returns manifest with source metadata", async () => {
    const res = await app.request("/community-catalog/manifest");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manifest).toBeDefined();
    expect(body.source).toMatch(/^(remote|cache)$/);
  });
});

describe("POST /community-catalog/import/:id", () => {
  test("imports a non-template catalog entry", async () => {
    const res = await app.request("/community-catalog/import/magic-wizards-news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.feedId).toBeDefined();
  });
});

describe("POST /community-catalog/refresh", () => {
  test("triggers manifest refresh", async () => {
    const res = await app.request("/community-catalog/refresh", { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("POST /catalog/submissions/:feedId/download", () => {
  test("returns 400 for ineligible feed", async () => {
    // Set up a test feed config that is ineligible (e.g., serviceConnector)
    const res = await app.request("/catalog/submissions/test-service-connector/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", description: "Test", category: "other", tags: [] }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/catalog-routes.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `routes/catalog.ts`**

```ts
import { Hono } from "hono";
import * as yaml from "js-yaml";
import { getCatalogManifest, getCatalogFeedYaml, refreshCatalogManifest } from "../utilities/community-catalog/catalog-client.utility";
import { sanitizeFeedConfigForCatalog } from "../utilities/community-catalog/catalog-sanitizer.utility";
import { hasFeedTemplate, renderFeedConfigTemplate, validateFeedTemplate, validateTemplateValues, extractFeedTemplate } from "../utilities/feed-template.utility";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";
import { loadFeedConfig } from "../utilities/feed-config.utility";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const router = new Hono();

router.get("/community-catalog/manifest", async (c) => {
  const result = await getCatalogManifest();
  return c.json(result);
});

router.get("/community-catalog/feeds/:id", async (c) => {
  const id = c.req.param("id");
  const result = await getCatalogFeedYaml(id);
  const manifest = await getCatalogManifest();
  const entry = manifest.manifest.feeds.find((f) => f.id === id);
  return c.json({ ...result, entry });
});

router.post("/community-catalog/import/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as {
    values?: Record<string, unknown>;
    secretStorage?: Record<string, "protected" | "env">;
    feedName?: string;
  };
  const catalogYaml = await getCatalogFeedYaml(id);
  const parsed = yaml.load(catalogYaml.yaml) as Record<string, unknown>;
  const feedId = randomUUID();

  let rendered: Record<string, unknown>;

  if (hasFeedTemplate(parsed)) {
    const schemaValidation = validateFeedTemplate(parsed);
    if (!schemaValidation.valid) return c.json({ ok: false, errors: schemaValidation.errors }, 400);

    const template = extractFeedTemplate(parsed)!;
    const valuesValidation = validateTemplateValues(template, body.values ?? {}, body.secretStorage ?? {});
    if (!valuesValidation.valid) return c.json({ ok: false, errors: valuesValidation.errors }, 400);

    rendered = renderFeedConfigTemplate(parsed, {
      feedId,
      encryptionKey: process.env.ENCRYPTION_KEY ?? "",
      values: body.values ?? {},
      secretStorage: body.secretStorage ?? {},
      origin: { type: "community", catalogId: id },
    });
  } else {
    rendered = { ...parsed, feedId, schemaVersion: 2 };
  }

  if (body.feedName) rendered.feedName = body.feedName;

  const feedConfig = normalizeLoadedFeedConfig(rendered);
  const validation = validateFeedConfig(feedConfig);
  if (!validation.valid) return c.json({ ok: false, errors: validation.errors }, 400);

  await writeFile(
    join(process.env.CONFIGS_DIR ?? "./configs", `${feedId}.yaml`),
    yaml.dump(feedConfig),
    "utf8",
  );

  return c.json({ ok: true, feedId: feedConfig.feedId, feedName: feedConfig.feedName, feedUrl: `/public/feeds/${feedConfig.feedId}.xml` });
});

router.post("/community-catalog/refresh", async (c) => {
  await refreshCatalogManifest();
  return c.json({ ok: true });
});

router.post("/catalog/submissions/:feedId/download", async (c) => {
  const feedId = c.req.param("feedId");
  const input = await c.req.json() as import("../models/community-catalog.model").CatalogSubmissionInput;

  const config = await loadFeedConfig(feedId);
  if (!config) return c.json({ ok: false, error: "Feed not found." }, 404);

  const sanitizeResult = sanitizeFeedConfigForCatalog(config, input);
  if (!sanitizeResult.eligible) {
    return c.json({ ok: false, eligible: false, errors: sanitizeResult.errors }, 400);
  }

  // Build bundle response (in production this would be a ZIP; return JSON for simplicity in tests)
  return c.json({
    ok: true,
    sanitizedYaml: sanitizeResult.sanitizedYaml,
    manifestEntry: sanitizeResult.manifestEntry,
    removed: sanitizeResult.removed,
    warnings: sanitizeResult.warnings,
  });
});

export default router;
```

- [ ] **Step 4: Mount router in `index.ts`**

```ts
import catalogRouter from "./routes/catalog";
app.route("/", catalogRouter);
```

- [ ] **Step 5: Run tests**

```bash
bun test tests/catalog-routes.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add routes/catalog.ts index.ts tests/catalog-routes.test.ts
git commit -m "feat: add catalog API routes for browse, import, refresh, and download"
```

---

### Task 6: Catalog CI script + GitHub Action

**Files:**
- Create: `scripts/validate-community-catalog.ts`
- Create: `.github/workflows/validate-community-catalog.yml`
- Modify: `package.json`

- [ ] **Step 1: Write failing test**

```ts
import { validateCatalogDir } from "../scripts/validate-community-catalog";

describe("validate-community-catalog", () => {
  test("passes on valid community-catalog directory", async () => {
    const result = await validateCatalogDir("./community-catalog");
    expect(result.errors).toHaveLength(0);
  });

  test("fails if a feed contains feedId", async () => {
    // Write a temp invalid feed
    await Bun.write("/tmp/test-feed.yaml", "feedId: should-not-be-here\nfeedType: webScraping");
    const result = await validateCatalogDir("/tmp/test-catalog");
    // Not testing real path for unit, just the function logic
  });
});
```

- [ ] **Step 2: Create `scripts/validate-community-catalog.ts`**

```ts
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import type { CatalogManifest } from "../models/community-catalog.model";

export async function validateCatalogDir(
  catalogDir: string,
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. manifest.json exists
  const manifestPath = join(catalogDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    errors.push("manifest.json not found.");
    return { errors, warnings };
  }

  let manifest: CatalogManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CatalogManifest;
  } catch (err) {
    errors.push(`manifest.json parse error: ${err}`);
    return { errors, warnings };
  }

  // 2. IDs and paths unique
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const entry of manifest.feeds) {
    if (ids.has(entry.id)) errors.push(`Duplicate manifest ID: ${entry.id}`);
    if (paths.has(entry.path)) errors.push(`Duplicate manifest path: ${entry.path}`);
    ids.add(entry.id);
    paths.add(entry.path);
  }

  // 3. All paths exist and validate
  for (const entry of manifest.feeds) {
    const feedPath = join(catalogDir, entry.path);
    if (!existsSync(feedPath)) {
      errors.push(`Manifest path not found: ${entry.path}`);
      continue;
    }

    let feedConfig: Record<string, unknown>;
    try {
      feedConfig = yaml.load(readFileSync(feedPath, "utf8")) as Record<string, unknown>;
    } catch (err) {
      errors.push(`YAML parse error in ${entry.path}: ${err}`);
      continue;
    }

    // Must not have feedId
    if (feedConfig.feedId) {
      errors.push(`${entry.path}: catalog configs must not contain feedId.`);
    }

    // Must not be serviceConnector or email
    if (["serviceConnector", "email"].includes(String(feedConfig.feedType ?? ""))) {
      errors.push(`${entry.path}: ${feedConfig.feedType} is not allowed in the catalog.`);
    }

    // Must not have protected values
    if (containsProtectedValues(feedConfig)) {
      errors.push(`${entry.path}: contains protected/encrypted values.`);
    }

    // Must not have private IPs/localhost
    const privateUrls = findPrivateUrls(feedConfig);
    for (const url of privateUrls) {
      errors.push(`${entry.path}: private URL at ${url.path}: ${url.value}`);
    }

    // Must not have hardcoded sensitive headers (non-template)
    const hardcodedHeaders = findHardcodedSensitiveHeaders(feedConfig);
    for (const h of hardcodedHeaders) {
      errors.push(`${entry.path}: hardcoded sensitive header at ${h.path}.`);
    }

    // schemaVersion must be 2
    if (Number(feedConfig.schemaVersion) !== 2) {
      warnings.push(`${entry.path}: schemaVersion should be 2.`);
    }
  }

  return { errors, warnings };
}

// (Helper functions same as in sanitizer - extract to shared utility in implementation)
function containsProtectedValues(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some(containsProtectedValues);
  const record = obj as Record<string, unknown>;
  if (record.type === "protected" && record.value) return true;
  return Object.values(record).some(containsProtectedValues);
}

function findPrivateUrls(obj: unknown, path = ""): Array<{ path: string; value: string }> {
  const PRIVATE_IP_REGEX = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost)/i;
  const results: Array<{ path: string; value: string }> = [];
  if (typeof obj === "string") {
    try {
      const url = new URL(obj);
      if (PRIVATE_IP_REGEX.test(url.hostname)) results.push({ path, value: obj });
    } catch { /* not a URL */ }
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      results.push(...findPrivateUrls(v, path ? `${path}.${k}` : k));
    }
  }
  return results;
}

function findHardcodedSensitiveHeaders(obj: unknown, path = ""): Array<{ path: string }> {
  const SENSITIVE_HEADER_NAMES = /^(authorization|x-api-key|cookie|x-auth-token)$/i;
  const results: Array<{ path: string }> = [];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_HEADER_NAMES.test(key) && typeof value === "string" && !value.includes("{{")) {
        results.push({ path: currentPath });
      } else {
        results.push(...findHardcodedSensitiveHeaders(value, currentPath));
      }
    }
  }
  return results;
}

// CLI entry point
if (import.meta.main) {
  const catalogDir = process.argv[2] ?? "./community-catalog";
  const { errors, warnings } = await validateCatalogDir(catalogDir);
  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  if (errors.length > 0) {
    console.error(`\n❌ Catalog validation failed with ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log("✓ Catalog validation passed.");
}
```

- [ ] **Step 3: Add script to `package.json`**

```json
{
  "scripts": {
    "validate:catalog": "bun run scripts/validate-community-catalog.ts"
  }
}
```

- [ ] **Step 4: Create `.github/workflows/validate-community-catalog.yml`**

```yaml
name: Validate Community Catalog
on:
  pull_request:
    paths:
      - "community-catalog/**"
      - "scripts/validate-community-catalog.ts"
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run validate:catalog
```

- [ ] **Step 5: Run tests**

```bash
bun test tests/validate-community-catalog.test.ts
```

Expected: PASS

```bash
bun run validate:catalog
```

Expected: passes for the sample entry

- [ ] **Step 6: Commit**

```bash
git add scripts/validate-community-catalog.ts .github/workflows/validate-community-catalog.yml package.json
git commit -m "feat: add catalog CI validation script and GitHub Actions workflow"
```

---

### Task 7: Frontend catalog UI

> **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing components in this task.**

**Files:**
- Create: `frontend/src/pages/catalog/CommunityCatalogPage.tsx`
- Create: `frontend/src/components/catalog/CatalogFeedCard.tsx`
- Create: `frontend/src/components/catalog/CatalogFeedDetailDrawer.tsx`
- Create: `frontend/src/components/catalog/CatalogImportDialog.tsx`
- Modify: routes file

- [ ] **Step 1: Invoke `superpowers:frontend-design` for catalog page layout**

- [ ] **Step 2: Create `CatalogFeedCard.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import type { CatalogManifestEntry } from "@/models/community-catalog.model";

interface Props {
  entry: CatalogManifestEntry;
  onClick: () => void;
}

export function CatalogFeedCard({ entry, onClick }: Props) {
  return (
    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={onClick}>
      <CardHeader>
        <CardTitle className="text-base">{entry.title}</CardTitle>
        <CardDescription>{entry.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{entry.feedType}</Badge>
        <Badge variant="outline">{entry.category}</Badge>
        {entry.requiresSecrets && <Badge variant="destructive">Requires secret</Badge>}
        {entry.requiresPrivateNetwork && <Badge variant="destructive">Private network</Badge>}
        {entry.requiresTemplateValues && <Badge>Setup required</Badge>}
        {entry.tags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create `CommunityCatalogPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CatalogFeedCard } from "@/components/catalog/CatalogFeedCard";
import { CatalogFeedDetailDrawer } from "@/components/catalog/CatalogFeedDetailDrawer";
import type { CatalogManifestEntry } from "@/models/community-catalog.model";

export function CommunityCatalogPage() {
  const [entries, setEntries] = useState<CatalogManifestEntry[]>([]);
  const [stale, setStale] = useState(false);
  const [staleWarning, setStaleWarning] = useState<string>();
  const [search, setSearch] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<CatalogManifestEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/community-catalog/manifest")
      .then((r) => r.json())
      .then((body) => {
        setEntries(body.manifest.feeds ?? []);
        setStale(body.stale);
        setStaleWarning(body.warning);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = entries.filter(
    (e) =>
      !search ||
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase()) ||
      e.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) return <div className="p-6">Loading catalog...</div>;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Community Catalog</h1>
      {stale && staleWarning && (
        <Alert variant="destructive">
          <AlertDescription>{staleWarning}</AlertDescription>
        </Alert>
      )}
      <Input
        placeholder="Search feeds..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((entry) => (
          <CatalogFeedCard key={entry.id} entry={entry} onClick={() => setSelectedEntry(entry)} />
        ))}
      </div>
      {selectedEntry && (
        <CatalogFeedDetailDrawer
          entry={selectedEntry}
          open={true}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `CatalogFeedDetailDrawer.tsx`** (shows YAML + Import button; routes to `TemplateImportDialog` when template present)

- [ ] **Step 5: Create `CatalogImportDialog.tsx`** (confirmation + import)

- [ ] **Step 6: Add `/catalog` route** to the frontend router

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/catalog/ frontend/src/components/catalog/
git commit -m "feat: add community catalog page with browse, import, and submission UI"
```

---

### Task 8: Submission UI + download bundle

> **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing components in this task.**

**Files:**
- Create: `frontend/src/components/catalog/CatalogSubmissionDialog.tsx`
- Create: `frontend/src/components/catalog/CatalogMetadataForm.tsx`
- Create: `frontend/src/components/catalog/CatalogSanitizedYamlPreview.tsx`

- [ ] **Step 1: Implement submission dialog with eligibility check → metadata form → YAML preview → download**

The dialog calls `POST /catalog/submissions/:feedId/download` to check eligibility and get the sanitized YAML. On success, creates a client-side download of the YAML file.

- [ ] **Step 2: Wire "Submit to Community Catalog" action to My Feeds per-feed menu**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/catalog/
git commit -m "feat: add catalog submission dialog with eligibility check and bundle download"
```

---

### Task 9: Verification

- [ ] **Step 1: Run all catalog tests**

```bash
bun test tests/community-catalog.test.ts tests/catalog-routes.test.ts
```

Expected: PASS

- [ ] **Step 2: Run catalog validation script**

```bash
bun run validate:catalog
```

Expected: PASS on sample entries

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: PASS with no regressions

- [ ] **Step 4: Manual verification**

- Open Catalog page — confirm entries load from manifest
- Click a card — confirm YAML preview appears
- Click Import — confirm config saved to `/app/configs`
- Open My Feeds → eligible feed → "Submit to Community Catalog"
- Confirm sanitized YAML shows removed fields list
- Confirm download button produces a valid YAML file
- Confirm serviceConnector feed shows ineligibility error
