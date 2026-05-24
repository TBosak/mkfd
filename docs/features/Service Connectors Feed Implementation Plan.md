## Goal

Add `serviceConnector` as a first-class Mkfd feed type using the new backwards-compatible feed config model.

Service connectors should let Mkfd generate feeds from structured services like:

```text
Jellyfin
Plex
GitHub
Discord
Home Assistant
Sonarr
Radarr
Immich
Audiobookshelf
Komga
Kavita
qBittorrent
Transmission
```

The core rule:

> A service connector feed is still just one normal feed config YAML file in `/app/configs`.

No separate service connector config folder. No separate connection config document. No `kind`. No `configType`.

---

# 1. Config shape

Service connectors use the same top-level fields as every other feed:

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
  description: Latest movies added to Jellyfin.
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

This preserves Mkfd’s existing config style:

```text
feedId
feedName
feedType
refreshTime
metadata
source-specific block
feed-level RSS fields
```

The only new source-specific block is:

```yaml
serviceConnector: {}
```

---

# 2. Model files

Add or extend these files:

```text
models/service-connector.model.ts
models/feed-config.model.ts
models/protected-value.model.ts
```

## `models/service-connector.model.ts`

```ts
import type { ProtectedValue } from "./protected-value.model";

export type ServiceConnectorConfig = {
  service: ServiceConnectorServiceId | string;
  connection: ServiceConnectorConnectionConfig;
  resource: ServiceConnectorResourceRef;
  preset: string;
  options?: Record<string, unknown>;
  cursor?: ServiceConnectorCursorConfig;
};

export type ServiceConnectorServiceId =
  | "jellyfin"
  | "plex"
  | "github"
  | "discord"
  | "homeAssistant"
  | "sonarr"
  | "radarr"
  | "immich"
  | "audiobookshelf"
  | "komga"
  | "kavita"
  | "qbittorrent"
  | "transmission";

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

export type ServiceConnectorFeedItem = {
  id: string;
  title: string;
  description?: string;
  link?: string;
  date?: string;
  author?: string;
  categories?: string[];
  content?: string;
  contentEncoded?: string;
  enclosure?: {
    url: string;
    type?: string;
    length?: number;
  };
  raw?: unknown;
};

export type ServiceConnectorFetchContext = {
  feedId: string;
  feedName: string;
  connection: ResolvedServiceConnectorConnectionConfig;
  resource: ServiceConnectorResourceRef;
  preset: string;
  options: Record<string, unknown>;
  state?: ServiceConnectorFeedState;
};

export type ResolvedServiceConnectorConnectionConfig = Omit<
  ServiceConnectorConnectionConfig,
  "auth"
> & {
  auth: {
    mode: ServiceConnectorAuthConfig["mode"];
    fields: Record<string, string>;
  };
};

export type ServiceConnectorFeedState = {
  service: string;
  resourceType: string;
  resourceId: string;
  preset: string;
  cursor?: string;
  lastSeenId?: string;
  lastSeenAt?: string;
  lastFetchedAt?: string;
  itemState?: Record<string, unknown>;
  rateLimit?: {
    limitedUntil?: string;
    lastWarning?: string;
  };
};

export type ServiceConnectorFetchResult = {
  items: ServiceConnectorFeedItem[];
  nextState?: Partial<ServiceConnectorFeedState>;
  warnings?: ServiceConnectorWarning[];
  health?: ServiceConnectorHealth;
};

export type ServiceConnectorWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};

export type ServiceConnectorHealth = {
  status: "healthy" | "warning" | "error";
  message?: string;
  checkedAt: string;
  itemCount?: number;
  durationMs?: number;
};
```

## Extend `models/feed-config.model.ts`

```ts
import type { ServiceConnectorConfig } from "./service-connector.model";

export type ServiceConnectorFeedConfig = FeedConfigBase<"serviceConnector"> & {
  serviceConnector: ServiceConnectorConfig;
};
```

Add `serviceConnector` to `FeedConfig` union and `FeedType`.

---

# 3. Connector definition registry

Create:

```text
utilities/service-connectors/service-connector-registry.utility.ts
```

## Connector definition interface

```ts
import type {
  ServiceConnectorConnectionConfig,
  ServiceConnectorFetchContext,
  ServiceConnectorFetchResult,
  ServiceConnectorResourceRef,
} from "../../models/service-connector.model";

export type ServiceConnectorDefinition = {
  id: string;
  label: string;
  description: string;
  category: ServiceConnectorCategory;
  authModes: ServiceConnectorAuthMode[];
  resourceTypes: ServiceConnectorResourceType[];
  presets: ServiceConnectorPreset[];
  testConnection: ServiceConnectorTestConnectionFn;
  listResources: ServiceConnectorListResourcesFn;
  fetchItems: ServiceConnectorFetchItemsFn;
  validateConnection?: ServiceConnectorValidateConnectionFn;
  validateFeedConfig?: ServiceConnectorValidateFeedConfigFn;
};

export type ServiceConnectorCategory =
  | "media"
  | "developer"
  | "community"
  | "automation"
  | "downloads"
  | "photos"
  | "books"
  | "other";

export type ServiceConnectorAuthMode = {
  id: string;
  label: string;
  fields: ServiceConnectorAuthField[];
};

export type ServiceConnectorAuthField = {
  name: string;
  label: string;
  type: "text" | "password" | "textarea";
  required: boolean;
  protected: boolean;
  placeholder?: string;
};

export type ServiceConnectorResourceType = {
  id: string;
  label: string;
  description?: string;
  parentType?: string;
};

export type ServiceConnectorPreset = {
  id: string;
  label: string;
  description: string;
  resourceType: string;
  defaultOptions: Record<string, unknown>;
  optionSchema?: ServiceConnectorOptionSchema;
};

export type ServiceConnectorOptionSchema = {
  fields: ServiceConnectorOptionField[];
};

export type ServiceConnectorOptionField = {
  name: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "multiselect";
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{
    label: string;
    value: string;
  }>;
};

export type ServiceConnectorTestConnectionFn = (
  connection: ServiceConnectorConnectionConfig,
) => Promise<ServiceConnectorTestResult>;

export type ServiceConnectorListResourcesFn = (args: {
  connection: ServiceConnectorConnectionConfig;
  resourceType: string;
  parentId?: string;
}) => Promise<ServiceConnectorResourceListResult>;

export type ServiceConnectorFetchItemsFn = (
  context: ServiceConnectorFetchContext,
) => Promise<ServiceConnectorFetchResult>;

export type ServiceConnectorValidateConnectionFn = (
  connection: ServiceConnectorConnectionConfig,
) => ServiceConnectorValidationResult;

export type ServiceConnectorValidateFeedConfigFn = (args: {
  resource: ServiceConnectorResourceRef;
  preset: string;
  options: Record<string, unknown>;
}) => ServiceConnectorValidationResult;

export type ServiceConnectorTestResult = {
  ok: boolean;
  message: string;
  identity?: {
    id?: string;
    name?: string;
    url?: string;
  };
  warnings?: string[];
};

export type ServiceConnectorResourceListResult = {
  resources: ServiceConnectorDiscoveredResource[];
  warnings?: string[];
};

export type ServiceConnectorDiscoveredResource = {
  type: string;
  id: string;
  label: string;
  description?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
};

export type ServiceConnectorValidationResult = {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
  }>;
  warnings: Array<{
    path: string;
    message: string;
  }>;
};
```

## Registry

```ts
import { jellyfinConnector } from "./jellyfin.connector";
import type { ServiceConnectorDefinition } from "./service-connector-registry.utility";

export const serviceConnectorRegistry: Record<string, ServiceConnectorDefinition> = {
  jellyfin: jellyfinConnector,
};

export function getServiceConnectorDefinition(service: string) {
  const connector = serviceConnectorRegistry[service];

  if (!connector) {
    throw new Error(`Unsupported service connector: ${service}`);
  }

  return connector;
}

export function listServiceConnectorDefinitions() {
  return Object.values(serviceConnectorRegistry);
}
```

Start with Jellyfin only. Add Plex next.

---

# 4. Protected auth handling

Service connector auth must always be encrypted or env-based in YAML.

Add helpers to existing protected value utility, or create:

```text
utilities/protected-values.utility.ts
```

```ts
import { decrypt, encrypt } from "./security.utility";
import type { ProtectedValue, ProtectedRecord } from "../models/protected-value.model";
import type {
  ServiceConnectorAuthConfig,
  ServiceConnectorConnectionConfig,
  ResolvedServiceConnectorConnectionConfig,
} from "../models/service-connector.model";

export function protectValue(value: string, encryptionKey: string): ProtectedValue {
  if (value.startsWith("ENC:")) {
    return {
      type: "protected",
      value,
    };
  }

  return {
    type: "protected",
    value: encrypt(value, encryptionKey),
  };
}

export function resolveProtectedValue(
  value: ProtectedValue,
  encryptionKey: string,
): string {
  if (value.type === "env") {
    const resolved = process.env[value.value];

    if (!resolved) {
      throw new Error(`Missing environment variable: ${value.value}`);
    }

    return resolved;
  }

  return decrypt(value.value, encryptionKey);
}

export function resolveServiceConnectorConnection(
  connection: ServiceConnectorConnectionConfig,
  encryptionKey: string,
): ResolvedServiceConnectorConnectionConfig {
  return {
    ...connection,
    auth: {
      mode: connection.auth.mode,
      fields: Object.fromEntries(
        Object.entries(connection.auth.fields).map(([key, value]) => [
          key,
          resolveProtectedValue(value, encryptionKey),
        ]),
      ),
    },
  };
}

export function maskProtectedValue(value: ProtectedValue) {
  if (value.type === "env") return `env:${value.value}`;
  return "********";
}

export function maskServiceConnectorConnection(
  connection: ServiceConnectorConnectionConfig,
): ServiceConnectorConnectionConfig {
  return {
    ...connection,
    auth: {
      ...connection.auth,
      fields: Object.fromEntries(
        Object.entries(connection.auth.fields).map(([key, value]) => [
          key,
          {
            ...value,
            value: maskProtectedValue(value),
          },
        ]),
      ),
    },
  };
}
```

If your existing `encrypt` output does not already use `ENC:v1:...`, either wrap it now or treat that as a follow-up. The service connector model should assume a protected value format even if the first implementation delegates to existing encryption.

---

# 5. Service connector runner

Create:

```text
utilities/service-connectors/service-connector-runner.utility.ts
```

```ts
import type { ServiceConnectorFeedConfig } from "../../models/feed-config.model";
import type {
  ServiceConnectorFeedItem,
  ServiceConnectorFeedState,
} from "../../models/service-connector.model";
import { getServiceConnectorDefinition } from "./service-connector-registry.utility";
import { resolveServiceConnectorConnection } from "../protected-values.utility";
import {
  loadServiceConnectorState,
  saveServiceConnectorState,
} from "./service-connector-state.utility";

export type RunServiceConnectorFeedOptions = {
  config: ServiceConnectorFeedConfig;
  encryptionKey: string;
};

export async function fetchServiceConnectorItems({
  config,
  encryptionKey,
}: RunServiceConnectorFeedOptions) {
  const serviceConfig = config.serviceConnector;
  const connector = getServiceConnectorDefinition(serviceConfig.service);
  const connection = resolveServiceConnectorConnection(
    serviceConfig.connection,
    encryptionKey,
  );
  const state = await loadServiceConnectorState(config.feedId);

  const result = await connector.fetchItems({
    feedId: config.feedId,
    feedName: config.feedName,
    connection,
    resource: serviceConfig.resource,
    preset: serviceConfig.preset,
    options: serviceConfig.options ?? {},
    state,
  });

  await saveServiceConnectorState(config.feedId, {
    service: serviceConfig.service,
    resourceType: serviceConfig.resource.type,
    resourceId: serviceConfig.resource.id,
    preset: serviceConfig.preset,
    lastFetchedAt: new Date().toISOString(),
    ...state,
    ...result.nextState,
  });

  return result;
}
```

This runner should not build RSS directly. It returns normalized items.

---

# 6. Service connector state

Create:

```text
utilities/service-connectors/service-connector-state.utility.ts
```

Store state outside `/app/configs`:

```text
./feed-state/service-connectors/{feedId}.json
```

```ts
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceConnectorFeedState } from "../../models/service-connector.model";

const stateDir = "./feed-state/service-connectors";

function ensureStateDir() {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
}

export async function loadServiceConnectorState(
  feedId: string,
): Promise<ServiceConnectorFeedState | undefined> {
  ensureStateDir();

  const path = join(stateDir, `${feedId}.json`);

  if (!existsSync(path)) {
    return undefined;
  }

  return JSON.parse(await readFile(path, "utf8"));
}

export async function saveServiceConnectorState(
  feedId: string,
  state: ServiceConnectorFeedState,
) {
  ensureStateDir();

  await writeFile(
    join(stateDir, `${feedId}.json`),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}
```

---

# 7. Build RSS from normalized connector items

Add to `rss-builder.utility.ts` or create a new utility:

```text
utilities/normalized-feed-builder.utility.ts
```

Better long-term name:

```text
utilities/feed-object-builder.utility.ts
```

Initial function:

```ts
import { Feed } from "feed";
import type { ServiceConnectorFeedConfig } from "../models/feed-config.model";
import type { ServiceConnectorFeedItem } from "../models/service-connector.model";
import { sanitizeForXML, sanitizeURLForXML } from "./xml-sanitizer.utility";

export function buildRSSFromServiceConnectorItems(
  items: ServiceConnectorFeedItem[],
  feedConfig: ServiceConnectorFeedConfig,
): string {
  const serverUrl =
    feedConfig.serverUrl || process.env.SERVER_URL || "http://localhost:5000";

  const feed = new Feed({
    id: sanitizeURLForXML(`${serverUrl}/public/feeds/${feedConfig.feedId}.xml`),
    title: sanitizeForXML(
      feedConfig.metadata?.title ||
        feedConfig.feedName ||
        "Service Connector Feed",
    ),
    link: sanitizeURLForXML(`${serverUrl}/public/feeds/${feedConfig.feedId}.xml`),
    description: sanitizeForXML(
      feedConfig.metadata?.description ||
        feedConfig.feedDescription ||
        "",
    ),
    generator: "Generated by mkfd",
    language: sanitizeForXML(feedConfig.feedLanguage || "en"),
    copyright: sanitizeForXML(feedConfig.feedCopyright || ""),
    updated: new Date(),
    feedLinks: {
      rss: sanitizeURLForXML(`${serverUrl}/public/feeds/${feedConfig.feedId}.xml`),
    },
  });

  for (const item of items) {
    feed.addItem({
      title: sanitizeForXML(item.title),
      description: sanitizeForXML(item.description || ""),
      link: sanitizeURLForXML(item.link || ""),
      date: item.date ? new Date(item.date) : new Date(),
      guid: sanitizeForXML(item.id),
      author: item.author ? [{ name: sanitizeForXML(item.author) }] : undefined,
      category: item.categories?.map((name) => ({
        name: sanitizeForXML(name),
      })),
      content: item.content ? sanitizeForXML(item.content) : undefined,
      enclosure: item.enclosure
        ? {
            url: sanitizeURLForXML(item.enclosure.url),
            type: sanitizeForXML(item.enclosure.type || "application/octet-stream"),
            length: item.enclosure.length || 0,
          }
        : undefined,
      extensions: item.contentEncoded
        ? [
            {
              name: "content:encoded",
              objects: sanitizeForXML(item.contentEncoded),
            },
          ]
        : undefined,
    });
  }

  return feed.rss2();
}
```

Later, refactor this to return `Feed` and write RSS/Atom/JSON together.

---

# 8. Worker integration

Update `workers/feed-updater.worker.ts`.

Add imports:

```ts
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
import { fetchServiceConnectorItems } from "../utilities/service-connectors/service-connector-runner.utility";
import { buildRSSFromServiceConnectorItems } from "../utilities/normalized-feed-builder.utility";
```

At the top of `fetchDataAndUpdateFeed`:

```ts
const feedConfig = normalizeLoadedFeedConfig(rawFeedConfig);
```

Add branch:

```ts
if (feedConfig.feedType === "serviceConnector") {
  const result = await fetchServiceConnectorItems({
    config: feedConfig,
    encryptionKey: process.env.ENCRYPTION_KEY || "",
  });

  rssXml = buildRSSFromServiceConnectorItems(result.items, feedConfig);
}
```

Better: pass encryption key into worker data instead of relying on env. If that is too much for MVP, use env and document it.

The existing worker writes `${feedConfig.feedId}.xml`, stores history, handles outgoing webhooks, and posts completion. Keep that behavior unchanged.

---

# 9. API routes

Add service connector utility routes to `index.ts`.

## List connectors

```text
GET /service-connectors
```

Returns connector definitions without functions.

```ts
app.get("/service-connectors", (ctx) => {
  const connectors = listServiceConnectorDefinitions().map((connector) => ({
    id: connector.id,
    label: connector.label,
    description: connector.description,
    category: connector.category,
    authModes: connector.authModes,
    resourceTypes: connector.resourceTypes,
    presets: connector.presets,
  }));

  return ctx.json({ connectors });
});
```

## Test connection

```text
POST /service-connectors/:service/test
```

Payload:

```json
{
  "connection": {
    "label": "Home Jellyfin",
    "auth": {
      "mode": "apiKey",
      "fields": {
        "apiKey": {
          "type": "protected",
          "value": "plaintext-or-enc"
        }
      }
    },
    "settings": {
      "baseUrl": "http://jellyfin:8096",
      "allowPrivateNetwork": true
    }
  }
}
```

For test endpoints, accept plaintext wrapped as protected input and encrypt before save, but resolve for testing.

Simpler MVP: test before save can accept plaintext as:

```json
{
  "connection": {
    "auth": {
      "mode": "apiKey",
      "fields": {
        "apiKey": "plain-token"
      }
    }
  }
}
```

Then cast it server-side. But final stored YAML should always use `ProtectedValue`.

Recommended route flow:

```ts
app.post("/service-connectors/:service/test", async (ctx) => {
  const service = ctx.req.param("service");
  const body = await ctx.req.json();
  const connector = getServiceConnectorDefinition(service);

  const connection = protectIncomingServiceConnection(
    body.connection,
    encryptionKey,
  );

  const result = await connector.testConnection(connection);

  return ctx.json(result);
});
```

## List resources

```text
POST /service-connectors/:service/resources
```

Payload:

```json
{
  "connection": {},
  "resourceType": "library",
  "parentId": null
}
```

Use POST because the connection contains auth data and should not be in query params.

```ts
app.post("/service-connectors/:service/resources", async (ctx) => {
  const service = ctx.req.param("service");
  const body = await ctx.req.json();
  const connector = getServiceConnectorDefinition(service);

  const connection = protectIncomingServiceConnection(
    body.connection,
    encryptionKey,
  );

  const result = await connector.listResources({
    connection,
    resourceType: body.resourceType,
    parentId: body.parentId,
  });

  return ctx.json(result);
});
```

## Preview

```text
POST /service-connectors/:service/preview
```

Payload:

```json
{
  "feedName": "jellyfin-latest-movies",
  "connection": {},
  "resource": {},
  "preset": "latestItems",
  "options": {}
}
```

Flow:

```ts
app.post("/service-connectors/:service/preview", async (ctx) => {
  const service = ctx.req.param("service");
  const body = await ctx.req.json();
  const connector = getServiceConnectorDefinition(service);

  const connection = resolveServiceConnectorConnection(
    protectIncomingServiceConnection(body.connection, encryptionKey),
    encryptionKey,
  );

  const result = await connector.fetchItems({
    feedId: "preview",
    feedName: body.feedName || "Preview",
    connection,
    resource: body.resource,
    preset: body.preset,
    options: body.options ?? {},
  });

  return ctx.json({
    items: result.items.slice(0, 20),
    warnings: result.warnings ?? [],
  });
});
```

The normal `/preview` endpoint should also support `feedType: serviceConnector`.

---

# 10. Feed config casting

Extend `utilities/feed-config-caster.utility.ts`.

Add:

```ts
export function castServiceConnectorFormDataToFeedConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
): ServiceConnectorFeedConfig;
```

Expected frontend form fields can be:

```text
serviceConnector.service
serviceConnector.connection.label
serviceConnector.connection.auth.mode
serviceConnector.connection.auth.fields
serviceConnector.connection.settings
serviceConnector.resource.type
serviceConnector.resource.id
serviceConnector.resource.label
serviceConnector.preset
serviceConnector.options
serviceConnector.cursor.strategy
serviceConnector.cursor.field
```

If sending nested JSON from React, the caster can mostly normalize and protect secrets.

Pseudo-code:

```ts
export function castServiceConnectorFormDataToFeedConfig(
  input: Record<string, unknown>,
  context: FeedConfigCastContext,
): ServiceConnectorFeedConfig {
  const serviceConnector = objectValue(input.serviceConnector, {});
  const connection = objectValue(serviceConnector.connection, {});
  const auth = objectValue(connection.auth, {});
  const authFields = objectValue(auth.fields, {});

  return {
    schemaVersion: 2,
    feedId: stringValue(input.feedId, context.feedId ?? crypto.randomUUID()),
    feedName: stringValue(input.feedName, "Service Connector Feed"),
    feedType: "serviceConnector",
    enabled: booleanValue(input.enabled, true),
    refreshTime: numberValue(input.refreshTime, 30),
    reverse: booleanValue(input.reverse, false),
    strict: booleanValue(input.strict, false),
    advanced: false,
    headers: {},
    metadata: {
      ...normalizeMetadata(input.metadata),
      localOnly: true,
      visibility: "private",
    },
    serviceConnector: {
      service: stringValue(serviceConnector.service, ""),
      connection: {
        label: stringValue(connection.label, ""),
        auth: {
          mode: stringValue(auth.mode, "apiKey") as ServiceConnectorAuthConfig["mode"],
          fields: protectServiceConnectorAuthFields(authFields, context.encryptionKey),
        },
        settings: objectValue(connection.settings, {}),
      },
      resource: normalizeServiceConnectorResource(serviceConnector.resource),
      preset: stringValue(serviceConnector.preset, ""),
      options: objectValue(serviceConnector.options, {}),
      cursor: normalizeServiceConnectorCursor(serviceConnector.cursor),
    },
    feedLanguage: "en",
    feedDescription: stringValue(input.feedDescription, ""),
    feedGenerator: "MkFD Feed Generator",
    feedDocs: "https://www.rssboard.org/rss-specification",
    feedCategories: [],
    feedSkipHours: [],
    feedSkipDays: [],
  };
}
```

---

# 11. Validation

Extend `utilities/feed-config-validator.utility.ts`.

Service connector validation:

```ts
export function validateServiceConnectorFeedConfig(
  config: ServiceConnectorFeedConfig,
): FeedConfigValidationResult {
  const errors = [];
  const warnings = [];

  if (!config.serviceConnector.service) {
    errors.push({
      path: "serviceConnector.service",
      message: "Service connector service is required.",
      severity: "error",
    });
  }

  if (!config.serviceConnector.connection) {
    errors.push({
      path: "serviceConnector.connection",
      message: "Service connector connection is required.",
      severity: "error",
    });
  }

  if (!config.serviceConnector.resource?.type) {
    errors.push({
      path: "serviceConnector.resource.type",
      message: "Service connector resource type is required.",
      severity: "error",
    });
  }

  if (!config.serviceConnector.resource?.id) {
    errors.push({
      path: "serviceConnector.resource.id",
      message: "Service connector resource ID is required.",
      severity: "error",
    });
  }

  if (!config.serviceConnector.preset) {
    errors.push({
      path: "serviceConnector.preset",
      message: "Service connector preset is required.",
      severity: "error",
    });
  }

  if (config.metadata?.visibility === "public") {
    warnings.push({
      path: "metadata.visibility",
      message:
        "Service connector feeds may expose private service data. Private visibility is recommended.",
      severity: "warning",
    });
  }

  validateProtectedAuthFields(config, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

Auth validation:

```text
auth.fields values must be ProtectedValue.
plain string auth fields are invalid after casting.
env fields must name an environment variable.
protected values must decrypt successfully.
```

---

# 12. Community catalog guard

Service connector configs are local-only.

Add to catalog validator:

```ts
if (config.feedType === "serviceConnector") {
  errors.push({
    path: "feedType",
    message:
      "Service connector feeds are local-only and cannot be submitted to the community catalog.",
    severity: "error",
  });
}
```

UI behavior:

```text
Hide Submit to Community Catalog for serviceConnector feeds.
Show Local-only badge.
Allow local backup export.
```

---

# 13. Jellyfin connector MVP

Create:

```text
utilities/service-connectors/jellyfin.connector.ts
```

## Definition

```ts
import type { ServiceConnectorDefinition } from "./service-connector-registry.utility";

export const jellyfinConnector: ServiceConnectorDefinition = {
  id: "jellyfin",
  label: "Jellyfin",
  description: "Create feeds from Jellyfin libraries and recently added media.",
  category: "media",
  authModes: [
    {
      id: "apiKey",
      label: "API Key",
      fields: [
        {
          name: "apiKey",
          label: "API Key",
          type: "password",
          required: true,
          protected: true,
        },
      ],
    },
  ],
  resourceTypes: [
    {
      id: "library",
      label: "Library",
      description: "A Jellyfin media library.",
    },
  ],
  presets: [
    {
      id: "latestItems",
      label: "Latest Items",
      description: "Recently added items from a Jellyfin library.",
      resourceType: "library",
      defaultOptions: {
        maxItems: 50,
        includeImages: true,
        includeOverview: true,
        includeGenres: true,
      },
      optionSchema: {
        fields: [
          {
            name: "maxItems",
            label: "Max items",
            type: "number",
            defaultValue: 50,
          },
          {
            name: "includeImages",
            label: "Include images",
            type: "boolean",
            defaultValue: true,
          },
          {
            name: "includeOverview",
            label: "Include overview",
            type: "boolean",
            defaultValue: true,
          },
          {
            name: "includeGenres",
            label: "Include genres",
            type: "boolean",
            defaultValue: true,
          },
        ],
      },
    },
  ],
  testConnection,
  listResources,
  fetchItems,
};
```

## Connection settings

```ts
export type JellyfinConnectionSettings = {
  baseUrl: string;
  allowPrivateNetwork?: boolean;
  userId?: string;
};
```

## Request helper

```ts
function getBaseUrl(connection: ResolvedServiceConnectorConnectionConfig) {
  const baseUrl = String(connection.settings?.baseUrl || "").replace(/\/+$/, "");

  if (!baseUrl) {
    throw new Error("Jellyfin base URL is required.");
  }

  return baseUrl;
}

function getApiKey(connection: ResolvedServiceConnectorConnectionConfig) {
  const apiKey = connection.auth.fields.apiKey;

  if (!apiKey) {
    throw new Error("Jellyfin API key is required.");
  }

  return apiKey;
}

async function jellyfinGet<T>(
  connection: ResolvedServiceConnectorConnectionConfig,
  path: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  const baseUrl = getBaseUrl(connection);
  const apiKey = getApiKey(connection);

  const response = await axios.get<T>(`${baseUrl}${path}`, {
    headers: {
      "X-Emby-Token": apiKey,
      Accept: "application/json",
    },
    params,
    timeout: 30000,
  });

  return response.data;
}
```

## Test connection

```ts
async function testConnection(connection: ServiceConnectorConnectionConfig) {
  const resolved = resolveForConnectorTest(connection);
  const publicInfo = await jellyfinGet<any>(resolved, "/System/Info/Public");

  return {
    ok: true,
    message: `Connected to Jellyfin ${publicInfo.Version || ""}`.trim(),
    identity: {
      name: publicInfo.ServerName,
    },
  };
}
```

## List libraries

Jellyfin libraries are typically exposed through user views if using a user context. For MVP, support either `userId` or a server-wide item query if available.

```ts
async function listResources({ connection, resourceType }) {
  const resolved = resolveForConnectorTest(connection);

  if (resourceType !== "library") {
    return {
      resources: [],
      warnings: [`Unsupported Jellyfin resource type: ${resourceType}`],
    };
  }

  const userId = String(resolved.settings?.userId || "");

  if (!userId) {
    return {
      resources: [],
      warnings: ["Jellyfin userId is required for library discovery in the MVP."],
    };
  }

  const data = await jellyfinGet<any>(resolved, `/Users/${userId}/Views`);

  return {
    resources: (data.Items || []).map((item: any) => ({
      type: "library",
      id: item.Id,
      label: item.Name,
      metadata: {
        collectionType: item.CollectionType,
      },
    })),
  };
}
```

If you want to avoid `userId` friction, add a “Manual library ID” field for MVP and improve discovery later.

## Fetch latest items

```ts
async function fetchItems(context: ServiceConnectorFetchContext) {
  const { connection, resource, options } = context;
  const maxItems = Number(options.maxItems || 50);
  const userId = String(connection.settings?.userId || "");

  if (!userId) {
    throw new Error("Jellyfin userId is required.");
  }

  const data = await jellyfinGet<any>(
    connection,
    `/Users/${userId}/Items/Latest`,
    {
      ParentId: resource.id,
      Limit: maxItems,
      Fields: "Overview,Genres,DateCreated,Path,MediaSources",
      EnableImages: true,
    },
  );

  const rawItems = Array.isArray(data) ? data : data.Items || [];

  const items = rawItems.map((item: any) =>
    normalizeJellyfinItem(item, connection, resource),
  );

  return {
    items,
    nextState: {
      lastSeenAt: items[0]?.date,
      lastSeenId: items[0]?.id,
    },
    health: {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      itemCount: items.length,
    },
  };
}
```

## Normalize item

```ts
function normalizeJellyfinItem(
  item: any,
  connection: ResolvedServiceConnectorConnectionConfig,
  resource: ServiceConnectorResourceRef,
): ServiceConnectorFeedItem {
  const baseUrl = getBaseUrl(connection);
  const itemUrl = `${baseUrl}/web/#/details?id=${encodeURIComponent(item.Id)}`;
  const imageUrl = `${baseUrl}/Items/${encodeURIComponent(
    item.Id,
  )}/Images/Primary`;

  const categories = [
    "jellyfin",
    resource.label,
    item.Type,
    ...(Array.isArray(item.Genres) ? item.Genres : []),
  ].filter(Boolean);

  return {
    id: `jellyfin:${item.Id}`,
    title: buildJellyfinTitle(item),
    description: buildJellyfinDescription(item),
    link: itemUrl,
    date: item.DateCreated || item.PremiereDate || new Date().toISOString(),
    author: "Jellyfin",
    categories,
    enclosure: {
      url: imageUrl,
      type: "image/jpeg",
    },
    raw: item,
  };
}

function buildJellyfinTitle(item: any) {
  if (item.Type === "Episode" && item.SeriesName) {
    const season = item.ParentIndexNumber
      ? `S${String(item.ParentIndexNumber).padStart(2, "0")}`
      : "";
    const episode = item.IndexNumber
      ? `E${String(item.IndexNumber).padStart(2, "0")}`
      : "";

    return `${item.SeriesName} ${season}${episode}: ${item.Name}`.trim();
  }

  return item.Name || "Untitled Jellyfin Item";
}

function buildJellyfinDescription(item: any) {
  const parts = [
    item.Overview,
    item.ProductionYear ? `Year: ${item.ProductionYear}` : "",
    item.Type ? `Type: ${item.Type}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}
```

---

# 14. Plex connector next

After Jellyfin works, add:

```text
utilities/service-connectors/plex.connector.ts
```

MVP settings:

```yaml
serviceConnector:
  service: plex
  connection:
    label: Home Plex
    auth:
      mode: apiKey
      fields:
        token:
          type: protected
          value: ENC:v1:aes-256-gcm:...
    settings:
      baseUrl: http://plex:32400
      allowPrivateNetwork: true
```

Presets:

```text
recentlyAdded
recentlyAddedMovies
recentlyAddedEpisodes
```

Resource:

```text
library
```

Plex can come after the framework because it will validate the agnostic service connector model against a second media server.

---

# 15. Frontend implementation

Add components:

```text
src/components/service-connectors/ServiceConnectorBuilder.tsx
src/components/service-connectors/ServiceConnectorCardGrid.tsx
src/components/service-connectors/ServiceConnectionForm.tsx
src/components/service-connectors/ServiceResourcePicker.tsx
src/components/service-connectors/ServicePresetPicker.tsx
src/components/service-connectors/ServiceConnectorOptionsForm.tsx
src/components/service-connectors/ServiceConnectorPreview.tsx
```

## Builder flow

```text
1. Choose service
2. Enter connection settings/auth
3. Test connection
4. Pick resource
5. Pick preset
6. Configure options
7. Preview
8. Save feed
```

## UI grouping

```text
Service Connectors
  Media Servers
    Jellyfin
    Plex
  Developer
    GitHub
  Community
    Discord
  Automation
    Home Assistant
```

## Connection form behavior

Sensitive fields:

```text
password input
never echo saved value
backend encrypts before YAML write
show “stored encrypted” after save
```

## Feed builder integration

Add tab/card in `FeedBuilderForm`:

```text
Web Scraping | REST API | Email | Service Connector
```

Or if you switch to source cards:

```text
Manual Sources
Service Connectors
```

For first pass, a single `Service Connector` tab is enough.

---

# 16. Service connector form submission

Frontend should submit a modern `FeedConfig` shape:

```ts
const payload = {
  schemaVersion: 2,
  feedName: data.feedName,
  feedType: "serviceConnector",
  refreshTime: data.refreshTime,
  enabled: true,
  reverse: false,
  strict: false,
  advanced: false,
  headers: {},
  metadata: {
    title: data.title,
    description: data.description,
    tags: data.tags,
    category: data.category,
    localOnly: true,
    visibility: "private",
  },
  serviceConnector: {
    service: data.service,
    connection: {
      label: data.connectionLabel,
      auth: {
        mode: data.authMode,
        fields: data.authFields,
      },
      settings: data.connectionSettings,
    },
    resource: data.resource,
    preset: data.preset,
    options: data.options,
    cursor: {
      strategy: "serviceManaged",
    },
  },
};
```

Backend casts/encrypts/validates anyway.

---

# 17. Security and privacy

Rules:

```text
Service connector auth fields are encrypted before YAML write.
Plain service connector auth values are never persisted.
Service connector feeds default to metadata.localOnly: true.
Service connector feeds default to metadata.visibility: private.
Generated feed URLs may expose private data.
Community catalog submission is disabled.
Private network URLs are only allowed when allowPrivateNetwork is true.
Secrets are masked in API responses.
Secrets are never logged.
```

UI warning:

```text
This feed is generated from a connected service. Anyone with access to the feed URL may be able to read generated items from that service.
```

Homelab warning:

```text
If Mkfd runs in Docker, localhost points to the Mkfd container. Use the service container name, host LAN IP, or Docker network hostname.
```

---

# 18. Validation rules

## Generic service connector validation

```text
serviceConnector.service required
serviceConnector.connection required
serviceConnector.connection.auth.mode required
serviceConnector.resource.type required
serviceConnector.resource.id required
serviceConnector.preset required
selected connector exists
selected preset exists
selected resource type matches preset
auth fields match connector auth mode
protected auth values are valid
```

## Jellyfin validation

```text
settings.baseUrl required
auth.fields.apiKey required
resource.type must be library
preset must be latestItems for MVP
options.maxItems must be 1-100
```

## Privacy warnings

```text
visibility public warning
allowPrivateNetwork false with private IP warning/error
missing metadata.localOnly should auto-set true
```

---

# 19. Testing plan

## Model tests

```text
ServiceConnectorFeedConfig type compiles.
Jellyfin config validates.
Missing service fails.
Missing auth fails.
Plain auth fails after normalization.
Protected auth passes.
```

## Caster tests

```text
Raw service connector form casts to schemaVersion 2.
Auth fields are converted to ProtectedValue.
metadata.localOnly is true.
metadata.visibility is private.
```

## Registry tests

```text
Jellyfin connector appears in connector list.
Unknown connector throws clear error.
Jellyfin latestItems preset exists.
Jellyfin library resource type exists.
```

## Route tests

```text
GET /service-connectors returns definitions without functions.
POST /service-connectors/jellyfin/test masks auth in response.
POST /service-connectors/jellyfin/resources returns libraries from mock.
POST /service-connectors/jellyfin/preview returns normalized feed items.
POST /preview supports serviceConnector.
POST / saves serviceConnector YAML with encrypted auth.
```

## Worker tests

```text
Worker processes serviceConnector feed.
Worker resolves protected auth.
Worker calls connector fetchItems.
Worker writes RSS XML.
Worker saves service connector state.
Worker handles connector warning without crashing.
Worker handles connector error with health error.
```

## Jellyfin connector tests

```text
testConnection handles valid server response.
testConnection handles auth failure.
listResources maps libraries.
fetchItems maps latest items.
Episode title formats correctly.
Movie title formats correctly.
Image URL is generated.
Missing overview does not fail.
```

## Security tests

```text
Saved YAML does not contain plaintext API key.
API responses mask protected values.
Logs do not contain API key.
Community catalog validation rejects serviceConnector.
```

---

# 20. Implementation phases

## Phase 1: Models and validation

```text
Add service-connector.model.ts.
Extend feed-config.model.ts with serviceConnector.
Add validation for serviceConnector.
Add ProtectedValue enforcement for service connector auth.
```

## Phase 2: Registry and runner

```text
Add service connector registry.
Add fetchServiceConnectorItems runner.
Add service connector state storage.
Add normalized item to RSS builder.
```

## Phase 3: Backend routes

```text
GET /service-connectors
POST /service-connectors/:service/test
POST /service-connectors/:service/resources
POST /service-connectors/:service/preview
Update /preview for feedType serviceConnector
Update POST / caster for feedType serviceConnector
```

## Phase 4: Worker support

```text
Normalize feed config at worker boundary.
Add serviceConnector branch.
Resolve protected auth.
Fetch connector items.
Build RSS.
Write feed XML.
Save state.
```

## Phase 5: Jellyfin connector MVP

```text
Connection test.
Manual or discovered library selection.
latestItems preset.
Item normalization.
Image enclosure.
Preview.
End-to-end save and run.
```

## Phase 6: Frontend

```text
Add Service Connector tab/page.
List connector cards.
Add connection form.
Add test connection.
Add resource picker.
Add preset/options form.
Add preview.
Save service connector feed.
Display service connector feed in My Feeds.
Hide community catalog submission.
```

## Phase 7: Plex connector

```text
Connection test.
Library discovery.
recentlyAdded preset.
Movie/episode normalization.
Poster enclosure.
Preview and save.
```

## Phase 8: Additional connectors

Recommended order:

```text
GitHub
Discord
Home Assistant
Sonarr
Radarr
Immich
Audiobookshelf
Komga/Kavita
qBittorrent/Transmission
```

---

# 21. Acceptance criteria

Service connectors MVP is complete when:

```text
feedType: serviceConnector is supported in FeedConfig.
Service connector configs are saved as normal feed YAML files in /app/configs.
Service connector auth is encrypted by default.
Plain auth is not persisted.
Jellyfin connector works end-to-end.
Users can test a Jellyfin connection.
Users can pick or enter a Jellyfin library.
Users can preview latest Jellyfin items.
Users can save a Jellyfin feed.
The worker can refresh that feed.
The feed generates RSS XML.
Service connector state is saved outside configs.
Service connector feeds are localOnly/private by default.
Community catalog submission is blocked for serviceConnector.
```

# Final recommendation

Build the framework around **Jellyfin first**.

It is the best proof of the concept because it validates the exact use case you care about:

```text
A self-hosted local service
Encrypted credentials
Private network URL
Structured resources
Media items
Feed-worthy “recently added” data
```

Once Jellyfin works, Plex should be straightforward, and GitHub/Discord will prove the same framework works for cloud/community connectors.