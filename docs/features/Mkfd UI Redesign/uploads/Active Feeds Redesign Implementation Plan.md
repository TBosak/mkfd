Below is an implementation plan for the **Active Feeds page redesign**.

I would frame this feature as:

> Turn Active Feeds into Mkfd’s feed operations dashboard: browse, search, tag, filter, inspect, run, edit, export, and eventually repair every feed configuration.

This should be tightly coupled with config browsing/import/export because Mkfd configs are already central to how the app runs. Docker and Docker Compose both mount `./configs` into `/app/configs`, so the app is already operationally config-driven. The frontend currently renders `FeedBuilderForm` directly as the main content, so this redesign also creates the foundation for a real multi-page GUI.

---

# Active Feeds Redesign Implementation Plan

## 1. Product goal

The redesigned page should answer these questions quickly:

```text
What feeds do I have?
Which ones are working?
Which ones are broken?
Which ones use secrets?
Which ones came from the community catalog?
Which feeds are related to this topic/tag?
How do I edit, duplicate, export, or run this feed?
```

The page should not merely list generated XML files. It should summarize **installed feed configurations** plus operational state.

Recommended name:

```text
My Feeds
```

“Active Feeds” can remain as a status filter, but “My Feeds” is a better page name because it can include disabled feeds, imported configs, community recipes, broken feeds, and drafts.

---

# 2. MVP scope

## MVP should include

```text
- List all configs from /app/configs
- Search feeds
- Filter by feed type
- Filter by enabled/disabled
- Add/edit/remove tags
- Assign category
- Mark favorite
- Open generated feed URL
- Copy generated feed URL
- Preview feed
- Edit config
- Duplicate config
- Export config
- Delete config
- Show basic badges: type, enabled, protected values, env vars
```

## Delay until health dashboard phase

```text
- Detailed run history
- Selector match counts
- Fetch duration charts
- Error analytics
- Automatic repair actions
- Saved filter views
- Bulk actions
- Catalog update checks
```

---

# 3. Navigation redesign

Current `App.tsx` directly renders `FeedBuilderForm` in the main content. Replace that with a page shell.

## MVP navigation

```text
My Feeds | Build Feed | Catalog
```

## Later navigation

```text
Dashboard | My Feeds | Build | Catalog | Settings
```

Suggested frontend structure:

```tsx
function App() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 max-w-7xl">
          <Card className="my-8 shadow-lg border-0 bg-white/80 backdrop-blur-sm dark:bg-slate-900/80 slide-up">
            <CardContent className="p-0">
              <Header />
              <main className="px-6 md:px-12 pb-12">
                <Tabs defaultValue="feeds">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="feeds">My Feeds</TabsTrigger>
                    <TabsTrigger value="builder">Build Feed</TabsTrigger>
                    <TabsTrigger value="catalog">Catalog</TabsTrigger>
                  </TabsList>

                  <TabsContent value="feeds">
                    <MyFeedsPage />
                  </TabsContent>

                  <TabsContent value="builder">
                    <FeedBuilderForm />
                  </TabsContent>

                  <TabsContent value="catalog">
                    <CommunityCatalog />
                  </TabsContent>
                </Tabs>
              </main>
              <div className="px-6 md:px-12 pb-6">
                <Footer />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}
```

The wider `max-w-7xl` matters because feed management wants tables, filters, drawers, and cards. The current builder is narrow and form-focused.

---

# 4. Data model

Add feed metadata to YAML configs.

## Config metadata block

```yaml
metadata:
  title: Cape County Notices
  description: Public notice feed for Cape Girardeau County.
  category: civic
  tags:
    - government
    - local
    - notices
  favorite: true
  enabled: true
  color: blue
  origin:
    type: local
```

For community-imported configs:

```yaml
metadata:
  title: GitHub Releases
  description: Release feed for a GitHub repository.
  category: developer
  tags:
    - github
    - releases
  favorite: false
  enabled: true
  origin:
    type: community
    catalogId: github-releases
    importedAt: 2026-05-16T12:00:00Z
    sourceRepo: TBosak/mkfd
    sourcePath: community-configs/configs/developer/github-releases.yaml
```

## Why metadata belongs in YAML

Put stable, user-controlled organization data in the config:

```text
tags
category
favorite
description
origin
enabled
```

Do **not** put volatile runtime state in YAML:

```text
lastRunAt
lastError
fetchDuration
itemCount
selectorMatchCount
```

Those should live in JSONL/SQLite/feed-state later.

---

# 5. Feed summary type

Create a backend summary shape.

```ts
export type FeedStatus =
  | "unknown"
  | "healthy"
  | "warning"
  | "error"
  | "disabled"
  | "running"
  | "neverRun";

export type FeedSummary = {
  id: string;
  filename: string;
  feedName: string;
  title?: string;
  description?: string;
  feedType: string;
  sourceLabel?: string;
  sourceUrl?: string;
  publicFeedUrl: string;
  enabled: boolean;
  tags: string[];
  category?: string;
  favorite: boolean;
  status: FeedStatus;
  refreshTime?: number;
  lastModifiedAt: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  lastItemCount?: number;
  lastNewItemCount?: number;
  usesProtectedValues: boolean;
  usesEnvVars: boolean;
  hasPlainSensitiveValues: boolean;
  origin?: {
    type: "local" | "community";
    catalogId?: string;
  };
};
```

## Source label examples

```text
Web Scraping: https://example.com/news
REST API: GET https://api.example.com/posts
GraphQL: RepositoryReleases @ https://api.github.com/graphql
Email: INBOX on imap.gmail.com
Calendar: https://example.com/events.ics
Sitemap: https://example.com/sitemap.xml
Filesystem: /app/watch/agendas
Webhook: /webhook-feeds/deployments
```

---

# 6. Backend API

Add feed-management endpoints.

```text
GET    /feeds
GET    /feeds/:id
PATCH  /feeds/:id/metadata
PATCH  /feeds/:id/enabled
POST   /feeds/:id/preview
POST   /feeds/:id/run
POST   /feeds/:id/duplicate
GET    /feeds/:id/export
DELETE /feeds/:id
```

## MVP endpoints

Start with:

```text
GET    /feeds
PATCH  /feeds/:id/metadata
PATCH  /feeds/:id/enabled
POST   /feeds/:id/duplicate
GET    /feeds/:id/export
DELETE /feeds/:id
```

Add `run` and richer `preview` once you have the config manager and worker hooks cleaner.

---

# 7. Backend utilities

Create:

```text
utilities/feed-summary.utility.ts
utilities/config-manager.utility.ts
utilities/config-metadata.utility.ts
```

## `config-manager.utility.ts`

Responsibilities:

```text
list YAML files from /app/configs
read config by id
write config by id
delete config
duplicate config
generate safe config id/filename
export config
```

## `config-metadata.utility.ts`

Responsibilities:

```text
normalize metadata block
patch tags/category/favorite/enabled
preserve unknown config fields
generate title fallback from feedName
```

## `feed-summary.utility.ts`

Responsibilities:

```text
build FeedSummary from config
derive sourceLabel/sourceUrl
detect protected values
detect env vars
detect plain sensitive values
compute basic status
load last run state if available
```

---

# 8. Feed ID rules

Use safe feed IDs.

```text
city-notices
github-releases
oldham-athletic-news
```

Sanitization:

```text
lowercase
letters, numbers, dash, underscore
no slash
no dot-dot
no file extension in route param
```

Map:

```text
id: city-notices
file: /app/configs/city-notices.yaml
```

For existing configs, derive ID from filename.

---

# 9. Basic status model

MVP can compute status from config and shallow state.

```ts
function getFeedStatus(summary: Partial<FeedSummary>): FeedStatus {
  if (summary.enabled === false) return "disabled";
  if (!summary.lastRunAt) return "neverRun";
  if (summary.lastErrorAt && summary.lastErrorAt > (summary.lastSuccessAt ?? "")) return "error";
  if (summary.hasPlainSensitiveValues) return "warning";
  return "healthy";
}
```

Before run history exists, most feeds will be:

```text
unknown
disabled
neverRun
warning
```

That is fine. The model can grow into the health dashboard later.

---

# 10. Frontend components

Create:

```text
components/feeds/MyFeedsPage.tsx
components/feeds/FeedCard.tsx
components/feeds/FeedTable.tsx
components/feeds/FeedFilters.tsx
components/feeds/FeedSearchBar.tsx
components/feeds/FeedActionsMenu.tsx
components/feeds/FeedTagEditor.tsx
components/feeds/FeedStatusBadge.tsx
components/feeds/FeedTypeBadge.tsx
components/feeds/FeedDetailDrawer.tsx
```

MVP subset:

```text
MyFeedsPage.tsx
FeedCard.tsx
FeedFilters.tsx
FeedActionsMenu.tsx
FeedTagEditor.tsx
FeedStatusBadge.tsx
FeedTypeBadge.tsx
```

---

# 11. Page layout

## Header area

```text
My Feeds

Search, tag, filter, inspect, edit, and export every feed recipe.

[Search feeds...]
[+ Build Feed] [Import Config]
```

## Filter bar

```text
[All] [Favorites] [Broken] [Warnings] [Disabled] [Has Secrets]

Type:
[Web Scraping] [REST] [GraphQL] [Email] [Calendar] [Sitemap] [Filesystem] [Webhook]

Tags:
[government] [developer] [automation] [local]
```

## Feed grid

Cards for MVP:

```text
Cape County Notices                         Healthy
Web Scraping · civic
government local notices

Source: https://example.gov/notices
Refresh: every 60 min
Last run: Never

[Open Feed] [Copy URL] [Preview] [Edit] [...]
```

## Later table view

```text
Name | Type | Status | Tags | Last Run | Items | Refresh | Actions
```

Start with cards. Add table view once bulk actions matter.

---

# 12. Search behavior

Search should operate client-side for MVP because the feed list is probably small.

Search these fields:

```text
feedName
title
description
feedType
sourceLabel
sourceUrl
tags
category
filename
publicFeedUrl
origin.catalogId
```

Implementation:

```ts
function feedMatchesSearch(feed: FeedSummary, query: string) {
  const haystack = [
    feed.feedName,
    feed.title,
    feed.description,
    feed.feedType,
    feed.sourceLabel,
    feed.sourceUrl,
    feed.publicFeedUrl,
    feed.category,
    feed.filename,
    feed.origin?.catalogId,
    ...feed.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.trim().toLowerCase());
}
```

## Later search syntax

Add later:

```text
type:graphql
tag:government
status:error
source:github.com
has:secrets
is:favorite
origin:community
```

Do not implement this in MVP.

---

# 13. Filtering behavior

## MVP filters

```ts
type FeedFilterState = {
  feedTypes: string[];
  statuses: FeedStatus[];
  tags: string[];
  categories: string[];
  enabled?: boolean;
  favoritesOnly: boolean;
  hasSecrets?: boolean;
  hasWarnings?: boolean;
};
```

## Tag logic

Default to “match any selected tag.”

Later add:

```text
Match any tag
Match all tags
```

## Built-in quick filters

```text
All
Favorites
Disabled
Warnings
Has Secrets
Community
```

---

# 14. Tag editing

## YAML update

When user edits tags:

```http
PATCH /feeds/:id/metadata
```

Payload:

```json
{
  "tags": ["government", "local", "notices"]
}
```

Backend should update only:

```yaml
metadata:
  tags:
    - government
    - local
    - notices
```

and preserve the rest of the config.

## Inline tag editor

UX:

```text
[government] [local] [+]
```

Click `+` opens a small input.

Tag rules:

```text
trim whitespace
lowercase by default
allow letters/numbers/dash/underscore/spaces
dedupe tags
max maybe 25 tags/feed
```

I would allow spaces in labels but normalize internally to lower-case trimmed strings.

---

# 15. Category model

Add one category per feed.

```yaml
metadata:
  category: civic
```

Recommended built-ins:

```text
civic
news
developer
personal
automation
commerce
sports
entertainment
education
monitoring
other
```

But allow custom categories.

Category should be a select/combobox, not a hard enum.

---

# 16. Feed actions

## MVP actions

```text
Open RSS
Copy URL
Preview
Edit
Duplicate
Export YAML
Disable / Enable
Delete
```

## Later actions

```text
Run Now
View Logs
Validate
Submit to Catalog
Sanitize Export
Repair
Convert to Sitemap Feed
Retry with Advanced Scraping
```

## Action menu component

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon">
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem>Open RSS</DropdownMenuItem>
    <DropdownMenuItem>Copy Feed URL</DropdownMenuItem>
    <DropdownMenuItem>Preview</DropdownMenuItem>
    <DropdownMenuItem>Edit</DropdownMenuItem>
    <DropdownMenuItem>Duplicate</DropdownMenuItem>
    <DropdownMenuItem>Export YAML</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem>Disable</DropdownMenuItem>
    <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

# 17. Edit behavior

For MVP, clicking **Edit** can load the config into the existing builder form.

But be careful: the current builder form posts new feeds to `/` and reloads after success. You will need an edit mode.

## FeedBuilderForm edit mode

Add props:

```ts
type FeedBuilderFormProps = {
  mode?: "create" | "edit";
  feedId?: string;
  initialData?: FeedFormData;
  onSaved?: () => void;
};
```

In create mode:

```http
POST /
```

In edit mode:

```http
PUT /feeds/:id
```

Or:

```http
PUT /configs/:id
```

Long-term, I would prefer `/configs/:id` for raw config updates and `/feeds/:id` for feed operations. But for UX consistency, `/feeds/:id` is fine.

## YAML editor later

Add:

```text
Edit in Form
Edit YAML
```

YAML editing is important because community configs and advanced source types may contain fields the current form does not support.

---

# 18. Preview behavior

MVP options:

1. Preview the generated XML from saved config.
    
2. Reuse existing `/preview` route by reading config and passing it through the same builder path.
    

Add:

```http
POST /feeds/:id/preview
```

Response:

```text
RSS XML
```

Frontend opens existing `FeedPreview`.

The current builder already has an XML preview dialog. Reuse it.

---

# 19. Enable / disable behavior

Add:

```yaml
metadata:
  enabled: true
```

or top-level:

```yaml
enabled: true
```

I would use top-level `enabled` because workers need it often:

```yaml
enabled: true
metadata:
  tags:
    - developer
```

Then `metadata.favorite`, `metadata.tags`, etc. stay organizational.

Worker startup/update process should skip:

```yaml
enabled: false
```

MVP page can toggle the value even if the worker skip behavior is added in the next step.

---

# 20. Secret/protected value badges

Since you want optional header/cookie encryption, surface that here.

Badges:

```text
Encrypted values
Env vars
Plain sensitive values
Catalog-safe
Needs sanitization
```

Detection rules:

```text
usesProtectedValues: any { type: protected }
usesEnvVars: any { type: env } or ${VAR}
hasPlainSensitiveValues: Authorization/Cookie/token-like key stored as plain
```

Example card:

```text
Private API
REST API · Encrypted values · Not catalog-safe
```

This directly supports import/export and GitHub submission safety.

---

# 21. Runtime state integration

Do this after the MVP page exists.

## JSON state option

Before SQLite:

```text
/feed-state/runs/{feedId}.json
```

Shape:

```ts
type FeedRunSummary = {
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  lastItemCount?: number;
  lastNewItemCount?: number;
  lastDurationMs?: number;
};
```

## SQLite option later

```sql
feed_runtime_summary
  feed_id TEXT PRIMARY KEY
  last_run_at TEXT
  last_success_at TEXT
  last_error_at TEXT
  last_error_message TEXT
  last_item_count INTEGER
  last_new_item_count INTEGER
  last_duration_ms INTEGER
  updated_at TEXT
```

The feed summary endpoint should be designed so it can switch from JSON to SQLite without changing the frontend.

---

# 22. Backend `GET /feeds` flow

Pseudo-flow:

```text
read all YAML config files
parse each config
normalize metadata
derive feed id
derive source label
detect secret/protected/env usage
load latest runtime summary if available
compute status
return FeedSummary[]
```

Suggested implementation:

```ts
app.get("/feeds", async (c) => {
  const configs = await listFeedConfigs();
  const summaries = await Promise.all(
    configs.map(async (configFile) => {
      const config = await readFeedConfig(configFile.id);
      const runtime = await loadFeedRunSummary(configFile.id);
      return buildFeedSummary(configFile, config, runtime);
    }),
  );

  return c.json({ feeds: summaries });
});
```

---

# 23. Frontend state management

For MVP, local React state is enough.

```ts
const [feeds, setFeeds] = useState<FeedSummary[]>([]);
const [search, setSearch] = useState("");
const [filters, setFilters] = useState<FeedFilterState>(defaultFilters);
const [loading, setLoading] = useState(true);
```

Fetch:

```ts
useEffect(() => {
  fetch("/feeds")
    .then((res) => res.json())
    .then((data) => setFeeds(data.feeds ?? []))
    .finally(() => setLoading(false));
}, []);
```

Mutations should optimistically update when safe:

```text
toggle favorite
edit tags
enable/disable
```

For delete/duplicate/export, refetch after success.

---

# 24. Empty states

Important for new users.

## No feeds

```text
No feeds yet

Build your first feed from a webpage, REST API, or email folder.

[Build Feed]
```

## No filter results

```text
No feeds match these filters.

[Clear filters]
```

## No tags yet

```text
No tags yet. Add tags to organize feeds by project, topic, or source.
```

---

# 25. Visual design

Keep it practical, not flashy.

## Feed card structure

```text
┌──────────────────────────────────────────────┐
│ Cape County Notices               Healthy    │
│ Web Scraping · Civic                         │
│ government local notices                     │
│                                              │
│ Source: https://example.gov/notices          │
│ Refresh: 60 min · Last run: Never            │
│                                              │
│ [Open] [Copy] [Preview]              [...]   │
└──────────────────────────────────────────────┘
```

## Status colors

Use existing design system tokens if available. Conceptually:

```text
healthy = green
warning = yellow/orange
error = red
disabled = muted
neverRun = blue/gray
running = blue
```

## Feed type icons

```text
Web Scraping: Globe
REST API: Code
GraphQL: GraphQL icon
Email: Mail
Calendar: CalendarDays
Sitemap: Map
Filesystem: FolderOpen
Webhook: RadioTower or Webhook
Existing Feed: Rss
```

---

# 26. Bulk actions later

Not MVP, but design the data model so it is easy.

Bulk actions:

```text
Add tag
Remove tag
Set category
Enable
Disable
Export selected
Delete selected
Validate selected
Run selected
```

This becomes valuable once users have dozens of feeds.

---

# 27. Tests

## Backend tests

```text
lists configs from /app/configs
ignores non-YAML files
builds feed summary
derives source label for web scraping
derives source label for REST API
derives source label for email
normalizes missing metadata
patches tags without destroying config
patches category
patches favorite
toggles enabled
duplicates config with safe filename
deletes config
detects protected values
detects env vars
detects plain sensitive values
```

## Frontend tests

```text
renders feed cards
search filters by name
search filters by tag
type filter works
status filter works
favorite filter works
tag editor adds tag
tag editor removes tag
enable toggle calls API
actions menu renders expected actions
empty state renders
```

## Integration tests

```text
create feed
appears in My Feeds
add tag
filter by tag
duplicate feed
export feed
delete feed
```

---

# 28. Suggested implementation phases

## Phase 1: Feed summary backend

Deliverables:

```text
GET /feeds
FeedSummary type
config file listing
metadata normalization
source label derivation
basic enabled/status logic
protected/env/plain-sensitive detection
```

## Phase 2: My Feeds page MVP

Deliverables:

```text
MyFeedsPage
FeedCard
search
feed type filter
enabled/disabled filter
favorite filter
open/copy feed URL
empty states
```

## Phase 3: Metadata editing

Deliverables:

```text
PATCH /feeds/:id/metadata
inline tag editor
category editor
favorite toggle
description/title editing in detail drawer
```

## Phase 4: Actions

Deliverables:

```text
duplicate feed
export YAML
delete feed
enable/disable feed
preview saved feed
edit existing feed
```

## Phase 5: Status and validation

Deliverables:

```text
validation warnings
secret/protected badges
never-run/disabled/warning statuses
detail drawer validation panel
```

## Phase 6: Runtime health

Deliverables:

```text
run now
last run
last success
last error
item count
new item count
recent run list
status filters
```

## Phase 7: Advanced management

Deliverables:

```text
table view
bulk actions
saved views
catalog origin badges
check catalog updates
submit to catalog
repair actions
```

---

# 29. MVP acceptance criteria

The first version is done when:

```text
User can open My Feeds.
User can see all installed YAML configs.
User can search by name, source, type, category, and tags.
User can filter by feed type.
User can filter enabled/disabled feeds.
User can add and remove tags.
User can set a category.
User can mark a feed as favorite.
User can open and copy the public RSS URL.
User can preview a saved feed.
User can duplicate, export, disable, enable, and delete feeds.
User can see badges for encrypted values, env vars, and plain sensitive values.
```

The second version is done when:

```text
User can manually run a feed.
User can see last run status.
User can filter by health status.
User can inspect validation warnings.
User can view recent run history.
User can bulk tag/export/disable feeds.
```

---

# 30. Priority placement

I would place this as part of the same P0 work as config management:

```text
P0.1 My Feeds / config browser
P0.2 Search, filtering, tagging
P0.3 Import/export
P0.4 Validation and protected-value warnings
P0.5 Feed run status and health summaries
P1.0 Community catalog and GitHub submission
```

This should come before adding many more feed types. As Mkfd adds Calendar, Sitemap, Filesystem, Webhook, GraphQL, and existing-feed transformer sources, the management surface becomes more important than the builder itself.

The strongest framing:

> Build Feed is where users create recipes. My Feeds is where they operate, organize, share, and repair them.