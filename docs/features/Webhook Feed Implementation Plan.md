Below is an implementation plan for adding **Webhook / Event Receiver feeds** to Mkfd.

The goal:

> Add a source type that accepts incoming JSON events over HTTP and turns them into an RSS feed.

This is a strong Mkfd feature because it makes Mkfd useful for automation systems, CI/CD, homelabs, scripts, uptime monitors, and self-hosted tools. It also clearly differentiates Mkfd from a feed reader: Mkfd becomes an **event-to-feed bridge**.

Mkfd already has source-specific feed types in the builder UI, including web scraping, REST API, and email, with preview/save behavior and form defaults. It also already has outgoing webhook concepts in the feed form defaults, so webhook feeds become the inverse: **incoming webhook → stored event → generated RSS**.

---

# Webhook Feed Implementation Plan

## 1. MVP scope

### MVP behavior

The first version should support:

```text
- Select “Webhook” as a feed type
- Create a named webhook feed
- Generate a per-feed endpoint URL
- Generate a per-feed bearer token
- Accept native Mkfd event JSON payloads
- Store received events
- Generate RSS from latest events
- Deduplicate by provided id or generated hash
- Limit feed size
- Preview sample RSS
- Show curl example in UI
```

### Avoid in MVP

Delay these until the source type is stable:

```text
- Arbitrary third-party payload mapping
- GitHub/Discord/Home Assistant-specific adapters
- HMAC signature verification
- IP allowlists
- replay UI
- delivery retries
- per-event editing
- multi-user ownership
```

Start with **native Mkfd event JSON** only. Add custom mapping later.

---

# 2. Add webhook as a source type

Add:

```ts
type FeedType =
  | "webScraping"
  | "api"
  | "email"
  | "calendar"
  | "sitemap"
  | "filesystem"
  | "webhook";
```

If Calendar/Sitemap/Filesystem are not implemented yet:

```ts
type FeedType =
  | "webScraping"
  | "api"
  | "email"
  | "webhook";
```

The current builder has source tabs. Add a **Webhook** tab:

```text
Web Scraping | REST API | Email | Webhook
```

Later:

```text
Web Scraping | REST API | Email | Calendar | Sitemap | Filesystem | Webhook
```

---

# 3. Native event payload format

Define a simple, stable JSON shape.

```ts
export type WebhookFeedPayload = {
  id?: string;
  title: string;
  description?: string;
  url?: string;
  date?: string;
  author?: string;
  categories?: string[];
  severity?: "info" | "success" | "warning" | "error";
  metadata?: Record<string, unknown>;
};
```

Example:

```json
{
  "id": "deploy-2026-05-15-001",
  "title": "Deployment completed",
  "description": "Mkfd was deployed successfully.",
  "url": "https://github.com/TBosak/mkfd/actions/runs/123",
  "date": "2026-05-15T18:30:00Z",
  "author": "GitHub Actions",
  "categories": ["deployment", "github"],
  "severity": "success",
  "metadata": {
    "workflow": "docker-build",
    "branch": "main"
  }
}
```

For MVP, require `title`. Everything else can be optional.

---

# 4. Recommended config shape

Use a nested block.

```yaml
feedType: webhook
feedName: deployments
refreshTime: 0

webhookFeed:
  slug: deployments
  tokenHash: sha256-token-hash
  maxItems: 100
  retentionDays: 90
  duplicateStrategy: idOrHash
  dateStrategy: payloadDateOrReceivedAt
  storeRawPayload: false

  mapping:
    mode: native
    title: title
    description: description
    link: url
    date: date
    categories: categories
    author: author
```

## Config field meanings

|Field|Purpose|
|---|---|
|`slug`|URL-safe endpoint identifier|
|`tokenHash`|hashed bearer token|
|`maxItems`|number of RSS items retained/emitted|
|`retentionDays`|prune older events|
|`duplicateStrategy`|dedupe behavior|
|`dateStrategy`|payload date or received date|
|`storeRawPayload`|whether raw JSON is stored|
|`mapping.mode`|`native` now, `custom` later|

## Refresh behavior

Webhook feeds do **not** need scheduled refresh. The feed should regenerate immediately after a valid event is received.

`refreshTime: 0` can mean “event-driven.”

---

# 5. Endpoint design

Add:

```text
POST /webhook-feeds/:slug
```

Example:

```bash
curl -X POST "https://mkfd.local/webhook-feeds/deployments" \
  -H "Authorization: Bearer mkfd_wh_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Backup completed",
    "description": "Nightly NAS backup completed successfully.",
    "url": "https://nas.local/backups/2026-05-15",
    "categories": ["backup", "nas"],
    "severity": "success"
  }'
```

Response:

```json
{
  "ok": true,
  "eventId": "evt_01J...",
  "feedUrl": "/public/feeds/deployments.xml"
}
```

Error examples:

```json
{
  "ok": false,
  "error": "Missing Authorization bearer token."
}
```

```json
{
  "ok": false,
  "error": "Payload must include a title."
}
```

---

# 6. Security model

Webhook feeds are public-facing endpoints by design, so they need stronger guardrails.

## MVP security requirements

```text
- Per-feed bearer token
- Store token hash, not plaintext token
- Max JSON payload size
- Require application/json
- Reject missing title
- Sanitize XML output
- Rate limit per endpoint
- Do not expose raw payload in RSS by default
```

## Token generation

Generate a token once when the feed is created.

Example token:

```text
mkfd_wh_3fQxzq83vQ6V0fQb4xGfQG7cGv...
```

Store only:

```ts
sha256(token)
```

UI should show:

```text
Copy this token now. Mkfd will not show it again.
```

## Authorization

Accept:

```text
Authorization: Bearer <token>
```

Optional later:

```text
X-Mkfd-Token: <token>
```

But keep MVP to one method.

## Payload size limit

Recommended default:

```text
64 KB
```

Configurable globally later.

---

# 7. Persistence strategy

Webhook feeds require persistence.

## Recommended if SQLite exists

Use SQLite.

```sql
webhook_feed_events
  id TEXT PRIMARY KEY
  feed_id TEXT NOT NULL
  external_id TEXT
  received_at TEXT NOT NULL
  event_date TEXT NOT NULL
  title TEXT NOT NULL
  description TEXT
  link TEXT
  author TEXT
  categories_json TEXT
  severity TEXT
  metadata_json TEXT
  raw_payload_json TEXT
  dedupe_key TEXT NOT NULL
```

Indexes:

```sql
CREATE INDEX idx_webhook_feed_events_feed_date
ON webhook_feed_events(feed_id, event_date DESC);

CREATE UNIQUE INDEX idx_webhook_feed_events_dedupe
ON webhook_feed_events(feed_id, dedupe_key);
```

## If SQLite is not added yet

Use JSONL:

```text
./feed-state/webhook-events/{feedId}.jsonl
```

Each event is one line:

```json
{"id":"evt_01","feedId":"deployments","receivedAt":"2026-05-15T18:30:00Z","title":"Deployment completed"}
```

For MVP, JSONL is fine. SQLite becomes better once health dashboards, search, pruning, and event replay matter.

---

# 8. Internal normalized event model

Create:

```ts
export type WebhookFeedEvent = {
  id: string;
  feedId: string;
  externalId?: string;
  receivedAt: string;
  eventDate: string;
  title: string;
  description?: string;
  link?: string;
  author?: string;
  categories: string[];
  severity?: "info" | "success" | "warning" | "error";
  metadata?: Record<string, unknown>;
  rawPayload?: unknown;
  dedupeKey: string;
};
```

Normalization rules:

```text
id:
  generated UUID or ULID

externalId:
  payload.id if provided

eventDate:
  payload.date if valid
  otherwise receivedAt

dedupeKey:
  payload.id if provided
  otherwise hash(title + link + eventDate)
```

---

# 9. Backend utility

Create:

```text
utilities/webhook-feed.utility.ts
```

## Responsibilities

```text
- generate tokens
- hash tokens
- verify tokens
- validate payload
- normalize payload
- compute dedupe key
- store event
- load latest events
- prune old events
- build event stats
```

## Suggested API

```ts
export function generateWebhookToken(): string;

export function hashWebhookToken(token: string): string;

export function verifyWebhookToken(token: string, tokenHash: string): boolean;

export function validateWebhookPayload(payload: unknown): WebhookFeedPayload;

export function normalizeWebhookEvent(
  feedId: string,
  payload: WebhookFeedPayload,
  receivedAt: Date,
): WebhookFeedEvent;

export async function appendWebhookEvent(
  feedId: string,
  event: WebhookFeedEvent,
): Promise<{ inserted: boolean; duplicate: boolean }>;

export async function loadWebhookEvents(
  feedId: string,
  limit: number,
): Promise<WebhookFeedEvent[]>;

export async function pruneWebhookEvents(
  feedId: string,
  retentionDays: number,
  maxItems: number,
): Promise<void>;
```

---

# 10. RSS builder

Add:

```ts
export function buildRSSFromWebhookEvents(
  events: WebhookFeedEvent[],
  feedConfig: FeedConfig,
): string;
```

## RSS mapping

|RSS field|Webhook event|
|---|---|
|title|`title`|
|description|`description` + optional severity/metadata|
|link|`link`|
|guid|`externalId` or internal `id`|
|pubDate|`eventDate`|
|author|`author`|
|categories|`categories` + optional severity|

Example item:

```xml
<item>
  <title>Deployment completed</title>
  <link>https://github.com/TBosak/mkfd/actions/runs/123</link>
  <guid>deploy-2026-05-15-001</guid>
  <pubDate>Fri, 15 May 2026 18:30:00 GMT</pubDate>
  <category>deployment</category>
  <category>github</category>
  <category>success</category>
  <description>Mkfd was deployed successfully.</description>
</item>
```

## Metadata rendering

For MVP, do not include metadata by default unless the user enables it. Metadata can contain sensitive values.

Later option:

```yaml
webhookFeed:
  includeMetadataInDescription: false
```

---

# 11. Backend routes

## Create feed

The existing feed creation route should save `feedType: webhook` config.

On create:

1. generate token
    
2. hash token
    
3. save hash in config
    
4. show token once in response
    

Response should include token only once:

```json
{
  "ok": true,
  "feedUrl": "/public/feeds/deployments.xml",
  "webhookUrl": "/webhook-feeds/deployments",
  "token": "mkfd_wh_..."
}
```

## Receive event

Add route:

```ts
app.post("/webhook-feeds/:slug", async (c) => {
  // locate feed config by slug
  // validate bearer token
  // parse JSON
  // validate payload
  // normalize event
  // append event
  // prune old events
  // rebuild RSS XML
  // return result
});
```

## Optional inspect endpoint later

```text
GET /webhook-feeds/:slug/status
```

Could show event count, last received time, last error, but keep this authenticated.

---

# 12. UI implementation

Create:

```text
frontend/src/components/forms/WebhookFeedForm.tsx
```

## UI sections

### Endpoint settings

```text
Webhook feed name
[ Deployments ]

Endpoint slug
[ deployments ]
```

Slug should auto-generate from feed name, but remain editable.

### Security

```text
Authentication
[x] Require bearer token

[ Generate token on save ]
```

After saving:

```text
Webhook URL:
https://mkfd.local/webhook-feeds/deployments

Bearer token:
mkfd_wh_...

Copy this token now. It will not be shown again.
```

### Feed behavior

```text
Max items
[ 100 ]

Retention
[ 90 ] days

Duplicate handling
[ Use payload id, otherwise hash event ]

Date strategy
[ Payload date, otherwise received time ]
```

### Payload format

For MVP:

```text
Payload format
[ Mkfd native event JSON ]
```

Display schema example:

```json
{
  "title": "Backup completed",
  "description": "Nightly backup completed successfully.",
  "url": "https://example.com/report",
  "date": "2026-05-15T18:30:00Z",
  "categories": ["backup"],
  "severity": "success"
}
```

### Curl example

Generate the curl command dynamically:

```bash
curl -X POST "{{webhookUrl}}" \
  -H "Authorization: Bearer {{token}}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test event","description":"Hello from Mkfd"}'
```

This is important. Webhook feeds are much more useful when the UI teaches the user how to use them.

---

# 13. Preview behavior

Webhook feeds are event-driven, so preview is different.

For MVP, preview can generate a sample feed using sample events.

Example:

```ts
const sampleEvents = [
  {
    title: "Example event",
    description: "This is how incoming webhook events will appear.",
    eventDate: new Date().toISOString(),
    categories: ["example"],
  },
];
```

When the user clicks Preview, show sample RSS.

After feed exists, preview can show actual stored events.

---

# 14. Regeneration behavior

When a webhook event is received:

```text
1. Store event
2. Load latest N events
3. Build RSS
4. Write ./public/feeds/{feedId}.xml
5. Return success
```

This avoids waiting for a worker interval.

Webhook feeds may not need a worker branch at all, except for maintenance tasks like pruning. If Mkfd has a general feed startup process, webhook feeds should simply ensure their RSS XML exists on startup by rebuilding from stored events.

## Startup behavior

On app startup:

```text
For each webhook feed:
  load latest events
  rebuild RSS XML
```

This prevents missing XML after restart.

---

# 15. Optional outgoing webhook integration

This is not MVP, but interesting:

A webhook feed could also trigger Mkfd’s existing outgoing webhook behavior when it receives a new event.

Example:

```text
Incoming webhook event -> Mkfd RSS item -> outgoing webhook to Discord/Slack/automation
```

Do this later to avoid confusion between incoming and outgoing webhooks.

Use clear names:

```text
Webhook Feed = incoming
Feed Webhook = outgoing
```

Or better:

```text
Incoming Event Feed
Outgoing Notifications
```

---

# 16. Health dashboard integration

Webhook feeds should produce rich health data.

Stats:

```ts
type WebhookFeedStats = {
  feedId: string;
  slug: string;
  totalEvents: number;
  retainedEvents: number;
  lastReceivedAt?: string;
  lastDuplicateAt?: string;
  lastRejectedAt?: string;
  rejectedCount: number;
  duplicateCount: number;
  lastError?: string;
};
```

Warnings:

```text
- no events received yet
- recent rejected events
- token authentication failures
- payload too large
- invalid JSON
- duplicate event ignored
- retention pruned old events
```

This pairs well with the feed health dashboard you are already considering.

---

# 17. Rate limiting

Add simple per-slug rate limiting.

MVP:

```text
Max 60 requests per minute per webhook slug
```

In memory is fine at first:

```ts
const webhookRateLimits = new Map<string, { count: number; resetAt: number }>();
```

Later, use SQLite or persistent store.

Return:

```text
429 Too Many Requests
```

---

# 18. Validation rules

Payload validation:

```text
title:
  required
  string
  max 300 chars

description:
  optional
  string
  max 20,000 chars

url:
  optional
  valid http/https URL

date:
  optional
  valid date

categories:
  optional
  string array
  max 25 items
  each max 100 chars

severity:
  optional
  info | success | warning | error

metadata:
  optional object
  max serialized size
```

Do not allow arbitrary XML/HTML to pass unsanitized into feed XML. Mkfd already has XML sanitizer utilities, so use those in the RSS builder path.

---

# 19. Custom mapping later

After native payloads work, add `mapping.mode: custom`.

Config:

```yaml
webhookFeed:
  mapping:
    mode: custom
    title: workflow_run.display_title
    description: workflow_run.conclusion
    link: workflow_run.html_url
    date: workflow_run.updated_at
    categories:
      - repository.full_name
      - workflow_run.event
```

This would let users turn third-party webhook payloads directly into RSS without writing glue scripts.

Supported JSON path should be simple dot notation first, similar to your API mapping direction:

```text
workflow_run.html_url
repository.full_name
commit.author.name
```

Avoid full JSONPath in the first pass.

---

# 20. Adapter presets later

After custom mapping, add presets:

```text
- GitHub Actions workflow_run
- GitHub release
- GitLab pipeline
- Uptime Kuma
- Home Assistant
- Gitea release
- Drone CI
- Jenkins build
```

Each preset is just a mapping template.

This is a better long-term strategy than hardcoding a lot of source-specific webhook routes.

---

# 21. Tests

## Utility tests

Create tests for:

```text
- token generation
- token hashing
- valid token verification
- invalid token rejection
- payload validation
- missing title rejection
- invalid date fallback
- dedupe key from payload id
- dedupe key from hash
- normalization
- pruning old events
```

## Route tests

Test:

```text
- POST without auth returns 401
- POST with invalid token returns 403
- POST with invalid JSON returns 400
- POST with missing title returns 400
- POST valid event returns 200
- duplicate event returns 200 with duplicate flag or 409, choose one
- payload too large returns 413
- rate limited returns 429
```

I recommend returning `200` for duplicates with:

```json
{
  "ok": true,
  "duplicate": true
}
```

That makes webhook clients easier to retry safely.

## RSS builder tests

Test:

```text
- event becomes RSS item
- title is escaped/sanitized
- description is escaped/sanitized
- link maps correctly
- categories map correctly
- severity can become category
- date maps correctly
- GUID uses external id when present
- XML validates
```

## Persistence tests

If JSONL:

```text
- append event writes one line
- load latest events returns newest first
- corrupt line is skipped with warning
- prune removes old entries
```

If SQLite:

```text
- insert event
- duplicate dedupe key ignored
- load latest by event_date desc
- retention delete works
```

---

# 22. README documentation

Add:

```md
## 📬 Webhook Feeds

Mkfd can create RSS feeds from incoming webhook events. This is useful for CI/CD pipelines, backup scripts, uptime monitors, home automation, server alerts, and other systems that can send HTTP POST requests.

Each webhook feed gets its own endpoint and bearer token. When Mkfd receives a valid JSON event, it stores the event and regenerates the RSS feed.
```

Example:

```bash
curl -X POST "https://mkfd.local/webhook-feeds/deployments" \
  -H "Authorization: Bearer mkfd_wh_your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Deployment completed",
    "description": "Mkfd was deployed successfully.",
    "url": "https://github.com/TBosak/mkfd/actions/runs/123",
    "categories": ["deployment"],
    "severity": "success"
  }'
```

Sample config:

```yaml
feedType: webhook
feedName: deployments
refreshTime: 0

webhookFeed:
  slug: deployments
  tokenHash: sha256-token-hash
  maxItems: 100
  retentionDays: 90
  duplicateStrategy: idOrHash
  dateStrategy: payloadDateOrReceivedAt
  storeRawPayload: false
  mapping:
    mode: native
```

---

# 23. Recommended implementation order

## Sprint 1: Core event model and storage

Deliverables:

```text
- Add webhook feed type
- Add WebhookFeedPayload and WebhookFeedEvent types
- Add webhook-feed.utility.ts
- Add token generation/hash/verify
- Add JSONL or SQLite event storage
- Add validation and normalization tests
```

## Sprint 2: Incoming endpoint

Deliverables:

```text
- POST /webhook-feeds/:slug
- Auth checks
- Payload validation
- Dedupe
- Store event
- Return JSON response
- Route tests
```

## Sprint 3: RSS generation

Deliverables:

```text
- buildRSSFromWebhookEvents
- Regenerate feed after event insert
- Rebuild webhook feed XML on startup
- RSS tests
```

## Sprint 4: Frontend form

Deliverables:

```text
- WebhookFeedForm.tsx
- Add Webhook tab
- Slug generation
- Token generation UX
- Native payload schema display
- Generated curl example
- Sample preview
```

## Sprint 5: Retention, rate limiting, and stats

Deliverables:

```text
- retention pruning
- max item enforcement
- simple per-slug rate limiting
- rejected/duplicate counters
- basic stats file or DB records
```

## Sprint 6: Custom mapping and presets

Deliverables:

```text
- custom JSON field mappings
- mapping preview
- GitHub Actions preset
- Uptime Kuma preset
- Home Assistant preset
```

---

# 24. MVP acceptance criteria

Webhook feeds are MVP-complete when:

```text
- User can create a Webhook feed.
- Mkfd generates a slug and token.
- User can copy endpoint URL and token.
- POST /webhook-feeds/:slug accepts valid authenticated JSON.
- Invalid or unauthenticated requests are rejected.
- Events are persisted.
- Duplicate events are handled safely.
- Received events become RSS items.
- Feed XML updates immediately after event receipt.
- Feed XML survives app restart.
- Payload fields are sanitized for XML.
- The UI shows a working curl example.
```

---

# 25. Strategic positioning

Good product language:

> Create RSS feeds from incoming webhook events.

Sharper:

> Turn CI/CD events, server alerts, backup jobs, home automation, and custom scripts into RSS feeds.

Broader Mkfd positioning:

> Mkfd turns webpages, APIs, email folders, calendars, sitemaps, local files, and automation events into reliable feeds.

I would place webhook feeds at **P2**, or **late P1 if SQLite/event storage is added early**. They are not hard conceptually, but they are security-sensitive and storage-dependent. The payoff is high because they open Mkfd to any system that can send HTTP events.