# My Feeds Redesign — Design Spec

**Date:** 2026-05-23
**Tier:** R2 Output & Operations
**Status:** Approved
**Design source:** Claude Design prototype (SzaRsfItQYugaiKfte9ymg / `docs/features/Mkfd UI Redesign/`)

---

## Goal

Replace the current minimal `ActiveFeedsPage` with a full feed management dashboard — **My Feeds** — that lets users browse, search, tag, filter, inspect, edit, duplicate, export, and delete every feed configuration.

---

## Scope

### In scope

**Backend**
- Expand `GET /api/feeds` to return the full `FeedSummary` shape (including metadata, runtime state from `run_logs`, and secrets detection)
- `PATCH /api/feeds/:id/metadata` — update `tags`, `category`, `favorite`, `title`, `description`
- `PATCH /api/feeds/:id/enabled` — toggle `enabled`
- `POST /api/feeds/:id/duplicate` — copy config with safe new filename/id
- `GET /api/feeds/:id/export` — download raw YAML
- `DELETE /api/feeds/:id` — replace existing `POST /delete-feed`
- Three new utilities: `feed-summary.utility.ts`, `config-manager.utility.ts`, `config-metadata.utility.ts`

**Frontend**
- Rename `ActiveFeedsPage.tsx` → `MyFeedsPage.tsx`; update route and nav label
- New components under `frontend/src/components/feeds/`:
  - `FeedCard.tsx`
  - `FeedTable.tsx`
  - `FeedDetailDrawer.tsx`
  - `FeedActionsMenu.tsx`
  - `FeedTagEditor.tsx`
  - `FeedStatusBadge.tsx`
  - `FeedTypeBadge.tsx`
  - `ScrollableFilterRow.tsx`
- Toast notifications for all mutating actions (copy URL, delete + undo, duplicate, enable/disable)
- CSS token layer (`feeds-tokens.css`) that bridges prototype alias names (`--bg`, `--ink`, `--line`, etc.) to shadcn's default blue-gray variables — no custom palette overrides; semantic status colors (ok/warn/err/info), shadows, and mono-font are also defined here

### Out of scope

- Run-now button (no worker trigger from UI yet)
- Bulk actions (tag/export/disable multiple feeds at once)
- Saved filter views
- YAML inline editor
- Catalog origin badges and catalog update checks
- Import YAML button (stubbed in UI, not wired)

---

## Design System

Uses the default shadcn blue-gray palette. The components reference a set of local aliases (`--bg`, `--ink`, `--line`, etc.) that are defined in `feeds-tokens.css` as thin wrappers around shadcn's own CSS variables (`--background`, `--foreground`, `--muted`, `--border`, `--primary`, etc.). Semantic status colors (ok/warn/err/info/purple), shadows, and the mono font are the only non-shadcn values in the token file.

### CSS tokens (`feeds-tokens.css`)

```css
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
  --ok: #15803d;        --ok-ink: #14532d;    --ok-soft: #dcf3e3;
  --warn: #b45309;      --warn-ink: #78350f;  --warn-soft: #fdecc8;
  --err: #b91c1c;       --err-ink: #7f1d1d;   --err-soft: #fadcd9;
  --info: #1d4ed8;      --info-ink: #1e40af;  --info-soft: #dde6fb;
  --purple: #6d28d9;    --purple-soft: #ede4fc;

  /* Feeds utility */
  --feeds-radius: 10px; --feeds-radius-sm: 6px; --feeds-radius-lg: 14px;
  --feeds-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --shadow-1:   0 1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-2:   0 1px 0 rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.12);
  --shadow-pop: 0 1px 0 rgba(0,0,0,0.04), 0 18px 48px -16px rgba(0,0,0,0.16);
}
```

### Feed type color map

| Type | Background | Icon color | Border |
|---|---|---|---|
| scrape | `#fff1e8` | `#c2410c` | `#fcd9b8` |
| rest | `--info-soft` | `--info-ink` | `#c9d6f7` |
| graphql | `#fce7f6` | `#9d174d` | `#f7c7e3` |
| email | `--ok-soft` | `--ok-ink` | `#bce4c9` |
| calendar | `#e2eafc` | `#1e3a8a` | `#c4d2f4` |
| sitemap | `#ede7d8` | `#57534e` | `#d6cdb4` |
| filesystem | `--warn-soft` | `--warn-ink` | `#f1d699` |
| webhook | `--purple-soft` | `--purple` | `#d9c8f3` |

---

## FeedSummary Type

```ts
// frontend/src/types/feed-summary.ts  (also mirrored in backend types)

export type FeedStatus = "healthy" | "warning" | "error" | "disabled" | "neverRun" | "running";
export type FeedType = "scrape" | "rest" | "graphql" | "email" | "calendar" | "sitemap" | "filesystem" | "webhook";

export type FeedSummary = {
  id: string;                   // derived from filename (no .yaml)
  filename: string;             // e.g. "cape-county-notices.yaml"
  title: string;                // metadata.title ?? feedName
  description?: string;         // metadata.description
  type: FeedType;               // normalized from YAML feedType
  category?: string;            // metadata.category
  sourceUrl: string;            // derived per feed type (see Source Label rules)
  sourceMethod?: string;        // "GET" | "POST" for rest/graphql
  publicFeedUrl: string;        // base path: "/feeds/{feedId}" (no extension)
  enabled: boolean;             // top-level `enabled` field in YAML
  favorite: boolean;            // metadata.favorite
  tags: string[];               // metadata.tags
  status: FeedStatus;           // computed (see Status Model)
  statusDetail?: string;        // human-readable status detail (e.g. error message)
  refreshMinutes?: number | null;
  lastRunAt?: string;           // ISO string from run_logs
  lastRunRelative?: string;     // human-readable relative time (e.g. "8 min ago")
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastItemCount?: number | null;
  lastNewItemCount?: number;
  secrets: {
    protected: boolean;         // any { type: "protected" } value in config
    env: boolean;               // any { type: "env" } or ${VAR} pattern
    plain: boolean;             // plain string in a sensitive key (password, token, etc.)
  };
  origin: {
    type: "local" | "community";
    catalogId?: string;
  };
};
```

### Feed type normalization (YAML `feedType` → `FeedType`)

| YAML feedType | FeedType |
|---|---|
| `webScraping` | `scrape` |
| `api` | `rest` |
| `email` | `email` |
| `graphql` | `graphql` |
| `calendar` | `calendar` |
| `sitemap` | `sitemap` |
| `filesystem` | `filesystem` |
| `webhook` | `webhook` |

### Status model

```ts
function computeStatus(config: FeedConfig, lastRun?: RunLog): FeedStatus {
  if (!config.enabled) return "disabled";
  if (!lastRun) return "neverRun";
  if (lastRun.status === "error") return "error";
  if (config.secrets?.hasPlainSensitive) return "warning";  // detected by config-metadata
  return "healthy";
}
```

### Relative time

```ts
function toRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days  = Math.floor(ms / 86_400_000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} h ago`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
```

---

## Backend — Utilities

### `utilities/config-manager.utility.ts`

```ts
listFeedConfigs(): Promise<{ id: string; filename: string }[]>
readFeedConfig(id: string): Promise<FeedConfig>
writeFeedConfig(id: string, config: FeedConfig): Promise<void>
deleteFeedConfig(id: string): Promise<void>
duplicateFeedConfig(id: string): Promise<{ id: string; filename: string }>
exportFeedConfig(id: string): Promise<string>   // returns raw YAML string
safeFeedId(raw: string): string                 // lowercase, a-z0-9 dash underscore, no extension
```

Duplicate generates a new id by appending `-copy` (or `-copy-2`, `-copy-3` if taken).

### `utilities/config-metadata.utility.ts`

```ts
normalizeMetadata(config: FeedConfig): FeedConfig   // fills defaults for missing metadata block
patchMetadata(id: string, patch: Partial<FeedMetadata>): Promise<FeedConfig>
patchEnabled(id: string, enabled: boolean): Promise<FeedConfig>
detectPlainSensitive(config: FeedConfig): boolean   // checks Authorization/password/token keys for plain strings
```

### `utilities/feed-summary.utility.ts`

```ts
buildFeedSummary(file: { id: string; filename: string }, config: FeedConfig, lastRun?: RunLog): FeedSummary
deriveSourceLabel(config: FeedConfig): { sourceUrl: string; sourceMethod?: string }
detectSecrets(config: FeedConfig): { protected: boolean; env: boolean; plain: boolean }
normalizeFeedType(yamlFeedType: string): FeedType
```

`buildFeedSummary` assembles the full `FeedSummary` from config + most-recent `run_log` row for that `feedId`. Runtime fields (`lastRunAt`, `lastRunRelative`, `lastItemCount`, etc.) are `undefined` when no run log exists.

---

## Backend — API Routes

### `GET /api/feeds`

Replaces current minimal implementation. Returns `{ feeds: FeedSummary[] }`.

Flow:
1. List all `.yaml` files from `configs/`
2. Parse each config
3. Look up most-recent `run_logs` row per `feedId` (single query: `SELECT * FROM run_logs WHERE feed_id IN (...) ORDER BY started_at DESC` grouped by `feed_id`)
4. Call `buildFeedSummary(file, config, lastRun)` for each
5. Return `{ feeds }`

### `PATCH /api/feeds/:id/metadata`

Body: `Partial<{ title, description, tags, category, favorite }>`.
Calls `patchMetadata(id, body)`. Returns updated `FeedSummary`.

### `PATCH /api/feeds/:id/enabled`

Body: `{ enabled: boolean }`.
Calls `patchEnabled(id, body.enabled)`. Returns updated `FeedSummary`.

### `POST /api/feeds/:id/duplicate`

Calls `duplicateFeedConfig(id)`. Returns `{ id, filename }`.

### `GET /api/feeds/:id/export`

Calls `exportFeedConfig(id)`. Sets `Content-Disposition: attachment; filename="{id}.yaml"`. Returns raw YAML.

### `DELETE /api/feeds/:id`

Replaces `POST /delete-feed`. Calls `deleteFeedConfig(id)`. Returns `204`.

`POST /delete-feed` is kept as a redirect shim pointing to `DELETE /api/feeds/:id` for backwards compatibility with any existing callers.

---

## Frontend — Components

All new components live in `frontend/src/components/feeds/`.

### `FeedTypeBadge.tsx`

Renders the colored 32×32 icon chip. Props: `type: FeedType`, `size?: number`. Uses the type color map and the custom inline SVG icon set from the prototype.

### `FeedStatusBadge.tsx`

Renders a pill badge with a dot. Props: `status: FeedStatus`. Color map:

| Status | Tone | Label |
|---|---|---|
| healthy | ok (green) | Healthy |
| warning | warn (amber) | Warning |
| error | err (red) | Failing |
| disabled | muted | Disabled |
| neverRun | info (blue) | Never run |
| running | info | Running |

### `FeedTagEditor.tsx`

Inline tag editor. Props: `tags: string[]`, `onChange: (tags: string[]) => void`. 

- Renders existing tags as removable chips (remove `×` appears on parent card hover)
- `+` dashed chip opens an inline `<input>` that commits on Enter/blur, cancels on Escape
- Tags are trimmed and lowercased; duplicates silently dropped

### `ScrollableFilterRow.tsx`

Props: `label: string`, `children: ReactNode`.

Wraps a horizontally scrollable row of filter chips. Shows `◀` / `▶` circular arrow buttons when the row overflows left or right respectively. Uses `ResizeObserver` to recompute on layout change. Label is an uppercase 46px-wide column header (`QUICK`, `TYPE`, `TAGS`).

### `FeedActionsMenu.tsx`

Props: `feed: FeedSummary`, `onAction: (action: string) => void`.

`⋯` ghost icon button that opens a positioned dropdown menu. Actions:
- Open RSS / Copy feed URL / Preview
- (separator)
- Edit config / Duplicate / Export YAML
- (separator)
- Disable feed (or Enable feed) / Delete (danger)

Closes on outside click or Escape key.

### `FeedCard.tsx`

Props: `feed: FeedSummary`, `format: "rss" | "atom" | "json"`, `setFormat`, `onUpdate`, `onAction`, `onOpenDetail`.

Card layout (top to bottom):
1. **Head**: type icon chip + title + catalog badge (if community) + favorite star button
2. **Type line**: `{type label} · {category}`
3. **Source bar**: monospace, method pill if present (`GET`/`POST`), truncated URL
4. **Meta 2×2 grid**: Status / Last run / Refresh / Items (with `+N` new in green)
5. **Tags**: `FeedTagEditor`
6. **Secret badges**: encrypted (info/blue) / env var (ghost) / plain secret (err/red) — only shown when at least one is true
7. **Footer**: format picker `[RSS][Atom][JSON]` + Copy + Open + `FeedActionsMenu`

Clicking anywhere on the card (except interactive elements) opens `FeedDetailDrawer`.
Disabled feeds render at 78% opacity.

### `FeedTable.tsx`

Props: `feeds: FeedSummary[]`, `onUpdate`, `onAction`, `onOpenDetail`.

8-column grid (min-width 880px, horizontal scroll on overflow):
`favorite star | Name/Source | Type | Status | Tags (max 3 + overflow) | Last run | Items | Actions`

Clicking a row opens `FeedDetailDrawer`.

### `FeedDetailDrawer.tsx`

Right-rail drawer (480px wide, 96vw max, slides in from right). Props: `feed: FeedSummary | null`, `onClose`, `onUpdate`, `onAction`.

Sections:
1. **Header**: type icon + title + `{type} · {category} · {filename}` + status badge + close
2. **Status detail banner** (only if `statusDetail`): amber/red alert message
3. **Description**: plain text
4. **Endpoints**: kv table — Source / RSS 2.0 URL + copy+open / Atom URL + copy+open / JSON Feed URL + copy+open / Refresh / Origin
5. **Recent activity**: Last run / Items / Last error (if any)
6. **Tags**: `FeedTagEditor`
7. **Settings**: "Feed enabled" toggle row
8. **Footer**: Preview / Duplicate / (spacer) / Delete (danger) / Edit (primary)

Clicking the scrim closes the drawer.

### `MyFeedsPage.tsx`

Top-level page component. Replaces `ActiveFeedsPage.tsx`. File moves to `frontend/src/pages/MyFeedsPage.tsx`.

State:
- `feeds: FeedSummary[]` — fetched from `GET /api/feeds` on mount
- `search: string`
- `quick: string` — active quick filter id (`"all"` default)
- `typeFilters: string[]` — active type chip ids
- `tagFilters: string[]` — active tag chip ids
- `view: "cards" | "table"` — default `"cards"`
- `detailId: string | null` — open drawer feed id
- `formatPerFeed: Record<string, "rss" | "atom" | "json">` — per-feed format selection (default `"rss"`)

Layout (top to bottom):
1. **Page header** (sticky): `My Feeds` title + subtitle + search input + Import button (stubbed) + Build Feed button (navigates to `/`)
2. **Filter section**: three `ScrollableFilterRow` rows — Quick, Type (only shows types present in data), Tags (sorted by frequency)
3. **Result bar**: `{N} of {total} feeds` + Clear filters (when any filter active) + Cards/Table segmented toggle
4. **Feed grid** (cards view) or **FeedTable** (table view)
5. **Empty state** when no results: dashed border box with RSS glyph, message, Clear filters + Build Feed buttons

### Quick filter counts

Computed client-side from the full `feeds` array (not filtered):

| id | predicate |
|---|---|
| all | always |
| favorites | `feed.favorite` |
| warnings | `feed.status === "warning"` |
| broken | `feed.status === "error"` |
| disabled | `!feed.enabled` |
| secrets | any of `secrets.protected / secrets.env / secrets.plain` |
| community | `feed.origin.type === "community"` |

### Client-side filter logic

All filtering is client-side (fetch once, filter in memory):

```ts
visible = feeds.filter(f =>
  matchesQuick(f, quick) &&
  (typeFilters.length === 0 || typeFilters.includes(f.type)) &&
  (tagFilters.length === 0 || tagFilters.some(t => f.tags.includes(t))) &&
  matchesSearch(f, search)
);
```

Search haystack: `title, description, type, category, sourceUrl, publicFeedUrl, filename, origin.catalogId, ...tags`.

### Mutations

Optimistic updates for: favorite toggle, tag edit, enable/disable toggle.
Refetch after: delete, duplicate.
Toast on: every mutating action.

Delete uses a 6-second toast with an **Undo** button that restores the feed to local state (does not call the API again — undo is client-only within the toast lifetime).

### Output URL format

```ts
const FORMATS = [
  { id: "rss",  ext: ".rss",  label: "RSS",  full: "RSS 2.0" },
  { id: "atom", ext: ".atom", label: "Atom", full: "Atom" },
  { id: "json", ext: ".json", label: "JSON", full: "JSON Feed" },
];

const feedUrl = (feed: FeedSummary, format: string) =>
  feed.publicFeedUrl + FORMATS.find(f => f.id === format)!.ext;
```

`publicFeedUrl` from the backend is the base path (e.g. `/feeds/cape-county-notices`). The `.rss`, `.atom`, `.json` extensions are appended client-side. This aligns with the Feed Format Refactor spec output file naming.

---

## Navigation

- `Header.tsx`: rename "Active Feeds" nav link label to "My Feeds"
- `App.tsx`: rename `<ActiveFeedsPage />` import to `<MyFeedsPage />` (same route `/feeds`)
- `App.tsx`: add route for `GET /feeds/:id/edit` → `EditFeedPage` (already exists, no change)

---

## File Map

| Action | Path |
|---|---|
| Create | `utilities/config-manager.utility.ts` |
| Create | `utilities/config-metadata.utility.ts` |
| Create | `utilities/feed-summary.utility.ts` |
| Create | `tests/feed-summary.test.ts` |
| Create | `tests/config-manager.test.ts` |
| Modify | `index.ts` — expand `GET /api/feeds`, add new routes, keep `POST /delete-feed` shim |
| Create | `frontend/src/types/feed-summary.ts` |
| Create | `frontend/src/styles/feeds-tokens.css` |
| Create | `frontend/src/components/feeds/FeedTypeBadge.tsx` |
| Create | `frontend/src/components/feeds/FeedStatusBadge.tsx` |
| Create | `frontend/src/components/feeds/FeedTagEditor.tsx` |
| Create | `frontend/src/components/feeds/ScrollableFilterRow.tsx` |
| Create | `frontend/src/components/feeds/FeedActionsMenu.tsx` |
| Create | `frontend/src/components/feeds/FeedCard.tsx` |
| Create | `frontend/src/components/feeds/FeedTable.tsx` |
| Create | `frontend/src/components/feeds/FeedDetailDrawer.tsx` |
| Create | `frontend/src/pages/MyFeedsPage.tsx` |
| Delete | `frontend/src/pages/ActiveFeedsPage.tsx` |
| Modify | `frontend/src/App.tsx` — swap ActiveFeedsPage → MyFeedsPage |
| Modify | `frontend/src/components/layout/Header.tsx` — rename nav link |

---

## Dependencies

- **Feed Config Formalization** must be implemented first — this spec consumes `FeedMetadata` (`tags`, `category`, `favorite`, `enabled`, `description`, `title`) from YAML configs.
- **Protected Value Encryption** must be implemented first — `detectSecrets` checks for `{ type: "protected" }` values.
- **SQLite Runtime Substrate + Feed History** must be implemented first — runtime state (`lastRunAt`, `lastItemCount`, etc.) is read from the `run_logs` table in `runtime.db`.
- **Feed Format Refactor** must be implemented first — `publicFeedUrl` base path requires that `.rss`, `.atom`, `.json` files are written per feed.

---

## Tests

### Backend (`bun:test`)

```text
config-manager: lists only .yaml files, skips non-YAML
config-manager: reads config by id
config-manager: writes config preserving unknown fields
config-manager: deletes config
config-manager: duplicates with -copy suffix
config-manager: duplicate avoids collision (-copy-2)
config-manager: safeFeedId sanitizes spaces and uppercase
config-metadata: normalizeMetadata fills defaults
config-metadata: patchMetadata updates tags without destroying config
config-metadata: patchMetadata updates category
config-metadata: patchEnabled sets enabled true/false
config-metadata: detectPlainSensitive detects plain password key
feed-summary: buildFeedSummary with no run log returns neverRun status
feed-summary: buildFeedSummary with error run log returns error status
feed-summary: buildFeedSummary with success run log returns healthy status
feed-summary: disabled config returns disabled status
feed-summary: normalizeFeedType maps webScraping → scrape
feed-summary: detectSecrets detects protected value
feed-summary: detectSecrets detects env var
feed-summary: detectSecrets detects plain sensitive value
```

### Frontend (manual smoke test — no automated frontend tests in this pass)

```text
My Feeds page loads and shows feed cards
Search filters feed cards
Quick filter "Favorites" shows only starred feeds
Type filter "Web Scraping" shows only scrape feeds
Tag filter narrows results
Cards/Table toggle switches view
Clicking a card opens detail drawer
Favorite star toggles and persists via PATCH
Tag editor adds and removes tags via PATCH
Enable toggle fires PATCH and updates card status badge
Duplicate action adds copy to list
Delete action removes card and shows undo toast; undo restores card
Export action triggers YAML download
Format picker changes Copy/Open URL per card
Detail drawer shows all 3 output URLs with copy and open
```
