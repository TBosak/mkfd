# Webhook Feeds — Design Spec

**Date:** 2026-05-24
**Tier:** R5 New Source Types
**Status:** Approved

---

## Goal

Add `feedType: webhook` so Mkfd can receive incoming HTTP events and turn them into RSS feeds. Each webhook feed gets its own endpoint URL and bearer token. When a valid event arrives, it is stored and the feed XML is immediately regenerated — no polling interval needed.

---

## Scope

### In scope (MVP)

- `feedType: webhook` added to `FeedType`
- `WebhookFeedPayload` (native Mkfd event format: title required, rest optional)
- `WebhookFeedEvent` (normalized storage model with dedupe key)
- `utilities/webhook-feed.utility.ts` — token gen/hash/verify, payload validation, normalization, JSONL storage, pruning
- `buildRSSFromWebhookEvents` in RSS builder
- `POST /webhook-feeds/:slug` endpoint (auth, validation, dedupe, store, regenerate)
- Per-slug in-memory rate limiting (60 req/min)
- Startup rebuild of feed XML from stored events
- `WebhookFeedForm.tsx` with Webhook tab in builder
- Curl example auto-generated in UI
- `models/webhook.model.ts`

### Out of scope (MVP)

- HMAC signature verification
- Custom payload mapping (`mapping.mode: custom`)
- Third-party adapter presets (GitHub Actions, Uptime Kuma, etc.)
- IP allowlists
- Event replay UI
- Per-event editing
- Outgoing webhook on incoming event
- SQLite storage (use JSONL files; SQLite migration deferred to SQLite Runtime Substrate)

---

## Dependencies

Must be implemented first:

- Feed Config Formalization (canonical `FeedConfig` for `feedType: webhook`)

---

## Architecture

| Unit | File | Responsibility |
|---|---|---|
| Webhook model | `models/webhook.model.ts` | All webhook types |
| Webhook utility | `utilities/webhook-feed.utility.ts` | Token, validation, normalization, JSONL storage, pruning |
| RSS builder | `utilities/rss-builder.utility.ts` | Add `buildRSSFromWebhookEvents` |
| Webhook tests | `tests/webhook.test.ts` | Unit tests for utility, storage, builder |
| Webhook routes | `routes/webhook.ts` | `POST /webhook-feeds/:slug` |
| Webhook form | `frontend/src/components/forms/WebhookFeedForm.tsx` | Webhook builder UI |
| Feed builder | `frontend/src/components/forms/FeedBuilderForm.tsx` | Add Webhook tab |

---

## Data Model

### `models/webhook.model.ts` (new)

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

export type WebhookFeedConfig = {
  slug: string;
  tokenHash: string;
  maxItems: number;
  retentionDays: number;
  duplicateStrategy: "idOrHash" | "idOnly" | "always";
  dateStrategy: "payloadDateOrReceivedAt" | "receivedAt" | "payloadDateOnly";
  storeRawPayload: boolean;
  mapping: { mode: "native" };
};

export type WebhookFeedStats = {
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

export type WebhookReceiveResult = {
  ok: boolean;
  eventId?: string;
  feedUrl?: string;
  duplicate?: boolean;
  error?: string;
};
```

### `FeedConfig` addition

Add `"webhook"` to `FeedType` and `webhookFeed?: WebhookFeedConfig` to `FeedConfig`.

---

## Webhook Utility

### `utilities/webhook-feed.utility.ts` (new)

```ts
export function generateWebhookToken(): string;
// Returns "mkfd_wh_" + 32 random hex chars

export function hashWebhookToken(token: string): string;
// Returns hex sha256 of token

export function verifyWebhookToken(token: string, tokenHash: string): boolean;
// Constant-time comparison of sha256(token) vs tokenHash

export function validateWebhookPayload(payload: unknown): WebhookFeedPayload;
// Throws on missing title, invalid types, oversized fields

export function normalizeWebhookEvent(
  feedId: string,
  payload: WebhookFeedPayload,
  receivedAt: Date,
): WebhookFeedEvent;
// Assigns id (ULID/UUID), computes dedupeKey, resolves eventDate

export async function appendWebhookEvent(
  feedId: string,
  event: WebhookFeedEvent,
  config: WebhookFeedConfig,
): Promise<{ inserted: boolean; duplicate: boolean }>;
// Writes to JSONL file; skips duplicates by dedupeKey

export async function loadWebhookEvents(
  feedId: string,
  limit: number,
): Promise<WebhookFeedEvent[]>;
// Reads JSONL file, returns newest `limit` events, skips corrupt lines with warning

export async function pruneWebhookEvents(
  feedId: string,
  retentionDays: number,
  maxItems: number,
): Promise<void>;
// Removes events older than retentionDays or beyond maxItems count
```

**JSONL storage:** `./feed-state/webhook-events/{feedId}.jsonl` — one JSON event per line, appended on write.

**Deduplication:**
- `idOrHash`: use `payload.id` if present; else SHA-256 of `title + (link ?? "") + eventDate`
- `idOnly`: only deduplicate by `payload.id`; hash-only events are always inserted
- `always`: always insert (no deduplication)

**Token generation:** `crypto.randomBytes(32).toString("hex")` prefixed with `mkfd_wh_`

**Token hashing:** `createHash("sha256").update(token).digest("hex")`

---

## RSS Builder

### Add to `utilities/rss-builder.utility.ts`

```ts
export function buildRSSFromWebhookEvents(
  events: WebhookFeedEvent[],
  feedConfig: FeedConfig,
): string;
```

Mapping per event:

| RSS field | Webhook event field |
|---|---|
| `title` | `title` |
| `description` | `description` |
| `link` | `link` |
| `guid` | `externalId` ?? `id` |
| `pubDate` | `eventDate` |
| `author` | `author` |
| `categories` | `categories` + (severity as category if present) |

All string values are XML-escaped. No raw metadata in RSS unless explicitly enabled.

---

## Backend Routes

### `routes/webhook.ts` (new)

```ts
POST /webhook-feeds/:slug
```

Handler steps:
1. Locate feed config by `webhookFeed.slug` — 404 if not found
2. Extract `Authorization: Bearer <token>` header — 401 if missing
3. `verifyWebhookToken(token, config.webhookFeed.tokenHash)` — 403 if invalid
4. Enforce 64 KB body size limit — 413 if exceeded
5. Parse JSON — 400 if invalid
6. Validate `Content-Type: application/json` — 415 if wrong
7. `validateWebhookPayload(body)` — 400 with message if invalid
8. Apply per-slug rate limit (60/min in-memory) — 429 if exceeded
9. `normalizeWebhookEvent(feedId, payload, new Date())`
10. `appendWebhookEvent(feedId, event, config)` — return `{ ok: true, duplicate: true }` if duplicate
11. `pruneWebhookEvents(feedId, config.webhookFeed.retentionDays, config.webhookFeed.maxItems)`
12. Load latest events + `buildRSSFromWebhookEvents` + write to `./public/feeds/{feedName}.xml`
13. Return `{ ok: true, eventId: event.id, feedUrl: "/public/feeds/{feedName}.xml" }`

Rate limiting uses an in-memory Map `Map<slug, { count: number; resetAt: number }>`. Resets every 60 seconds.

### Startup rebuild

On app startup, for each `feedType: webhook` config:
1. `loadWebhookEvents(feedId, config.webhookFeed.maxItems)`
2. `buildRSSFromWebhookEvents(events, config)`
3. Write to `./public/feeds/{feedName}.xml`

### Feed creation

When saving a new webhook feed config:
1. `generateWebhookToken()` → show once in response
2. `hashWebhookToken(token)` → store as `webhookFeed.tokenHash`
3. Return `{ feedUrl, webhookUrl, token }` (token shown once, then gone)

---

## Payload Validation Rules

| Field | Rule |
|---|---|
| `title` | Required, string, max 300 chars |
| `description` | Optional, string, max 20,000 chars |
| `url` | Optional, valid http/https URL |
| `date` | Optional, parseable date string |
| `categories` | Optional, string array, max 25 items, each max 100 chars |
| `severity` | Optional, one of: `info`, `success`, `warning`, `error` |
| `metadata` | Optional, object, max serialized size 10 KB |

---

## Frontend

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this section.**

### `WebhookFeedForm.tsx` (new)

Sections:
1. **Feed name + Slug** — feed name input; slug auto-generated from feed name (lowercase, hyphens), but editable
2. **Security** — "Require bearer token" checkbox (always on in MVP); "Token will be generated on save" note
3. **After save state** — webhook URL display + token display with copy button + "Copy now, not shown again" warning
4. **Feed behavior** — max items input, retention days input, duplicate strategy dropdown, date strategy dropdown
5. **Payload format** — read-only "Mkfd native event JSON" label + JSON schema example block
6. **Curl example** — auto-generated `curl` command with the webhook URL and a `Authorization: Bearer <token>` placeholder

Curl template:
```
curl -X POST "{{webhookUrl}}" \
  -H "Authorization: Bearer {{token}}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test event","description":"Hello from Mkfd","severity":"info"}'
```

### `FeedBuilderForm.tsx`

Add Webhook tab. Render `WebhookFeedForm` inside the new tab content.

---

## Testing

**`tests/webhook.test.ts`**

Token:
- `generateWebhookToken()` starts with `mkfd_wh_`
- `hashWebhookToken(token)` returns 64-char hex string
- `verifyWebhookToken(token, hash)` returns true for valid pair
- `verifyWebhookToken(wrong, hash)` returns false

Payload validation:
- Rejects missing title
- Rejects non-string title
- Rejects title exceeding 300 chars
- Accepts optional fields absent
- Rejects invalid `severity` value
- Rejects non-http/https URL
- Rejects non-array categories

Normalization:
- Assigns `id` (non-empty string)
- Sets `eventDate` to `payload.date` when valid ISO date
- Falls back `eventDate` to `receivedAt` when payload date absent
- `dedupeKey` uses `payload.id` when present
- `dedupeKey` is SHA-256 hash when `payload.id` absent

JSONL storage:
- `appendWebhookEvent` writes one line to file
- `loadWebhookEvents` returns events newest first
- Skips corrupt JSONL lines with warning
- `appendWebhookEvent` skips duplicate dedupeKey, returns `{ inserted: false, duplicate: true }`
- `pruneWebhookEvents` removes events beyond `maxItems`
- `pruneWebhookEvents` removes events older than `retentionDays`

RSS builder:
- Event becomes RSS `<item>`
- Title is XML-escaped
- `externalId` used as guid when present, else `id`
- Severity added as `<category>`
- Date maps to `<pubDate>`
- Valid RSS 2.0 output

Route behavior:
- POST without `Authorization` returns 401
- POST with invalid token returns 403
- POST with invalid JSON body returns 400
- POST with missing title returns 400
- POST with valid event returns 200 with `{ ok: true, eventId, feedUrl }`
- POST with duplicate `id` returns 200 with `{ ok: true, duplicate: true }`
- POST exceeding rate limit returns 429
- POST body exceeding 64 KB returns 413

---

## Acceptance Criteria

- `feedType: webhook` recognized by the system
- User can create a Webhook feed in the builder
- Mkfd generates slug and bearer token (shown once)
- User can copy endpoint URL and curl example
- `POST /webhook-feeds/:slug` accepts valid authenticated JSON
- Missing/invalid auth returns 401/403
- Invalid payload returns 400 with clear message
- Events are stored in JSONL
- Duplicate events are handled safely
- Feed XML regenerated immediately after event receipt
- Feed XML rebuilt from stored events on startup
- Rate limiting enforced per slug

---

## Design Decisions

### 1. JSONL vs. SQLite for event storage?

**Options:**
- A. JSONL files at `./feed-state/webhook-events/{feedId}.jsonl` — simple, no new dep
- B. SQLite (when SQLite Runtime Substrate is available) — better for queries/pruning
- C. Both: JSONL now with SQLite migration in the same plan

**Chosen: A.** The SQLite Runtime Substrate is a separate Phase 1 feature that isn't implemented yet. JSONL is sufficient for MVP: append is cheap, load-latest is a file read + parse + sort. Migration to SQLite is a mechanical change when the substrate lands.

---

### 2. Should webhook feeds have a worker refresh interval?

**Options:**
- A. Event-driven only: RSS rebuilds immediately on receipt, no worker needed; `refreshTime: 0`
- B. Keep a worker interval for periodic prune/rebuild
- C. Both: event-driven rebuild + periodic pruning worker

**Chosen: C.** RSS rebuild happens synchronously when an event is received. Pruning (retention + max-items enforcement) also runs after each receipt for simplicity. Startup rebuilds handle the post-restart case. A separate periodic prune worker is unnecessary in MVP; pruning on-receipt is sufficient.

---

### 3. How to handle duplicate events?

**Options:**
- A. `idOrHash` — use `payload.id` if present, else hash of title+link+date
- B. Always insert — no deduplication
- C. Reject with 409 — make callers handle it

**Chosen: A as default.** `idOrHash` is safest for most use cases: callers that send a stable `payload.id` get clean deduplication; callers that don't are deduped by content hash. Returning 200 with `{ duplicate: true }` (instead of 409) makes webhook clients simpler to implement — they don't need to treat "I already sent this" as an error.

---

### 4. Should custom payload mapping be in MVP?

**Options:**
- A. Native format only in MVP; add custom mapping post-MVP
- B. Include basic dot-path custom mapping in MVP
- C. Include preset adapters (GitHub, Home Assistant) in MVP

**Chosen: A.** Custom mapping and presets are valuable but add scope. The native format covers any automation system that can serialize JSON. Users who need GitHub/Home Assistant adapters can transform their payload before sending. Custom mapping is the right post-MVP addition once the native flow is stable.
