## Goal

Create an explicit, typed Mkfd feed config model that becomes the canonical structure dumped into YAML, while preserving all existing configs.

The new model should:

```text
Keep existing YAML configs working.
Keep the current config + article + apiMapping structure.
Add schemaVersion: 2 for newly saved configs.
Cast form submissions into FeedConfig before writing YAML.
Support all current and future first-class feed sources.
Support serviceConnector without separate config files.
Encrypt sensitive values before saving.
Keep serviceConnector configs out of the community catalog.
```

The key decision:

> Do not replace the current YAML structure with `source` / `item` yet. Formalize the structure Mkfd already uses, then expand it.

---

# 1. Canonical YAML shape

New configs should look like this at the top level:

```yaml
schemaVersion: 2
feedId: 042a8d6a-462c-47dd-a650-a6638ff6260f
feedName: test
feedType: webScraping
enabled: true
refreshTime: 1
reverse: false
strict: true
advanced: false
headers: {}

config: {}
article: {}
apiMapping: {}
serviceConnector: {}
graphql: {}
calendar: {}
sitemap: {}
filesystem: {}
webhookFeed: {}
feedTransformer: {}
changeDetection: {}

metadata: {}

feedLanguage: ''
feedCopyright: ''
feedDescription: ''
feedManagingEditor: ''
feedWebMaster: ''
feedPubDate: ''
feedLastBuildDate: ''
feedCategories: []
feedDocs: https://www.rssboard.org/rss-specification
feedGenerator: MkFD Feed Generator
feedSkipHours: []
feedSkipDays: []
```

Only the block relevant to the selected `feedType` is required.

For example:

```text
webScraping requires config + article.
api/rest requires config + apiMapping.
email requires config.
serviceConnector requires serviceConnector.
calendar requires calendar.
sitemap requires sitemap.
```

Existing configs without `schemaVersion` remain valid.

---

# 2. Add model files

Create these files:

```text
models/feed-config.model.ts
models/protected-value.model.ts
models/feed-metadata.model.ts
models/service-connector.model.ts
```

Optional later:

```text
models/calendar-feed.model.ts
models/sitemap-feed.model.ts
models/filesystem-feed.model.ts
models/webhook-feed.model.ts
models/graphql-feed.model.ts
```

---

# 3. Define `ProtectedValue`

`models/protected-value.model.ts`

```ts
export type ProtectedValue =
  | {
      type: "protected";
      value: string;
    }
  | {
      type: "env";
      value: string;
    };

export type ProtectedRecord = Record<string, string | ProtectedValue>;

export type FeedCookie = {
  name: string;
  value: string | ProtectedValue;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
};
```

Rules:

```text
Service connector auth must be protected or env.
Email passwords should use ProtectedValue in v2.
Legacy encryptedPassword remains valid.
Sensitive headers should warn if plain.
Cookies can remain plain for now, but should support ProtectedValue.
```

---

# 4. Define metadata model

`models/feed-metadata.model.ts`

```ts
export type FeedMetadata = {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  language?: string;
  visibility?: "public" | "private";
  localOnly?: boolean;
  favorite?: boolean;
  origin?: FeedConfigOrigin;
};

export type FeedConfigOrigin = {
  type: "local" | "community" | "sourceAssistant" | "imported";
  catalogId?: string;
  importedAt?: string;
  sourceRepo?: string;
  sourcePath?: string;
};
```

This supports My Feeds filtering, service connector privacy, community catalog import tracking, and Source Assistant provenance.

---

# 5. Define base config model

`models/feed-config.model.ts`

```ts
import type { CSSTargetFields } from "./csstarget.model";
import type { ApiMapping } from "./api-mapping.model";
import type { FeedCookie, ProtectedRecord, ProtectedValue } from "./protected-value.model";
import type { FeedMetadata } from "./feed-metadata.model";
import type { ServiceConnectorConfig } from "./service-connector.model";

export type FeedType =
  | "webScraping"
  | "api"
  | "rest"
  | "graphql"
  | "email"
  | "calendar"
  | "sitemap"
  | "filesystem"
  | "webhook"
  | "serviceConnector"
  | "feedTransformer"
  | "changeDetection";

export type FeedConfig =
  | WebScrapingFeedConfig
  | ApiFeedConfig
  | RestFeedConfig
  | GraphQLFeedConfig
  | EmailFeedConfig
  | CalendarFeedConfig
  | SitemapFeedConfig
  | FilesystemFeedConfig
  | WebhookFeedConfig
  | ServiceConnectorFeedConfig
  | FeedTransformerFeedConfig
  | ChangeDetectionFeedConfig;

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

---

# 6. Define feed-level RSS metadata

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
```

Default values:

```ts
export const defaultFeedRssMetadata: Required<
  Pick<
    FeedRssMetadata,
    | "feedLanguage"
    | "feedCopyright"
    | "feedDescription"
    | "feedManagingEditor"
    | "feedWebMaster"
    | "feedPubDate"
    | "feedLastBuildDate"
    | "feedCategories"
    | "feedDocs"
    | "feedGenerator"
    | "feedSkipHours"
    | "feedSkipDays"
  >
> = {
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

---

# 7. Define existing feed types explicitly

## Web scraping

```ts
export type WebScrapingFeedConfig = FeedConfigBase<"webScraping"> & {
  config: WebScrapingSourceConfig;
  article: WebScrapingArticleConfig;
};

export type WebScrapingSourceConfig = {
  baseUrl: string;
  title?: string;
  method?: "GET";
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  timeoutMs?: number;
  userAgent?: string;
  proxyId?: string;
};

export type WebScrapingArticleConfig = CSSTargetFields & {
  comments?: CSSTarget;
  pubDate?: CSSTarget;
};
```

Important compatibility note:

```text
Existing YAML uses article.pubDate.
Existing model uses date.
The normalizer should support both and mirror them.
```

## API / REST

```ts
export type ApiFeedConfig = FeedConfigBase<"api"> & {
  config: ApiSourceConfig;
  apiMapping: ApiMapping;
};

export type RestFeedConfig = FeedConfigBase<"rest"> & {
  config: ApiSourceConfig;
  apiMapping: ApiMapping;
};

export type ApiSourceConfig = {
  title?: string;
  baseUrl: string;
  method?: string;
  route?: string;
  params?: Record<string, string>;
  headers?: ProtectedRecord;
  apiSpecificHeaders?: ProtectedRecord;
  apiSpecificBody?: Record<string, unknown>;
  cookieString?: string;
  body?: unknown;
  withCredentials?: boolean;
  contributor?: string;
  advanced?: boolean;
};
```

Compatibility rule:

```text
api remains valid.
rest can be added as a clearer alias.
Workers should treat api and rest the same.
```

## Email

```ts
export type EmailFeedConfig = FeedConfigBase<"email"> & {
  config: EmailSourceConfig;
};

export type EmailSourceConfig = {
  host: string;
  port: number;
  user: string;
  encryptedPassword?: string;
  password?: ProtectedValue;
  folder: string;
  emailCount: number;
};
```

Compatibility rule:

```text
New configs should write password: ProtectedValue.
Old configs with encryptedPassword still work.
Email worker should prefer password, then fall back to encryptedPassword.
```

---

# 8. Define service connector model

`models/service-connector.model.ts`

```ts
import type { ProtectedValue } from "./protected-value.model";

export type ServiceConnectorConfig = {
  service: string;
  connection: ServiceConnectorConnectionConfig;
  resource: ServiceConnectorResourceRef;
  preset: string;
  options?: Record<string, unknown>;
  cursor?: ServiceConnectorCursorConfig;
};

export type ServiceConnectorConnectionConfig = {
  label?: string;
  auth: ServiceConnectorAuthConfig;
  settings?: Record<string, unknown>;
};

export type ServiceConnectorAuthConfig = {
  mode:
    | "none"
    | "apiKey"
    | "bearerToken"
    | "botToken"
    | "basic"
    | "oauth2"
    | "custom";
  fields: Record<string, ProtectedValue>;
};

export type ServiceConnectorResourceRef = {
  type: string;
  id: string;
  label?: string;
  parentId?: string;
  parentLabel?: string;
};

export type ServiceConnectorCursorConfig = {
  strategy:
    | "none"
    | "latestId"
    | "latestTimestamp"
    | "offset"
    | "page"
    | "cursor"
    | "serviceManaged";
  field?: string;
};
```

Feed config:

```ts
export type ServiceConnectorFeedConfig = FeedConfigBase<"serviceConnector"> & {
  serviceConnector: ServiceConnectorConfig;
};
```

Example YAML:

```yaml
schemaVersion: 2
feedId: 2a6fcbd8-1a46-4cbb-91f5-jellyfin001
feedName: jellyfin-latest-movies
feedType: serviceConnector
enabled: true
refreshTime: 30
reverse: false
strict: false
advanced: false
headers: {}

metadata:
  title: Jellyfin Latest Movies
  tags:
    - jellyfin
    - movies
    - media
  category: media
  localOnly: true
  visibility: private

serviceConnector:
  service: jellyfin
  connection:
    label: Home Jellyfin
    auth:
      mode: apiKey
      fields:
        apiKey:
          type: protected
          value: ENC:v1:aes-256-gcm:...
    settings:
      baseUrl: http://jellyfin:8096
      allowPrivateNetwork: true
  resource:
    type: library
    id: movies
    label: Movies
  preset: latestItems
  options:
    maxItems: 50
    itemTypes:
      - Movie
    includeImages: true
    includeOverview: true
    includeGenres: true
  cursor:
    strategy: latestTimestamp
    field: DateCreated

feedLanguage: en
feedDescription: Latest movies added to Jellyfin.
feedGenerator: MkFD Feed Generator
feedDocs: https://www.rssboard.org/rss-specification
feedCategories: []
feedSkipHours: []
feedSkipDays: []
```

---

# 9. Stub future feed-type blocks

Add lightweight types now so the config model is ready.

```ts
export type GraphQLFeedConfig = FeedConfigBase<"graphql"> & {
  graphql: GraphQLConfigBlock;
  apiMapping: ApiMapping;
};

export type GraphQLConfigBlock = {
  endpoint: string;
  method?: "POST";
  headers?: ProtectedRecord;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  timeoutMs?: number;
};

export type CalendarFeedConfig = FeedConfigBase<"calendar"> & {
  calendar: CalendarConfigBlock;
};

export type CalendarConfigBlock = {
  calendarUrl: string;
  calendarWindowDays?: number;
  calendarIncludePastEvents?: boolean;
  calendarExpandRecurringEvents?: boolean;
  calendarMaxEvents?: number;
  calendarSortOrder?: "startAsc" | "startDesc" | "modifiedDesc";
  calendarDateStrategy?: "start" | "end" | "created" | "lastModified";
  calendarLinkStrategy?: "eventUrl" | "location" | "calendarUrl" | "none";
};

export type SitemapFeedConfig = FeedConfigBase<"sitemap"> & {
  sitemap: SitemapConfigBlock;
};

export type SitemapConfigBlock = {
  url: string;
  discovery?: "exact" | "auto";
  mode?: "urlList" | "pageMetadata" | "changeDetection";
  maxItems?: number;
  maxUrlsToScan?: number;
  sortOrder?: "lastmodDesc" | "firstSeenDesc" | "urlAsc" | "sitemapOrder";
  dateStrategy?: "sitemapLastmod" | "pagePublished" | "pageModified" | "firstSeen" | "contentChanged" | "bestAvailable";
};

export type FilesystemFeedConfig = FeedConfigBase<"filesystem"> & {
  filesystem: FilesystemConfigBlock;
};

export type FilesystemConfigBlock = {
  rootPath: string;
  publicBaseUrl?: string;
  recursive?: boolean;
  include?: string[];
  exclude?: string[];
  maxItems?: number;
  sortOrder?: "modifiedDesc" | "createdDesc" | "filenameAsc";
};

export type WebhookFeedConfig = FeedConfigBase<"webhook"> & {
  webhookFeed: WebhookFeedConfigBlock;
};

export type WebhookFeedConfigBlock = {
  slug: string;
  token?: ProtectedValue;
  maxItems?: number;
  retentionDays?: number;
  duplicateStrategy?: "idOrHash" | "hashOnly" | "allowDuplicates";
};

export type FeedTransformerFeedConfig = FeedConfigBase<"feedTransformer"> & {
  feedTransformer: FeedTransformerConfigBlock;
};

export type FeedTransformerConfigBlock = {
  sourceUrl: string;
  sourceFormat?: "rss" | "atom" | "json" | "auto";
};

export type ChangeDetectionFeedConfig = FeedConfigBase<"changeDetection"> & {
  changeDetection: ChangeDetectionConfigBlock;
};

export type ChangeDetectionConfigBlock = {
  url: string;
  target?: "fullPage" | "mainContent" | "selector";
  selector?: string;
  emitOn?: "contentHashChanged" | "selectedElementChanged" | "keywordAppears";
  includeDiff?: boolean;
};
```

---

# 10. Add form-data caster

Create:

```text
utilities/feed-config-caster.utility.ts
```

Purpose:

```text
Convert raw form submissions into FeedConfig before dumping YAML.
```

Main API:

```ts
export type FeedConfigCastContext = {
  feedId?: string;
  encryptionKey: string;
  sampleHtml?: string;
  now?: Date;
};

export async function castFeedFormDataToFeedConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
): Promise<FeedConfig> {
  const feedType = stringValue(input.feedType, "webScraping");

  if (feedType === "webScraping") {
    return castWebScrapingFormDataToFeedConfig(input, context);
  }

  if (feedType === "api" || feedType === "rest") {
    return castApiFormDataToFeedConfig(input, context, feedType);
  }

  if (feedType === "email") {
    return castEmailFormDataToFeedConfig(input, context);
  }

  if (feedType === "serviceConnector") {
    return castServiceConnectorFormDataToFeedConfig(input, context);
  }

  throw new Error(`Unsupported feed type: ${feedType}`);
}
```

Helper utilities:

```ts
export function stringValue(value: unknown, fallback = ""): string;
export function numberValue(value: unknown, fallback = 0): number;
export function booleanValue(value: unknown, fallback = false): boolean;
export function arrayValue<T>(value: unknown, fallback: T[] = []): T[];
export function keyValuePairs(value: unknown): Record<string, string>;
```

---

# 11. Web scraping caster

The caster should output the current YAML shape plus `schemaVersion: 2`.

```ts
export async function castWebScrapingFormDataToFeedConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
): Promise<WebScrapingFeedConfig> {
  const feedId = stringValue(input.feedId, context.feedId ?? crypto.randomUUID());

  const dateTarget = await buildCSSTarget("date", input, context.sampleHtml ?? "");

  return {
    schemaVersion: 2,
    feedId,
    feedName: stringValue(input.feedName, "RSS Feed"),
    feedType: "webScraping",
    enabled: booleanValue(input.enabled, true),
    refreshTime: numberValue(input.refreshTime, 5),
    reverse: booleanValue(input.reverse, false),
    strict: booleanValue(input.strict, false),
    advanced: booleanValue(input.advanced, false),
    headers: keyValuePairs(input.headers),
    cookies: castCookies(input),
    webhook: castOutgoingWebhook(input),
    flaresolverr: castFlareSolverr(input),
    config: {
      baseUrl: stringValue(input.feedUrl, ""),
    },
    article: {
      iterator: await buildCSSTarget("item", input, context.sampleHtml ?? ""),
      title: await buildCSSTarget("title", input, context.sampleHtml ?? ""),
      link: await buildCSSTarget("link", input, context.sampleHtml ?? ""),
      description: await buildCSSTarget("description", input, context.sampleHtml ?? ""),
      author: await buildCSSTarget("author", input, context.sampleHtml ?? ""),
      categories: await buildCSSTarget("categories", input, context.sampleHtml ?? ""),
      comments: await buildCSSTarget("commentsUrl", input, context.sampleHtml ?? ""),
      enclosure: await buildCSSTarget("enclosure", input, context.sampleHtml ?? ""),
      guid: await buildCSSTarget("guid", input, context.sampleHtml ?? ""),
      pubDate: dateTarget,
      date: dateTarget,
      source: {
        title: await buildCSSTarget("sourceTitle", input, context.sampleHtml ?? ""),
        url: await buildCSSTarget("sourceUrl", input, context.sampleHtml ?? ""),
      },
      contentEncoded: await buildCSSTarget("contentEncoded", input, context.sampleHtml ?? ""),
      summary: await buildCSSTarget("summary", input, context.sampleHtml ?? ""),
      contributors: await buildCSSTarget("contributors", input, context.sampleHtml ?? ""),
      lat: await buildCSSTarget("lat", input, context.sampleHtml ?? ""),
      long: await buildCSSTarget("long", input, context.sampleHtml ?? ""),
    },
    ...castFeedRssMetadata(input),
  };
}
```

---

# 12. API caster

```ts
export function castApiFormDataToFeedConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
  feedType: "api" | "rest" = "api",
): ApiFeedConfig | RestFeedConfig {
  return {
    schemaVersion: 2,
    feedId: stringValue(input.feedId, context.feedId ?? crypto.randomUUID()),
    feedName: stringValue(input.feedName, "API Feed"),
    feedType,
    enabled: booleanValue(input.enabled, true),
    refreshTime: numberValue(input.refreshTime, 5),
    reverse: booleanValue(input.reverse, false),
    strict: booleanValue(input.strict, false),
    advanced: booleanValue(input.advanced, false),
    headers: keyValuePairs(input.headers),
    cookies: castCookies(input),
    webhook: castOutgoingWebhook(input),
    config: {
      baseUrl: stringValue(input.feedUrl, ""),
      method: stringValue(input.apiMethod, "GET"),
      route: stringValue(input.apiRoute, ""),
      params: keyValuePairs(input.apiParams),
      apiSpecificHeaders: protectSensitiveRecord(keyValuePairs(input.apiHeaders), context.encryptionKey),
      apiSpecificBody: keyValuePairs(input.apiBody),
    },
    apiMapping: {
      items: stringValue(input.apiItemsPath, ""),
      title: stringValue(input.apiTitleField, ""),
      link: stringValue(input.apiLinkField, ""),
      description: stringValue(input.apiDescriptionField, ""),
      author: stringValue(input.apiAuthor, ""),
      categories: stringValue(input.apiCategories, ""),
      comments: stringValue(input.apiCommentsUrl, ""),
      enclosure: {
        url: stringValue(input.apiEnclosureUrl, ""),
        size: stringValue(input.apiEnclosureSize, ""),
        type: stringValue(input.apiEnclosureType, ""),
      },
      guid: stringValue(input.apiGuid, ""),
      guidIsPermaLink: stringValue(input.apiGuidIsPermaLink, ""),
      date: stringValue(input.apiDateField, ""),
      source: {
        title: stringValue(input.apiSourceTitle, ""),
        url: stringValue(input.apiSourceUrl, ""),
      },
      contentEncoded: stringValue(input.apiContentEncoded, ""),
      summary: stringValue(input.apiSummary, ""),
      contributors: stringValue(input.apiContributors, ""),
      lat: stringValue(input.apiLat, ""),
      long: stringValue(input.apiLong, ""),
      feedTitle: stringValue(input.apiFeedTitle, ""),
      feedDescription: stringValue(input.apiFeedDescription, ""),
      feedLanguage: stringValue(input.apiFeedLanguage, ""),
      feedCopyright: stringValue(input.apiFeedCopyright, ""),
      feedManagingEditor: stringValue(input.apiFeedManagingEditor, ""),
      feedWebMaster: stringValue(input.apiFeedWebMaster, ""),
      feedPubDate: stringValue(input.apiFeedPubDate, ""),
      feedCategories: stringValue(input.apiFeedCategories, ""),
      feedTtl: stringValue(input.apiFeedTtl, ""),
      feedSkipHours: stringValue(input.apiFeedSkipHours, ""),
      feedSkipDays: stringValue(input.apiFeedSkipDays, ""),
      feedImageUrl: stringValue(input.apiFeedImageUrl, ""),
    },
    ...castFeedRssMetadata(input),
  };
}
```

---

# 13. Email caster

```ts
export function castEmailFormDataToFeedConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
): EmailFeedConfig {
  const password = stringValue(input.emailPassword, "");
  const protectedPassword = password
    ? protectValue(password, context.encryptionKey)
    : undefined;

  return {
    schemaVersion: 2,
    feedId: stringValue(input.feedId, context.feedId ?? crypto.randomUUID()),
    feedName: stringValue(input.feedName, "Email Feed"),
    feedType: "email",
    enabled: booleanValue(input.enabled, true),
    refreshTime: numberValue(input.refreshTime, 5),
    reverse: booleanValue(input.reverse, false),
    strict: booleanValue(input.strict, false),
    advanced: false,
    headers: {},
    config: {
      host: stringValue(input.emailHost, ""),
      port: numberValue(input.emailPort, 993),
      user: stringValue(input.emailUsername, ""),
      encryptedPassword: password ? encrypt(password, context.encryptionKey) : undefined,
      password: protectedPassword,
      folder: stringValue(input.emailFolder, "INBOX"),
      emailCount: numberValue(input.emailCount, 10),
    },
    feedLanguage: "en",
    feedDescription: `Emails from folder: ${stringValue(input.emailFolder, "INBOX")}`,
    feedGenerator: "MkFD Feed Generator",
    feedDocs: "https://www.rssboard.org/rss-specification",
    feedCategories: [],
    feedSkipHours: [],
    feedSkipDays: [],
  };
}
```

Keep `encryptedPassword` during the transition so the existing worker remains compatible.

---

# 14. Service connector caster

```ts
export function castServiceConnectorFormDataToFeedConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
): ServiceConnectorFeedConfig {
  const service = stringValue(input.serviceConnectorService, "");
  const connectionSettings = objectValue(input.serviceConnectorConnectionSettings, {});
  const authFields = objectValue(input.serviceConnectorAuthFields, {});

  return {
    schemaVersion: 2,
    feedId: stringValue(input.feedId, context.feedId ?? crypto.randomUUID()),
    feedName: stringValue(input.feedName, `${service}-feed`),
    feedType: "serviceConnector",
    enabled: booleanValue(input.enabled, true),
    refreshTime: numberValue(input.refreshTime, 30),
    reverse: booleanValue(input.reverse, false),
    strict: booleanValue(input.strict, false),
    advanced: false,
    headers: {},
    metadata: {
      title: stringValue(input.metadataTitle, ""),
      description: stringValue(input.metadataDescription, ""),
      tags: arrayValue<string>(input.metadataTags, []),
      category: stringValue(input.metadataCategory, ""),
      localOnly: true,
      visibility: "private",
    },
    serviceConnector: {
      service,
      connection: {
        label: stringValue(input.serviceConnectorConnectionLabel, ""),
        auth: {
          mode: stringValue(input.serviceConnectorAuthMode, "apiKey") as ServiceConnectorAuthConfig["mode"],
          fields: protectServiceConnectorAuthFields(authFields, context.encryptionKey),
        },
        settings: connectionSettings,
      },
      resource: {
        type: stringValue(input.serviceConnectorResourceType, ""),
        id: stringValue(input.serviceConnectorResourceId, ""),
        label: stringValue(input.serviceConnectorResourceLabel, ""),
        parentId: stringValue(input.serviceConnectorResourceParentId, ""),
        parentLabel: stringValue(input.serviceConnectorResourceParentLabel, ""),
      },
      preset: stringValue(input.serviceConnectorPreset, ""),
      options: objectValue(input.serviceConnectorOptions, {}),
      cursor: {
        strategy: stringValue(input.serviceConnectorCursorStrategy, "serviceManaged") as ServiceConnectorCursorConfig["strategy"],
        field: stringValue(input.serviceConnectorCursorField, ""),
      },
    },
    feedLanguage: "en",
    feedDescription: stringValue(input.metadataDescription, ""),
    feedGenerator: "MkFD Feed Generator",
    feedDocs: "https://www.rssboard.org/rss-specification",
    feedCategories: [],
    feedSkipHours: [],
    feedSkipDays: [],
  };
}
```

Auth rule:

```ts
export function protectServiceConnectorAuthFields(
  fields: Record<string, unknown>,
  encryptionKey: string,
): Record<string, ProtectedValue> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([_, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, protectValue(String(value), encryptionKey)]),
  );
}
```

---

# 15. Add normalizer

Create:

```text
utilities/feed-config-normalizer.utility.ts
```

Purpose:

```text
Accept old YAML, new YAML, and raw form submissions.
Return a valid FeedConfig.
```

Main API:

```ts
export async function normalizeIncomingFeedConfig(
  input: unknown,
  context: FeedConfigCastContext,
): Promise<FeedConfig> {
  if (isFeedConfigLike(input)) {
    return normalizeLoadedFeedConfig(input as Record<string, unknown>, context);
  }

  return castFeedFormDataToFeedConfig(input as Record<string, unknown>, context);
}
```

Better detection:

```ts
export function isFeedConfigLike(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return typeof value.feedType === "string" && (
    typeof value.feedId === "string" ||
    "config" in value ||
    "article" in value ||
    "apiMapping" in value ||
    "serviceConnector" in value
  );
}
```

Normalize loaded configs:

```ts
export function normalizeLoadedFeedConfig(
  input: Record<string, unknown>,
  context?: Partial<FeedConfigCastContext>,
): FeedConfig {
  const feedType = input.feedType === "rest" ? "rest" : stringValue(input.feedType, "webScraping");

  const base = {
    schemaVersion: numberValue(input.schemaVersion, 1),
    feedId: stringValue(input.feedId, context?.feedId ?? crypto.randomUUID()),
    feedName: stringValue(input.feedName, "RSS Feed"),
    feedType,
    enabled: booleanValue(input.enabled, true),
    refreshTime: numberValue(input.refreshTime, 5),
    reverse: booleanValue(input.reverse, false),
    strict: booleanValue(input.strict, false),
    advanced: booleanValue(input.advanced, false),
    headers: normalizeProtectedRecord(input.headers),
    cookies: normalizeCookies(input.cookies),
    webhook: normalizeOutgoingWebhook(input.webhook),
    flaresolverr: normalizeFlareSolverr(input.flaresolverr),
    metadata: normalizeMetadata(input.metadata),
    ...normalizeFeedRssMetadata(input),
  };

  if (feedType === "webScraping") {
    const article = normalizeArticleTargets(objectValue(input.article, {}));
    return {
      ...base,
      feedType: "webScraping",
      config: normalizeWebScrapingSourceConfig(input.config),
      article,
    };
  }

  if (feedType === "api" || feedType === "rest") {
    return {
      ...base,
      feedType,
      config: normalizeApiSourceConfig(input.config),
      apiMapping: normalizeApiMapping(input.apiMapping),
    };
  }

  if (feedType === "email") {
    return {
      ...base,
      feedType: "email",
      config: normalizeEmailSourceConfig(input.config),
    };
  }

  if (feedType === "serviceConnector") {
    return {
      ...base,
      feedType: "serviceConnector",
      serviceConnector: normalizeServiceConnectorConfig(input.serviceConnector),
    };
  }

  throw new Error(`Unsupported feed type: ${feedType}`);
}
```

---

# 16. Normalize article date aliases

```ts
export function normalizeArticleTargets(article: Record<string, unknown>): WebScrapingArticleConfig {
  const normalized = article as WebScrapingArticleConfig;
  const dateTarget = normalized.date ?? normalized.pubDate;

  return {
    ...normalized,
    date: dateTarget,
    pubDate: dateTarget,
  };
}
```

Then update `buildRSS` to prefer:

```ts
const dateTarget = article.date ?? article.pubDate;
```

---

# 17. Add validator

Create:

```text
utilities/feed-config-validator.utility.ts
```

Main API:

```ts
export type FeedConfigValidationResult = {
  valid: boolean;
  errors: FeedConfigValidationIssue[];
  warnings: FeedConfigValidationIssue[];
};

export type FeedConfigValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export function validateFeedConfig(config: FeedConfig): FeedConfigValidationResult;
```

Generic validation:

```text
feedId exists
feedName exists
feedType is supported
refreshTime is valid
headers are valid
protected values are valid
serviceConnector feeds are localOnly/private by default
```

Feed-type validation:

```text
webScraping requires config.baseUrl and article.iterator.selector
api/rest requires config.baseUrl and apiMapping.items
email requires config.host, config.user, config.folder, and password/encryptedPassword
serviceConnector requires service, connection, resource.type, resource.id, preset
```

Warning examples:

```text
plain sensitive header found
serviceConnector metadata.visibility is public
article has pubDate but not date
api feedType is legacy alias, rest is preferred
```

---

# 18. Update POST `/`

Refactor the route so it no longer manually builds `finalFeedConfig`.

New flow:

```ts
app.post("/", async (ctx) => {
  const contentType = ctx.req.header("Content-Type") || "";
  const rawBody = await parseFeedRequestBody(ctx, contentType);
  const sampleHtml = await maybeFetchSampleHtmlForConfig(rawBody);

  const finalFeedConfig = await normalizeIncomingFeedConfig(rawBody, {
    feedId: uuidv4(),
    encryptionKey,
    sampleHtml,
    now: new Date(),
  });

  const validation = validateFeedConfig(finalFeedConfig);
  if (!validation.valid) {
    return ctx.json(validation, 400);
  }

  const yamlStr = yaml.dump(finalFeedConfig);
  const yamlFilePath = join(configsDir, `${finalFeedConfig.feedId}.yaml`);
  await writeFile(yamlFilePath, yamlStr, "utf8");

  setFeedUpdaterInterval(finalFeedConfig);

  return ctx.json({
    message: "Feed is being generated.",
    feedUrl: `public/feeds/${finalFeedConfig.feedId}.xml`,
    feedUrls: {
      rss: `public/feeds/${finalFeedConfig.feedId}.xml`,
      atom: `public/feeds/${finalFeedConfig.feedId}.atom`,
      json: `public/feeds/${finalFeedConfig.feedId}.json`,
    },
    feedId: finalFeedConfig.feedId,
    config: finalFeedConfig,
  });
});
```

Keep HTML response support if still needed, but the core path should use the normalizer.

---

# 19. Update `/preview`

Preview and submit must share the same config casting logic.

```ts
app.post("/preview", async (ctx) => {
  const rawBody = await ctx.req.json();
  const sampleHtml = await maybeFetchSampleHtmlForConfig(rawBody);

  const previewConfig = await normalizeIncomingFeedConfig(rawBody, {
    feedId: stringValue(rawBody.feedId, "preview"),
    encryptionKey,
    sampleHtml,
    now: new Date(),
  });

  const validation = validateFeedConfig(previewConfig);
  if (!validation.valid) {
    return ctx.json(validation, 400);
  }

  const preview = await generateFeedPreview(previewConfig);
  return ctx.text(preview.rss);
});
```

Later add:

```text
/preview?format=rss
/preview?format=atom
/preview?format=json
```

---

# 20. Update config loading

Wherever configs are read from `/app/configs`, normalize them.

```ts
const raw = yaml.load(fileText);
const config = normalizeLoadedFeedConfig(raw as Record<string, unknown>);
setFeedUpdaterInterval(config);
```

Important:

```text
Do not rewrite old configs automatically on startup.
Old configs should remain old until edited.
When edited/saved, write schemaVersion: 2.
```

---

# 21. Update feed updater worker

Worker should normalize at the boundary too, especially if configs are passed directly from older startup code.

```ts
async function fetchDataAndUpdateFeed(rawFeedConfig: any) {
  const feedConfig = normalizeLoadedFeedConfig(rawFeedConfig);

  if (feedConfig.enabled === false) {
    return;
  }

  switch (feedConfig.feedType) {
    case "webScraping":
      return updateWebScrapingFeed(feedConfig);
    case "api":
    case "rest":
      return updateApiFeed(feedConfig);
    case "email":
      return updateEmailFeed(feedConfig);
    case "serviceConnector":
      return updateServiceConnectorFeed(feedConfig);
  }
}
```

This lets old YAML and new YAML both run.

---

# 22. Update RSS builder minimally

Do not refactor everything yet.

Make minimal compatibility improvements:

```text
Support article.date and article.pubDate.
Support config.password and config.encryptedPassword for email worker.
Support api and rest as same pipeline.
Support ProtectedRecord resolution before HTTP requests.
```

For web scraping date:

```ts
const dateTarget = article.date ?? article.pubDate;
const rawDate = processDates(
  await extractField($, el, dateTarget, advanced, false, false, flaresolverr, cookies),
  dateTarget?.stripHtml,
  dateTarget?.dateFormat,
);
```

For feed links later:

```text
Always write .xml, .atom, .json after feed object refactor.
```

---

# 23. Update frontend form submission

Current frontend can keep sending raw `FeedFormData` until the backend caster is stable.

Then add:

```text
src/lib/feed-config-builder.ts
```

Functions:

```ts
export function buildFeedConfigFromFormData(data: FeedFormData): UnsavedFeedConfig;
export function buildWebScrapingFeedConfig(data: FeedFormData): UnsavedWebScrapingFeedConfig;
export function buildApiFeedConfig(data: FeedFormData): UnsavedApiFeedConfig;
export function buildEmailFeedConfig(data: FeedFormData): UnsavedEmailFeedConfig;
```

Submission flow:

```ts
const feedConfig = buildFeedConfigFromFormData(data);

await fetch("/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(feedConfig),
});
```

Backend still validates, assigns `feedId`, encrypts, and writes.

---

# 24. Community catalog guard

Service connector configs should not be accepted into the catalog.

```ts
export function validateCommunityCatalogSubmission(config: FeedConfig): FeedConfigValidationResult {
  const result = validateFeedConfig(config);

  if (config.feedType === "serviceConnector") {
    result.errors.push({
      path: "feedType",
      message: "Service connector feeds are local-only and cannot be submitted to the community catalog.",
      severity: "error",
    });
  }

  return {
    ...result,
    valid: result.errors.length === 0,
  };
}
```

UI:

```text
Hide Submit to Community Catalog for serviceConnector feeds.
Show Local-only Service Connector badge.
```

---

# 25. Migration UX

Do not automatically rewrite user YAML.

In My Feeds:

```text
Legacy Config
This feed uses Mkfd’s older config shape. It still works.

[Migrate to schemaVersion 2]
```

Migration action:

```ts
const raw = await readConfig(feedId);
const normalized = normalizeLoadedFeedConfig(raw);
normalized.schemaVersion = 2;
await saveConfig(normalized);
```

Warnings:

```text
Back up your config before migration.
Migration preserves feedId and feedName.
```

---

# 26. Test plan

## Model tests

```text
FeedConfig accepts webScraping.
FeedConfig accepts api.
FeedConfig accepts rest.
FeedConfig accepts email.
FeedConfig accepts serviceConnector.
ProtectedValue rejects plain service connector auth.
```

## Caster tests

```text
Web scraping form casts to schemaVersion 2.
API form casts to schemaVersion 2.
Email form casts to schemaVersion 2 and writes protected password.
Service connector form encrypts auth fields.
Date field writes both article.date and article.pubDate.
```

## Normalizer tests

```text
Existing YAML without schemaVersion normalizes successfully.
Existing webScraping config normalizes.
Existing API config normalizes.
Existing email encryptedPassword config normalizes.
article.pubDate becomes article.date.
article.date becomes article.pubDate.
api and rest both validate.
```

## Route tests

```text
POST / writes schemaVersion 2 config.
POST / accepts old FeedFormData.
POST / accepts new FeedConfig.
POST /preview uses the same normalized config.
Validation errors return 400.
```

## Worker tests

```text
Old config runs.
New schemaVersion 2 config runs.
webScraping uses config.baseUrl and article.
api/rest uses config and apiMapping.
email uses encryptedPassword fallback.
serviceConnector dispatches to connector runner.
```

## Security tests

```text
Service connector auth is encrypted before YAML write.
Plain auth field is rejected or transformed.
Sensitive headers warn or protect.
API responses mask protected values.
Logs do not include decrypted values.
```

---

# 27. Implementation order

## Phase 1: Models

```text
Add protected-value.model.ts.
Add feed-metadata.model.ts.
Add service-connector.model.ts.
Add feed-config.model.ts.
Export types from a central models index if useful.
```

## Phase 2: Caster

```text
Add feed-config-caster.utility.ts.
Move POST / inline config construction into caster.
Keep output YAML shape compatible.
```

## Phase 3: Normalizer

```text
Add feed-config-normalizer.utility.ts.
Normalize old and new configs.
Normalize article.date/pubDate.
Normalize email encryptedPassword/password.
Normalize api/rest.
```

## Phase 4: Validator

```text
Add feed-config-validator.utility.ts.
Validate before writing YAML.
Warn on legacy aliases and sensitive plain values.
```

## Phase 5: Route refactor

```text
Refactor POST /.
Refactor POST /preview.
Keep response shape compatible.
Add feedUrls response for RSS/Atom/JSON future output.
```

## Phase 6: Worker boundary

```text
Normalize config at worker start.
Dispatch by feedType.
Add serviceConnector branch stub.
Keep old web/api/email behavior working.
```

## Phase 7: Frontend

```text
Add frontend feed config builder.
Gradually submit typed FeedConfig instead of raw form state.
Keep backend compatible with both.
```

## Phase 8: Service connector MVP

```text
Add serviceConnector feed type UI.
Add connector registry.
Add Jellyfin connector first.
Encrypt service connector auth.
Generate feed from normalized connector items.
Reject catalog submission.
```

---

# 28. Acceptance criteria

The new feed config model is complete when:

```text
There is an explicit FeedConfig TypeScript model.
Newly saved YAML includes schemaVersion: 2.
Existing YAML configs still load and run unchanged.
Current web scraping YAML structure remains valid.
Current API YAML structure remains valid.
Current email YAML structure remains valid.
Form submissions are cast into FeedConfig before YAML dump.
Preview and save use the same casting/normalization logic.
Sensitive fields can use ProtectedValue.
Service connector configs fit the same YAML model.
Service connector auth is encrypted by default.
Workers process normalized configs.
Community catalog rejects serviceConnector feeds.
```

# Final recommendation

Use this as the guiding rule:

> Mkfd’s canonical config model should formalize the YAML shape it already writes, not replace it.

That gives you a clean TypeScript contract, a safe migration path, and a stable place to add service connectors, GraphQL, sitemap, calendar, filesystem, webhook receiver feeds, feed transformers, and change detection.