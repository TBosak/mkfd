# Feed Configuration Formalization — Design Spec

**Date:** 2026-05-22
**Tier:** R1 Foundation
**Status:** Approved

---

## Goal

Replace ad-hoc inline config assembly in `index.ts` with an explicit TypeScript `FeedConfig` discriminated union, a normalizer for reading old and new YAML, a caster for converting frontend form data, and a validator that runs before every YAML write. Existing configs continue working unchanged. New saves write `schemaVersion: 2`. The frontend sends typed `FeedConfig` objects via a thin converter function rather than raw `FeedFormData`.

---

## Scope

### In scope

- `FeedConfig` discriminated union model covering all current and future feed types
- `FeedConfigBase<T>`, per-type shapes, stub types for future feed types
- `FeedMetadata` model
- `normalizeLoadedFeedConfig` — raw YAML → typed `FeedConfig`, in-memory only
- `castFeedFormDataToFeedConfig` — `FeedFormData` → typed `FeedConfig`
- `validateFeedConfig` — per-type required field checks + sensitive value warnings
- Route wiring: POST `/`, PUT `/api/feeds/:id`, POST `/preview`, GET `/api/feeds/:id/config`
- Worker dispatch normalization
- Frontend `buildFeedConfigFromFormData` converter + `onSubmit` handler updates in three forms

### Out of scope

- Automatic rewriting of existing YAML files on startup
- Frontend form field restructuring — `FeedFormData` shape stays as-is
- Per-type validation for stub feed types — each feature spec adds its own rules
- Community catalog submission guards — Community Catalog spec
- `FeedCookie` type — defined in `models/protected-value.model.ts` (Protected Value spec)

---

## Core Model

### `models/feed-metadata.model.ts`

```ts
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

### `models/feed-config.model.ts`

Imports `CSSTargetFields` from `models/csstarget.model.ts` and `ApiMapping` from `models/api-mapping.model.ts` — neither file changes.
Imports `ProtectedRecord`, `FeedCookie`, `ProtectedValue` from `models/protected-value.model.ts`.
Imports `FeedMetadata` from `models/feed-metadata.model.ts`.

#### FeedType

```ts
export type FeedType =
  | "webScraping"
  | "rest"
  | "api"          // legacy alias for "rest" — normalised identically
  | "email"
  | "graphql"
  | "calendar"
  | "sitemap"
  | "filesystem"
  | "webhook"
  | "feedTransformer"
  | "serviceConnector"
  | "changeDetection";
```

#### FeedRssMetadata

```ts
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

export const defaultFeedRssMetadata: Required<Omit<FeedRssMetadata, "feedTtl" | "feedImage">> = {
  feedLanguage: "",
  feedCopyright: "",
  feedDescription: "",
  feedManagingEditor: "",
  feedWebMaster: "",
  feedPubDate: "",
  feedLastBuildDate: "",
  feedCategories: [],
  feedDocs: "https://www.rssboard.org/rss-specification",
  feedGenerator: "MkFD Feed Generator",
  feedSkipHours: [],
  feedSkipDays: [],
};
```

#### FeedConfigBase

```ts
export type OutgoingWebhookConfig = {
  enabled: boolean;
  url?: string | ProtectedValue;
  method?: "POST" | "PUT";
  headers?: ProtectedRecord;
  newItemsOnly?: boolean;
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
```

#### Implemented feed types

```ts
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

// "rest" is the canonical name; "api" is the legacy alias — identical shape
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
  password?: ProtectedValue;       // preferred — written by new saves
  encryptedPassword?: string;      // legacy — read-only backward compat
};

export type EmailFeedConfig = FeedConfigBase<"email"> & {
  config: EmailSourceConfig;
};
```

#### Stub types for future feed types

These use `Record<string, unknown>` for their source block until the feature spec defines the real shape.

```ts
export type GraphQLFeedConfig     = FeedConfigBase<"graphql">          & { graphql: Record<string, unknown>; apiMapping: ApiMapping };
export type CalendarFeedConfig    = FeedConfigBase<"calendar">         & { calendar: Record<string, unknown> };
export type SitemapFeedConfig     = FeedConfigBase<"sitemap">          & { sitemap: Record<string, unknown> };
export type FilesystemFeedConfig  = FeedConfigBase<"filesystem">       & { filesystem: Record<string, unknown> };
export type WebhookFeedConfig     = FeedConfigBase<"webhook">          & { webhookFeed: Record<string, unknown> };
export type FeedTransformerFeedConfig = FeedConfigBase<"feedTransformer"> & { feedTransformer: Record<string, unknown> };
export type ServiceConnectorFeedConfig = FeedConfigBase<"serviceConnector"> & { serviceConnector: Record<string, unknown> };
export type ChangeDetectionFeedConfig  = FeedConfigBase<"changeDetection">  & { changeDetection: Record<string, unknown> };
```

#### FeedConfig union

```ts
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

---

## Normalizer

### `utilities/feed-config-normalizer.utility.ts`

```ts
export function normalizeLoadedFeedConfig(input: Record<string, unknown>): FeedConfig
```

**Rules:**

- Never throws — always returns a runnable config
- `feedType: "api"` → kept as `"api"` (not converted to `"rest"`); worker and caster treat both identically
- `article.pubDate` and `article.date` — whichever is present is mirrored onto both keys
- Missing `schemaVersion` → treated as `1` in memory; not written back unless config is re-saved
- Missing optional fields use defaults: `enabled: true`, `refreshTime: 5`, `headers: {}`, `cookies: []`, RSS metadata from `defaultFeedRssMetadata`
- Unknown `feedType` → returns base config with the type preserved; validator catches it
- Called at: worker dispatch boundary, GET `/api/feeds/:id/config` before returning

---

## Caster

### `utilities/feed-config-caster.utility.ts`

```ts
export type CastContext = {
  feedId?: string;       // assigned from existing config on update; new UUID on create if absent
  encryptionKey: string;
};

export function castFeedFormDataToFeedConfig(
  data: FeedFormData,
  context: CastContext,
): FeedConfig
```

- Dispatches internally to per-type functions: `castWebScrapingFormData`, `castRestFormData`, `castEmailFormData`
- All new configs write `schemaVersion: 2`
- `feedId` is `context.feedId ?? crypto.randomUUID()`
- `feedType: "api"` in submitted data → caster writes `feedType: "rest"` — new saves use the canonical name
- Email: writes `config.password: ProtectedValue` (not `encryptedPassword`)
- The caster runs **before** `preserveMaskedProtectedValues`. It calls `protectValue(value, encryptionKey)` on any `{ type: "protected", value: v }` where `v !== "********"` — those are new plaintexts the user entered. `"********"` values are left as-is; `preserveMaskedProtectedValues` restores them to original ciphertext in the next step. This ordering means the caster never sees raw ciphertext and never needs to distinguish it from plaintext.
- `FeedFormData` field names map to `FeedConfig` field names — this is the only place that mapping lives

---

## Validator

### `utilities/feed-config-validator.utility.ts`

```ts
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

export function validateFeedConfig(config: FeedConfig): ValidationResult
```

**Global checks (all types):**
- `feedId` present — error
- `feedName` present — error
- `refreshTime` positive integer — error
- Sensitive plain values in `headers`, `cookies` — warning (via `findPlainSensitiveValues`)

**Per-type required fields:**

| feedType | Error if missing |
|---|---|
| webScraping | `config.baseUrl`, `article.iterator.selector` |
| rest / api | `config.baseUrl` (`apiMapping.items` optional — empty means root is array) |
| email | `config.host`, `config.user`, `config.folder`, one of `config.password` or `config.encryptedPassword` |
| stub types | no per-type errors yet |

Validator runs before every YAML write (create + update) and before preview generation.

---

## Route Wiring

### `index.ts` changes

**POST `/` (create):**
```
parse body
→ castFeedFormDataToFeedConfig(body, { encryptionKey })
→ validateFeedConfig — 400 on errors
→ yaml.dump + writeFile
→ maskProtectedValues on echoed config in response
```

**PUT `/api/feeds/:id` (update):**
```
load existing config from disk
→ castFeedFormDataToFeedConfig(incoming, { feedId, encryptionKey })  ← encrypts new plaintext, leaves "********" alone
→ preserveMaskedProtectedValues(cast, existing)                      ← restores "********" to original ciphertext
→ validateFeedConfig — 400 on errors
→ yaml.dump + writeFile
→ maskProtectedValues on echoed config in response
```

**POST `/preview`:**
```
castFeedFormDataToFeedConfig(body, { encryptionKey })
→ validateFeedConfig — 400 on errors
→ pass to builder
```

**GET `/api/feeds/:id/config`:**
```
yaml.load
→ normalizeLoadedFeedConfig
→ maskProtectedValues
→ return
```

### `workers/feed-updater.worker.ts` change

At the top of `fetchDataAndUpdateFeed`:
```ts
const feedConfig = normalizeLoadedFeedConfig(rawFeedConfig);
```
Then switch on `feedConfig.feedType`. Both `"api"` and `"rest"` route to the same handler.

---

## Frontend Converter

### `frontend/src/lib/feed-config-builder.ts`

```ts
export function buildFeedConfigFromFormData(data: FeedFormData): Partial<FeedConfig>
```

Returns `Partial<FeedConfig>` — `feedId` is omitted on create (assigned by backend), and sensitive fields are sent as `{ type: "protected", value: "plaintext" }` for the backend to encrypt. The backend's caster handles final assembly.

Each form's `onSubmit` replaces `body: data` or `body: JSON.stringify(data)` with `body: JSON.stringify(buildFeedConfigFromFormData(data))`.

**Affected files:**
- `frontend/src/components/forms/WebScrapingForm.tsx` — `onSubmit` handler
- `frontend/src/components/forms/APIForm.tsx` — `onSubmit` handler
- `frontend/src/components/forms/EmailForm.tsx` — `onSubmit` handler

`FeedFormData` itself does not change.

---

## What This Spec Does Not Cover

- Automatic YAML rewriting on startup — configs only upgrade on re-save
- Frontend form field restructuring — `FeedFormData` stays as-is internally
- Per-type validation rules for stub types — each feature spec adds them
- Community catalog submission guards — Community Catalog spec
- `FeedCookie` type definition — Protected Value spec
