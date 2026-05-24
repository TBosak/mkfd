# Feed Configuration Formalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc inline config assembly in `index.ts` with a typed `FeedConfig` discriminated union, a normalizer for old/new YAML, a caster from form data, and a validator — wired into all save/preview/worker paths. The frontend sends typed objects via a thin converter.

**Architecture:** Models define shapes; the normalizer handles reading; the caster handles writing; the validator gates every write. The existing `index.ts` POST `/` and PUT `/api/feeds/:id` inline logic moves into the caster. Worker normalizes at dispatch. Frontend adds one converter file and updates one `onSubmit` handler. No existing YAML changes automatically.

**Security decision:** `feedId` is the immutable storage/security identifier. It is generated once on create, is not editable through normal edit flows, and must validate as `^[A-Za-z0-9_-]+$` before it is used for YAML paths, output files, history keys, worker maps, route params, or URLs. `feedName` and metadata title are the user-visible labels.

**Tech Stack:** Bun, TypeScript, `js-yaml`, `uuid`, `bun:test`, React, react-hook-form

**Depends on:** Protected Value Encryption plan must be executed first — this plan imports `ProtectedRecord`, `FeedCookie`, `ProtectedValue`, `protectValue`, `isProtectedValue` from `models/protected-value.model.ts` and `utilities/protected-values.utility.ts`.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/feed-metadata.model.ts` | `FeedMetadata`, `FeedConfigOrigin` |
| Create | `models/feed-config.model.ts` | Full `FeedConfig` union + all supporting types |
| Create | `utilities/feed-config-normalizer.utility.ts` | `normalizeLoadedFeedConfig` |
| Create | `utilities/feed-config-caster.utility.ts` | `castFeedFormDataToFeedConfig` + per-type casters |
| Create | `utilities/feed-config-validator.utility.ts` | `validateFeedConfig` |
| Create | `tests/feed-config-normalizer.test.ts` | Normalizer tests |
| Create | `tests/feed-config-caster.test.ts` | Caster tests |
| Create | `tests/feed-config-validator.test.ts` | Validator tests |
| Modify | `workers/feed-updater.worker.ts` | Normalize at dispatch; handle `"rest"` alongside `"api"` |
| Modify | `index.ts` | Wire caster+validator into POST `/`, PUT `/api/feeds/:id`, POST `/preview`; normalizer into GET `/api/feeds/:id/config` |
| Create | `frontend/src/lib/feed-config-builder.ts` | `buildFeedConfigFromFormData` |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Use converter in `onSubmit` |

---

### Task 1: FeedMetadata model

**Files:**
- Create: `models/feed-metadata.model.ts`
- Create: `tests/feed-config-normalizer.test.ts`

- [ ] **Step 1: Write failing import test**

```typescript
// tests/feed-config-normalizer.test.ts
import { describe, it, expect } from "bun:test";
import type { FeedMetadata, FeedConfigOrigin } from "../models/feed-metadata.model";

describe("FeedMetadata types", () => {
  it("accepts a local origin", () => {
    const origin: FeedConfigOrigin = { type: "local" };
    expect(origin.type).toBe("local");
  });

  it("accepts a community origin with catalogId", () => {
    const origin: FeedConfigOrigin = {
      type: "community",
      catalogId: "github-releases",
      importedAt: "2026-05-22T00:00:00Z",
    };
    expect(origin.catalogId).toBe("github-releases");
  });

  it("accepts a FeedMetadata with tags and category", () => {
    const meta: FeedMetadata = {
      title: "My Feed",
      tags: ["news", "local"],
      category: "civic",
      favorite: true,
    };
    expect(meta.tags).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/feed-config-normalizer.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the model**

```typescript
// models/feed-metadata.model.ts
export type FeedConfigOrigin = {
  type: "local" | "community" | "sourceAssistant" | "imported";
  catalogId?: string;
  importedAt?: string;
  sourceRepo?: string;
  sourcePath?: string;
};

export type FeedMetadata = {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  language?: string;
  visibility?: "public" | "private";
  localOnly?: boolean;
  favorite?: boolean;
  color?: string;
  origin?: FeedConfigOrigin;
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/feed-config-normalizer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add models/feed-metadata.model.ts tests/feed-config-normalizer.test.ts
git commit -m "feat: add FeedMetadata model"
```

---

### Task 2: FeedConfig model

**Files:**
- Create: `models/feed-config.model.ts`
- Modify: `tests/feed-config-normalizer.test.ts`

- [ ] **Step 1: Add failing tests for model shapes**

Append to `tests/feed-config-normalizer.test.ts`:

```typescript
import type {
  FeedConfig,
  WebScrapingFeedConfig,
  RestFeedConfig,
  EmailFeedConfig,
  defaultFeedRssMetadata,
} from "../models/feed-config.model";
import { defaultFeedRssMetadata as defaults } from "../models/feed-config.model";

describe("defaultFeedRssMetadata", () => {
  it("has feedGenerator set to MkFD Feed Generator", () => {
    expect(defaults.feedGenerator).toBe("MkFD Feed Generator");
  });
  it("has feedDocs set to rssboard.org", () => {
    expect(defaults.feedDocs).toBe("https://www.rssboard.org/rss-specification");
  });
  it("has empty arrays for categories, skipHours, skipDays", () => {
    expect(defaults.feedCategories).toEqual([]);
    expect(defaults.feedSkipHours).toEqual([]);
    expect(defaults.feedSkipDays).toEqual([]);
  });
});

describe("FeedConfig shapes", () => {
  it("WebScrapingFeedConfig has config and article", () => {
    const config: WebScrapingFeedConfig = {
      feedId: "abc",
      feedName: "test",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://example.com" },
      article: { iterator: { selector: "article" } },
    };
    expect(config.feedType).toBe("webScraping");
  });

  it("RestFeedConfig has config and apiMapping", () => {
    const config: RestFeedConfig = {
      feedId: "def",
      feedName: "api",
      feedType: "rest",
      refreshTime: 5,
      config: { baseUrl: "https://api.example.com" },
      apiMapping: { items: "data" },
    };
    expect(config.feedType).toBe("rest");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/feed-config-normalizer.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the full model file**

```typescript
// models/feed-config.model.ts
import type { CSSTargetFields } from "./csstarget.model";
import type { ApiMapping } from "./api-mapping.model";
import type { ProtectedRecord, FeedCookie, ProtectedValue } from "./protected-value.model";
import type { FeedMetadata } from "./feed-metadata.model";

export type FeedType =
  | "webScraping"
  | "rest"
  | "api"
  | "email"
  | "graphql"
  | "calendar"
  | "sitemap"
  | "filesystem"
  | "webhook"
  | "feedTransformer"
  | "serviceConnector"
  | "changeDetection";

export type FeedRssMetadata = {
  feedLanguage?: string;
  feedCopyright?: string;
  feedDescription?: string;
  feedManagingEditor?: string;
  feedWebMaster?: string;
  feedPubDate?: string;
  feedLastBuildDate?: string;
  feedCategories?: string[];
  feedDocs?: string;
  feedGenerator?: string;
  feedTtl?: number;
  feedSkipHours?: number[];
  feedSkipDays?: string[];
  feedImage?: string;
};

export const defaultFeedRssMetadata = {
  feedLanguage: "",
  feedCopyright: "",
  feedDescription: "",
  feedManagingEditor: "",
  feedWebMaster: "",
  feedPubDate: "",
  feedLastBuildDate: "",
  feedCategories: [] as string[],
  feedDocs: "https://www.rssboard.org/rss-specification",
  feedGenerator: "MkFD Feed Generator",
  feedSkipHours: [] as number[],
  feedSkipDays: [] as string[],
} as const;

export type OutgoingWebhookConfig = {
  enabled: boolean;
  url?: string | ProtectedValue;
  method?: "POST" | "PUT";
  format?: "xml" | "json";
  headers?: ProtectedRecord;
  newItemsOnly?: boolean;
  customPayload?: string;
};

export type FlareSolverrConfig = {
  enabled: boolean;
  serverUrl?: string;
  timeout?: number;
};

export type FeedConfigBase<T extends FeedType> = {
  schemaVersion?: number;
  feedId: string;
  feedName: string;
  feedType: T;
  enabled?: boolean;
  refreshTime: number;
  reverse?: boolean;
  strict?: boolean;
  advanced?: boolean;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  webhook?: OutgoingWebhookConfig;
  flaresolverr?: FlareSolverrConfig;
  metadata?: FeedMetadata;
} & FeedRssMetadata;

export type WebScrapingSourceConfig = {
  baseUrl: string;
  title?: string;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  timeoutMs?: number;
  userAgent?: string;
  proxyId?: string;
};

export type WebScrapingFeedConfig = FeedConfigBase<"webScraping"> & {
  config: WebScrapingSourceConfig;
  article: CSSTargetFields;
};

export type ApiSourceConfig = {
  title?: string;
  baseUrl: string;
  method?: string;
  route?: string;
  params?: ProtectedRecord;
  headers?: ProtectedRecord;
  apiSpecificHeaders?: ProtectedRecord;
  apiSpecificBody?: Record<string, unknown>;
  cookieString?: string;
  body?: unknown;
  withCredentials?: boolean;
  contributor?: string;
  advanced?: boolean;
};

export type RestFeedConfig = FeedConfigBase<"rest"> & {
  config: ApiSourceConfig;
  apiMapping: ApiMapping;
};

export type ApiFeedConfig = FeedConfigBase<"api"> & {
  config: ApiSourceConfig;
  apiMapping: ApiMapping;
};

export type EmailSourceConfig = {
  host: string;
  port: number;
  user: string;
  folder: string;
  emailCount: number;
  password?: ProtectedValue;
  encryptedPassword?: string;
};

export type EmailFeedConfig = FeedConfigBase<"email"> & {
  config: EmailSourceConfig;
};

// Stub types — source block is Record<string, unknown> until each feature spec defines it
export type GraphQLFeedConfig         = FeedConfigBase<"graphql">          & { graphql: Record<string, unknown>; apiMapping: ApiMapping };
export type CalendarFeedConfig        = FeedConfigBase<"calendar">         & { calendar: Record<string, unknown> };
export type SitemapFeedConfig         = FeedConfigBase<"sitemap">          & { sitemap: Record<string, unknown> };
export type FilesystemFeedConfig      = FeedConfigBase<"filesystem">       & { filesystem: Record<string, unknown> };
export type WebhookFeedConfig         = FeedConfigBase<"webhook">          & { webhookFeed: Record<string, unknown> };
export type FeedTransformerFeedConfig = FeedConfigBase<"feedTransformer">  & { feedTransformer: Record<string, unknown> };
export type ServiceConnectorFeedConfig = FeedConfigBase<"serviceConnector"> & { serviceConnector: Record<string, unknown> };
export type ChangeDetectionFeedConfig = FeedConfigBase<"changeDetection">  & { changeDetection: Record<string, unknown> };

export type FeedConfig =
  | WebScrapingFeedConfig
  | RestFeedConfig
  | ApiFeedConfig
  | EmailFeedConfig
  | GraphQLFeedConfig
  | CalendarFeedConfig
  | SitemapFeedConfig
  | FilesystemFeedConfig
  | WebhookFeedConfig
  | FeedTransformerFeedConfig
  | ServiceConnectorFeedConfig
  | ChangeDetectionFeedConfig;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/feed-config-normalizer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add models/feed-config.model.ts tests/feed-config-normalizer.test.ts
git commit -m "feat: add FeedConfig discriminated union model with all feed types"
```

---

### Task 3: Feed config normalizer

**Files:**
- Create: `utilities/feed-config-normalizer.utility.ts`
- Modify: `tests/feed-config-normalizer.test.ts`

- [ ] **Step 1: Add failing normalizer tests**

Append to `tests/feed-config-normalizer.test.ts`:

```typescript
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";

describe("normalizeLoadedFeedConfig", () => {
  it("normalizes a legacy webScraping config without schemaVersion", () => {
    const raw = {
      feedId: "test-ws",
      feedName: "Test Feed",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://example.com" },
      article: { iterator: { selector: "article" } },
    };
    const result = normalizeLoadedFeedConfig(raw);
    expect(result.feedType).toBe("webScraping");
    expect(result.feedId).toBe("test-ws");
    expect(result.enabled).toBe(true);
  });

  it("mirrors article.pubDate onto article.date", () => {
    const raw = {
      feedId: "d1",
      feedName: "F",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" }, pubDate: { selector: "time" } },
    };
    const result = normalizeLoadedFeedConfig(raw) as import("../models/feed-config.model").WebScrapingFeedConfig;
    expect(result.article.date).toBeDefined();
    expect(result.article.date).toEqual(result.article.pubDate);
  });

  it("mirrors article.date onto article.pubDate", () => {
    const raw = {
      feedId: "d2",
      feedName: "F",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" }, date: { selector: "time" } },
    };
    const result = normalizeLoadedFeedConfig(raw) as import("../models/feed-config.model").WebScrapingFeedConfig;
    expect(result.article.pubDate).toEqual(result.article.date);
  });

  it("normalizes a legacy api config", () => {
    const raw = {
      feedId: "api-1",
      feedName: "API Feed",
      feedType: "api",
      refreshTime: 5,
      config: { baseUrl: "https://api.com" },
      apiMapping: { items: "data" },
    };
    const result = normalizeLoadedFeedConfig(raw);
    expect(result.feedType).toBe("api");
  });

  it("fills missing enabled with true", () => {
    const raw = {
      feedId: "x",
      feedName: "X",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" } },
    };
    expect(normalizeLoadedFeedConfig(raw).enabled).toBe(true);
  });

  it("fills missing refreshTime with 5", () => {
    const raw = {
      feedId: "x",
      feedName: "X",
      feedType: "webScraping",
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" } },
    };
    expect(normalizeLoadedFeedConfig(raw as any).refreshTime).toBe(5);
  });

  it("applies defaultFeedRssMetadata for missing RSS fields", () => {
    const raw = {
      feedId: "x",
      feedName: "X",
      feedType: "webScraping",
      refreshTime: 5,
      config: { baseUrl: "https://x.com" },
      article: { iterator: { selector: "li" } },
    };
    const result = normalizeLoadedFeedConfig(raw);
    expect(result.feedGenerator).toBe("MkFD Feed Generator");
    expect(result.feedCategories).toEqual([]);
  });

  it("never throws for unknown feedType", () => {
    const raw = { feedId: "x", feedName: "X", feedType: "unknown", refreshTime: 5 };
    expect(() => normalizeLoadedFeedConfig(raw as any)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/feed-config-normalizer.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the normalizer**

```typescript
// utilities/feed-config-normalizer.utility.ts
import type { FeedConfig, WebScrapingFeedConfig, RestFeedConfig, ApiFeedConfig, EmailFeedConfig } from "../models/feed-config.model";
import { defaultFeedRssMetadata } from "../models/feed-config.model";

function s(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function n(v: unknown, fallback = 0): number {
  const parsed = typeof v === "number" ? v : Number(v);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function b(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  return ["on", "true", "checked"].includes(String(v ?? "").toLowerCase()) ? true : fallback;
}

function normalizeArticle(raw: Record<string, unknown>): Record<string, unknown> {
  const dateTarget = raw.date ?? raw.pubDate;
  return { ...raw, date: dateTarget, pubDate: dateTarget };
}

function normalizeRssMetadata(input: Record<string, unknown>) {
  return {
    feedLanguage:       s(input.feedLanguage,       defaultFeedRssMetadata.feedLanguage),
    feedCopyright:      s(input.feedCopyright,      defaultFeedRssMetadata.feedCopyright),
    feedDescription:    s(input.feedDescription,    defaultFeedRssMetadata.feedDescription),
    feedManagingEditor: s(input.feedManagingEditor, defaultFeedRssMetadata.feedManagingEditor),
    feedWebMaster:      s(input.feedWebMaster,      defaultFeedRssMetadata.feedWebMaster),
    feedPubDate:        s(input.feedPubDate,        defaultFeedRssMetadata.feedPubDate),
    feedLastBuildDate:  s(input.feedLastBuildDate,  defaultFeedRssMetadata.feedLastBuildDate),
    feedCategories:     Array.isArray(input.feedCategories) ? input.feedCategories : [],
    feedDocs:           s(input.feedDocs,           defaultFeedRssMetadata.feedDocs),
    feedGenerator:      s(input.feedGenerator,      defaultFeedRssMetadata.feedGenerator),
    feedSkipHours:      Array.isArray(input.feedSkipHours) ? input.feedSkipHours : [],
    feedSkipDays:       Array.isArray(input.feedSkipDays)  ? input.feedSkipDays  : [],
    feedTtl:            typeof input.feedTtl === "number" ? input.feedTtl : undefined,
    feedImage:          s(input.feedImage) || undefined,
  };
}

export function normalizeLoadedFeedConfig(input: Record<string, unknown>): FeedConfig {
  const feedType = s(input.feedType, "webScraping");

  const base = {
    schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : 1,
    feedId:        s(input.feedId),
    feedName:      s(input.feedName, "RSS Feed"),
    feedType,
    enabled:       b(input.enabled, true),
    refreshTime:   n(input.refreshTime, 5),
    reverse:       b(input.reverse, false),
    strict:        b(input.strict, false),
    advanced:      b(input.advanced, false),
    headers:       (input.headers as Record<string, unknown>) ?? {},
    cookies:       Array.isArray(input.cookies) ? input.cookies : [],
    webhook:       input.webhook as FeedConfig["webhook"],
    flaresolverr:  input.flaresolverr as FeedConfig["flaresolverr"],
    metadata:      input.metadata as FeedConfig["metadata"],
    ...normalizeRssMetadata(input),
  };

  if (feedType === "webScraping") {
    return {
      ...base,
      feedType: "webScraping",
      config: (input.config as WebScrapingFeedConfig["config"]) ?? { baseUrl: "" },
      article: normalizeArticle((input.article as Record<string, unknown>) ?? {}),
    } as WebScrapingFeedConfig;
  }

  if (feedType === "rest") {
    return {
      ...base,
      feedType: "rest",
      config: (input.config as RestFeedConfig["config"]) ?? { baseUrl: "" },
      apiMapping: (input.apiMapping as RestFeedConfig["apiMapping"]) ?? {},
    } as RestFeedConfig;
  }

  if (feedType === "api") {
    return {
      ...base,
      feedType: "api",
      config: (input.config as ApiFeedConfig["config"]) ?? { baseUrl: "" },
      apiMapping: (input.apiMapping as ApiFeedConfig["apiMapping"]) ?? {},
    } as ApiFeedConfig;
  }

  if (feedType === "email") {
    return {
      ...base,
      feedType: "email",
      config: (input.config as EmailFeedConfig["config"]) ?? {
        host: "", port: 993, user: "", folder: "INBOX", emailCount: 10,
      },
    } as EmailFeedConfig;
  }

  // Stub types and unknown — pass through base with their source block
  return {
    ...base,
    feedType,
    [feedType]: (input[feedType] as Record<string, unknown>) ?? {},
  } as FeedConfig;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/feed-config-normalizer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-config-normalizer.utility.ts tests/feed-config-normalizer.test.ts
git commit -m "feat: add normalizeLoadedFeedConfig"
```

---

### Task 4: Feed config validator

**Files:**
- Create: `utilities/feed-config-validator.utility.ts`
- Create: `tests/feed-config-validator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/feed-config-validator.test.ts
import { describe, it, expect } from "bun:test";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";

function makeWS(overrides: Record<string, unknown> = {}) {
  return normalizeLoadedFeedConfig({
    feedId: "test-id",
    feedName: "Test",
    feedType: "webScraping",
    refreshTime: 5,
    config: { baseUrl: "https://example.com" },
    article: { iterator: { selector: "article" } },
    ...overrides,
  });
}

describe("validateFeedConfig — global checks", () => {
  it("passes a valid webScraping config", () => {
    const result = validateFeedConfig(makeWS());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when feedId is missing", () => {
    const result = validateFeedConfig(makeWS({ feedId: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "feedId")).toBe(true);
  });

  it("errors when feedName is missing", () => {
    const result = validateFeedConfig(makeWS({ feedName: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "feedName")).toBe(true);
  });

  it("errors when refreshTime is zero", () => {
    const config = { ...makeWS(), refreshTime: 0 };
    const result = validateFeedConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "refreshTime")).toBe(true);
  });
});

describe("validateFeedConfig — webScraping", () => {
  it("errors when config.baseUrl is missing", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "x", feedName: "X", feedType: "webScraping", refreshTime: 5,
      config: {}, article: { iterator: { selector: "li" } },
    });
    const result = validateFeedConfig(config);
    expect(result.errors.some((e) => e.path === "config.baseUrl")).toBe(true);
  });

  it("errors when article.iterator.selector is missing", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "x", feedName: "X", feedType: "webScraping", refreshTime: 5,
      config: { baseUrl: "https://x.com" }, article: { iterator: {} },
    });
    const result = validateFeedConfig(config);
    expect(result.errors.some((e) => e.path === "article.iterator.selector")).toBe(true);
  });
});

describe("validateFeedConfig — rest/api", () => {
  it("passes with no apiMapping.items (root-is-array behaviour)", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "r1", feedName: "REST", feedType: "rest", refreshTime: 5,
      config: { baseUrl: "https://api.com" }, apiMapping: {},
    });
    expect(validateFeedConfig(config).valid).toBe(true);
  });

  it("errors when config.baseUrl is missing for rest", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "r1", feedName: "REST", feedType: "rest", refreshTime: 5,
      config: {}, apiMapping: {},
    });
    expect(validateFeedConfig(config).valid).toBe(false);
  });
});

describe("validateFeedConfig — email", () => {
  it("errors when email host is missing", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "e1", feedName: "Email", feedType: "email", refreshTime: 5,
      config: { host: "", port: 993, user: "u", folder: "INBOX", emailCount: 10, encryptedPassword: "enc" },
    });
    const result = validateFeedConfig(config);
    expect(result.errors.some((e) => e.path === "config.host")).toBe(true);
  });

  it("errors when no password or encryptedPassword", () => {
    const config = normalizeLoadedFeedConfig({
      feedId: "e1", feedName: "Email", feedType: "email", refreshTime: 5,
      config: { host: "imap.gmail.com", port: 993, user: "u@g.com", folder: "INBOX", emailCount: 10 },
    });
    const result = validateFeedConfig(config);
    expect(result.errors.some((e) => e.path === "config.password")).toBe(true);
  });
});

describe("validateFeedConfig — warnings", () => {
  it("warns on plain Authorization header", () => {
    const config = makeWS({ headers: { Authorization: "Bearer plain-token" } });
    const result = validateFeedConfig(config);
    expect(result.warnings.some((w) => w.path.includes("Authorization"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/feed-config-validator.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the validator**

```typescript
// utilities/feed-config-validator.utility.ts
import type { FeedConfig, WebScrapingFeedConfig, RestFeedConfig, ApiFeedConfig, EmailFeedConfig } from "../models/feed-config.model";
import { findPlainSensitiveValues } from "./sensitive-config.utility";

export type ValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export function validateFeedConfig(config: FeedConfig): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const err = (path: string, message: string) => errors.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => warnings.push({ path, message, severity: "warning" });

  if (!config.feedId)   err("feedId",      "feedId is required");
  if (config.feedId && !/^[A-Za-z0-9_-]+$/.test(config.feedId)) {
    err("feedId", "feedId may only contain letters, numbers, underscores, and hyphens");
  }
  if (!config.feedName) err("feedName",    "feedName is required");
  if (!config.refreshTime || config.refreshTime <= 0) err("refreshTime", "refreshTime must be a positive number");

  // Sensitive plain value warnings
  for (const finding of findPlainSensitiveValues(config.headers ?? {})) {
    warn(`headers.${finding.path}`, finding.message);
  }
  for (const finding of findPlainSensitiveValues(config.cookies ?? [])) {
    warn(`cookies.${finding.path}`, finding.message);
  }

  const t = config.feedType;
  const supportedFeedTypes = new Set([
    "webScraping", "rest", "api", "email", "graphql", "calendar", "sitemap",
    "filesystem", "webhook", "feedTransformer", "serviceConnector", "changeDetection",
  ]);
  if (!supportedFeedTypes.has(t)) {
    err("feedType", `Unsupported feedType: ${String(t)}`);
  }

  if (t === "webScraping") {
    const ws = config as WebScrapingFeedConfig;
    if (!ws.config?.baseUrl) err("config.baseUrl", "baseUrl is required for webScraping feeds");
    if (!ws.article?.iterator?.selector) err("article.iterator.selector", "iterator selector is required for webScraping feeds");
  }

  if (t === "rest" || t === "api") {
    const api = config as RestFeedConfig | ApiFeedConfig;
    if (!api.config?.baseUrl) err("config.baseUrl", "baseUrl is required for REST/API feeds");
    // apiMapping.items is intentionally not required — empty means root response is the array
  }

  if (t === "email") {
    const email = config as EmailFeedConfig;
    if (!email.config?.host)   err("config.host",   "host is required for email feeds");
    if (!email.config?.user)   err("config.user",   "user is required for email feeds");
    if (!email.config?.folder) err("config.folder", "folder is required for email feeds");
    if (!email.config?.password && !email.config?.encryptedPassword) {
      err("config.password", "a password or encryptedPassword is required for email feeds");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/feed-config-validator.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utilities/feed-config-validator.utility.ts tests/feed-config-validator.test.ts
git commit -m "feat: add validateFeedConfig with per-type required field checks"
```

---

### Task 5: Feed config caster

**Files:**
- Create: `utilities/feed-config-caster.utility.ts`
- Create: `tests/feed-config-caster.test.ts`

- [ ] **Step 1: Write failing caster tests**

```typescript
// tests/feed-config-caster.test.ts
import { describe, it, expect } from "bun:test";
import { castFeedFormDataToFeedConfig } from "../utilities/feed-config-caster.utility";
import type { WebScrapingFeedConfig, RestFeedConfig, EmailFeedConfig } from "../models/feed-config.model";
import { isProtectedValue } from "../utilities/protected-values.utility";

const KEY = "a18c1fd2211edd76a18c1fd2211edd76";

const baseFormData = {
  feedName: "Test Feed",
  refreshTime: 10,
  reverse: false,
  strict: false,
  advanced: false,
  headers: {},
  cookies: [],
};

describe("castFeedFormDataToFeedConfig — webScraping", () => {
  it("produces schemaVersion 2", () => {
    const data = { ...baseFormData, feedType: "webScraping", feedUrl: "https://x.com", itemSelector: "li" };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY });
    expect(result.schemaVersion).toBe(2);
  });

  it("assigns a feedId when not provided", () => {
    const data = { ...baseFormData, feedType: "webScraping", feedUrl: "https://x.com", itemSelector: "li" };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY });
    expect(typeof result.feedId).toBe("string");
    expect(result.feedId.length).toBeGreaterThan(0);
  });

  it("uses provided feedId", () => {
    const data = { ...baseFormData, feedType: "webScraping" as const, feedUrl: "https://x.com", itemSelector: "li" };
    const result = castFeedFormDataToFeedConfig(data, { feedId: "my-id", encryptionKey: KEY });
    expect(result.feedId).toBe("my-id");
  });

  it("maps feedUrl to config.baseUrl", () => {
    const data = { ...baseFormData, feedType: "webScraping" as const, feedUrl: "https://x.com", itemSelector: "article" };
    const result = castFeedFormDataToFeedConfig(data as FeedFormData, { encryptionKey: KEY }) as WebScrapingFeedConfig;
    expect(result.config.baseUrl).toBe("https://x.com");
  });

  it("maps itemSelector to article.iterator.selector", () => {
    const data = { ...baseFormData, feedType: "webScraping" as const, feedUrl: "https://x.com", itemSelector: "article.card" };
    const result = castFeedFormDataToFeedConfig(data as FeedFormData, { encryptionKey: KEY }) as WebScrapingFeedConfig;
    expect(result.article.iterator?.selector).toBe("article.card");
  });
});

describe("castFeedFormDataToFeedConfig — api → rest", () => {
  it("converts feedType api to rest", () => {
    const data = { ...baseFormData, feedType: "api", feedUrl: "https://api.com", apiItemsPath: "data" };
    const result = castFeedFormDataToFeedConfig(data as FeedFormData, { encryptionKey: KEY });
    expect(result.feedType).toBe("rest");
  });

  it("maps apiItemsPath to apiMapping.items", () => {
    const data = { ...baseFormData, feedType: "api", feedUrl: "https://api.com", apiItemsPath: "results" };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY }) as RestFeedConfig;
    expect(result.apiMapping.items).toBe("results");
  });
});

describe("castFeedFormDataToFeedConfig — email", () => {
  it("writes password as ProtectedValue, not encryptedPassword", () => {
    const data = {
      ...baseFormData,
      feedType: "email",
      emailHost: "imap.gmail.com",
      emailPort: 993,
      emailUsername: "user@gmail.com",
      emailPassword: "my-password",
      emailFolder: "INBOX",
      emailCount: 10,
    };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY }) as EmailFeedConfig;
    expect(isProtectedValue(result.config.password)).toBe(true);
    expect(result.config.encryptedPassword).toBeUndefined();
  });
});

describe("castFeedFormDataToFeedConfig — protected headers", () => {
  it("encrypts a new protected header value", () => {
    const data = {
      ...baseFormData,
      feedType: "webScraping" as const,
      feedUrl: "https://x.com",
      itemSelector: "li",
      headers: { Authorization: { type: "protected" as const, value: "my-token" } },
    };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY }) as WebScrapingFeedConfig;
    const authHeader = result.headers?.Authorization;
    expect(isProtectedValue(authHeader)).toBe(true);
    expect((authHeader as { value: string }).value).not.toBe("my-token");
  });

  it("leaves a masked ******** header value unchanged (preserving existing ciphertext)", () => {
    const data = {
      ...baseFormData,
      feedType: "webScraping" as const,
      feedUrl: "https://x.com",
      itemSelector: "li",
      headers: { Authorization: { type: "protected" as const, value: "********" } },
    };
    const result = castFeedFormDataToFeedConfig(data, { encryptionKey: KEY }) as WebScrapingFeedConfig;
    const authHeader = result.headers?.Authorization;
    expect((authHeader as { value: string }).value).toBe("********");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/feed-config-caster.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the caster**

```typescript
// utilities/feed-config-caster.utility.ts
import { v4 as uuidv4 } from "uuid";
import { isProtectedValue, protectValue } from "./protected-values.utility";
import type { ProtectedRecord, ProtectedValue } from "../models/protected-value.model";
import type { FeedConfig, WebScrapingFeedConfig, RestFeedConfig, EmailFeedConfig } from "../models/feed-config.model";
import { defaultFeedRssMetadata } from "../models/feed-config.model";
import type { ApiMapping } from "../models/api-mapping.model";
import CSSTarget from "../models/csstarget.model";

// Accepts the flat FeedFormData shape from the frontend without importing the frontend type.
// All field reads use optional chaining so missing fields degrade gracefully.
type FormInput = Record<string, unknown>;

export type CastContext = {
  feedId?: string;
  encryptionKey: string;
};

// Encrypt any { type: "protected", value: "not-asterisks" } values in a record
function encryptPendingProtectedValues(
  record: Record<string, unknown>,
  key: string,
): ProtectedRecord {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => {
      if (isProtectedValue(v) && v.type === "protected" && v.value !== "********") {
        return [k, protectValue(v.value, key)];
      }
      return [k, v];
    }),
  );
}

function kvPairsToRecord(pairs: Array<{ key: string; value: string }> | undefined): Record<string, string> {
  if (!Array.isArray(pairs)) return {};
  return Object.fromEntries(pairs.filter((p) => p.key?.trim()).map((p) => [p.key.trim(), p.value ?? ""]));
}

function buildCSSTargetFromForm(
  prefix: string,
  data: Record<string, unknown>,
): CSSTarget | undefined {
  const selector = data[`${prefix}Selector`] as string | undefined;
  if (!selector) return undefined;
  return new CSSTarget(
    selector,
    data[`${prefix}Attribute`] as string | undefined,
    data[`${prefix}StripHtml`] as boolean | undefined,
    data[`${prefix}BaseUrl`] as string | undefined,
    data[`${prefix}RelativeLink`] as boolean | undefined,
    data[`${prefix}TitleCase`] as boolean | undefined,
    undefined, // iterator
    data[`${prefix}Format`] as string | undefined,
    data[`${prefix}CustomDateFormat`] as string | undefined,
  );
}

export function castFeedFormDataToFeedConfig(
  data: FormInput,
  context: CastContext,
): FeedConfig {
  const feedId = context.feedId ?? uuidv4();
  const feedType = (data.feedType as string) === "api" ? "rest" : (data.feedType as string);
  const encKey = context.encryptionKey;

  const headers = encryptPendingProtectedValues(
    (data.headers as unknown as Record<string, unknown>) ?? {},
    encKey,
  );

  const base = {
    schemaVersion: 2 as const,
    feedId,
    feedName: data.feedName ?? "RSS Feed",
    feedType,
    enabled: true,
    refreshTime: Number(data.refreshTime) || 5,
    reverse: data.reverse ?? false,
    strict: data.strict ?? false,
    advanced: data.advanced ?? false,
    headers,
    cookies: Array.isArray(data.cookies) ? data.cookies : [],
    webhook: data.webhook?.enabled && data.webhook?.url ? {
      enabled: true,
      url: data.webhook.url,
      format: data.webhook.format ?? "xml",
      newItemsOnly: data.webhook.newItemsOnly ?? true,
    } : undefined,
    flaresolverr: data.flaresolverr?.enabled && data.flaresolverr?.serverUrl ? {
      enabled: true,
      serverUrl: data.flaresolverr.serverUrl,
      timeout: data.flaresolverr.timeout ?? 60000,
    } : undefined,
    ...defaultFeedRssMetadata,
    feedLanguage: data.feedLanguage ?? "",
    feedDescription: data.feedDescription ?? "",
  };

  if (feedType === "webScraping") {
    const d = data as Record<string, unknown>;
    const iterator = buildCSSTargetFromForm("item", d) ?? new CSSTarget(data.itemSelector ?? "");
    return {
      ...base,
      feedType: "webScraping",
      config: { baseUrl: (data.feedUrl ?? "") as string },
      article: {
        iterator,
        title:          buildCSSTargetFromForm("title", d),
        link:           buildCSSTargetFromForm("link", d),
        description:    buildCSSTargetFromForm("description", d),
        author:         buildCSSTargetFromForm("author", d),
        categories:     buildCSSTargetFromForm("categories", d),
        comments:       buildCSSTargetFromForm("commentsUrl", d),
        enclosure:      buildCSSTargetFromForm("enclosure", d),
        guid:           buildCSSTargetFromForm("guid", d),
        date:           buildCSSTargetFromForm("date", d),
        pubDate:        buildCSSTargetFromForm("date", d),
        contentEncoded: buildCSSTargetFromForm("contentEncoded", d),
        summary:        buildCSSTargetFromForm("summary", d),
        contributors:   buildCSSTargetFromForm("contributors", d),
        lat:            buildCSSTargetFromForm("lat", d),
        long:           buildCSSTargetFromForm("long", d),
        source: {
          title: buildCSSTargetFromForm("sourceTitle", d) ?? new CSSTarget(),
          url:   buildCSSTargetFromForm("sourceUrl",   d) ?? new CSSTarget(),
        },
      },
    } as WebScrapingFeedConfig;
  }

  if (feedType === "rest") {
    return {
      ...base,
      feedType: "rest",
      config: {
        baseUrl:          data.feedUrl ?? "",
        method:           data.apiMethod ?? "GET",
        route:            data.apiRoute ?? "",
        params:           encryptPendingProtectedValues(kvPairsToRecord(data.apiParams), encKey),
        apiSpecificHeaders: encryptPendingProtectedValues(kvPairsToRecord(data.apiHeaders), encKey),
        apiSpecificBody:  kvPairsToRecord(data.apiBody),
        advanced:         data.advanced ?? false,
      },
      apiMapping: {
        items:            data.apiItemsPath ?? "",
        title:            data.apiTitleField ?? "",
        link:             data.apiLinkField ?? "",
        description:      data.apiDescriptionField ?? "",
        author:           data.apiAuthor ?? "",
        date:             data.apiDateField ?? "",
        guid:             data.apiGuid ?? "",
        enclosureUrl:     data.apiEnclosureUrl ?? "",
        enclosureLength:  data.apiEnclosureSize ?? "",
        enclosureType:    data.apiEnclosureType ?? "",
        contentEncoded:   data.apiContentEncoded ?? "",
        summary:          data.apiSummary ?? "",
        contributors:     data.apiContributors ?? "",
        lat:              data.apiLat ?? "",
        long:             data.apiLong ?? "",
        categories:       data.apiCategories ?? "",
        comments:         data.apiCommentsUrl ?? "",
        sourceTitle:      data.apiSourceTitle ?? "",
        sourceUrl:        data.apiSourceUrl ?? "",
        feedTitlePath:    data.apiFeedTitle ?? "",
        feedDescriptionPath: data.apiFeedDescription ?? "",
        feedLanguagePath: data.apiFeedLanguage ?? "",
        feedCopyrightPath: data.apiFeedCopyright ?? "",
        feedManagingEditorPath: data.apiFeedManagingEditor ?? "",
        feedWebMasterPath: data.apiFeedWebMaster ?? "",
        feedPubDatePath:  data.apiFeedPubDate ?? "",
        feedCategoriesPath: data.apiFeedCategories ?? "",
        feedTtlPath:      data.apiFeedTtl ?? "",
        feedSkipHoursPath: data.apiFeedSkipHours ?? "",
        feedSkipDaysPath: data.apiFeedSkipDays ?? "",
        feedImageUrl:     data.apiFeedImageUrl ?? "",
      },
    } as RestFeedConfig;
  }

  if (feedType === "email") {
    return {
      ...base,
      feedType: "email",
      feedLanguage: "en",
      feedDescription: `Emails from folder: ${data.emailFolder ?? "INBOX"}`,
      config: {
        host:         data.emailHost ?? "",
        port:         Number(data.emailPort) || 993,
        user:         data.emailUsername ?? "",
        folder:       data.emailFolder ?? "INBOX",
        emailCount:   Number(data.emailCount) || 10,
        password:     data.emailPassword
          ? protectValue(data.emailPassword, encKey)
          : undefined,
      },
    } as EmailFeedConfig;
  }

  throw new Error(`castFeedFormDataToFeedConfig: unsupported feedType "${feedType}"`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/feed-config-caster.test.ts
```

Expected: PASS

- [ ] **Step 5: Run all tests to confirm no regressions**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add utilities/feed-config-caster.utility.ts tests/feed-config-caster.test.ts
git commit -m "feat: add castFeedFormDataToFeedConfig with web scraping, REST, and email casters"
```

---

### Task 6: Wire normalizer into worker and GET /api/feeds/:id/config

**Files:**
- Modify: `workers/feed-updater.worker.ts`
- Modify: `index.ts`

- [ ] **Step 1: Add normalizer import to feed-updater.worker.ts**

At the top of `workers/feed-updater.worker.ts`:

```typescript
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
```

- [ ] **Step 2: Normalize at the top of fetchDataAndUpdateFeed**

Find `async function fetchDataAndUpdateFeed(feedConfig: any)` (line ~18). Replace the first line of the function body with:

```typescript
async function fetchDataAndUpdateFeed(rawConfig: Record<string, unknown>) {
  const feedConfig = normalizeLoadedFeedConfig(rawConfig);
```

- [ ] **Step 3: Add "rest" to the feedType dispatch switch**

Find the `if (feedConfig.feedType === "api")` branch and add `"rest"`:

```typescript
} else if (feedConfig.feedType === "api" || feedConfig.feedType === "rest") {
```

- [ ] **Step 4: Add normalizer import to index.ts**

```typescript
import { normalizeLoadedFeedConfig } from "./utilities/feed-config-normalizer.utility";
import { maskProtectedValues } from "./utilities/protected-values.utility";
```

- [ ] **Step 5: Update GET /api/feeds/:id/config to normalize and mask**

Find the route `app.get("/api/feeds/:id/config", ...)` (around line 1185). Replace:

```typescript
const config = yaml.load(yamlContent);
return ctx.json(config);
```

With:

```typescript
const raw = yaml.load(yamlContent) as Record<string, unknown>;
const config = normalizeLoadedFeedConfig(raw);
return ctx.json(maskProtectedValues(config));
```

- [ ] **Step 6: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add workers/feed-updater.worker.ts index.ts
git commit -m "feat: normalize feed config at worker dispatch and on GET config endpoint"
```

---

### Task 7: Wire caster + validator into POST / (create)

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add caster and validator imports**

```typescript
import { castFeedFormDataToFeedConfig } from "./utilities/feed-config-caster.utility";
import { validateFeedConfig } from "./utilities/feed-config-validator.utility";
```

- [ ] **Step 2: Find the start of the POST / handler body — locate where finalFeedConfig is assembled (around line 532)**

The existing code builds `configData`, `articleData`, `apiMappingData`, `emailConfigData` and assembles `finalFeedConfig`. Replace the entire assembly block with the caster:

```typescript
// Replace from "let configData: any = {};" down to "const finalFeedConfig = {...}"
const finalFeedConfig = castFeedFormDataToFeedConfig(body as any, {
  feedId: uuidv4(),
  encryptionKey,
});

const validation = validateFeedConfig(finalFeedConfig);
if (!validation.valid) {
  if (contentType.includes("application/json")) {
    return ctx.json({ errors: validation.errors, warnings: validation.warnings }, 400);
  }
  return ctx.text(validation.errors.map((e) => e.message).join("\n"), 400);
}
```

- [ ] **Step 3: Update the success response to mask the echoed config**

Find the `return ctx.json({ message: "RSS feed is being generated.", ... })` and update:

```typescript
return ctx.json({
  message: "RSS feed is being generated.",
  feedUrl: `public/feeds/${finalFeedConfig.feedId}.xml`,
  feedId: finalFeedConfig.feedId,
  config: maskProtectedValues(finalFeedConfig),
});
```

- [ ] **Step 4: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add index.ts
git commit -m "feat: POST / now uses castFeedFormDataToFeedConfig + validateFeedConfig"
```

---

### Task 8: Wire caster + validator into PUT /api/feeds/:id (update)

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add preserveMaskedProtectedValues to the import**

```typescript
import { maskProtectedValues, preserveMaskedProtectedValues } from "./utilities/protected-values.utility";
```

- [ ] **Step 2: Find the PUT /api/feeds/:id handler (around line 1198)**

The existing handler reads `existingConfig`, then assembles an update config inline. Replace the assembly with:

```typescript
// After reading existingYaml and existingConfig...
const incomingBody = await ctx.req.json();

// 1. Cast — encrypts new protected values, leaves "********" alone
const castConfig = castFeedFormDataToFeedConfig(incomingBody as any, {
  feedId: feedId,
  encryptionKey,
});

// 2. Preserve — restores "********" sentinels to original ciphertext
const finalFeedConfig = preserveMaskedProtectedValues(castConfig, existingConfig);

// 3. Validate
const validation = validateFeedConfig(finalFeedConfig as any);
if (!validation.valid) {
  return ctx.json({ errors: validation.errors, warnings: validation.warnings }, 400);
}
```

- [ ] **Step 3: Update the PUT success response to mask the echoed config**

```typescript
return ctx.json({
  message: "Feed updated successfully.",
  feedId,
  config: maskProtectedValues(finalFeedConfig),
});
```

- [ ] **Step 4: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add index.ts
git commit -m "feat: PUT /api/feeds/:id uses caster + preserveMaskedProtectedValues + validator"
```

---

### Task 9: Wire caster + validator into POST /preview

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Find the POST /preview handler**

```bash
grep -n "preview" /home/timb/projects/mkfd/index.ts | grep "app\." | head -5
```

- [ ] **Step 2: Replace the inline config assembly in /preview with the caster**

Find the existing preview handler. It currently assembles a config inline (similar to POST `/`). Replace the assembly with:

```typescript
const previewBody = await ctx.req.json().catch(() => ctx.req.parseBody());
const previewConfig = castFeedFormDataToFeedConfig(previewBody as Record<string, unknown>, {
  feedId: "preview",
  encryptionKey,
});

const previewValidation = validateFeedConfig(previewConfig);
if (!previewValidation.valid) {
  return ctx.json({ errors: previewValidation.errors, warnings: previewValidation.warnings }, 400);
}

// Pass previewConfig to the existing preview generation logic (buildRSS / buildRSSFromApiData)
```

- [ ] **Step 3: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "feat: POST /preview uses caster + validator before generating preview"
```

---

### Task 10: Frontend converter and FeedBuilderForm update

**Files:**
- Create: `frontend/src/lib/feed-config-builder.ts`
- Modify: `frontend/src/components/forms/FeedBuilderForm.tsx`

- [ ] **Step 1: Create the frontend converter**

```typescript
// frontend/src/lib/feed-config-builder.ts
import type { FeedFormData } from "@/types/feed";

// Converts FeedFormData (react-hook-form state) to the typed shape the backend expects.
// The backend caster handles feedId assignment and encryption — we just reshape the data.
export function buildFeedConfigFromFormData(data: FeedFormData): Record<string, unknown> {
  // The backend caster already handles all field mapping from FeedFormData.
  // We just send the data as-is since the caster was written to accept FeedFormData shape.
  // This function exists as the explicit boundary — future transformations go here.
  return data as unknown as Record<string, unknown>;
}
```

This is intentionally thin — the caster does all the mapping on the backend. The function's purpose is to be the explicit seam where future frontend-side transformations can be added without hunting through `onSubmit` handlers.

- [ ] **Step 2: Update FeedBuilderForm.tsx onSubmit to use the converter**

Find the `onSubmit` function in `frontend/src/components/forms/FeedBuilderForm.tsx` (around line 66):

```typescript
const onSubmit = async (data: FeedFormData) => {
  setIsSubmitting(true);
  try {
    const url = mode === "edit" && feedId ? `/api/feeds/${feedId}` : "/";
    const method = mode === "edit" ? "PUT" : "POST";
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),         // ← change this line
    });
```

Add the import at the top of the file:

```typescript
import { buildFeedConfigFromFormData } from "@/lib/feed-config-builder";
```

Change `JSON.stringify(data)` to `JSON.stringify(buildFeedConfigFromFormData(data))`.

Also update the error handling to surface validation errors from the backend:

```typescript
if (!response.ok) {
  const errorBody = await response.json().catch(() => null);
  const msg = errorBody?.errors?.map((e: { message: string }) => e.message).join("\n")
    ?? (mode === "edit" ? "Error updating feed" : "Error creating feed");
  alert(msg);
  return;
}
```

- [ ] **Step 3: Start the dev server and verify create + edit still work**

```bash
cd /home/timb/projects/mkfd/frontend && bun run dev
```

Open `http://localhost:5173`. Create a new web scraping feed end-to-end:
1. Enter a URL, item selector, title selector
2. Submit — confirm a success message appears
3. Check `./configs/` — a YAML file with `schemaVersion: 2` should exist

Also test an API feed and an email feed creation. Stop the server with Ctrl+C.

- [ ] **Step 4: Run all backend tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 5: Run all backend tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/feed-config-builder.ts frontend/src/components/forms/FeedBuilderForm.tsx
git commit -m "feat: frontend sends FeedConfig via buildFeedConfigFromFormData converter"
```
