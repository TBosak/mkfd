# My Feeds Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **UI implementation:** For Tasks 6–11 (all React component work), use **superpowers:frontend-design** to validate visual designs before writing final component code.

**Goal:** Replace the minimal ActiveFeedsPage with a full My Feeds dashboard — searchable, filterable feed cards with inline tag editing, a detail drawer, and all feed management actions (duplicate, export, delete, enable/disable, edit).

**Architecture:** Three new backend utilities handle config I/O, metadata patching, and FeedSummary assembly from YAML + run_logs. The existing `GET /api/feeds` is expanded; four new routes are added. The frontend is rebuilt as `MyFeedsPage` with eight new components under `components/feeds/` and a custom toast system.

**Security decision:** `feedId` is the immutable storage/security identifier. All config-manager operations must validate route/body ids with `assertSafeFeedId` before joining paths. `feedName` and metadata title remain editable display labels; changing them must not rename YAML files, output files, history rows, or worker keys.

**Tech Stack:** Bun, TypeScript, Hono, js-yaml, drizzle-orm/bun-sqlite, React 18, shadcn/ui (Dialog, Tabs), custom CSS tokens layer

**Depends on (must be implemented first):**
- Feed Config Formalization — provides `FeedConfig`, `FeedMetadata`, `models/feed-config.model.ts`
- Protected Value Encryption — provides `{ type: "protected" }` value shape
- SQLite Runtime Substrate + Feed History — provides the runtime DB (`runtime.db`) with `run_logs`, feed history tables, and shared migration wiring
- Feed Format Refactor — writes `.xml`/`.atom`/`.json` output files per feedId
- App Shell / shared UI tokens — provides or precedes the shared `feeds-tokens.css` design-token bridge

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `utilities/config-manager.utility.ts` | YAML CRUD: list, read, write, delete, duplicate, export |
| Create | `utilities/config-metadata.utility.ts` | Normalize + patch metadata block, detect plain secrets |
| Create | `utilities/feed-summary.utility.ts` | Build `FeedSummary` from config + RunLog |
| Create | `tests/config-manager.test.ts` | Unit tests for config-manager |
| Create | `tests/config-metadata.test.ts` | Unit tests for config-metadata |
| Create | `tests/feed-summary.test.ts` | Unit tests for feed-summary |
| Modify | `index.ts` | Expand `GET /api/feeds`; add PATCH metadata/enabled, POST duplicate, GET export, DELETE |
| Create | `frontend/src/types/feed-summary.ts` | `FeedSummary`, `FeedStatus`, `FeedType` types |
| Create | `frontend/src/styles/feeds-tokens.css` | Warm cream/charcoal CSS custom properties |
| Create | `frontend/src/components/ui/toast-provider.tsx` | Toast context + host (no external lib) |
| Create | `frontend/src/components/feeds/FeedTypeBadge.tsx` | Colored 32×32 type icon chip |
| Create | `frontend/src/components/feeds/FeedStatusBadge.tsx` | Status pill with dot |
| Create | `frontend/src/components/feeds/FeedTagEditor.tsx` | Inline add/remove tag editor |
| Create | `frontend/src/components/feeds/ScrollableFilterRow.tsx` | Horizontally scrollable filter row with arrow controls |
| Create | `frontend/src/components/feeds/FeedActionsMenu.tsx` | ⋯ dropdown action menu |
| Create | `frontend/src/components/feeds/FeedCard.tsx` | Full feed card with meta grid, format picker, footer |
| Create | `frontend/src/components/feeds/FeedTable.tsx` | Dense 8-column table view |
| Create | `frontend/src/components/feeds/FeedDetailDrawer.tsx` | Right-rail slide-in drawer |
| Create | `frontend/src/pages/MyFeedsPage.tsx` | Top-level page: state, filtering, fetch, layout |
| Delete | `frontend/src/pages/ActiveFeedsPage.tsx` | Replaced by MyFeedsPage |
| Modify | `frontend/src/App.tsx` | Swap import + route |
| Modify | `frontend/src/components/layout/Header.tsx` | Rename nav link label |

---

### Task 1: Shared frontend types + CSS tokens

**Files:**
- Create: `frontend/src/types/feed-summary.ts`
- Create: `frontend/src/styles/feeds-tokens.css`

- [ ] **Step 1: Create `feed-summary.ts`**

```ts
// frontend/src/types/feed-summary.ts
export type FeedStatus =
  | "healthy"
  | "warning"
  | "error"
  | "disabled"
  | "neverRun"
  | "running";

export type FeedType =
  | "scrape"
  | "rest"
  | "graphql"
  | "email"
  | "calendar"
  | "sitemap"
  | "filesystem"
  | "webhook";

export type FeedSummary = {
  id: string;
  filename: string;
  title: string;
  description?: string;
  type: FeedType;
  category?: string;
  sourceUrl: string;
  sourceMethod?: string;
  publicFeedUrl: string;
  enabled: boolean;
  favorite: boolean;
  tags: string[];
  status: FeedStatus;
  statusDetail?: string;
  refreshMinutes?: number | null;
  lastRunAt?: string;
  lastRunRelative?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastItemCount?: number | null;
  lastNewItemCount?: number;
  secrets: { protected: boolean; env: boolean; plain: boolean };
  origin: { type: "local" | "community"; catalogId?: string };
};
```

- [ ] **Step 2: Create `feeds-tokens.css`**

```css
/* frontend/src/styles/feeds-tokens.css */
/* Bridges prototype token aliases to shadcn default blue-gray variables.
   No custom palette — structural tokens alias shadcn's own CSS properties. */
:root {
  /* Structural aliases → shadcn default blue-gray */
  --bg:          hsl(var(--background));
  --bg-sunken:   hsl(var(--muted));
  --bg-elevated: hsl(var(--card));
  --ink:         hsl(var(--foreground));
  --ink-2:       hsl(var(--foreground));
  --ink-3:       hsl(var(--muted-foreground));
  --ink-4:       hsl(var(--muted-foreground));
  --line:        hsl(var(--border));
  --line-strong: hsl(var(--border));
  --brand:       hsl(var(--primary));
  --brand-ink:   hsl(var(--primary));
  --brand-soft:  hsl(var(--primary) / 0.12);

  /* Semantic status colors */
  --ok:       #15803d; --ok-ink:   #14532d; --ok-soft:  #dcf3e3;
  --warn:     #b45309; --warn-ink: #78350f; --warn-soft:#fdecc8;
  --err:      #b91c1c; --err-ink:  #7f1d1d; --err-soft: #fadcd9;
  --info:     #1d4ed8; --info-ink: #1e40af; --info-soft:#dde6fb;
  --purple:   #6d28d9; --purple-soft: #ede4fc;

  /* Feeds utility */
  --feeds-radius:    10px;
  --feeds-radius-sm:  6px;
  --feeds-radius-lg: 14px;
  --feeds-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --shadow-1:   0 1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-2:   0 1px 0 rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.12);
  --shadow-pop: 0 1px 0 rgba(0,0,0,0.04), 0 18px 48px -16px rgba(0,0,0,0.16);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/feed-summary.ts frontend/src/styles/feeds-tokens.css
git commit -m "feat: add FeedSummary types and feeds CSS token layer"
```

---

### Task 2: `config-manager.utility.ts` (TDD)

**Files:**
- Create: `utilities/config-manager.utility.ts`
- Create: `tests/config-manager.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/config-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  listFeedConfigs,
  readFeedConfig,
  writeFeedConfig,
  deleteFeedConfig,
  duplicateFeedConfig,
  exportFeedConfig,
  safeFeedId,
} from "../utilities/config-manager.utility";

const TEST_DIR = "./test-configs-tmp";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "my-feed.yaml"), "feedId: my-feed\nfeedName: My Feed\nfeedType: webScraping\n");
  writeFileSync(join(TEST_DIR, "other-feed.yaml"), "feedId: other-feed\nfeedName: Other\nfeedType: rest\n");
  writeFileSync(join(TEST_DIR, "notayaml.txt"), "ignored");
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("listFeedConfigs", () => {
  it("returns only .yaml files", async () => {
    const list = await listFeedConfigs(TEST_DIR);
    expect(list.length).toBe(2);
    expect(list.every(f => f.filename.endsWith(".yaml"))).toBe(true);
  });
  it("derives id from filename", async () => {
    const list = await listFeedConfigs(TEST_DIR);
    const ids = list.map(f => f.id).sort();
    expect(ids).toEqual(["my-feed", "other-feed"]);
  });
});

describe("readFeedConfig", () => {
  it("parses YAML into object", async () => {
    const config = await readFeedConfig("my-feed", TEST_DIR);
    expect(config.feedId).toBe("my-feed");
    expect(config.feedType).toBe("webScraping");
  });
  it("throws on missing config", async () => {
    expect(readFeedConfig("nonexistent", TEST_DIR)).rejects.toThrow();
  });
});

describe("writeFeedConfig", () => {
  it("writes YAML file", async () => {
    await writeFeedConfig("new-feed", { feedId: "new-feed", feedName: "New", feedType: "email" } as any, TEST_DIR);
    const back = await readFeedConfig("new-feed", TEST_DIR);
    expect(back.feedId).toBe("new-feed");
  });
});

describe("deleteFeedConfig", () => {
  it("removes the YAML file", async () => {
    await deleteFeedConfig("my-feed", TEST_DIR);
    expect(existsSync(join(TEST_DIR, "my-feed.yaml"))).toBe(false);
  });
  it("throws on missing config", async () => {
    expect(deleteFeedConfig("ghost", TEST_DIR)).rejects.toThrow();
  });
});

describe("duplicateFeedConfig", () => {
  it("creates a -copy file", async () => {
    const result = await duplicateFeedConfig("my-feed", TEST_DIR);
    expect(result.id).toBe("my-feed-copy");
    expect(existsSync(join(TEST_DIR, "my-feed-copy.yaml"))).toBe(true);
  });
  it("avoids collision with -copy-2", async () => {
    await duplicateFeedConfig("my-feed", TEST_DIR);
    const result = await duplicateFeedConfig("my-feed", TEST_DIR);
    expect(result.id).toBe("my-feed-copy-2");
  });
});

describe("exportFeedConfig", () => {
  it("returns raw YAML string", async () => {
    const yaml = await exportFeedConfig("my-feed", TEST_DIR);
    expect(yaml).toContain("feedId: my-feed");
  });
});

describe("safeFeedId", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(safeFeedId("My Feed Name")).toBe("my-feed-name");
  });
  it("strips disallowed characters", () => {
    expect(safeFeedId("feed/../../etc")).toBe("feed-etc");
  });
  it("strips .yaml extension", () => {
    expect(safeFeedId("foo.yaml")).toBe("foo");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
bun test tests/config-manager.test.ts 2>&1 | head -20
```

Expected: module not found errors.

- [ ] **Step 3: Implement `config-manager.utility.ts`**

```ts
// utilities/config-manager.utility.ts
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import * as yaml from "js-yaml";
import type { FeedConfig } from "../models/feed-config.model";

const DEFAULT_CONFIGS_DIR = join(__dirname, "../configs");

export async function listFeedConfigs(
  dir: string = DEFAULT_CONFIGS_DIR
): Promise<{ id: string; filename: string }[]> {
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => ({ id: f.replace(/\.yaml$/, ""), filename: f }));
}

export async function readFeedConfig(
  id: string,
  dir: string = DEFAULT_CONFIGS_DIR
): Promise<FeedConfig> {
  assertSafeFeedId(id);
  const path = join(dir, `${id}.yaml`);
  if (!existsSync(path)) throw new Error(`Feed config not found: ${id}`);
  const raw = await readFile(path, "utf8");
  return yaml.load(raw) as FeedConfig;
}

export async function writeFeedConfig(
  id: string,
  config: FeedConfig,
  dir: string = DEFAULT_CONFIGS_DIR
): Promise<void> {
  assertSafeFeedId(id);
  const path = join(dir, `${id}.yaml`);
  await writeFile(path, yaml.dump(config), "utf8");
}

export async function deleteFeedConfig(
  id: string,
  dir: string = DEFAULT_CONFIGS_DIR
): Promise<void> {
  assertSafeFeedId(id);
  const path = join(dir, `${id}.yaml`);
  if (!existsSync(path)) throw new Error(`Feed config not found: ${id}`);
  await unlink(path);
}

export async function duplicateFeedConfig(
  id: string,
  dir: string = DEFAULT_CONFIGS_DIR
): Promise<{ id: string; filename: string }> {
  const config = await readFeedConfig(id, dir);
  let newId = `${id}-copy`;
  let counter = 2;
  while (existsSync(join(dir, `${newId}.yaml`))) {
    newId = `${id}-copy-${counter++}`;
  }
  const newConfig = { ...config, feedId: newId, feedName: `${(config as any).feedName} (copy)` };
  await writeFeedConfig(newId, newConfig as FeedConfig, dir);
  return { id: newId, filename: `${newId}.yaml` };
}

export async function exportFeedConfig(
  id: string,
  dir: string = DEFAULT_CONFIGS_DIR
): Promise<string> {
  assertSafeFeedId(id);
  const path = join(dir, `${id}.yaml`);
  if (!existsSync(path)) throw new Error(`Feed config not found: ${id}`);
  return readFile(path, "utf8");
}

export function safeFeedId(raw: string): string {
  return raw
    .replace(/\.yaml$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function assertSafeFeedId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid feedId: ${id}`);
  }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
bun test tests/config-manager.test.ts
```

Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add utilities/config-manager.utility.ts tests/config-manager.test.ts
git commit -m "feat: add config-manager utility (TDD)"
```

---

### Task 3: `config-metadata.utility.ts` (TDD)

**Files:**
- Create: `utilities/config-metadata.utility.ts`
- Create: `tests/config-metadata.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/config-metadata.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeMetadata,
  patchMetadata,
  patchEnabled,
  detectPlainSensitive,
} from "../utilities/config-metadata.utility";

const TEST_DIR = "./test-meta-tmp";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(
    join(TEST_DIR, "feed-a.yaml"),
    "feedId: feed-a\nfeedName: Feed A\nfeedType: webScraping\nconfig:\n  baseUrl: https://example.com\n"
  );
  writeFileSync(
    join(TEST_DIR, "plain-secret.yaml"),
    "feedId: ps\nfeedName: PS\nfeedType: rest\nconfig:\n  headers:\n    Authorization: Bearer hardcoded-token\n"
  );
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("normalizeMetadata", () => {
  it("adds empty metadata block when missing", () => {
    const config: any = { feedId: "x", feedName: "X", feedType: "webScraping" };
    const result = normalizeMetadata(config);
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.tags).toEqual([]);
    expect(result.metadata!.favorite).toBe(false);
  });
  it("preserves existing metadata fields", () => {
    const config: any = { feedId: "x", metadata: { tags: ["a"], favorite: true } };
    const result = normalizeMetadata(config);
    expect(result.metadata!.tags).toEqual(["a"]);
    expect(result.metadata!.favorite).toBe(true);
  });
});

describe("patchMetadata", () => {
  it("updates tags without destroying config", async () => {
    const result = await patchMetadata("feed-a", { tags: ["gov", "local"] }, TEST_DIR);
    expect(result.metadata!.tags).toEqual(["gov", "local"]);
    expect((result as any).feedId).toBe("feed-a");
    expect((result as any).config?.baseUrl).toBe("https://example.com");
  });
  it("updates category", async () => {
    const result = await patchMetadata("feed-a", { category: "civic" }, TEST_DIR);
    expect(result.metadata!.category).toBe("civic");
  });
  it("updates favorite", async () => {
    const result = await patchMetadata("feed-a", { favorite: true }, TEST_DIR);
    expect(result.metadata!.favorite).toBe(true);
  });
});

describe("patchEnabled", () => {
  it("sets enabled to false", async () => {
    const result = await patchEnabled("feed-a", false, TEST_DIR);
    expect((result as any).enabled).toBe(false);
  });
  it("sets enabled to true", async () => {
    await patchEnabled("feed-a", false, TEST_DIR);
    const result = await patchEnabled("feed-a", true, TEST_DIR);
    expect((result as any).enabled).toBe(true);
  });
});

describe("detectPlainSensitive", () => {
  it("detects plain Authorization header", async () => {
    const config = await import("../utilities/config-manager.utility")
      .then(m => m.readFeedConfig("plain-secret", TEST_DIR));
    expect(detectPlainSensitive(config as any)).toBe(true);
  });
  it("returns false for clean config", async () => {
    const config = await import("../utilities/config-manager.utility")
      .then(m => m.readFeedConfig("feed-a", TEST_DIR));
    expect(detectPlainSensitive(config as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
bun test tests/config-metadata.test.ts 2>&1 | head -20
```

Expected: module not found.

- [ ] **Step 3: Implement `config-metadata.utility.ts`**

```ts
// utilities/config-metadata.utility.ts
import * as yaml from "js-yaml";
import { readFeedConfig, writeFeedConfig } from "./config-manager.utility";
import type { FeedConfig } from "../models/feed-config.model";
import type { FeedMetadata } from "../models/feed-metadata.model";

const SENSITIVE_KEYS = /password|token|secret|authorization|api[_-]?key|bearer/i;
const DEFAULT_CONFIGS_DIR = require("node:path").join(__dirname, "../configs");

export function normalizeMetadata(config: any): any {
  const meta = config.metadata ?? {};
  return {
    ...config,
    metadata: {
      tags: [],
      favorite: false,
      ...meta,
    },
  };
}

export async function patchMetadata(
  id: string,
  patch: Partial<FeedMetadata>,
  dir: string = DEFAULT_CONFIGS_DIR
): Promise<any> {
  const config = await readFeedConfig(id, dir);
  const normalized = normalizeMetadata(config);
  const updated = {
    ...normalized,
    metadata: { ...normalized.metadata, ...patch },
  };
  await writeFeedConfig(id, updated as FeedConfig, dir);
  return updated;
}

export async function patchEnabled(
  id: string,
  enabled: boolean,
  dir: string = DEFAULT_CONFIGS_DIR
): Promise<any> {
  const config = await readFeedConfig(id, dir);
  const updated = { ...config, enabled };
  await writeFeedConfig(id, updated as FeedConfig, dir);
  return updated;
}

export function detectPlainSensitive(config: any): boolean {
  const str = JSON.stringify(config);
  const parsed = JSON.parse(str);
  return checkObject(parsed);
}

function checkObject(obj: any): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key) && typeof val === "string" && val.length > 0) {
      return true;
    }
    if (typeof val === "object" && checkObject(val)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
bun test tests/config-metadata.test.ts
```

Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add utilities/config-metadata.utility.ts tests/config-metadata.test.ts
git commit -m "feat: add config-metadata utility (TDD)"
```

---

### Task 4: `feed-summary.utility.ts` (TDD)

**Files:**
- Create: `utilities/feed-summary.utility.ts`
- Create: `tests/feed-summary.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/feed-summary.test.ts
import { describe, it, expect } from "bun:test";
import {
  normalizeFeedType,
  detectSecrets,
  buildFeedSummary,
  toRelative,
} from "../utilities/feed-summary.utility";

describe("normalizeFeedType", () => {
  it("maps webScraping -> scrape", () => expect(normalizeFeedType("webScraping")).toBe("scrape"));
  it("maps api -> rest", () => expect(normalizeFeedType("api")).toBe("rest"));
  it("maps rest -> rest", () => expect(normalizeFeedType("rest")).toBe("rest"));
  it("maps email -> email", () => expect(normalizeFeedType("email")).toBe("email"));
  it("maps graphql -> graphql", () => expect(normalizeFeedType("graphql")).toBe("graphql"));
  it("maps calendar -> calendar", () => expect(normalizeFeedType("calendar")).toBe("calendar"));
  it("maps sitemap -> sitemap", () => expect(normalizeFeedType("sitemap")).toBe("sitemap"));
  it("maps filesystem -> filesystem", () => expect(normalizeFeedType("filesystem")).toBe("filesystem"));
  it("maps webhook -> webhook", () => expect(normalizeFeedType("webhook")).toBe("webhook"));
  it("unknown type falls back to scrape", () => expect(normalizeFeedType("unknown")).toBe("scrape"));
});

describe("detectSecrets", () => {
  it("detects protected value", () => {
    const config: any = { config: { headers: { Authorization: { type: "protected", value: "x" } } } };
    expect(detectSecrets(config).protected).toBe(true);
  });
  it("detects env var", () => {
    const config: any = { config: { headers: { Authorization: { type: "env", key: "API_KEY" } } } };
    expect(detectSecrets(config).env).toBe(true);
  });
  it("detects plain sensitive value", () => {
    const config: any = { config: { headers: { Authorization: "Bearer hardcoded" } } };
    expect(detectSecrets(config).plain).toBe(true);
  });
  it("returns all false for clean config", () => {
    const config: any = { config: { baseUrl: "https://example.com" } };
    const s = detectSecrets(config);
    expect(s.protected).toBe(false);
    expect(s.env).toBe(false);
    expect(s.plain).toBe(false);
  });
});

describe("buildFeedSummary", () => {
  const file = { id: "my-feed", filename: "my-feed.yaml" };
  const config: any = {
    feedId: "my-feed",
    feedName: "My Feed",
    feedType: "webScraping",
    enabled: true,
    refreshTime: 60,
    config: { baseUrl: "https://example.com/news" },
  };

  it("returns neverRun when no run log", () => {
    const s = buildFeedSummary(file, config);
    expect(s.status).toBe("neverRun");
    expect(s.lastRunAt).toBeUndefined();
  });

  it("returns error when last run was error", () => {
    const run: any = { feedId: "my-feed", status: "error", startedAt: Date.now() - 60000, itemCount: 0, prevItemCount: 0, errorMessage: "timeout" };
    const s = buildFeedSummary(file, config, run);
    expect(s.status).toBe("error");
    expect(s.statusDetail).toBe("timeout");
  });

  it("returns healthy when last run was success", () => {
    const run: any = { feedId: "my-feed", status: "success", startedAt: Date.now() - 60000, itemCount: 10, prevItemCount: 8 };
    const s = buildFeedSummary(file, config, run);
    expect(s.status).toBe("healthy");
    expect(s.lastNewItemCount).toBe(2);
  });

  it("returns disabled when enabled=false", () => {
    const disabledConfig = { ...config, enabled: false };
    const run: any = { feedId: "my-feed", status: "success", startedAt: Date.now() - 60000, itemCount: 5, prevItemCount: 5 };
    const s = buildFeedSummary(file, disabledConfig, run);
    expect(s.status).toBe("disabled");
  });

  it("maps sourceUrl from config.baseUrl for webScraping", () => {
    const s = buildFeedSummary(file, config);
    expect(s.sourceUrl).toBe("https://example.com/news");
  });

  it("uses metadata.title when present", () => {
    const configWithMeta = { ...config, metadata: { title: "Custom Title", tags: [], favorite: false } };
    const s = buildFeedSummary(file, configWithMeta);
    expect(s.title).toBe("Custom Title");
  });
});

describe("toRelative", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(toRelative(new Date(Date.now() - 30000).toISOString())).toBe("just now");
  });
  it("returns minutes ago", () => {
    expect(toRelative(new Date(Date.now() - 5 * 60 * 1000).toISOString())).toBe("5 min ago");
  });
  it("returns hours ago", () => {
    expect(toRelative(new Date(Date.now() - 2 * 3600 * 1000).toISOString())).toBe("2 h ago");
  });
  it("returns days ago", () => {
    expect(toRelative(new Date(Date.now() - 3 * 86400 * 1000).toISOString())).toBe("3 days ago");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
bun test tests/feed-summary.test.ts 2>&1 | head -20
```

- [ ] **Step 3: Implement `feed-summary.utility.ts`**

```ts
// utilities/feed-summary.utility.ts
import type { FeedSummary, FeedStatus, FeedType } from "../frontend/src/types/feed-summary";
import type { RunLog } from "../lib/analytics/schema";
import { detectPlainSensitive } from "./config-metadata.utility";

const FEED_TYPE_MAP: Record<string, FeedType> = {
  webScraping: "scrape",
  api:         "rest",
  rest:        "rest",
  email:       "email",
  graphql:     "graphql",
  calendar:    "calendar",
  sitemap:     "sitemap",
  filesystem:  "filesystem",
  webhook:     "webhook",
  feedTransformer: "scrape",
};

export function normalizeFeedType(yamlType: string): FeedType {
  return FEED_TYPE_MAP[yamlType] ?? "scrape";
}

export function toRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days  = Math.floor(ms / 86_400_000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} h ago`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function detectSecrets(config: any): { protected: boolean; env: boolean; plain: boolean } {
  const str = JSON.stringify(config);
  const obj = JSON.parse(str);

  let hasProtected = false;
  let hasEnv = false;

  function walk(o: any) {
    if (typeof o !== "object" || o === null) return;
    if (o.type === "protected") { hasProtected = true; return; }
    if (o.type === "env") { hasEnv = true; return; }
    for (const v of Object.values(o)) walk(v);
  }
  walk(obj);

  return { protected: hasProtected, env: hasEnv, plain: detectPlainSensitive(config) };
}

function deriveSourceUrl(config: any): { sourceUrl: string; sourceMethod?: string } {
  const c = config.config ?? {};
  const type = config.feedType;
  if (type === "webScraping" || type === "sitemap" || type === "calendar") {
    return { sourceUrl: c.baseUrl ?? c.url ?? "" };
  }
  if (type === "api" || type === "rest") {
    const url = c.baseUrl + (c.route ? c.route : "");
    return { sourceUrl: url, sourceMethod: (c.method ?? "GET").toUpperCase() };
  }
  if (type === "graphql") {
    return { sourceUrl: c.endpoint ?? c.baseUrl ?? "", sourceMethod: "POST" };
  }
  if (type === "email") {
    const host = c.host ?? c.imap?.host ?? "";
    const folder = c.folder ?? "INBOX";
    return { sourceUrl: `${host} / ${folder}` };
  }
  if (type === "filesystem") {
    return { sourceUrl: c.watchPath ?? c.path ?? "/app/watch" };
  }
  if (type === "webhook") {
    return { sourceUrl: c.path ?? `/webhook-feeds/${config.feedId}` };
  }
  return { sourceUrl: c.baseUrl ?? c.url ?? "" };
}

export function buildFeedSummary(
  file: { id: string; filename: string },
  config: any,
  lastRun?: RunLog
): FeedSummary {
  const enabled = config.enabled !== false;
  const meta = config.metadata ?? {};

  let status: FeedStatus;
  let statusDetail: string | undefined;

  if (!enabled) {
    status = "disabled";
  } else if (!lastRun) {
    status = "neverRun";
  } else if (lastRun.status === "error") {
    status = "error";
    statusDetail = lastRun.errorMessage ?? undefined;
  } else {
    const secrets = detectSecrets(config);
    status = secrets.plain ? "warning" : "healthy";
    if (secrets.plain) statusDetail = "Password stored as plain string in config.";
  }

  const lastRunAt = lastRun ? new Date(lastRun.startedAt).toISOString() : undefined;
  const lastRunRelative = lastRunAt ? toRelative(lastRunAt) : undefined;
  const lastItemCount = lastRun?.itemCount ?? null;
  const lastNewItemCount = lastRun?.itemCount != null && lastRun?.prevItemCount != null
    ? Math.max(0, lastRun.itemCount - lastRun.prevItemCount)
    : 0;

  const { sourceUrl, sourceMethod } = deriveSourceUrl(config);

  return {
    id:             file.id,
    filename:       file.filename,
    title:          meta.title ?? config.feedName ?? file.id,
    description:    meta.description,
    type:           normalizeFeedType(config.feedType),
    category:       meta.category,
    sourceUrl,
    sourceMethod,
    publicFeedUrl:  `/feeds/${file.id}`,
    enabled,
    favorite:       meta.favorite ?? false,
    tags:           meta.tags ?? [],
    status,
    statusDetail,
    refreshMinutes: config.refreshTime ?? null,
    lastRunAt,
    lastRunRelative,
    lastItemCount,
    lastNewItemCount,
    secrets:        detectSecrets(config),
    origin: {
      type: meta.origin?.type === "community" ? "community" : "local",
      catalogId: meta.origin?.catalogId,
    },
  };
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
bun test tests/feed-summary.test.ts
```

Expected: 17 passing.

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-summary.utility.ts tests/feed-summary.test.ts
git commit -m "feat: add feed-summary utility (TDD)"
```

---

### Task 5: Backend routes

**Files:**
- Modify: `index.ts`

The existing `GET /api/feeds` (around line 1149) is replaced. Four routes are added after it.

- [ ] **Step 1: Add imports near the top of `index.ts`** (after existing imports)

```ts
import { listFeedConfigs, readFeedConfig, deleteFeedConfig, duplicateFeedConfig, exportFeedConfig } from "./utilities/config-manager.utility";
import { patchMetadata, patchEnabled } from "./utilities/config-metadata.utility";
import { buildFeedSummary } from "./utilities/feed-summary.utility";
```

- [ ] **Step 2: Replace `GET /api/feeds` implementation**

Find the existing block (starts at `app.get("/api/feeds", async (ctx) =>`) and replace it entirely:

```ts
app.get("/api/feeds", async (ctx) => {
  const sqlite = getDb();
  const db = drizzle(sqlite, { schema: analyticsSchema });

  const files = await listFeedConfigs();
  const feedIds = files.map((f) => f.id);

  const allRuns = feedIds.length
    ? await db
        .select()
        .from(analyticsSchema.runLogs)
        .where(inArray(analyticsSchema.runLogs.feedId, feedIds))
        .orderBy(desc(analyticsSchema.runLogs.startedAt))
    : [];

  const lastRunMap = new Map<string, typeof allRuns[0]>();
  for (const run of allRuns) {
    if (!lastRunMap.has(run.feedId)) lastRunMap.set(run.feedId, run);
  }

  const summaries = await Promise.all(
    files.map(async (file) => {
      const config = await readFeedConfig(file.id);
      return buildFeedSummary(file, config, lastRunMap.get(file.id));
    })
  );

  return ctx.json({ feeds: summaries });
});
```

- [ ] **Step 3: Add `PATCH /api/feeds/:id/metadata`** (after the GET route)

```ts
app.patch("/api/feeds/:id/metadata", async (ctx) => {
  const id = ctx.req.param("id");
  const body = await ctx.req.json();
  const allowed = ["title", "description", "tags", "category", "favorite"];
  const patch = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );
  const updated = await patchMetadata(id, patch);
  return ctx.json(updated);
});
```

- [ ] **Step 4: Add `PATCH /api/feeds/:id/enabled`**

```ts
app.patch("/api/feeds/:id/enabled", async (ctx) => {
  const id = ctx.req.param("id");
  const { enabled } = await ctx.req.json<{ enabled: boolean }>();
  const updated = await patchEnabled(id, !!enabled);
  return ctx.json(updated);
});
```

- [ ] **Step 5: Add `POST /api/feeds/:id/duplicate`**

```ts
app.post("/api/feeds/:id/duplicate", async (ctx) => {
  const id = ctx.req.param("id");
  const result = await duplicateFeedConfig(id);
  return ctx.json(result, 201);
});
```

- [ ] **Step 6: Add `GET /api/feeds/:id/export`**

```ts
app.get("/api/feeds/:id/export", async (ctx) => {
  const id = ctx.req.param("id");
  const yamlStr = await exportFeedConfig(id);
  ctx.header("Content-Type", "application/x-yaml");
  ctx.header("Content-Disposition", `attachment; filename="${id}.yaml"`);
  return ctx.body(yamlStr);
});
```

- [ ] **Step 7: Add `DELETE /api/feeds/:id`**

```ts
app.delete("/api/feeds/:id", async (ctx) => {
  const id = ctx.req.param("id");
  await deleteFeedConfig(id);
  return ctx.body(null, 204);
});
```

- [ ] **Step 8: Add `inArray` to existing drizzle import** (it may already be there — check line ~28)

The line `import { sql, and, eq, gte, lte, desc } from "drizzle-orm";` should include `inArray`. If missing, add it:

```ts
import { sql, and, eq, gte, lte, desc, inArray } from "drizzle-orm";
```

- [ ] **Step 9: Smoke-test the new routes**

```bash
bun run index.ts &
sleep 2
curl -s http://localhost:3000/api/feeds | head -100
kill %1
```

Expected: JSON with `{ feeds: [...] }` array (may be empty if no configs exist yet).

- [ ] **Step 10: Commit**

```bash
git add index.ts
git commit -m "feat: expand GET /api/feeds and add metadata/enabled/duplicate/export/delete routes"
```

---

### Task 6: Toast system + primitive badges

**Files:**
- Create: `frontend/src/components/ui/toast-provider.tsx`
- Create: `frontend/src/components/feeds/FeedTypeBadge.tsx`
- Create: `frontend/src/components/feeds/FeedStatusBadge.tsx`

- [ ] **Step 1: Create `toast-provider.tsx`**

```tsx
// frontend/src/components/ui/toast-provider.tsx
import React, { createContext, useCallback, useContext, useState } from "react";

type ToastTone = "ok" | "err" | "warn" | "";

type Toast = {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  ms?: number;
};

type ToastCtx = {
  push: (t: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((a) => a.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((a) => [...a, { id, ...t }]);
      const ms = t.ms !== 0 ? (t.ms ?? 4200) : null;
      if (ms !== null) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss]
  );

  return (
    <Ctx.Provider value={{ push, dismiss }}>
      {children}
      <div style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 10, zIndex: 100 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            display: "grid", gridTemplateColumns: "1fr auto", gap: 10,
            background: t.tone === "ok" ? "#166534" : t.tone === "err" ? "#991b1b" : t.tone === "warn" ? "#92400e" : "hsl(var(--foreground))",
            color: "#fff", padding: "12px 14px", borderRadius: 10,
            fontSize: 13, minWidth: 300, maxWidth: 400, boxShadow: "var(--shadow-pop)",
          }}>
            <div>
              <strong style={{ display: "block", marginBottom: 2 }}>{t.title}</strong>
              {t.body && <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{t.body}</span>}
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                  style={{ marginTop: 6, background: "rgba(255,255,255,0.15)", border: 0, color: "#fff", fontSize: 12, padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontWeight: 500 }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} style={{ background: "transparent", border: 0, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px", alignSelf: "start" }}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
```

- [ ] **Step 2: Create `FeedTypeBadge.tsx`**

```tsx
// frontend/src/components/feeds/FeedTypeBadge.tsx
import type { FeedType } from "@/types/feed-summary";

const TYPE_META: Record<FeedType, { label: string; bg: string; color: string; border: string }> = {
  scrape:     { label: "Web Scraping", bg: "#fff1e8", color: "#c2410c", border: "#fcd9b8" },
  rest:       { label: "REST API",     bg: "var(--info-soft)", color: "var(--info-ink)", border: "#c9d6f7" },
  graphql:    { label: "GraphQL",      bg: "#fce7f6", color: "#9d174d", border: "#f7c7e3" },
  email:      { label: "Email",        bg: "var(--ok-soft)",  color: "var(--ok-ink)",  border: "#bce4c9" },
  calendar:   { label: "Calendar",     bg: "#e2eafc", color: "#1e3a8a", border: "#c4d2f4" },
  sitemap:    { label: "Sitemap",      bg: "#ede7d8", color: "#57534e", border: "#d6cdb4" },
  filesystem: { label: "Filesystem",   bg: "var(--warn-soft)", color: "var(--warn-ink)", border: "#f1d699" },
  webhook:    { label: "Webhook",      bg: "var(--purple-soft)", color: "var(--purple)", border: "#d9c8f3" },
};

const TYPE_ICONS: Record<FeedType, React.ReactNode> = {
  scrape: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>,
  rest: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6M14 4l-4 16"/></svg>,
  graphql: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 5.25v7.5L12 21l-9-5.25v-7.5L12 3z"/><path d="M3 8.25L12 21M21 8.25L12 21M3 8.25h18"/></svg>,
  email: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>,
  sitemap: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>,
  filesystem: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>,
  webhook: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 18h7M16.5 8l-4 7M9 16l-1-4 4-3"/></svg>,
};

type Props = { type: FeedType; size?: number; className?: string };

export function FeedTypeBadge({ type, size = 32, className = "" }: Props) {
  const meta = TYPE_META[type] ?? TYPE_META.scrape;
  return (
    <span
      className={className}
      style={{
        width: size, height: size, borderRadius: 8, display: "grid", placeItems: "center",
        background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
        flexShrink: 0,
      }}
    >
      <span style={{ width: size * 0.5, height: size * 0.5, display: "block" }}>
        {TYPE_ICONS[type]}
      </span>
    </span>
  );
}

export { TYPE_META };
```

- [ ] **Step 3: Create `FeedStatusBadge.tsx`**

```tsx
// frontend/src/components/feeds/FeedStatusBadge.tsx
import type { FeedStatus } from "@/types/feed-summary";

const STATUS_META: Record<FeedStatus, { label: string; bg: string; color: string }> = {
  healthy:  { label: "Healthy",   bg: "var(--ok-soft)",   color: "var(--ok-ink)" },
  warning:  { label: "Warning",   bg: "var(--warn-soft)", color: "var(--warn-ink)" },
  error:    { label: "Failing",   bg: "var(--err-soft)",  color: "var(--err-ink)" },
  disabled: { label: "Disabled",  bg: "var(--bg-sunken)", color: "var(--ink-3)" },
  neverRun: { label: "Never run", bg: "var(--info-soft)", color: "var(--info-ink)" },
  running:  { label: "Running",   bg: "var(--info-soft)", color: "var(--info-ink)" },
};

export function FeedStatusBadge({ status }: { status: FeedStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.neverRun;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 8px",
      borderRadius: 999, fontSize: 11, fontWeight: 500, background: m.bg, color: m.color,
      whiteSpace: "nowrap", fontFamily: "var(--feeds-font-mono)",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
      {m.label}
    </span>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/toast-provider.tsx frontend/src/components/feeds/FeedTypeBadge.tsx frontend/src/components/feeds/FeedStatusBadge.tsx
git commit -m "feat: add toast system and FeedTypeBadge/FeedStatusBadge"
```

---

### Task 7: `FeedTagEditor` + `ScrollableFilterRow`

**Files:**
- Create: `frontend/src/components/feeds/FeedTagEditor.tsx`
- Create: `frontend/src/components/feeds/ScrollableFilterRow.tsx`

- [ ] **Step 1: Create `FeedTagEditor.tsx`**

```tsx
// frontend/src/components/feeds/FeedTagEditor.tsx
import { useEffect, useRef, useState } from "react";

type Props = { tags: string[]; onChange: (tags: string[]) => void };

export function FeedTagEditor({ tags, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    const t = val.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setVal("");
    setEditing(false);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {tags.map((t) => (
        <span key={t} className="feeds-tag">
          {t}
          <span
            className="feeds-tag-x"
            onClick={(e) => { e.stopPropagation(); onChange(tags.filter((x) => x !== t)); }}
            title="Remove tag"
          >
            ×
          </span>
        </span>
      ))}
      {editing ? (
        <input
          ref={inputRef}
          className="feeds-tag-input"
          value={val}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setVal(""); setEditing(false); }
          }}
          onBlur={commit}
          placeholder="tag"
        />
      ) : (
        <button
          className="feeds-tag-add"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title="Add tag"
        >
          +
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `ScrollableFilterRow.tsx`**

```tsx
// frontend/src/components/feeds/ScrollableFilterRow.tsx
import { useCallback, useEffect, useRef, useState } from "react";

type Props = { label: string; children: React.ReactNode };

export function ScrollableFilterRow({ label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanL(el.scrollLeft > 4);
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    const t = setTimeout(update, 50);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
      clearTimeout(t);
    };
  }, [update, children]);

  const scroll = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
      <span style={{ fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-4)", fontWeight: 600, width: 46, flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ position: "relative", flex: 1, minWidth: 0, overflow: "hidden" }}>
        {canL && (
          <button onClick={() => scroll(-1)} aria-label="Scroll left" style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", zIndex: 2, width: 26, height: 26, borderRadius: 999, background: "var(--bg-elevated)", border: "1px solid var(--line-strong)", color: "var(--ink-2)", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "var(--shadow-1)" }}>‹</button>
        )}
        <div ref={ref} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", overflowX: "auto", scrollbarWidth: "none", padding: "2px 0", scrollBehavior: "smooth" }}>
          {children}
        </div>
        {canR && (
          <button onClick={() => scroll(1)} aria-label="Scroll right" style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", zIndex: 2, width: 26, height: 26, borderRadius: 999, background: "var(--bg-elevated)", border: "1px solid var(--line-strong)", color: "var(--ink-2)", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "var(--shadow-1)" }}>›</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/feeds/FeedTagEditor.tsx frontend/src/components/feeds/ScrollableFilterRow.tsx
git commit -m "feat: add FeedTagEditor and ScrollableFilterRow"
```

---

### Task 8: `FeedActionsMenu`

**Files:**
- Create: `frontend/src/components/feeds/FeedActionsMenu.tsx`

- [ ] **Step 1: Create `FeedActionsMenu.tsx`**

```tsx
// frontend/src/components/feeds/FeedActionsMenu.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedSummary } from "@/types/feed-summary";

type Props = {
  feed: FeedSummary;
  onAction: (action: string) => void;
};

export function FeedActionsMenu({ feed, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open, close]);

  const item = (id: string, label: string, danger = false) => (
    <button
      key={id}
      onClick={(e) => { e.stopPropagation(); setOpen(false); onAction(id); }}
      style={{ display: "flex", width: "100%", alignItems: "center", padding: "7px 9px", borderRadius: 6, border: 0, background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: danger ? "var(--err)" : "var(--ink-2)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? "var(--err-soft)" : "var(--bg-sunken)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="More actions"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, border: "1px solid transparent", background: "transparent", cursor: "pointer", color: "var(--ink-3)", fontSize: 18 }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-sunken)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        ⋯
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", minWidth: 200, background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow-pop)", padding: 4, zIndex: 30 }}
        >
          {item("open", "Open RSS")}
          {item("copy", "Copy feed URL")}
          {item("preview", "Preview")}
          <hr style={{ margin: "4px 0", border: 0, borderTop: "1px solid var(--line)" }} />
          {item("edit", "Edit config")}
          {item("duplicate", "Duplicate")}
          {item("export", "Export YAML")}
          <hr style={{ margin: "4px 0", border: 0, borderTop: "1px solid var(--line)" }} />
          {item(feed.enabled ? "disable" : "enable", feed.enabled ? "Disable feed" : "Enable feed")}
          {item("delete", "Delete", true)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/feeds/FeedActionsMenu.tsx
git commit -m "feat: add FeedActionsMenu"
```

---

### Task 9: `FeedCard`

**Files:**
- Create: `frontend/src/components/feeds/FeedCard.tsx`

- [ ] **Step 1: Create `FeedCard.tsx`**

```tsx
// frontend/src/components/feeds/FeedCard.tsx
import type { FeedSummary, FeedType } from "@/types/feed-summary";
import { FeedTypeBadge, TYPE_META } from "./FeedTypeBadge";
import { FeedStatusBadge } from "./FeedStatusBadge";
import { FeedTagEditor } from "./FeedTagEditor";
import { FeedActionsMenu } from "./FeedActionsMenu";

const FORMATS = [
  { id: "rss",  label: "RSS",  ext: ".xml" },
  { id: "atom", label: "Atom", ext: ".atom" },
  { id: "json", label: "JSON", ext: ".json" },
] as const;

type Format = typeof FORMATS[number]["id"];

type Props = {
  feed: FeedSummary;
  format: Format;
  setFormat: (f: Format) => void;
  onUpdate: (id: string, patch: Partial<FeedSummary>) => void;
  onAction: (id: string, action: string, format?: string) => void;
  onOpenDetail: (id: string) => void;
};

export function FeedCard({ feed, format, setFormat, onUpdate, onAction, onOpenDetail }: Props) {
  const typeMeta = TYPE_META[feed.type] ?? TYPE_META.scrape;

  return (
    <div
      onClick={() => onOpenDetail(feed.id)}
      style={{
        background: "var(--bg-elevated)", border: "1px solid var(--line)",
        borderRadius: "var(--feeds-radius-lg)", display: "flex", flexDirection: "column",
        cursor: "pointer", opacity: feed.enabled ? 1 : 0.78,
        transition: "border-color 0.12s, box-shadow 0.12s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--line-strong)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-2)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--line)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
    >
      {/* Head */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 12px 6px" }}>
        <FeedTypeBadge type={feed.type} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "14.5px", fontWeight: 600, letterSpacing: "-0.005em", display: "flex", alignItems: "center", gap: 8, lineHeight: 1.2 }}>
            {feed.title}
            {feed.origin.type === "community" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 18, padding: "0 6px", borderRadius: 999, fontSize: 10, fontWeight: 500, background: "var(--bg-sunken)", color: "var(--ink-3)", border: "1px solid var(--line)" }}>
                catalog
              </span>
            )}
          </h3>
          <div style={{ fontSize: "11.5px", color: "var(--ink-3)", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
            <span>{typeMeta.label}</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--ink-4)", display: "inline-block" }} />
            <span style={{ textTransform: "capitalize" }}>{feed.category ?? "uncategorized"}</span>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onUpdate(feed.id, { favorite: !feed.favorite }); }}
          title={feed.favorite ? "Unstar" : "Star"}
          style={{ background: "transparent", border: 0, cursor: "pointer", color: feed.favorite ? "var(--brand)" : "var(--ink-4)", padding: 4, borderRadius: 6, display: "inline-flex" }}
        >
          <svg viewBox="0 0 24 24" width={16} height={16} fill={feed.favorite ? "var(--brand)" : "none"} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.6l2.7 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.9l-5.5 2.9 1.1-6.2-4.5-4.4 6.2-.9z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "0 12px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--feeds-font-mono)", fontSize: "11.5px", color: "var(--ink-3)", background: "var(--bg-sunken)", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px", overflow: "hidden" }}>
          {feed.sourceMethod && (
            <span style={{ fontWeight: 600, color: "var(--ink)", flexShrink: 0, fontSize: "10.5px", letterSpacing: "0.04em", background: "var(--bg-elevated)", border: "1px solid var(--line-strong)", padding: "0 4px", borderRadius: 3 }}>
              {feed.sourceMethod}
            </span>
          )}
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
            {feed.sourceUrl}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", fontSize: 12 }}>
          {[
            { k: "Status", v: <FeedStatusBadge status={feed.enabled ? feed.status : "disabled"} /> },
            { k: "Last run", v: <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 12, color: feed.status === "error" ? "var(--err)" : feed.status === "neverRun" ? "var(--ink-4)" : "var(--ink-2)" }}>{feed.lastRunRelative ?? "—"}</span> },
            { k: "Refresh",  v: <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 12, color: "var(--ink-2)" }}>{feed.refreshMinutes ? (feed.refreshMinutes < 60 ? `${feed.refreshMinutes} min` : `${feed.refreshMinutes / 60} h`) : feed.type === "webhook" ? "on push" : "—"}</span> },
            { k: "Items",    v: <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 12, color: feed.lastItemCount == null ? "var(--ink-4)" : "var(--ink-2)" }}>{feed.lastItemCount ?? "—"}{(feed.lastNewItemCount ?? 0) > 0 && <span style={{ color: "var(--ok)" }}> +{feed.lastNewItemCount}</span>}</span> },
          ].map(({ k, v }) => (
            <div key={k}>
              <div style={{ fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-4)", fontWeight: 600, marginBottom: 1 }}>{k}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{v}</div>
            </div>
          ))}
        </div>

        <FeedTagEditor tags={feed.tags} onChange={(tags) => onUpdate(feed.id, { tags })} />

        {(feed.secrets.protected || feed.secrets.env || feed.secrets.plain) && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {feed.secrets.protected && <SecretBadge tone="info" label="encrypted" />}
            {feed.secrets.env && <SecretBadge tone="ghost" label="env var" />}
            {feed.secrets.plain && <SecretBadge tone="err" label="plain secret" />}
          </div>
        )}
      </div>

      {/* Footer */}
      <div onClick={(e) => e.stopPropagation()} style={{ padding: "8px 10px 8px 12px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 6, background: "var(--bg-sunken)", borderBottomLeftRadius: "var(--feeds-radius-lg)", borderBottomRightRadius: "var(--feeds-radius-lg)" }}>
        <div style={{ display: "inline-flex", background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: 7, padding: 2, gap: 1, fontFamily: "var(--feeds-font-mono)" }}>
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFormat(f.id)}
              style={{ height: 22, padding: "0 8px", fontSize: "10.5px", fontWeight: 600, background: format === f.id ? "var(--ink)" : "transparent", color: format === f.id ? "var(--bg)" : "var(--ink-3)", border: 0, borderRadius: 5, cursor: "pointer", letterSpacing: "0.02em" }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <FooterBtn onClick={() => onAction(feed.id, "copy", format)} title="Copy URL">Copy</FooterBtn>
        <FooterBtn onClick={() => onAction(feed.id, "open", format)} title="Open">↗</FooterBtn>
        <FeedActionsMenu feed={feed} onAction={(action) => onAction(feed.id, action, format)} />
      </div>
    </div>
  );
}

function SecretBadge({ tone, label }: { tone: string; label: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    info: { bg: "var(--info-soft)", color: "var(--info-ink)" },
    ghost: { bg: "transparent", color: "var(--ink-3)" },
    err: { bg: "var(--err-soft)", color: "var(--err-ink)" },
  };
  const s = styles[tone] ?? styles.ghost;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 500, background: s.bg, color: s.color, border: "1px solid var(--line)", fontFamily: "var(--feeds-font-mono)" }}>
      {label}
    </span>
  );
}

function FooterBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 8px", borderRadius: 6, fontSize: 12, fontWeight: 500, border: "1px solid transparent", background: "transparent", cursor: "pointer", color: "var(--ink-2)" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-elevated)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--line)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/feeds/FeedCard.tsx
git commit -m "feat: add FeedCard component"
```

---

### Task 10: `FeedTable` + `FeedDetailDrawer`

**Files:**
- Create: `frontend/src/components/feeds/FeedTable.tsx`
- Create: `frontend/src/components/feeds/FeedDetailDrawer.tsx`

- [ ] **Step 1: Create `FeedTable.tsx`**

```tsx
// frontend/src/components/feeds/FeedTable.tsx
import type { FeedSummary } from "@/types/feed-summary";
import { FeedTypeBadge, TYPE_META } from "./FeedTypeBadge";
import { FeedStatusBadge } from "./FeedStatusBadge";
import { FeedActionsMenu } from "./FeedActionsMenu";

const COL = "24px 1.7fr 130px 110px 1fr 100px 80px 40px";

type Props = {
  feeds: FeedSummary[];
  onUpdate: (id: string, patch: Partial<FeedSummary>) => void;
  onAction: (id: string, action: string) => void;
  onOpenDetail: (id: string) => void;
};

export function FeedTable({ feeds, onUpdate, onAction, onOpenDetail }: Props) {
  const row = (style?: React.CSSProperties) => ({
    display: "grid", gridTemplateColumns: COL, minWidth: 880,
    alignItems: "center", gap: 12, padding: "10px 16px",
    borderBottom: "1px solid var(--line)", ...style,
  });

  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: "var(--feeds-radius-lg)", overflowX: "auto" }}>
      <div style={row({ background: "var(--bg-sunken)", fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-4)", fontWeight: 600 })}>
        <span />
        <span>Name / Source</span>
        <span>Type</span>
        <span>Status</span>
        <span>Tags</span>
        <span>Last run</span>
        <span>Items</span>
        <span />
      </div>
      {feeds.map((f) => (
        <div key={f.id} style={row({ cursor: "pointer" })} onClick={() => onOpenDetail(f.id)}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-sunken)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onUpdate(f.id, { favorite: !f.favorite }); }}
            style={{ background: "transparent", border: 0, cursor: "pointer", color: f.favorite ? "var(--brand)" : "var(--ink-4)", padding: 0 }}
          >
            <svg viewBox="0 0 24 24" width={14} height={14} fill={f.favorite ? "var(--brand)" : "none"} stroke="currentColor" strokeWidth="1.75"><path d="M12 3.6l2.7 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.9l-5.5 2.9 1.1-6.2-4.5-4.4 6.2-.9z" /></svg>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <FeedTypeBadge type={f.type} size={26} />
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{f.title}</strong>
              <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 11, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{f.sourceUrl}</span>
            </div>
          </div>
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{TYPE_META[f.type]?.label ?? f.type}</span>
          <FeedStatusBadge status={f.enabled ? f.status : "disabled"} />
          <div style={{ display: "flex", gap: 3, flexWrap: "nowrap", overflow: "hidden" }}>
            {f.tags.slice(0, 3).map((t) => (
              <span key={t} style={{ display: "inline-flex", height: 20, padding: "0 6px", fontSize: "10.5px", borderRadius: 999, background: "var(--bg-sunken)", color: "var(--ink-2)", border: "1px solid var(--line)", fontFamily: "var(--feeds-font-mono)" }}>{t}</span>
            ))}
            {f.tags.length > 3 && <span style={{ fontSize: "10.5px", color: "var(--ink-4)" }}>+{f.tags.length - 3}</span>}
          </div>
          <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: "11.5px", color: f.status === "error" ? "var(--err)" : f.status === "neverRun" ? "var(--ink-4)" : "var(--ink-2)" }}>{f.lastRunRelative ?? "—"}</span>
          <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: "11.5px", color: f.lastItemCount == null ? "var(--ink-4)" : "var(--ink-2)" }}>
            {f.lastItemCount ?? "—"}
            {(f.lastNewItemCount ?? 0) > 0 && <span style={{ color: "var(--ok)" }}> +{f.lastNewItemCount}</span>}
          </span>
          <div onClick={(e) => e.stopPropagation()}>
            <FeedActionsMenu feed={f} onAction={(action) => onAction(f.id, action)} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `FeedDetailDrawer.tsx`**

```tsx
// frontend/src/components/feeds/FeedDetailDrawer.tsx
import type { FeedSummary } from "@/types/feed-summary";
import { FeedTypeBadge, TYPE_META } from "./FeedTypeBadge";
import { FeedStatusBadge } from "./FeedStatusBadge";
import { FeedTagEditor } from "./FeedTagEditor";

const FORMATS = [
  { id: "rss",  ext: ".xml",  full: "RSS 2.0" },
  { id: "atom", ext: ".atom", full: "Atom" },
  { id: "json", ext: ".json", full: "JSON Feed" },
];

type Props = {
  feed: FeedSummary | null;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<FeedSummary>) => void;
  onAction: (id: string, action: string, format?: string) => void;
};

export function FeedDetailDrawer({ feed, onClose, onUpdate, onAction }: Props) {
  if (!feed) return null;
  const typeMeta = TYPE_META[feed.type];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(22,20,15,0.4)", zIndex: 50, animation: "scrim-in 0.16s ease" }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 480, maxWidth: "96vw", background: "var(--bg)", zIndex: 51, display: "flex", flexDirection: "column", boxShadow: "-20px 0 40px -20px rgba(22,20,15,0.3)", animation: "drawer-in 0.22s cubic-bezier(.16,.84,.44,1)" }}>
        {/* Header */}
        <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "flex-start", gap: 12, background: "var(--bg-sunken)" }}>
          <FeedTypeBadge type={feed.type} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{feed.title}</h2>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span>{typeMeta?.label}</span>
              <span>·</span>
              <span style={{ textTransform: "capitalize" }}>{feed.category}</span>
              <span>·</span>
              <code style={{ fontSize: 11 }}>{feed.filename}</code>
            </div>
          </div>
          <FeedStatusBadge status={feed.enabled ? feed.status : "disabled"} />
          <button onClick={onClose} style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--ink-3)", padding: 4, borderRadius: 6, fontSize: 20, lineHeight: 1 }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>×</button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px 60px", display: "flex", flexDirection: "column", gap: 18 }}>
          {feed.statusDetail && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", background: feed.status === "error" ? "var(--err-soft)" : "var(--warn-soft)", color: feed.status === "error" ? "var(--err-ink)" : "var(--warn-ink)", borderRadius: 8, fontSize: "12.5px", lineHeight: 1.45 }}>
              ⚠ {feed.statusDetail}
            </div>
          )}

          {feed.description && (
            <section>
              <SectionHeader>Description</SectionHeader>
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>{feed.description}</p>
            </section>
          )}

          <section>
            <SectionHeader>Endpoints</SectionHeader>
            <KVTable>
              <KVRow label="Source">{feed.sourceMethod ? `${feed.sourceMethod} ` : ""}{feed.sourceUrl}</KVRow>
              {FORMATS.map((fmt) => (
                <KVRow key={fmt.id} label={fmt.full}>
                  <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 12 }}>{feed.publicFeedUrl}{fmt.ext}</span>
                  <CopyBtn onClick={() => onAction(feed.id, "copy", fmt.id)} />
                  <OpenBtn onClick={() => onAction(feed.id, "open", fmt.id)} />
                </KVRow>
              ))}
              <KVRow label="Refresh">{feed.refreshMinutes ? `${feed.refreshMinutes} min` : feed.type === "webhook" ? "on push" : "—"}</KVRow>
              <KVRow label="Origin">{feed.origin.type === "community" ? `Community · ${feed.origin.catalogId}` : "Local"}</KVRow>
            </KVTable>
          </section>

          <section>
            <SectionHeader>Recent activity</SectionHeader>
            <KVTable>
              <KVRow label="Last run">{feed.lastRunRelative ?? "never"}</KVRow>
              <KVRow label="Items">{feed.lastItemCount ?? "—"}{(feed.lastNewItemCount ?? 0) > 0 ? ` (${feed.lastNewItemCount} new)` : ""}</KVRow>
              {feed.lastErrorAt && <KVRow label="Last error"><span style={{ color: "var(--err)" }}>{feed.statusDetail ?? "Failed run"}</span></KVRow>}
            </KVTable>
          </section>

          <section>
            <SectionHeader>Tags</SectionHeader>
            <FeedTagEditor tags={feed.tags} onChange={(tags) => onUpdate(feed.id, { tags })} />
          </section>

          <section>
            <SectionHeader>Settings</SectionHeader>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: 10 }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>Feed enabled</div>
                <div style={{ fontSize: "11.5px", color: "var(--ink-3)" }}>Skipped by the worker when off.</div>
              </div>
              <Toggle on={feed.enabled} onToggle={() => onUpdate(feed.id, { enabled: !feed.enabled })} />
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer style={{ padding: "12px 22px", borderTop: "1px solid var(--line)", background: "var(--bg)", display: "flex", gap: 8, alignItems: "center" }}>
          <DrawerBtn onClick={() => onAction(feed.id, "preview")}>Preview</DrawerBtn>
          <DrawerBtn onClick={() => onAction(feed.id, "duplicate")}>Duplicate</DrawerBtn>
          <span style={{ flex: 1 }} />
          <DrawerBtn danger onClick={() => onAction(feed.id, "delete")}>Delete</DrawerBtn>
          <DrawerBtn primary onClick={() => onAction(feed.id, "edit")}>Edit</DrawerBtn>
        </footer>
      </aside>
      <style>{`
        @keyframes scrim-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes drawer-in { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h4 style={{ margin: "0 0 8px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-4)", fontWeight: 600 }}>{children}</h4>;
}

function KVTable({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>{children}</div>;
}

function KVRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", padding: "10px 12px", fontSize: "12.5px", borderBottom: "1px solid var(--line)", alignItems: "center", gap: 10 }}>
      <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 12, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

function CopyBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} title="Copy" style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--ink-4)", fontSize: 12, padding: "0 2px" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-4)")}>⎘</button>;
}

function OpenBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} title="Open" style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--ink-4)", fontSize: 12, padding: "0 2px" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-4)")}>↗</button>;
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{ position: "relative", width: 30, height: 17, background: on ? "var(--ok)" : "var(--line-strong)", borderRadius: 999, cursor: "pointer", border: 0, padding: 0, transition: "background 0.12s" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 15 : 2, width: 13, height: 13, background: "#fff", borderRadius: "50%", transition: "left 0.16s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

function DrawerBtn({ onClick, children, primary, danger }: { onClick: () => void; children: React.ReactNode; primary?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", border: "1px solid var(--line-strong)", background: primary ? "var(--ink)" : "var(--bg-elevated)", color: primary ? "var(--bg)" : danger ? "var(--err)" : "var(--ink)", transition: "background 0.12s" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = primary ? "#000" : danger ? "var(--err-soft)" : "var(--bg-sunken)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = primary ? "var(--ink)" : "var(--bg-elevated)"; }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/feeds/FeedTable.tsx frontend/src/components/feeds/FeedDetailDrawer.tsx
git commit -m "feat: add FeedTable and FeedDetailDrawer"
```

---

### Task 11: `MyFeedsPage` + wiring

**Files:**
- Create: `frontend/src/pages/MyFeedsPage.tsx`
- Delete: `frontend/src/pages/ActiveFeedsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Header.tsx`

- [ ] **Step 1: Create `MyFeedsPage.tsx`**

```tsx
// frontend/src/pages/MyFeedsPage.tsx
import "@/styles/feeds-tokens.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FeedSummary, FeedType } from "@/types/feed-summary";
import { useToast } from "@/components/ui/toast-provider";
import { FeedCard } from "@/components/feeds/FeedCard";
import { FeedTable } from "@/components/feeds/FeedTable";
import { FeedDetailDrawer } from "@/components/feeds/FeedDetailDrawer";
import { FeedTypeBadge, TYPE_META } from "@/components/feeds/FeedTypeBadge";
import { ScrollableFilterRow } from "@/components/feeds/ScrollableFilterRow";

type Format = "rss" | "atom" | "json";
type QuickFilter = "all" | "favorites" | "warnings" | "broken" | "disabled" | "secrets" | "community";

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "warnings",  label: "Needs attention" },
  { id: "broken",    label: "Failing" },
  { id: "disabled",  label: "Disabled" },
  { id: "secrets",   label: "Has secrets" },
  { id: "community", label: "From catalog" },
];

const FORMATS = [
  { id: "rss"  as Format, ext: ".xml",  full: "RSS 2.0" },
  { id: "atom" as Format, ext: ".atom", full: "Atom" },
  { id: "json" as Format, ext: ".json", full: "JSON Feed" },
];

function feedUrl(feed: FeedSummary, fmt: Format) {
  return feed.publicFeedUrl + (FORMATS.find((f) => f.id === fmt)?.ext ?? ".xml");
}

function matchesQuick(feed: FeedSummary, q: QuickFilter): boolean {
  switch (q) {
    case "all":       return true;
    case "favorites": return feed.favorite;
    case "warnings":  return feed.status === "warning";
    case "broken":    return feed.status === "error";
    case "disabled":  return !feed.enabled;
    case "secrets":   return feed.secrets.protected || feed.secrets.env || feed.secrets.plain;
    case "community": return feed.origin.type === "community";
  }
}

function matchesSearch(feed: FeedSummary, raw: string): boolean {
  if (!raw) return true;
  const q = raw.trim().toLowerCase();
  const hay = [feed.title, feed.description, feed.type, feed.category, feed.sourceUrl, feed.publicFeedUrl, feed.filename, feed.origin.catalogId, ...feed.tags].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

export function MyFeedsPage() {
  const toast = useToast();
  const navigate = useNavigate();

  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [typeFilters, setTypeFilters] = useState<FeedType[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formatPerFeed, setFormatPerFeed] = useState<Record<string, Format>>({});

  const formatFor = (id: string): Format => formatPerFeed[id] ?? "rss";
  const setFormatFor = (id: string, f: Format) => setFormatPerFeed((m) => ({ ...m, [id]: f }));

  const fetchFeeds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/feeds");
      if (!res.ok) throw new Error("Failed to load feeds");
      const data = await res.json();
      setFeeds(data.feeds ?? []);
    } catch (e) {
      toast.push({ tone: "err", title: "Failed to load feeds", body: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchFeeds(); }, [fetchFeeds]);

  const updateFeed = useCallback((id: string, patch: Partial<FeedSummary>) => {
    setFeeds((all) => all.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: feeds.length };
    QUICK_FILTERS.forEach((q) => { if (q.id !== "all") c[q.id] = feeds.filter((f) => matchesQuick(f, q.id)).length; });
    return c;
  }, [feeds]);

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    feeds.forEach((f) => f.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [feeds]);

  const presentTypes = useMemo(() => {
    const s = new Set(feeds.map((f) => f.type));
    return (Object.keys(TYPE_META) as FeedType[]).filter((t) => s.has(t));
  }, [feeds]);

  const visible = useMemo(() =>
    feeds.filter((f) =>
      matchesQuick(f, quick) &&
      (typeFilters.length === 0 || typeFilters.includes(f.type)) &&
      (tagFilters.length === 0 || tagFilters.some((t) => f.tags.includes(t))) &&
      matchesSearch(f, search)
    ),
    [feeds, quick, typeFilters, tagFilters, search]
  );

  const detail = feeds.find((f) => f.id === detailId) ?? null;
  const filterActive = quick !== "all" || typeFilters.length > 0 || tagFilters.length > 0 || search.length > 0;

  const handleAction = useCallback(async (id: string, action: string, fmt?: string) => {
    const feed = feeds.find((f) => f.id === id);
    if (!feed) return;
    const format = (fmt as Format) ?? formatFor(id);
    const url = feedUrl(feed, format);
    const fmtFull = FORMATS.find((f) => f.id === format)?.full ?? "RSS 2.0";

    switch (action) {
      case "open":
        window.open(url, "_blank");
        break;
      case "copy":
        await navigator.clipboard.writeText(window.location.origin + url);
        toast.push({ tone: "ok", title: `${fmtFull} URL copied`, body: url });
        break;
      case "preview":
        toast.push({ tone: "", title: "Preview", body: "Opening feed preview…" });
        break;
      case "edit":
        navigate(`/feeds/${id}/edit`);
        break;
      case "duplicate": {
        const res = await fetch(`/api/feeds/${id}/duplicate`, { method: "POST" });
        if (!res.ok) { toast.push({ tone: "err", title: "Duplicate failed" }); return; }
        const { id: newId } = await res.json();
        toast.push({ tone: "ok", title: "Duplicated", body: `${newId}.yaml` });
        fetchFeeds();
        break;
      }
      case "export": {
        const res = await fetch(`/api/feeds/${id}/export`);
        if (!res.ok) { toast.push({ tone: "err", title: "Export failed" }); return; }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${id}.yaml`;
        a.click();
        toast.push({ tone: "ok", title: "YAML exported", body: `${id}.yaml downloaded` });
        break;
      }
      case "enable":
      case "disable": {
        const enabled = action === "enable";
        const res = await fetch(`/api/feeds/${id}/enabled`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
        if (!res.ok) { toast.push({ tone: "err", title: `${action} failed` }); return; }
        updateFeed(id, { enabled });
        toast.push({ tone: enabled ? "ok" : "warn", title: enabled ? "Feed enabled" : "Feed disabled", body: feed.title });
        break;
      }
      case "delete": {
        const res = await fetch(`/api/feeds/${id}`, { method: "DELETE" });
        if (!res.ok) { toast.push({ tone: "err", title: "Delete failed" }); return; }
        setFeeds((all) => all.filter((f) => f.id !== id));
        setDetailId(null);
        toast.push({ tone: "err", title: "Feed deleted", body: feed.filename, ms: 6000,
          action: { label: "Undo", onClick: () => setFeeds((all) => [feed, ...all]) } });
        break;
      }
    }
  }, [feeds, formatPerFeed, toast, navigate, fetchFeeds, updateFeed]);

  const handleUpdate = useCallback(async (id: string, patch: Partial<FeedSummary>) => {
    updateFeed(id, patch);
    if ("tags" in patch || "category" in patch || "favorite" in patch || "title" in patch || "description" in patch) {
      await fetch(`/api/feeds/${id}/metadata`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    } else if ("enabled" in patch) {
      await fetch(`/api/feeds/${id}/enabled`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: patch.enabled }) });
    }
  }, [updateFeed]);

  const clearFilters = () => { setSearch(""); setQuick("all"); setTypeFilters([]); setTagFilters([]); };

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>Loading feeds…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Page header */}
      <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 24px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 10, background: "var(--bg)", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: "-0.015em" }}>My Feeds</h1>
          <span style={{ fontSize: "12.5px", color: "var(--ink-3)" }}>Search, tag, filter, inspect, and export every feed recipe.</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 280 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: 14 }}>🔍</span>
            <input
              placeholder="Search by name, source, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", height: 34, borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--bg-elevated)", padding: "0 36px 0 32px", font: "inherit", fontSize: 13, color: "var(--ink)", outline: "none" }}
            />
          </div>
          <Btn onClick={() => navigate("/")}>+ Build Feed</Btn>
        </div>
      </header>

      <div style={{ padding: "18px 24px 48px", flex: 1, minWidth: 0 }}>
        {/* Filters */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          <ScrollableFilterRow label="Quick">
            {QUICK_FILTERS.map((q) => (
              <Chip key={q.id} active={quick === q.id} onClick={() => setQuick(q.id)}>
                {q.label}
                <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 11, opacity: 0.65, marginLeft: 2 }}>{counts[q.id]}</span>
              </Chip>
            ))}
          </ScrollableFilterRow>
          {presentTypes.length > 0 && (
            <ScrollableFilterRow label="Type">
              {presentTypes.map((t) => {
                const active = typeFilters.includes(t);
                const count = feeds.filter((f) => f.type === t).length;
                return (
                  <Chip key={t} active={active} onClick={() => setTypeFilters((arr) => active ? arr.filter((x) => x !== t) : [...arr, t])}>
                    {TYPE_META[t]?.label}
                    <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 11, opacity: 0.65, marginLeft: 2 }}>{count}</span>
                  </Chip>
                );
              })}
            </ScrollableFilterRow>
          )}
          {allTags.length > 0 && (
            <ScrollableFilterRow label="Tags">
              {allTags.map(([t, n]) => {
                const active = tagFilters.includes(t);
                return (
                  <Chip key={t} active={active} onClick={() => setTagFilters((arr) => active ? arr.filter((x) => x !== t) : [...arr, t])}>
                    {t}
                    <span style={{ fontFamily: "var(--feeds-font-mono)", fontSize: 11, opacity: 0.65, marginLeft: 2 }}>{n}</span>
                  </Chip>
                );
              })}
            </ScrollableFilterRow>
          )}
        </div>

        {/* Result bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: "12.5px", color: "var(--ink-3)" }}>
          <strong style={{ color: "var(--ink)", fontWeight: 600, fontFamily: "var(--feeds-font-mono)" }}>{visible.length}</strong>
          <span>of {feeds.length} feed{feeds.length === 1 ? "" : "s"}</span>
          {filterActive && <Btn small ghost onClick={clearFilters}>× Clear filters</Btn>}
          <span style={{ flex: 1 }} />
          <div style={{ display: "inline-flex", background: "var(--bg-sunken)", border: "1px solid var(--line)", borderRadius: 8, padding: 2, gap: 2 }}>
            {(["cards", "table"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px", fontSize: 12, fontWeight: 500, background: view === v ? "var(--bg-elevated)" : "transparent", color: view === v ? "var(--ink)" : "var(--ink-3)", border: 0, borderRadius: 6, cursor: "pointer" }}>
                {v === "cards" ? "⊞ Cards" : "☰ Table"}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "70px 20px", color: "var(--ink-3)", background: "var(--bg-elevated)", border: "1px dashed var(--line-strong)", borderRadius: "var(--feeds-radius-lg)" }}>
            <h3 style={{ margin: "0 0 6px", color: "var(--ink)", fontSize: 16, fontWeight: 600 }}>
              {feeds.length === 0 ? "No feeds yet" : "No feeds match these filters."}
            </h3>
            <p style={{ margin: "0 auto 16px", fontSize: 13, maxWidth: "44ch" }}>
              {feeds.length === 0 ? "Build your first feed from a webpage, REST API, or email folder." : "Try clearing filters or build a new feed."}
            </p>
            <div style={{ display: "inline-flex", gap: 8 }}>
              {filterActive && <Btn onClick={clearFilters}>Clear filters</Btn>}
              <Btn onClick={() => navigate("/")}>+ Build Feed</Btn>
            </div>
          </div>
        ) : view === "cards" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {visible.map((f) => (
              <FeedCard
                key={f.id}
                feed={f}
                format={formatFor(f.id)}
                setFormat={(fmt) => setFormatFor(f.id, fmt)}
                onUpdate={handleUpdate}
                onAction={handleAction}
                onOpenDetail={setDetailId}
              />
            ))}
          </div>
        ) : (
          <FeedTable feeds={visible} onUpdate={handleUpdate} onAction={handleAction} onOpenDetail={setDetailId} />
        )}
      </div>

      <FeedDetailDrawer feed={detail} onClose={() => setDetailId(null)} onUpdate={handleUpdate} onAction={handleAction} />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 999, fontSize: 12, background: active ? "var(--ink)" : "var(--bg-elevated)", border: `1px solid ${active ? "var(--ink)" : "var(--line)"}`, color: active ? "var(--bg)" : "var(--ink-2)", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

function Btn({ onClick, children, small, ghost }: { onClick: () => void; children: React.ReactNode; small?: boolean; ghost?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: small ? 26 : 32, padding: small ? "0 8px" : "0 12px", borderRadius: small ? 6 : 8, fontSize: small ? 12 : 13, fontWeight: 500, border: ghost ? "1px solid transparent" : "1px solid var(--line-strong)", background: ghost ? "transparent" : "var(--bg-elevated)", color: "var(--ink)", cursor: "pointer" }}>
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Update `App.tsx`**

Replace the `ActiveFeedsPage` import and route:

```tsx
// Remove: import { ActiveFeedsPage } from "./pages/ActiveFeedsPage";
// Add:
import { MyFeedsPage } from "./pages/MyFeedsPage";
```

And in the Routes:

```tsx
// Remove: <Route path="/feeds" element={<ActiveFeedsPage />} />
// Add:
<Route path="/feeds" element={<MyFeedsPage />} />
```

- [ ] **Step 3: Update `Header.tsx`**

Find the "Active Feeds" `NavLink` label and rename it:

```tsx
// Change: Active Feeds
// To:
My Feeds
```

- [ ] **Step 4: Wrap app with `ToastProvider` in `App.tsx`**

The `ToastProvider` must wrap all content. In `App.tsx`, wrap the `TooltipProvider` (or its children) with `ToastProvider`:

```tsx
import { ToastProvider } from "./components/ui/toast-provider";

function App() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<FeedBuilderForm />} />
            <Route path="/feeds" element={<MyFeedsPage />} />
            <Route path="/feeds/:id/edit" element={<EditFeedPage />} />
            <Route path="/health" element={<HealthDashboardPage />} />
          </Routes>
        </Layout>
      </TooltipProvider>
    </ToastProvider>
  );
}
```

- [ ] **Step 5: Delete `ActiveFeedsPage.tsx`**

```bash
rm frontend/src/pages/ActiveFeedsPage.tsx
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/MyFeedsPage.tsx frontend/src/App.tsx frontend/src/components/layout/Header.tsx
git rm frontend/src/pages/ActiveFeedsPage.tsx
git commit -m "feat: replace ActiveFeedsPage with full My Feeds redesign"
```

---

### Task 12: Smoke test

- [ ] **Step 1: Start the backend**

```bash
bun run index.ts &
```

- [ ] **Step 2: Start the frontend dev server**

```bash
cd frontend && bun run dev
```

- [ ] **Step 3: Open browser at `http://localhost:5173/feeds`** and verify:

```text
[ ] Page loads without console errors
[ ] "My Feeds" heading visible
[ ] Search input responds to typing
[ ] Quick filter chips show counts
[ ] Cards view shows feed cards (or empty state if no configs)
[ ] Table toggle switches to table view
[ ] Clicking a card opens the detail drawer
[ ] Drawer close (×) and scrim click both close it
[ ] Favorite star toggles and fires PATCH
[ ] Format picker RSS/Atom/JSON changes Copy URL
[ ] Delete fires toast with Undo button
[ ] Nav link now reads "My Feeds"
```

- [ ] **Step 4: Stop servers**

```bash
kill %2 %1
```

- [ ] **Step 5: Update PROGRESS.md**

```markdown
| My Feeds Redesign | ✅ | ✅ |
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "chore: mark My Feeds Redesign spec and plan complete"
```
