# Service Connectors - Design Spec

**Date:** 2026-05-24
**Tier:** R5 New Source Types
**Status:** Draft

---

## Goal

Add `feedType: serviceConnector` so Mkfd can turn structured services into feeds without introducing a second config system. A service connector feed is still a normal YAML feed file in `/app/configs`, but it includes a `serviceConnector` block that describes the service, selected resource, preset, auth, and runtime cursor/state. Jellyfin is the reference connector for the first implementation.

---

## Scope

### In scope

- `feedType: serviceConnector` added to `FeedType`
- `serviceConnector?: ServiceConnectorConfig` added to `FeedConfig`
- `models/service-connector.model.ts` for connector, auth, resource, cursor, item, state, and result types
- `utilities/service-connector-registry.utility.ts` for listing available connectors and presets
- `utilities/service-connector-runner.utility.ts` for resolving auth, calling connector adapters, and normalizing items
- `utilities/service-connector-state.utility.ts` for SQLite-backed runtime state
- `utilities/service-connectors/jellyfin.connector.ts` as the reference connector
- `routes/service-connectors.ts` for list/test/resources/preview endpoints
- `worker` support for refreshing `serviceConnector` feeds
- `ServiceConnectorForm.tsx` and builder tab integration
- Masked API responses and protected auth persistence
- SQLite state for cursors, last-seen markers, and rate-limit/runtime metadata
- Community catalog ineligibility for `serviceConnector`

### Out of scope

- Full connector marketplace or plugin system
- Write or mutation actions against third-party services
- OAuth browser flows for the initial connector
- Bidirectional sync
- Service-specific UI for more than the reference connector MVP
- Separate connector config files outside the feed YAML

---

## Dependencies

Must be implemented first:

- Feed Config Formalization
- Protected Value Encryption
- SQLite Runtime Substrate + Feed History
- Feed Format Refactor
- Normalized Feed Item Pipeline

This feature also assumes the outbound fetch policy exists so connector requests obey the same SSRF, timeout, and private-network rules as other outbound HTTP traffic.

---

## Architecture

| Unit | File | Responsibility |
|---|---|---|
| Connector model | `models/service-connector.model.ts` | All service connector types |
| Feed config | `models/feed-config.model.ts` | Add `serviceConnector` and `feedType` union entry |
| Registry | `utilities/service-connector-registry.utility.ts` | List connectors, presets, and resource schemas |
| Runner | `utilities/service-connector-runner.utility.ts` | Resolve auth, execute connector adapter, normalize items |
| State store | `utilities/service-connector-state.utility.ts` | Load/save cursor and runtime state in SQLite |
| Jellyfin adapter | `utilities/service-connectors/jellyfin.connector.ts` | Reference connector implementation |
| Backend routes | `routes/service-connectors.ts` | List/test/resources/preview APIs |
| Worker branch | `workers/feed-updater.worker.ts` | Refresh service connector feeds |
| RSS builder | `utilities/rss-builder.utility.ts` | Build feed output from normalized connector items |
| Connector form | `frontend/src/components/forms/ServiceConnectorForm.tsx` | Service connector builder UI |
| Feed builder | `frontend/src/components/forms/FeedBuilderForm.tsx` | Add Service Connector tab |
| Tests | `tests/service-connectors/*.test.ts` | Model, registry, route, worker, and adapter coverage |

---

## Data Model

### `models/service-connector.model.ts`

```ts
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
  mode: "none" | "apiKey" | "bearerToken" | "botToken" | "basic" | "oauth2" | "custom";
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
  strategy: "none" | "latestId" | "latestTimestamp" | "offset" | "page" | "cursor" | "serviceManaged";
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
  detail?: string;
};

export type ServiceConnectorHealth = {
  ok: boolean;
  status?: number;
  message?: string;
  lastCheckedAt?: string;
};
```

### `FeedConfig` addition

Add `feedType: "serviceConnector"` to the `FeedType` union and `serviceConnector?: ServiceConnectorConfig` to `FeedConfig`.

---

## Security and Data Handling

- Service connector auth fields must be stored as `ProtectedValue` or env references. Plain auth strings are rejected by validation.
- API responses must mask protected auth fields. The UI should never receive raw ciphertext.
- Connector auth is resolved only at test/preview/worker execution time.
- Service connector feeds default to `metadata.localOnly: true` and `metadata.visibility: private`.
- Connector requests must obey the outbound fetch policy and any private-network restrictions already enforced by Mkfd.
- Runtime cursor and rate-limit state belongs in SQLite, not in the feed YAML.
- YAML remains the portable source of truth for connector configuration, but never for runtime secrets that are only needed at execution time.

---

## Acceptance Criteria

- `feedType: serviceConnector` is supported in `FeedConfig`.
- Service connector configs are saved as normal YAML feed files in `/app/configs`.
- Auth fields are encrypted or env-backed by default and plain auth is not persisted.
- Jellyfin works end-to-end: test connection, resource discovery, preview, save, worker refresh, and RSS output.
- Service connector runtime state is persisted outside the config file.
- Connector responses and saved configs do not leak secret values.
- Service connector feeds are private by default.
- Community catalog submission remains blocked for `serviceConnector`.

---

## Non-Goals

- A generic plugin marketplace
- Bi-directional sync
- Service mutation operations
- A separate connector config store
- Broad support for every media/service platform before the Jellyfin reference path is stable

