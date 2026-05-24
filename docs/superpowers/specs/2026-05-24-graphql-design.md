# GraphQL Feeds — Design Spec

**Date:** 2026-05-24
**Tier:** R5 New Source Types
**Status:** Approved

---

## Goal

Add `feedType: graphql` so users can run GraphQL queries on an interval and map the response into RSS. Extract the existing REST API mapping logic into a shared `StructuredFeedMapping` type and `buildRSSFromStructuredData` builder that both REST and GraphQL feeds use.

---

## Scope

### In scope (MVP)

- Rename `api` → `rest` in UI labels; keep `"api"` as a backward-compatible alias in `FeedType`
- `StructuredFeedMapping` shared type (replaces/wraps current REST mapping)
- `buildRSSFromStructuredData` (wraps/renames existing `buildRSSFromApiData`)
- `models/graphql.model.ts` — `GraphQLFeedConfig`, `ExecuteGraphQLFeedOptions`, `GraphQLRunStats`
- `utilities/graphql-feed.utility.ts` — execute POST, handle errors, return `StructuredFeedSourceResult`
- `utilities/structured-feed.utility.ts` — `findArrayPathCandidates`
- Preview endpoint extension for GraphQL
- Worker branch for GraphQL feeds
- `GraphQLForm.tsx` builder UI with GraphQL tab

### Out of scope (MVP)

- GraphQL schema introspection UI / query autocomplete
- Relay, cursor, or offset pagination
- OAuth helpers for GraphQL endpoints
- GraphQL subscriptions
- Query presets (GitHub, WordPress, etc.)

---

## Dependencies

Must be implemented first:

- Feed Config Formalization (canonical `FeedConfig` for `feedType: graphql`)
- Normalized Feed Item Pipeline (output serialization)

---

## Architecture

| Unit | File | Responsibility |
|---|---|---|
| GraphQL model | `models/graphql.model.ts` | `GraphQLFeedConfig`, `StructuredFeedMapping`, `GraphQLRunStats` |
| GraphQL utility | `utilities/graphql-feed.utility.ts` | Execute POST, handle GQL errors, validate |
| Structured util | `utilities/structured-feed.utility.ts` | `findArrayPathCandidates`, `StructuredFeedSourceResult` |
| RSS builder | `utilities/rss-builder.utility.ts` | Add/rename `buildRSSFromStructuredData` |
| GraphQL tests | `tests/graphql.test.ts` | Unit tests for utility, mapping, builder |
| Worker branch | `workers/feed-updater.worker.ts` | GraphQL refresh branch |
| GraphQL form | `frontend/src/components/forms/GraphQLForm.tsx` | GraphQL builder UI |
| Feed builder | `frontend/src/components/forms/FeedBuilderForm.tsx` | Add GraphQL tab, rename API → REST API |

---

## Data Model

### `models/graphql.model.ts` (new)

```ts
export type StructuredFeedMapping = {
  itemPath: string;
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  author?: string;
  enclosureUrl?: string;
  content?: string;
  contentEncoded?: string;
  summary?: string;
  categories?: string;
  contributors?: string;
  source?: string;
  lat?: string;
  long?: string;
};

export type StructuredFeedSourceResult = {
  data: unknown;
  warnings: string[];
  stats: {
    itemCount?: number;
    responseBytes?: number;
    fetchMs?: number;
  };
};

export type GraphQLFeedConfig = {
  endpoint: string;
  method: "POST";
  headers?: Record<string, string>;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  timeoutMs?: number;
  mapping: StructuredFeedMapping;
  pagination?: { enabled: false };
};

export type ExecuteGraphQLFeedOptions = {
  endpoint: string;
  headers?: Record<string, string>;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  timeoutMs?: number;
};

export type GraphQLRunStats = {
  feedId: string;
  endpoint: string;
  operationName?: string;
  fetchMs: number;
  responseBytes: number;
  graphQLErrorCount: number;
  itemCount: number;
  itemPath: string;
  warnings: string[];
};

export type JsonArrayPathCandidate = {
  path: string;
  length: number;
  sampleKeys: string[];
  confidence: number;
};
```

### `FeedType` addition

`"api"` is kept as a legacy alias; `"rest"` is the new canonical form; `"graphql"` is new.

```ts
export type FeedType = "webScraping" | "api" | "rest" | "graphql" | "email" | "calendar" | "sitemap" | "filesystem" | "webhook" | "serviceConnector" | "existingFeed" | "changeDetection";

export function normalizeFeedType(feedType: string): string {
  if (feedType === "api") return "rest";
  return feedType;
}
```

`FeedConfig` gains `graphql?: GraphQLFeedConfig`.

---

## `utilities/graphql-feed.utility.ts` (new)

```ts
export async function executeGraphQLFeedRequest(
  options: ExecuteGraphQLFeedOptions,
): Promise<StructuredFeedSourceResult>;

export function validateGraphQLConfig(config: unknown): GraphQLFeedConfig;
```

Request flow:
1. Build POST body: `{ query, variables: options.variables ?? {}, operationName }`
2. Merge headers with `Content-Type: application/json`, `Accept: application/json`
3. Resolve `${ENV_VAR}` placeholders in header values via `process.env`
4. Execute with `AbortSignal.timeout(timeoutMs ?? 15000)`
5. Handle non-2xx: throw with status code in message (401 → "authentication required", 429 → "rate limited")
6. Parse JSON; if parse fails, throw
7. If `response.errors` present but `response.data` also present: add warning, continue
8. If `response.errors` present but no `response.data`: throw with first error message
9. Return `{ data: response, warnings, stats }`

**Security:** never echo resolved secret values back in API responses. Header values are substituted at request time but never serialized into preview responses.

---

## `utilities/structured-feed.utility.ts` (new)

```ts
export function findArrayPathCandidates(data: unknown): JsonArrayPathCandidate[];
```

Walks the response recursively. For each array found:
- Records `path`, `length`, sample keys from first object element
- Scores by path keywords (`nodes`, `edges`, `items`, `results`) and sample key presence (`title`, `name`, `url`, `date`, `createdAt`, `publishedAt`)
- Returns sorted by confidence descending, filtered to length > 0

---

## `buildRSSFromStructuredData`

In `utilities/rss-builder.utility.ts`, rename (or add alongside) existing `buildRSSFromApiData`:

```ts
export function buildRSSFromStructuredData(
  data: unknown,
  mapping: StructuredFeedMapping,
  feedConfig: FeedConfig,
): string;
```

Resolves `mapping.itemPath` via dot-path getter. Throws if not found or not an array. Maps each item using dot-path lookup for each mapping field. Existing REST feeds are migrated to use this function.

---

## Preview Endpoint Extension

Add GraphQL branch to existing `/preview` handler:

```ts
if (normalizeFeedType(body.feedType) === "graphql") {
  const result = await executeGraphQLFeedRequest(body.graphql);
  const rssXml = buildRSSFromStructuredData(result.data, body.graphql.mapping, body);
  return c.text(rssXml, 200, { "Content-Type": "application/xml" });
}
```

A dedicated `POST /preview/graphql` that returns `{ rssXml, arrayPathCandidates, warnings, stats }` is preferred for the UI's "Run Query" button — add it alongside the main preview.

---

## Worker Branch

```ts
} else if (normalizeFeedType(feed.feedType) === "graphql" && feed.graphql) {
  const result = await executeGraphQLFeedRequest({ ...feed.graphql });
  for (const w of result.warnings) console.warn(`[graphql:${feed.feedId}]`, w);
  const xml = buildRSSFromStructuredData(result.data, feed.graphql.mapping, feed);
  await Bun.write(`./public/feeds/${feed.feedName}.xml`, xml);
}
```

---

## Validation Rules

| Rule | Behavior |
|---|---|
| `graphql.endpoint` required | Error |
| Endpoint must be `http`/`https` | Error |
| `graphql.query` required, non-empty | Error |
| `graphql.variables` must be a JSON object (not array/string) | Error |
| `graphql.mapping.itemPath` required | Error |
| `timeoutMs` must be 1000–60000 | Error |
| GraphQL `errors` present without `data` | Runtime error |
| `itemPath` doesn't resolve to array | Runtime error |
| Missing optional mapped fields | Warning |

---

## Frontend

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this section.**

### `GraphQLForm.tsx` (new)

Sections:
1. **Endpoint** — URL input, operation name input, timeout input
2. **Headers** — key/value pair list (same pattern as REST API headers)
3. **Query** — textarea for GraphQL query text
4. **Variables** — JSON textarea; validated as JSON object on blur
5. **Run Query** button — calls `POST /preview/graphql`, shows result: status, response size, detected array paths
6. **Item Path** — text input; populated from "detected arrays" suggestions
7. **Field Mapping** — title, link, description, pubDate, guid, author, enclosureUrl, categories dot-path inputs
8. **Preview RSS** — calls main `/preview` endpoint, shows RSS XML

### `FeedBuilderForm.tsx` changes

- Rename "API" tab label to "REST API"
- Add GraphQL tab (grow tab grid from existing count + 1)
- Render `<GraphQLForm>` inside new tab content

---

## Testing

**Fixtures** (`tests/fixtures/graphql/`):
- `github-releases-response.json`
- `wordpress-posts-response.json`
- `relay-edges-response.json`
- `graphql-errors-only.json`
- `graphql-partial-data-with-errors.json`
- `no-array-response.json`

**`tests/graphql.test.ts`**

Config validation:
- Rejects missing endpoint
- Rejects invalid endpoint protocol
- Rejects empty query
- Accepts variables object
- Rejects non-object variables root (array/string)

Array path detection (`findArrayPathCandidates`):
- Finds `data.repository.releases.nodes` as top candidate
- Finds Relay `data.repository.issues.edges`
- Returns empty when no arrays present
- Scores paths with `title`/`url` fields higher

RSS builder (`buildRSSFromStructuredData`):
- Item at `data.posts.nodes` maps to RSS items
- Nested mapping `author.login` resolves correctly
- Missing optional fields don't crash
- Missing `itemPath` throws with useful message
- `itemPath` not array throws with useful message
- HTML description is passed through
- Relay edges with `node.*` mappings work

Worker:
- GraphQL partial data + errors produces feed with warning
- Errors-only response does not write RSS

---

## Acceptance Criteria

- `feedType: graphql` recognized by the system
- Existing `feedType: api` configs continue to work
- User can select GraphQL tab in the builder
- User can enter endpoint, query, variables, operation name, headers
- "Run Query" returns detected array paths
- User can select item path and map fields
- User can preview RSS output
- Worker refreshes GraphQL feeds on schedule
- GraphQL errors with data produce feed + warning
- GraphQL errors without data produce useful failure message
- REST API feeds unaffected by refactor

---

## Design Decisions

### 1. Should `StructuredFeedMapping` live in `models/graphql.model.ts` or a shared models file?

**Options:**
- A. `models/graphql.model.ts` — co-located with GraphQL types
- B. `models/structured-feed.model.ts` — separate shared file
- C. `models/feed-config.model.ts` — inline with main feed config types

**Chosen: A for now.** Both REST and GraphQL import from `models/graphql.model.ts`. If a third structured source type appears, it can be extracted to a shared file then. Premature separation adds indirection with no benefit yet.

---

### 2. Should `buildRSSFromStructuredData` replace or wrap the existing `buildRSSFromApiData`?

**Options:**
- A. Rename `buildRSSFromApiData` → `buildRSSFromStructuredData` (one function, cleaner)
- B. Keep `buildRSSFromApiData` and add `buildRSSFromStructuredData` as a wrapper
- C. Keep both as separate implementations

**Chosen: A.** The feature doc explicitly calls for extracting and renaming the shared builder. The rename is safe because both callers (REST preview and REST worker) will be updated in the same task. A wrapper would add an unnecessary indirection layer.

---

### 3. How should `${ENV_VAR}` placeholders in headers be handled?

**Options:**
- A. Resolve at request time in the utility; never return resolved values in responses
- B. Require users to use the Protected Value encryption system
- C. Support both, with `${VAR}` as the plain env pattern and `{{secret.VAR}}` as the encrypted pattern

**Chosen: A for MVP.** The `${VAR}` pattern is already established in the feature doc. The Protected Value system (from the Protected Value Encryption spec) is the long-term solution; the template syntax `{{ secret.token }}` is reserved for Parameterized Feed Config Templates. For MVP, `${ENV_VAR}` resolved at runtime is sufficient and consistent with existing REST API header behavior.

---

### 4. Should the preview return plain RSS XML or a structured response with candidates?

**Options:**
- A. Single `/preview` endpoint returns RSS XML (existing pattern)
- B. New `POST /preview/graphql` returns structured response: `{ rssXml, arrayPathCandidates, warnings, stats }`
- C. Both: `/preview` for RSS XML, `/preview/graphql` for the structured response used by "Run Query" button

**Chosen: C.** The "Run Query" button needs `arrayPathCandidates` to suggest item paths to the user — that requires a structured endpoint. The main `/preview` endpoint is used by the existing preview modal which expects RSS XML. Both can coexist on distinct paths.
