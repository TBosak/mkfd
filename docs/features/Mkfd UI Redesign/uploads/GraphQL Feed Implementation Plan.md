Below is an implementation plan for adding **GraphQL feeds** to Mkfd.

The goal:

> Add a source type that runs a GraphQL query on an interval, maps the response data into feed items, and outputs RSS.

GraphQL should be implemented as a sibling to REST API feeds, not as a variant hidden inside the REST form. The important architecture move is to extract the existing API mapping logic into a shared **structured-data feed builder** that both REST and GraphQL can use.

---

# GraphQL Feed Implementation Plan

## 1. MVP scope

### MVP behavior

The first version should support:

```text
- Select “GraphQL” as a feed type
- Enter a GraphQL endpoint
- Enter query text
- Enter optional variables JSON
- Enter optional operation name
- Configure headers
- Run query preview
- Select item path from response data
- Map item fields to RSS fields
- Preview generated RSS
- Save feed config
- Worker refreshes GraphQL feed on interval
```

### Avoid in MVP

Delay these:

```text
- GraphQL schema introspection UI
- query autocomplete
- Relay pagination
- cursor pagination
- OAuth helpers
- persisted queries
- subscriptions
- batching
- file uploads
```

Start with one query request that returns enough items for the feed.

---

# 2. Rename current API concept to REST

Before adding GraphQL, split terminology:

```text
API -> REST API
```

Keep backward compatibility:

```ts
type FeedType =
  | "webScraping"
  | "api"
  | "rest"
  | "graphql"
  | "email";
```

Treat legacy `api` as `rest` internally:

```ts
function normalizeFeedType(feedType: string) {
  if (feedType === "api") return "rest";
  return feedType;
}
```

When editing/saving older configs, you can continue to read `feedType: api`, but new configs should write:

```yaml
feedType: rest
```

This gives you a clean path to:

```text
REST API
GraphQL
```

without breaking existing users.

---

# 3. Extract a shared structured-data builder

Right now REST API feeds likely have a builder shaped around `apiMapping`. Refactor that concept into a reusable structured mapping layer.

## Shared mapping type

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
```

## Shared source result

```ts
export type StructuredFeedSourceResult = {
  data: unknown;
  warnings: string[];
  stats: {
    itemCount?: number;
    responseBytes?: number;
    fetchMs?: number;
  };
};
```

## Shared builder API

Create or rename:

```ts
export function buildRSSFromStructuredData(
  data: unknown,
  mapping: StructuredFeedMapping,
  feedConfig: FeedConfig,
): string {
  const items = get(data, mapping.itemPath);

  if (!Array.isArray(items)) {
    throw new Error(`Structured item path did not resolve to an array: ${mapping.itemPath}`);
  }

  return buildRSSFromStructuredItems(items, mapping, feedConfig);
}
```

REST and GraphQL then become:

```text
REST:
fetch HTTP JSON -> buildRSSFromStructuredData

GraphQL:
POST query -> buildRSSFromStructuredData
```

This keeps GraphQL small.

---

# 4. Config shape

Use a dedicated `graphql` block.

```yaml
feedType: graphql
feedName: github-releases
refreshTime: 30

graphql:
  endpoint: https://api.github.com/graphql
  method: POST
  headers:
    Authorization: Bearer ${GITHUB_TOKEN}
  query: |
    query RepositoryReleases($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        releases(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            name
            url
            descriptionHTML
            publishedAt
            author {
              login
            }
          }
        }
      }
    }
  variables:
    owner: TBosak
    name: mkfd
  operationName: RepositoryReleases
  timeoutMs: 15000

  mapping:
    itemPath: data.repository.releases.nodes
    title: name
    link: url
    description: descriptionHTML
    author: author.login
    pubDate: publishedAt
    guid: url
```

Important: GraphQL responses usually wrap useful results under `data`, so the item path should include `data`.

---

# 5. GraphQL feed types

Add types:

```ts
export type GraphQLFeedConfig = {
  endpoint: string;
  method: "POST";
  headers?: Record<string, string>;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  timeoutMs?: number;
  mapping: StructuredFeedMapping;
  pagination?: GraphQLPaginationConfig;
};

export type GraphQLPaginationConfig = {
  enabled: boolean;
  type?: "relay" | "offset" | "page";
};
```

For MVP, keep pagination disabled:

```ts
pagination: {
  enabled: false
}
```

---

# 6. Backend utility

Create:

```text
utilities/graphql-feed.utility.ts
```

## Responsibilities

```text
- validate GraphQL config
- parse variables JSON
- send POST request
- include query, variables, operationName
- handle GraphQL errors
- return response data
- produce warnings/stats
```

## API

```ts
export type ExecuteGraphQLFeedOptions = {
  endpoint: string;
  headers?: Record<string, string>;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  timeoutMs?: number;
};

export async function executeGraphQLFeedRequest(
  options: ExecuteGraphQLFeedOptions,
): Promise<StructuredFeedSourceResult> {
  const started = Date.now();

  const response = await axios.post(
    options.endpoint,
    {
      query: options.query,
      variables: options.variables ?? {},
      operationName: options.operationName,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
      timeout: options.timeoutMs ?? 15000,
    },
  );

  const warnings: string[] = [];

  if (response.data?.errors?.length) {
    warnings.push(`GraphQL returned ${response.data.errors.length} error(s).`);
  }

  return {
    data: response.data,
    warnings,
    stats: {
      fetchMs: Date.now() - started,
      responseBytes: JSON.stringify(response.data).length,
    },
  };
}
```

Do not fail automatically on GraphQL `errors` if `data` is still present. GraphQL can return partial data plus errors. Fail only if there is no usable `data`.

---

# 7. Error handling rules

GraphQL can fail in several ways.

Handle these clearly:

```text
- endpoint network failure
- non-2xx HTTP response
- invalid JSON response
- response has errors and no data
- response has data plus errors
- itemPath does not exist
- itemPath exists but is not an array
- mapped field path does not exist
```

Recommended behavior:

|Condition|Behavior|
|---|---|
|Network failure|fail feed run|
|HTTP 401/403|fail with auth message|
|HTTP 429|fail with rate-limit message|
|GraphQL `errors` only|fail|
|GraphQL `data` plus `errors`|generate feed, log warning|
|item path missing|fail|
|item path not array|fail|
|individual mapped field missing|warn or leave blank|

---

# 8. Frontend UI

Create:

```text
components/forms/GraphQLForm.tsx
```

or wherever the current form components live.

## Source section

```text
GraphQL endpoint
[ https://api.example.com/graphql ]

Operation name
[ optional ]

Timeout
[ 15000 ] ms
```

## Headers section

Use the same pattern as REST API headers.

```text
Headers

Authorization
[ Bearer ${TOKEN} ]

Content-Type
[ application/json ]
```

Long-term, use a secrets manager instead of storing tokens directly in YAML. For MVP, match the current REST API behavior.

## Query editor

Use a textarea first:

```text
GraphQL query

query LatestPosts($limit: Int!) {
  posts(first: $limit) {
    nodes {
      title
      url
      excerpt
      publishedAt
    }
  }
}
```

Later, replace with CodeMirror or Monaco.

## Variables editor

Use a JSON textarea:

```json
{
  "limit": 20
}
```

Validation:

```text
- empty is allowed
- must parse as JSON object
- arrays/string roots are invalid for variables
```

## Run query / response preview

Add button:

```text
Run Query
```

Show:

```text
Status: success
Response size: 18 KB
Detected arrays:
- data.posts.nodes
- data.repository.releases.nodes
```

This detected-array helper will make GraphQL much more usable.

## Mapping section

Same as REST mapping:

```text
Item path
[ data.posts.nodes ]

Title path
[ title ]

Link path
[ url ]

Description path
[ excerpt ]

Date path
[ publishedAt ]

GUID path
[ url ]
```

## Preview RSS

Reuse the existing preview flow.

---

# 9. Detected array paths helper

Create a utility that walks a JSON response and finds arrays that look like item collections.

```ts
export type JsonArrayPathCandidate = {
  path: string;
  length: number;
  sampleKeys: string[];
  confidence: number;
};

export function findArrayPathCandidates(data: unknown): JsonArrayPathCandidate[] {
  const results: JsonArrayPathCandidate[] = [];

  function walk(value: unknown, path: string) {
    if (Array.isArray(value)) {
      const firstObject = value.find(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      ) as Record<string, unknown> | undefined;

      results.push({
        path,
        length: value.length,
        sampleKeys: firstObject ? Object.keys(firstObject).slice(0, 20) : [],
        confidence: scoreArrayCandidate(path, value),
      });

      value.slice(0, 3).forEach((item, index) => walk(item, `${path}.${index}`));
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  }

  walk(data, "");

  return results
    .filter((candidate) => candidate.length > 0)
    .sort((a, b) => b.confidence - a.confidence);
}
```

Scoring:

```text
Higher confidence if:
- path includes nodes
- path includes edges
- path includes items
- path includes results
- array items are objects
- sample keys include title/name/url/date/createdAt/publishedAt
```

Special Relay case:

```text
data.repository.releases.edges[].node
```

For MVP, you can either require users to map:

```text
data.repository.releases.nodes
```

or add support for edges:

```text
data.repository.releases.edges
title: node.name
link: node.url
```

That is simpler than trying to auto-flatten Relay responses at first.

---

# 10. Preview endpoint

Extend the existing preview route:

```ts
if (normalizeFeedType(body.feedType) === "graphql") {
  const result = await executeGraphQLFeedRequest(body.graphql);

  const rssXml = buildRSSFromStructuredData(
    result.data,
    body.graphql.mapping,
    body,
  );

  return c.text(rssXml);
}
```

Better later:

```text
POST /preview/graphql
```

Response:

```ts
{
  rssXml: string;
  dataPreview: unknown;
  arrayPathCandidates: JsonArrayPathCandidate[];
  warnings: string[];
  stats: {
    fetchMs: number;
    responseBytes: number;
    itemCount: number;
  };
}
```

This enables a nicer UI.

---

# 11. Worker support

Update the feed updater worker:

```ts
if (normalizeFeedType(feed.feedType) === "graphql") {
  const result = await executeGraphQLFeedRequest({
    endpoint: feed.graphql.endpoint,
    headers: feed.graphql.headers,
    query: feed.graphql.query,
    variables: feed.graphql.variables,
    operationName: feed.graphql.operationName,
    timeoutMs: feed.graphql.timeoutMs,
  });

  const rssXml = buildRSSFromStructuredData(
    result.data,
    feed.graphql.mapping,
    feed,
  );

  await Bun.write(`./public/feeds/${feedId}.xml`, rssXml);

  postRunStats({
    feedId,
    fetchMs: result.stats.fetchMs,
    responseBytes: result.stats.responseBytes,
    warnings: result.warnings,
  });
}
```

GraphQL should refresh on interval like REST API feeds.

---

# 12. Authentication and secrets

GraphQL commonly needs auth headers.

MVP:

```yaml
headers:
  Authorization: Bearer ${GITHUB_TOKEN}
```

Then resolve environment variables at runtime:

```ts
function resolveEnvPlaceholders(value: string) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, key) => {
    return process.env[key] ?? "";
  });
}
```

Apply recursively to headers and variables.

Important warning:

```text
Do not echo resolved secrets back in preview responses.
```

UI should show configured placeholders, not resolved values.

Later, add a secrets manager:

```text
Settings -> Secrets
GITHUB_TOKEN = encrypted value
```

Then configs use:

```yaml
Authorization: Bearer {{secret:GITHUB_TOKEN}}
```

---

# 13. GraphQL response path mapping

Reuse your existing `get` behavior if it supports dot paths.

Examples:

```yaml
mapping:
  itemPath: data.posts.nodes
  title: title
  link: url
  description: excerpt
  pubDate: publishedAt
```

Nested example:

```yaml
mapping:
  itemPath: data.repository.releases.nodes
  title: name
  link: url
  author: author.login
  description: descriptionHTML
  pubDate: publishedAt
```

Relay edges example:

```yaml
mapping:
  itemPath: data.repository.issues.edges
  title: node.title
  link: node.url
  author: node.author.login
  pubDate: node.createdAt
```

Keep this model because it is consistent with REST mappings.

---

# 14. Field transformations

GraphQL should eventually use the same field transformer system as REST.

Example:

```yaml
mapping:
  itemPath: data.posts.nodes
  title: title
  link: slug
  description: excerpt
  pubDate: publishedAt

transformers:
  link:
    - type: prepend
      value: https://example.com/posts/
  description:
    - type: stripHtml
  title:
    - type: trim
```

Do not make GraphQL special here. Structured source mappings should all share transformers.

---

# 15. Pagination later

Do not implement pagination in MVP.

Add it as Phase 2 or 3.

## Relay pagination config

```yaml
graphql:
  pagination:
    enabled: true
    type: relay
    cursorVariable: after
    pageInfoPath: data.repository.releases.pageInfo
    hasNextPagePath: hasNextPage
    endCursorPath: endCursor
    maxPages: 3
```

Query:

```graphql
query RepositoryReleases($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    releases(first: 20, after: $after) {
      nodes {
        name
        url
        publishedAt
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

Flow:

```text
1. Execute query with after = null
2. Collect items
3. Read pageInfo
4. If hasNextPage and maxPages not reached:
   variables.after = endCursor
   repeat
5. Merge item arrays
6. Build feed
```

## Offset pagination config

```yaml
pagination:
  enabled: true
  type: offset
  offsetVariable: offset
  limitVariable: limit
  limit: 50
  maxPages: 3
```

Later only.

---

# 16. GraphQL source presets

After MVP, add presets to make the feature easier.

Potential presets:

```text
- GitHub releases
- GitHub issues
- GitHub pull requests
- GitHub discussions
- GitLab issues
- Shopify products
- Hasura table rows
- WordPress GraphQL posts
```

A preset is just:

```text
endpoint template
query template
variables template
mapping defaults
auth instructions
```

Example GitHub release preset:

```yaml
graphql:
  endpoint: https://api.github.com/graphql
  query: |
    query RepositoryReleases($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        releases(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            name
            url
            descriptionHTML
            publishedAt
            author {
              login
            }
          }
        }
      }
    }
  variables:
    owner: TBosak
    name: mkfd
  mapping:
    itemPath: data.repository.releases.nodes
    title: name
    link: url
    description: descriptionHTML
    pubDate: publishedAt
    author: author.login
    guid: url
```

Presets are useful, but not required for MVP.

---

# 17. UI validation

Validate before preview/save:

```text
endpoint:
  required
  valid http/https URL

query:
  required
  must contain "query" or "mutation" or valid GraphQL document-looking text

variables:
  optional
  valid JSON object

operationName:
  optional string

headers:
  optional key/value pairs

itemPath:
  required

title mapping:
  recommended

link or guid mapping:
  recommended

date mapping:
  recommended
```

Do not require title/link/date for all use cases, but warn if missing.

---

# 18. Backend validation

Backend should not trust the UI.

Validation:

```ts
function validateGraphQLConfig(config: unknown): GraphQLFeedConfig {
  // endpoint exists
  // endpoint protocol is http/https
  // query is string and not empty
  // variables is object if present
  // operationName is string if present
  // mapping.itemPath exists
  // timeout bounded
}
```

Recommended timeout bounds:

```text
min: 1000 ms
default: 15000 ms
max: 60000 ms
```

Recommended response size limit:

```text
default: 5 MB
```

---

# 19. Health dashboard stats

Design stats now even if the dashboard comes later.

```ts
type GraphQLRunStats = {
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
```

Useful warnings:

```text
- GraphQL response included errors
- item path returned 0 items
- item path did not resolve to an array
- mapped title missing on N items
- mapped date missing on N items
- mapped link/guid missing on N items
- response exceeded configured size
- request timed out
```

This fits Mkfd’s feed reliability direction.

---

# 20. Tests

## Fixtures

Create:

```text
tests/fixtures/graphql/
  github-releases-response.json
  wordpress-posts-response.json
  relay-edges-response.json
  graphql-errors-only.json
  graphql-partial-data-with-errors.json
  no-array-response.json
```

## Utility tests

Test:

```text
- validates config
- rejects missing endpoint
- rejects invalid endpoint
- rejects empty query
- accepts variables object
- rejects invalid variables root
- detects GraphQL errors
- allows partial data with errors
- fails errors-only response
```

## Mapping tests

Test:

```text
- itemPath resolves array
- nested itemPath works
- relay edges itemPath works
- title mapping works
- nested author mapping works
- missing optional fields do not crash
- missing itemPath throws useful error
```

## RSS builder tests

Test:

```text
- GraphQL item becomes RSS item
- HTML description is sanitized
- pubDate maps correctly
- guid uses configured field
- link maps correctly
- categories map correctly
- XML validates
```

## Preview route tests

Test:

```text
- valid GraphQL config returns RSS XML
- GraphQL response with errors and data returns XML with warning
- GraphQL response with errors only returns useful failure
- item path not array returns useful failure
```

---

# 21. README documentation

Add:

```md
## GraphQL Feeds

Mkfd can generate RSS feeds from GraphQL endpoints. Provide an endpoint, query, optional variables, and a response item path. Mkfd runs the query on an interval and maps the returned objects into RSS items.
```

Example:

```yaml
feedType: graphql
feedName: repository-releases
refreshTime: 30

graphql:
  endpoint: https://api.github.com/graphql
  headers:
    Authorization: Bearer ${GITHUB_TOKEN}
  query: |
    query RepositoryReleases($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        releases(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            name
            url
            descriptionHTML
            publishedAt
            author {
              login
            }
          }
        }
      }
    }
  variables:
    owner: TBosak
    name: mkfd
  operationName: RepositoryReleases
  mapping:
    itemPath: data.repository.releases.nodes
    title: name
    link: url
    description: descriptionHTML
    pubDate: publishedAt
    author: author.login
    guid: url
```

Add note:

```md
Pagination is not supported in the first GraphQL release. Write queries that return the number of items you want in the feed.
```

---

# 22. Recommended implementation order

## Sprint 1: REST/API naming cleanup

Deliverables:

```text
- Rename UI label from API to REST API
- Add rest as preferred feedType
- Keep api as legacy alias
- Normalize feed type internally
```

## Sprint 2: Structured-data builder extraction

Deliverables:

```text
- Extract StructuredFeedMapping
- Rename or wrap buildRSSFromApiData as buildRSSFromStructuredData
- Make REST use shared builder
- Add tests to ensure existing REST feeds still work
```

## Sprint 3: GraphQL request utility

Deliverables:

```text
- Add graphql-feed.utility.ts
- Execute POST request
- Headers, variables, operationName
- Error handling
- Config validation
- Unit tests
```

## Sprint 4: Preview support

Deliverables:

```text
- Add GraphQL preview branch
- Build RSS from GraphQL response
- Add array-path detection helper
- Return warnings/stats
```

## Sprint 5: UI form

Deliverables:

```text
- Add GraphQLForm.tsx
- Endpoint field
- Headers editor
- Query textarea
- Variables JSON textarea
- Operation name
- Item path/mapping fields
- Run Query button
- RSS Preview button
```

## Sprint 6: Worker support

Deliverables:

```text
- Add GraphQL feed branch to updater
- Generate XML on schedule
- Capture stats/warnings
- Handle failures clearly
```

## Sprint 7: Docs and examples

Deliverables:

```text
- README GraphQL section
- GitHub releases example
- WordPress GraphQL posts example
- Troubleshooting notes
```

## Sprint 8: Pagination and presets later

Deliverables:

```text
- Relay pagination
- Offset pagination
- GitHub preset
- WordPress GraphQL preset
- Mapping templates
```

---

# 23. MVP acceptance criteria

GraphQL feeds are MVP-complete when:

```text
- User can select GraphQL as a feed type.
- User can enter endpoint, query, variables, operation name, and headers.
- User can run the query and see whether it succeeds.
- Mkfd can detect candidate array paths from the response.
- User can map item fields to RSS fields.
- User can preview RSS output.
- User can save a GraphQL feed.
- Worker refreshes the GraphQL feed on interval.
- GraphQL errors produce useful messages.
- Partial data with GraphQL errors can still generate a feed with warnings.
- Existing REST API feeds still work.
```

---

# 24. Priority recommendation

I would still put GraphQL at **P3** unless your users are primarily developers and self-hosters who already consume APIs heavily.

However, the prerequisite work is valuable sooner:

```text
P1/P2:
- Rename API to REST API
- Extract structured-data builder
- Improve response preview and item path detection

P3:
- Add GraphQL-specific request UI and worker support
```

That way, GraphQL becomes easier to implement later, and REST API feeds improve immediately.

---

# Strategic framing

GraphQL feeds fit Mkfd’s broader identity:

> Mkfd turns structured data, messy webpages, local files, email folders, calendars, sitemaps, and automation events into reliable RSS feeds.

The feature should not be presented as “advanced API support” only. It should be part of a larger story:

```text
REST API feeds: map JSON endpoints into RSS.
GraphQL feeds: query structured APIs and map the response into RSS.
Webhook feeds: receive events and expose them as RSS.
```

That gives Mkfd a coherent structured-source pipeline instead of a scattered set of source types.