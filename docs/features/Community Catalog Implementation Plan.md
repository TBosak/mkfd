## Objective

Add a community catalog system where Mkfd can:

```text
1. Browse catalog configs remotely from the main repository.
2. Import catalog configs without requiring a Mkfd app update.
3. Let users submit eligible local feed configs to the catalog.
4. Optionally authenticate with GitHub and automatically open a user-attributed PR.
```

This should be a **nice-to-have roadmap item**, not a blocker for the core feed config work.

---

# Phase 1: Add remote community catalog to the repository

## Goal

Create a static catalog folder in the main Mkfd repository that can be fetched remotely by running Mkfd instances.

## Repository structure

Add:

```text
community-catalog/
  manifest.json
  feeds/
    gaming/
      magic-wizards-news.yaml
  schemas/
    catalog-manifest.schema.json
    catalog-feed.schema.json
  README.md
```

## Example manifest

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-17T00:00:00Z",
  "feeds": [
    {
      "id": "magic-wizards-news",
      "title": "Magic: The Gathering News",
      "description": "Creates a feed from Magic: The Gathering news articles.",
      "category": "gaming",
      "tags": ["magic", "wizards", "gaming", "news"],
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

## Done when

```text
community-catalog exists in the repo.
manifest.json lists at least one sample feed config.
Sample catalog config excludes feedId and private/local fields.
Catalog README explains purpose and contribution rules.
```

---

# Phase 2: Serve catalog from a remote static source

## Goal

Mkfd instances should fetch catalog entries remotely so users do not need to update Mkfd when new configs are added.

## Preferred source

Use GitHub Pages:

```text
https://tbosak.github.io/mkfd/community-catalog/manifest.json
```

## Fallback source

Use raw GitHub:

```text
https://raw.githubusercontent.com/TBosak/mkfd/main/community-catalog/manifest.json
```

## Add environment settings

```env
COMMUNITY_CATALOG_URL=https://tbosak.github.io/mkfd/community-catalog/manifest.json
COMMUNITY_CATALOG_FALLBACK_URL=https://raw.githubusercontent.com/TBosak/mkfd/main/community-catalog/manifest.json
COMMUNITY_CATALOG_REFRESH_HOURS=24
```

## Done when

```text
The manifest can be fetched from a public URL.
New catalog configs added to main become visible without a Mkfd app release.
Mkfd has a fallback URL if the preferred catalog URL fails.
```

---

# Phase 3: Add Mkfd catalog models

## Goal

Create typed models for catalog manifests, catalog configs, and catalog submissions.

## Add file

```text
models/community-catalog.model.ts
```

## Types

```ts
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
  submitterUrl?: string;
};

export type CatalogSanitizeResult = {
  eligible: boolean;
  sanitizedYaml?: string;
  manifestEntry?: CatalogManifestEntry;
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

## Done when

```text
Catalog manifest and submission types exist.
Catalog types reference the explicit FeedConfig model.
Types support validation, preview, and PR submission.
```

---

# Phase 4: Add remote catalog fetch/cache utility

## Goal

Mkfd should fetch, validate, and cache the remote catalog manifest and individual feed YAML files.

## Add file

```text
utilities/community-catalog/catalog-client.utility.ts
```

## Behavior

```text
Fetch manifest from COMMUNITY_CATALOG_URL.
Validate manifest shape.
Cache manifest locally.
If remote fetch fails, return cached manifest with stale warning.
Fetch individual feed YAML only when selected/imported.
Cache individual feed YAML by catalog ID.
```

## Suggested local cache

```text
./catalog-cache/
  manifest.json
  feeds/
    magic-wizards-news.yaml
```

## Core functions

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
```

## Done when

```text
Mkfd can fetch the remote manifest.
Mkfd falls back to cached manifest if remote is unavailable.
Mkfd fetches individual catalog YAML on demand.
Catalog browsing does not require an app update.
```

---

# Phase 5: Add catalog API endpoints in Mkfd

## Goal

Expose catalog browsing/import functionality to the frontend.

## Add endpoints

```text
GET  /community-catalog/manifest
GET  /community-catalog/feeds/:id
POST /community-catalog/import/:id
POST /community-catalog/refresh
```

## Endpoint behavior

### `GET /community-catalog/manifest`

Returns:

```json
{
  "source": "remote",
  "stale": false,
  "manifest": {}
}
```

### `GET /community-catalog/feeds/:id`

Returns catalog YAML and metadata.

### `POST /community-catalog/import/:id`

```text
Fetch catalog YAML.
Validate catalog config.
Assign new feedId.
Write imported config into /app/configs.
Return feedId and feed URL.
```

### `POST /community-catalog/refresh`

Forces remote manifest refresh.

## Done when

```text
Frontend can list remote catalog feeds.
Frontend can preview a catalog YAML.
Frontend can import a catalog feed into /app/configs.
Imported configs receive a new feedId.
```

---

# Phase 6: Add Catalog page to GUI

## Goal

Let users browse and import community configs.

## Add components

```text
CommunityCatalogPage.tsx
CatalogFeedCard.tsx
CatalogFeedDetailDrawer.tsx
CatalogImportDialog.tsx
CatalogSearchFilters.tsx
```

## UI behavior

Catalog page shows:

```text
Search
Category filter
Tag filter
Feed type filter
Catalog feed cards
Import button
YAML preview
```

Each card shows:

```text
Title
Description
Category
Tags
Feed type
Source homepage
Requires secrets/private network badges
```

## Done when

```text
User can browse remote catalog configs.
User can filter/search catalog entries.
User can preview catalog YAML.
User can import a catalog feed.
```

---

# Phase 7: Add catalog sanitizer

## Goal

Convert a local feed config into a catalog-safe config.

## Add file

```text
utilities/community-catalog/catalog-sanitizer.utility.ts
```

## Sanitizer rules

Reject:

```text
feedType: serviceConnector
feedType: email
filesystem local paths
localhost URLs
private IP URLs
cookies
Authorization headers
Cookie headers
X-Api-Key headers
protected values
encrypted secrets
webhook URLs
large payloads
unknown YAML tags
```

Remove:

```text
feedId
metadata.visibility
metadata.localOnly
webhook delivery config
local runtime state
health metadata
private labels
```

Add:

```text
catalogVersion: 1
metadata.catalogReady: true
metadata.sourceHomepage
safe feedName slug
safe refreshTime
```

## Core function

```ts
export function sanitizeFeedConfigForCatalog(
  config: FeedConfig,
  input: CatalogSubmissionInput,
): CatalogSanitizeResult;
```

## Done when

```text
Eligible configs produce catalog-safe YAML.
Ineligible configs return clear errors.
Sanitizer reports removed fields.
Sanitizer never outputs secrets.
```

---

# Phase 8: Add “Submit to Community Catalog” GUI flow

## Goal

Add a per-feed submission action on My Feeds / Active Feeds.

## User flow

```text
1. User opens My Feeds.
2. User clicks Submit to Community Catalog.
3. Mkfd checks eligibility.
4. User enters catalog metadata.
5. Mkfd shows sanitized YAML preview.
6. User chooses Download Bundle or Submit with GitHub.
```

## Add components

```text
CatalogSubmissionDialog.tsx
CatalogEligibilityPanel.tsx
CatalogMetadataForm.tsx
CatalogSanitizedYamlPreview.tsx
CatalogSubmissionActions.tsx
```

## Ineligible feeds

Disable or explain for:

```text
serviceConnector
email
filesystem local paths
private URLs
secrets/cookies
```

## Done when

```text
Each eligible feed has Submit to Community Catalog action.
User can see why a feed is or is not eligible.
User can preview sanitized YAML.
User can see removed fields.
```

---

# Phase 9: Add downloadable submission bundle

## Goal

Provide a no-auth fallback for catalog contribution.

## Add endpoint

```text
POST /catalog/submissions/:feedId/download
```

## Bundle contents

```text
{slug}.yaml
manifest-entry.json
SUBMISSION.md
```

## `SUBMISSION.md`

Include:

```text
Title
Description
Source homepage
Category
Tags
Validation summary
Instructions for creating a PR manually
```

## Done when

```text
User can download a safe submission bundle.
No hosted service is required.
No GitHub auth is required.
```

---

# Phase 10: Add catalog validation script and CI

## Goal

Make catalog PRs safe and reviewable.

## Add script

```text
scripts/validate-community-catalog.ts
```

## Add package script

```json
{
  "scripts": {
    "validate:catalog": "bun run scripts/validate-community-catalog.ts"
  }
}
```

## Add GitHub Action

```text
.github/workflows/validate-community-catalog.yml
```

## CI checks

```text
manifest.json parses.
All manifest paths exist.
All YAML configs parse.
All configs validate as schemaVersion 2.
No catalog configs contain feedId.
No serviceConnector configs.
No email configs.
No protected values.
No private URLs.
No cookies.
Manifest entries match YAML metadata.
IDs are unique.
Paths are unique.
```

## Done when

```text
Catalog PRs are automatically validated.
Unsafe configs fail CI.
Reviewers can trust the validation output.
```

---

# Phase 11: Create hosted GitHub App broker

## Goal

Allow user-attributed PR creation without requiring PATs or distributing a GitHub App private key.

## Recommended hosting

Cloudflare Workers.

## Add separate service

```text
services/catalog-submitter-worker/
  src/index.ts
  src/github-app.ts
  src/catalog-validation.ts
  src/catalog-pr.ts
  wrangler.toml
```

## Worker environment

```env
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
GITHUB_OWNER=TBosak
GITHUB_REPO=mkfd
GITHUB_BASE_BRANCH=main
CATALOG_ROOT=community-catalog
```

Use Cloudflare secrets for sensitive values.

## Worker storage

Use Cloudflare KV:

```text
CATALOG_SUBMISSIONS
```

Stores short-lived submissions and OAuth state.

## Done when

```text
Worker can receive a sanitized submission.
Worker stores submission state.
Worker can redirect user to GitHub auth.
Worker can handle GitHub callback.
```

---

# Phase 12: Configure GitHub App

## Goal

Create an app that can create user-attributed catalog PRs.

## GitHub App settings

```text
Name: Mkfd Catalog Submitter
Callback URL: https://catalog-submit.mkfd.dev/github/callback
Repository permissions:
  Contents: Read and write
  Pull requests: Read and write
  Metadata: Read
```

## Install app

Install on:

```text
TBosak/mkfd
```

or the owner account that contains the Mkfd repo.

## Done when

```text
GitHub App exists.
Callback URL points to the Worker.
App is installed on the Mkfd repo.
Worker can exchange auth code for user token.
```

---

# Phase 13: Implement user-attributed PR creation

## Goal

After GitHub auth, create a PR associated with the authenticated user.

## Flow

```text
1. User submits sanitized bundle to Worker.
2. Worker validates and stores submission.
3. User authenticates with GitHub App.
4. Worker receives callback.
5. Worker obtains GitHub user access token.
6. Worker finds or creates user fork.
7. Worker creates branch in user fork.
8. Worker writes catalog YAML.
9. Worker updates manifest.json.
10. Worker opens PR from user fork to TBosak/mkfd:main.
11. Worker redirects back to Mkfd with PR URL.
```

## Branch name

```text
catalog/add-{slug}-{shortSubmissionId}
```

## PR title

```text
Add catalog feed: {title}
```

## PR body

```md
## Catalog feed submission

Adds a community catalog recipe for {title}.

### Source

{sourceHomepage}

### Feed type

{feedType}

### Category

{category}

### Validation

- No secrets detected
- No private network URLs detected
- No cookies included
- Config validates against schemaVersion 2
```

## Done when

```text
Authenticated users can create catalog PRs from Mkfd.
PRs are opened from user forks.
PRs are associated with the GitHub user.
Mkfd displays the returned PR URL.
```

---

# Phase 14: Integrate Mkfd with broker

## Goal

Add “Submit with GitHub” to the catalog submission dialog.

## Add env setting

```env
CATALOG_SUBMISSION_URL=https://catalog-submit.mkfd.dev
```

## Mkfd flow

```text
POST sanitized submission to broker.
Receive authorization URL.
Redirect user to GitHub.
Receive return redirect from broker.
Show PR URL or error.
```

## Return URL route

Add:

```text
GET /catalog/submissions/complete
```

or frontend route:

```text
/catalog/submissions/complete
```

It reads query params:

```text
status
pr
error
```

## Done when

```text
User can click Submit with GitHub.
User is redirected to GitHub.
User returns to Mkfd after submission.
Mkfd displays PR URL.
Download bundle remains available as fallback.
```

---

# Phase 15: Hardening and abuse controls

## Goal

Make the hosted submission service safe enough to leave running.

## Add protections

```text
Submission size limit
Rate limiting by IP
Rate limiting by GitHub user
Duplicate slug detection
Duplicate sourceHomepage detection
Submission expiration
Strict redirect return URL binding
Server-side sanitizer
Server-side catalog validator
Structured logs
Manual blocklist for abusive users/sources
```

## Done when

```text
Broker rejects unsafe submissions.
Broker cannot be used as an open redirect.
Broker limits spam.
Broker logs enough data to troubleshoot failed submissions.
```

---

# Final roadmap ordering

I would add it to the README in this order:

```md
- [ ] Remote community catalog
  - [ ] Store community feed recipes under `community-catalog/` in the main repository.
  - [ ] Serve the catalog manifest from GitHub Pages or the main branch.
  - [ ] Let Mkfd browse and import remote catalog configs without requiring app updates.
  - [ ] Cache catalog manifests and feed YAML locally with stale fallback.

- [ ] Community catalog submission workflow
  - [ ] Add a per-feed “Submit to Community Catalog” action.
  - [ ] Validate eligibility and reject private, secret-bearing, email, filesystem, and service connector configs.
  - [ ] Sanitize local feed configs into catalog-safe recipes.
  - [ ] Preview the generated catalog YAML and manifest entry.
  - [ ] Provide a downloadable submission bundle.

- [ ] GitHub App powered catalog PR submission
  - [ ] Host a small catalog submission broker, preferably on Cloudflare Workers.
  - [ ] Let users authenticate with GitHub from Mkfd.
  - [ ] Create user-fork branches and user-attributed pull requests automatically.
  - [ ] Keep the GitHub App private key out of self-hosted Mkfd instances.
```

# MVP cut

The smallest useful version is:

```text
Remote catalog browsing + import
Local sanitizer
Downloadable submission bundle
```

The GitHub App broker is valuable, but it is definitely a later nice-to-have.