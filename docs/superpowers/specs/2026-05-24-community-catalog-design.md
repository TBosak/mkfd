# Community Catalog — Design Spec

**Date:** 2026-05-24
**Tier:** R4 Catalog & Import
**Status:** Approved

---

## Goal

Add a community catalog system where Mkfd instances can browse, import, and submit community feed configs. Catalog entries are stored in the Mkfd repository under `community-catalog/` and served as a remote static source (GitHub Pages). Users can submit eligible feed configs via a downloadable bundle; an optional hosted GitHub App broker enables user-attributed PR creation without requiring Mkfd users to hold GitHub tokens.

---

## Scope

### In scope (MVP)

- `community-catalog/` folder in repo with `manifest.json` and sample feed YAML
- GitHub Pages (or raw GitHub) serving of manifest and feed YAML
- Local manifest and YAML cache with stale fallback
- Backend API: `GET /community-catalog/manifest`, `GET /community-catalog/feeds/:id`, `POST /community-catalog/import/:id`, `POST /community-catalog/refresh`
- Catalog browse and import UI
- Feed config sanitizer (strips private fields, rejects ineligible feed types)
- "Submit to Community Catalog" per-feed action
- Downloadable submission bundle (YAML + manifest entry + SUBMISSION.md)
- Catalog validation script + GitHub Actions CI
- Submission endpoint: `POST /catalog/submissions/:feedId/download`

### In scope (post-MVP)

- GitHub App broker (Cloudflare Worker) for user-attributed PR creation
- `Submit with GitHub` button in submission dialog

### Out of scope (MVP)

- Cloudflare Worker service infrastructure
- Rate-limiting by GitHub user on broker
- Duplicate detection on broker
- OAuth-linked user identity

---

## Dependencies

Must be implemented first:

- Feed Config Formalization (canonical `FeedConfig` model for sanitizer validation)
- Protected Value Encryption (sanitizer must detect and reject protected values)

---

## Architecture

| Unit | File | Responsibility |
|---|---|---|
| Catalog models | `models/community-catalog.model.ts` | Manifest, entry, submission, sanitize result types |
| Catalog client | `utilities/community-catalog/catalog-client.utility.ts` | Remote fetch, cache, stale fallback |
| Catalog sanitizer | `utilities/community-catalog/catalog-sanitizer.utility.ts` | Strip private fields, reject ineligible configs |
| Catalog tests | `tests/community-catalog.test.ts` | Unit tests for sanitizer and client |
| Catalog routes | `routes/catalog.ts` | All catalog API endpoints |
| CI script | `scripts/validate-community-catalog.ts` | Per-commit catalog validation |
| CI workflow | `.github/workflows/validate-community-catalog.yml` | GitHub Actions trigger |
| Catalog repo | `community-catalog/manifest.json`, `community-catalog/feeds/` | Static catalog assets |
| Catalog page | `frontend/src/pages/catalog/CommunityCatalogPage.tsx` | Browse and import UI |
| Catalog card | `frontend/src/components/catalog/CatalogFeedCard.tsx` | Single entry card |
| Catalog drawer | `frontend/src/components/catalog/CatalogFeedDetailDrawer.tsx` | YAML preview and import |
| Import dialog | `frontend/src/components/catalog/CatalogImportDialog.tsx` | Import confirmation |
| Submission dialog | `frontend/src/components/catalog/CatalogSubmissionDialog.tsx` | Submission flow |
| Submission form | `frontend/src/components/catalog/CatalogMetadataForm.tsx` | Category, tags, description |
| YAML preview | `frontend/src/components/catalog/CatalogSanitizedYamlPreview.tsx` | Shows sanitized output |

---

## Config Model

### `models/community-catalog.model.ts` (new)

```ts
import type { FeedType } from "./feed-config.model";

export type CatalogManifest = {
  schemaVersion: 1;
  updatedAt: string;
  feeds: CatalogManifestEntry[];
};

export type CatalogManifestEntry = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  feedType: FeedType;
  path: string;
  sourceHomepage?: string;
  requiresSecrets: boolean;
  requiresPrivateNetwork: boolean;
  requiresTemplateValues?: boolean;
  templateVariables?: string[];
  schemaVersion: number;
  catalogVersion: number;
};

export type CatalogSubmissionInput = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  sourceHomepage?: string;
  submitterName?: string;
};

export type CatalogSanitizeResult = {
  eligible: boolean;
  sanitizedYaml?: string;
  manifestEntry?: Omit<CatalogManifestEntry, "id" | "path">;
  errors: CatalogSanitizeIssue[];
  warnings: CatalogSanitizeIssue[];
  removed: CatalogSanitizeRemoval[];
};

export type CatalogSanitizeIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type CatalogSanitizeRemoval = {
  path: string;
  reason: string;
};
```

---

## Repository Structure

```
community-catalog/
  manifest.json
  feeds/
    gaming/
      magic-wizards-news.yaml
    developer/
      (future entries)
  schemas/
    catalog-manifest.schema.json
    catalog-feed.schema.json
  README.md
```

### `community-catalog/manifest.json`

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-24T00:00:00Z",
  "feeds": [
    {
      "id": "magic-wizards-news",
      "title": "Magic: The Gathering News",
      "description": "Feed from Magic: The Gathering news articles.",
      "category": "gaming",
      "tags": ["magic", "wizards", "gaming"],
      "feedType": "webScraping",
      "path": "feeds/gaming/magic-wizards-news.yaml",
      "sourceHomepage": "https://magic.wizards.com/en/news",
      "requiresSecrets": false,
      "requiresPrivateNetwork": false,
      "schemaVersion": 2,
      "catalogVersion": 1
    }
  ]
}
```

---

## Backend: Catalog Client

### `utilities/community-catalog/catalog-client.utility.ts` (new)

```ts
export async function getCatalogManifest(): Promise<{
  source: "remote" | "cache";
  stale: boolean;
  warning?: string;
  manifest: CatalogManifest;
}>;

export async function getCatalogFeedYaml(id: string): Promise<{
  source: "remote" | "cache";
  stale: boolean;
  warning?: string;
  yaml: string;
}>;

export async function refreshCatalogManifest(): Promise<void>;
```

Cache location: `./catalog-cache/manifest.json`, `./catalog-cache/feeds/{id}.yaml`

Behavior:
- Fetch from `COMMUNITY_CATALOG_URL` env var (default: GitHub Pages URL).
- On failure, fall back to cache with `stale: true` warning.
- On fetch success, write cache.
- Skip remote fetch if cached within `COMMUNITY_CATALOG_REFRESH_HOURS` (default: 24).

---

## Backend: Catalog Sanitizer

### `utilities/community-catalog/catalog-sanitizer.utility.ts` (new)

```ts
export function sanitizeFeedConfigForCatalog(
  config: FeedConfig,
  input: CatalogSubmissionInput,
): CatalogSanitizeResult;
```

#### Ineligible feed types (hard reject)

- `serviceConnector` — local credentials, private services
- `email` — contains personal email credentials
- Any config with `filesystem.rootPath` — local path

#### Fields always removed

- `feedId`
- `metadata.visibility`
- `metadata.localOnly`
- Any outgoing webhook delivery config
- Local runtime state fields
- Health metadata
- Private labels

#### Fields always rejected (hard reject if present)

- `protected` values (encrypted secrets)
- `cookies`
- `Authorization` headers with non-template values
- `Cookie` headers
- `X-Api-Key` headers with non-template values
- `localhost` URLs
- Private IP URLs (10.x, 172.16-31.x, 192.168.x)

#### Fields added/normalized

- `catalogVersion: 1`
- `metadata.catalogReady: true`
- `metadata.sourceHomepage` from submission input
- Safe `feedName` slug (sanitized, no PII)
- `refreshTime` normalized (minimum 5 minutes)

#### Warnings (non-blocking)

- URL with query parameters that look like API keys
- Feed contains `advanced: true`
- Selector count > 20

---

## Backend Routes

### `routes/catalog.ts` (new)

```ts
GET  /community-catalog/manifest
GET  /community-catalog/feeds/:id
POST /community-catalog/import/:id
POST /community-catalog/refresh
POST /catalog/submissions/:feedId/download
```

#### `GET /community-catalog/manifest`

Returns manifest with source and stale metadata.

#### `GET /community-catalog/feeds/:id`

Returns raw catalog YAML and the manifest entry for that feed.

#### `POST /community-catalog/import/:id`

See Parameterized Feed Config Templates spec for template rendering logic.

For non-template configs:
1. Fetch catalog YAML.
2. Assign `feedId`.
3. Normalize to `FeedConfig`.
4. Validate.
5. Write to `/app/configs`.
6. Start feed updater.
7. Return `feedId` and feed URL.

#### `POST /community-catalog/refresh`

Forces remote manifest re-fetch. Returns source metadata.

#### `POST /catalog/submissions/:feedId/download`

1. Load feed config from `/app/configs`.
2. Run sanitizer with submission metadata.
3. If ineligible: return 400 with eligibility errors.
4. Generate bundle ZIP containing:
   - `{slug}.yaml` — sanitized catalog YAML
   - `manifest-entry.json` — manifest entry without `id`/`path`
   - `SUBMISSION.md` — instructions + validation summary
5. Return ZIP as download.

---

## Frontend

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this section.**

### `CommunityCatalogPage.tsx`

- Fetches `/community-catalog/manifest` on load.
- Shows search input, category filter, feed type filter.
- Renders `CatalogFeedCard` grid.
- Shows stale warning banner when `stale: true`.

### `CatalogFeedCard.tsx`

Displays: title, description, category, feed type, source homepage link, badges (Requires secrets / Requires setup / Private network).

Click opens `CatalogFeedDetailDrawer`.

### `CatalogFeedDetailDrawer.tsx`

- Fetches YAML from `/community-catalog/feeds/:id`.
- Shows YAML preview (read-only).
- Shows "Import" button → opens `CatalogImportDialog`.

### `CatalogImportDialog.tsx`

- For non-template entries: confirms import, shows refresh time estimate.
- For template entries: opens `TemplateImportDialog` (see Parameterized Feed Config Templates spec).

### `CatalogSubmissionDialog.tsx`

- Opened from My Feeds "Submit to Community Catalog" action.
- Step 1: Eligibility check (calls sanitizer preview endpoint).
- Step 2: Metadata form (title, description, category, tags, source homepage).
- Step 3: Sanitized YAML preview + removed fields list.
- Step 4: Actions — "Download bundle" button.
- Ineligible feeds show clear reason (feed type, private URL, secrets, etc.).

---

## CI

### `scripts/validate-community-catalog.ts`

Checks on every PR that modifies `community-catalog/`:
- `manifest.json` parses.
- All manifest paths exist.
- All YAML files parse.
- All configs validate as `schemaVersion: 2`.
- No `feedId` in catalog configs.
- No `serviceConnector` or `email` feed types.
- No protected values.
- No private/localhost URLs.
- No cookies.
- No hardcoded auth headers.
- Manifest `id`s are unique.
- Manifest `path`s are unique.
- Manifest entries match YAML metadata.

### `.github/workflows/validate-community-catalog.yml`

```yaml
name: Validate Community Catalog
on:
  pull_request:
    paths:
      - "community-catalog/**"
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run validate:catalog
```

---

## Security

- Catalog browsing never requires Mkfd auth.
- Catalog import writes to `/app/configs` which requires Mkfd to be running locally.
- Sanitizer never outputs secrets, protected values, or private URLs.
- Import endpoint assigns a new `feedId` — catalog IDs are not user-controlled.
- Cache files are written to `./catalog-cache/` (not `/app/configs`).
- Submission bundle is downloaded client-side; no external service receives it in MVP.

---

## Testing

**`tests/community-catalog.test.ts`**

Catalog client:
- Returns manifest from remote
- Falls back to cache on remote failure
- Writes cache on successful fetch
- Returns stale warning when using cache

Sanitizer:
- Eligible webScraping config produces clean output
- Removes feedId from output
- Rejects serviceConnector feed type
- Rejects email feed type
- Rejects protected values
- Rejects localhost URL
- Rejects private IP URL
- Rejects Authorization header with non-template value
- Removes metadata.visibility
- Removes metadata.localOnly
- Adds catalogVersion: 1
- Normalizes refreshTime to minimum 5 minutes

Catalog CI:
- Valid catalog entry passes
- Missing manifest path fails
- Protected value in config fails
- Duplicate manifest ID fails

---

## Acceptance Criteria

- `community-catalog/` exists in the repo with at least one sample feed
- Mkfd instances can fetch the remote manifest
- Manifest falls back to local cache if remote unavailable
- Users can browse catalog entries by category/tag/type
- Users can preview catalog YAML
- Users can import a catalog entry (non-template)
- Imported configs receive a new `feedId`
- Users can submit eligible local feeds as downloadable bundles
- Ineligible feeds show clear disqualification reasons
- Sanitizer never outputs secrets or private URLs
- CI validates all PRs that touch `community-catalog/`

---

## Design Decisions

### 1. Should the GitHub App broker be in-scope for this spec?

**Options:**
- A. Include broker design in this spec (full phases 11-15 from feature doc)
- B. Spec MVP only (repo structure + client + sanitizer + download bundle), defer broker
- C. Include broker design as a separate future spec

**Chosen: B.** The broker requires infrastructure decisions (Cloudflare account, GitHub App registration, KV storage) that depend on external actions. The MVP value (browse + import + download bundle) is complete and independent of the broker. The broker can be specced separately when ready to build.

---

### 2. Local cache storage format: JSON files or SQLite?

**Options:**
- A. JSON files in `./catalog-cache/` directory
- B. SQLite (shared with the SQLite Runtime Substrate)

**Chosen: A.** The catalog cache is read-mostly, small, and doesn't require querying. JSON files are simpler to implement and inspect. SQLite can replace this later if catalog grows to hundreds of entries.

---

### 3. Should the submission eligibility check be a preview endpoint or frontend-only?

**Options:**
- A. Frontend-only check using same sanitizer logic (avoids round-trip)
- B. Backend preview endpoint (`POST /catalog/submissions/:feedId/preview`) returns sanitizer result
- C. Bundle download endpoint returns 400 with eligibility errors if ineligible

**Chosen: B + C.** A preview endpoint allows the UI to show eligibility without downloading. The bundle download also validates and returns 400 for ineligible configs as a safety net. This is slightly more code but avoids a class of user confusion ("why can't I download?").

---

### 4. Should catalog submission require GitHub authentication in MVP?

**Options:**
- A. No auth — download bundle only, no automatic PR creation
- B. Require GitHub token from user (user must have a GitHub account and create a token)
- C. GitHub App broker for zero-token user-attributed PRs (post-MVP)

**Chosen: A.** The MVP download bundle is sufficient for contributions. The broker is the right long-term solution but requires infrastructure work. Requiring a user-provided GitHub token creates friction and security risk (user tokens stored in Mkfd). Download bundle + manual PR is the correct zero-risk MVP.
