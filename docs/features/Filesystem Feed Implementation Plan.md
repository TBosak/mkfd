Below is an implementation plan for adding **Filesystem / Watch-Folder feeds** to Mkfd.

The goal:

> Add a source type that turns files in a mounted folder into RSS feed items.

This is a good Mkfd feature because it expands the app beyond web scraping into **local automation-to-feed workflows**. Mkfd already has source-specific feed forms for web scraping, REST API, and email, plus preview/save behavior in the main feed builder. Filesystem feeds should follow that same pattern as a new first-class `feedType`.

---

# Filesystem Feed Implementation Plan

## 1. MVP scope

### MVP behavior

The first version should support:

```text
- Select “Filesystem” as a feed type
- Configure a watched folder under an allowed root
- Include/exclude files by glob pattern
- Optionally scan subfolders
- Sort files by modified time, created time, filename, or first seen
- Generate RSS items from matching files
- Link items to a public file URL if public serving is enabled
- Preview generated RSS
- Refresh on interval like web/API/sitemap/calendar feeds
```

### Avoid in MVP

Delay these:

```text
- PDF text extraction
- DOCX/ODT extraction
- OCR
- arbitrary filesystem paths
- symlink traversal
- live file watching with fs.watch
- complex metadata editing UI
- per-file manual overrides
```

Start with **polling on refresh interval**, not live watching. That fits Mkfd’s existing feed updater model and is safer in Docker/NAS environments.

---

# 2. Source type design

Add a new feed type:

```ts
type FeedType =
  | "webScraping"
  | "api"
  | "email"
  | "calendar"
  | "sitemap"
  | "filesystem";
```

If Calendar/Sitemap are not implemented yet:

```ts
type FeedType =
  | "webScraping"
  | "api"
  | "email"
  | "filesystem";
```

The current UI uses tabs for feed types, so Filesystem should become another tab instead of being folded into “Additional Options.”

```text
Web Scraping | REST API | Email | Filesystem
```

Later:

```text
Web Scraping | REST API | Email | Calendar | Sitemap | Filesystem | Webhook
```

---

# 3. Recommended config shape

Use a nested config block to avoid more top-level clutter.

```yaml
feedType: filesystem
feedName: city-agendas
refreshTime: 15

filesystem:
  rootPath: /app/watch/agendas
  publicBaseUrl: /files/agendas
  recursive: true
  maxItems: 50
  sortOrder: modifiedDesc

  include:
    - "*.pdf"
    - "*.md"
    - "*.html"

  exclude:
    - "*.tmp"
    - "~$*"
    - ".DS_Store"

  dateStrategy: modifiedTime
  guidStrategy: pathAndModifiedTime
  titleStrategy: filename
  descriptionStrategy: fileMetadata

  sidecar:
    enabled: false
    extension: ".json"

  extraction:
    enabled: false
    maxCharacters: 1000
    supportedExtensions:
      - ".txt"
      - ".md"
      - ".html"
```

## Config field meanings

|Field|Purpose|
|---|---|
|`rootPath`|Folder to scan|
|`publicBaseUrl`|URL prefix used to link to files|
|`recursive`|Whether to scan subfolders|
|`include`|Glob allowlist|
|`exclude`|Glob denylist|
|`maxItems`|RSS item limit|
|`sortOrder`|File ordering|
|`dateStrategy`|Which timestamp becomes RSS date|
|`guidStrategy`|Stable item identity strategy|
|`titleStrategy`|How RSS title is created|
|`descriptionStrategy`|How RSS description is created|
|`sidecar`|Optional JSON metadata support|
|`extraction`|Optional text preview support|

---

# 4. Security model

This feature needs strong path restrictions.

## Add an allowed root

Add an environment variable:

```text
FILESYSTEM_FEEDS_ROOT=/app/watch
```

All filesystem feed paths must resolve inside that root.

Example:

```text
Allowed:
  /app/watch/agendas
  /app/watch/reports/weekly

Rejected:
  /etc
  /app/configs
  /home/user
  ../../
```

## Path validation rule

Every configured path should be normalized and checked.

```ts
import path from "node:path";

export function resolveSafeFilesystemFeedPath(inputPath: string, allowedRoot: string) {
  const root = path.resolve(allowedRoot);
  const target = path.resolve(inputPath);

  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Filesystem feed path must be inside FILESYSTEM_FEEDS_ROOT");
  }

  return target;
}
```

## Symlink policy

For MVP:

```text
Do not follow symlinks.
```

Reason: symlinks can escape the allowed root.

## Public file serving

Do not automatically expose all scanned files unless explicitly enabled.

Recommended env:

```text
FILESYSTEM_FEEDS_PUBLIC_SERVING=true
FILESYSTEM_FEEDS_PUBLIC_ROOT=/app/watch
```

If public serving is disabled, RSS items can still exist, but links should point to a configured external URL or be omitted.

---

# 5. Docker integration

Add optional volume documentation:

```yaml
services:
  mkfd:
    volumes:
      - ./configs:/app/configs
      - ./watch:/app/watch
      - ./extensions:/app/extensions
    environment:
      - FILESYSTEM_FEEDS_ROOT=/app/watch
      - FILESYSTEM_FEEDS_PUBLIC_SERVING=true
```

Mkfd’s README already documents Docker volume usage for configs and extensions. Filesystem feeds should follow that pattern: users mount a local folder into the container and Mkfd scans inside it.

---

# 6. Frontend implementation

Create:

```text
frontend/src/components/forms/FilesystemForm.tsx
```

The current `FeedBuilderForm` already imports source-specific forms and switches by tab. Add `FilesystemForm` the same way `WebScrapingForm`, `APIForm`, and `EmailForm` are used.

## UI fields

### Folder source

```text
Folder path
[ /app/watch/agendas ]

Public base URL
[ /files/agendas ]

Recursive
[x] Include subfolders
```

### File matching

```text
Include patterns
[ *.pdf ]
[ *.md ]
[ *.html ]

Exclude patterns
[ *.tmp ]
[ ~$* ]
[ .DS_Store ]
```

For MVP, use newline textareas instead of complex array builders.

### Feed behavior

```text
Max items
[ 50 ]

Sort order
[ Modified newest first ]

Date strategy
[ Modified time ]

GUID strategy
[ Path + modified time ]
```

### Description behavior

```text
Description
[ File metadata ]

Optional:
[ ] Use sidecar JSON metadata
[ ] Extract text preview for supported files
```

### Preview

The existing preview flow posts form data and displays XML. Reuse that initially.

Later, add a structured file preview table:

```text
Matched 23 files

| Modified | File | Size | Included | Reason |
|---|---|---:|---|---|
| 2026-05-15 | agenda.pdf | 242 KB | Yes | matched *.pdf |
```

---

# 7. Update `FeedBuilderForm.tsx`

Add import:

```ts
import { FilesystemForm } from "./FilesystemForm";
```

Update state:

```ts
const [feedType, setFeedType] = useState<
  "webScraping" | "api" | "email" | "filesystem"
>("webScraping");
```

Add defaults:

```ts
filesystemRecursive: true,
filesystemMaxItems: 50,
filesystemSortOrder: "modifiedDesc",
filesystemDateStrategy: "modifiedTime",
filesystemGuidStrategy: "pathAndModifiedTime",
filesystemTitleStrategy: "filename",
filesystemDescriptionStrategy: "fileMetadata",
filesystemSidecarEnabled: false,
filesystemExtractionEnabled: false,
```

Add tab trigger:

```tsx
<TabsTrigger value="filesystem">
  <FolderOpen className="mr-2 h-4 w-4" />
  Filesystem
</TabsTrigger>
```

Add tab content:

```tsx
<TabsContent value="filesystem">
  <FilesystemForm
    register={register}
    control={control}
    setValue={setValue}
    watch={watch}
  />
</TabsContent>
```

---

# 8. Shared types

Add types wherever Mkfd stores shared feed form/config types.

```ts
export type FilesystemSortOrder =
  | "modifiedDesc"
  | "modifiedAsc"
  | "createdDesc"
  | "createdAsc"
  | "filenameAsc"
  | "filenameDesc"
  | "firstSeenDesc";

export type FilesystemDateStrategy =
  | "modifiedTime"
  | "createdTime"
  | "firstSeen"
  | "currentRun";

export type FilesystemGuidStrategy =
  | "path"
  | "pathAndModifiedTime"
  | "contentHash"
  | "firstSeenId";

export type FilesystemTitleStrategy =
  | "filename"
  | "filenameWithoutExtension"
  | "relativePath"
  | "sidecarTitle";

export type FilesystemDescriptionStrategy =
  | "fileMetadata"
  | "sidecarDescription"
  | "textPreview"
  | "none";

export type FilesystemFeedConfig = {
  rootPath: string;
  publicBaseUrl?: string;
  recursive: boolean;
  include: string[];
  exclude: string[];
  maxItems: number;
  sortOrder: FilesystemSortOrder;
  dateStrategy: FilesystemDateStrategy;
  guidStrategy: FilesystemGuidStrategy;
  titleStrategy: FilesystemTitleStrategy;
  descriptionStrategy: FilesystemDescriptionStrategy;
  sidecar?: {
    enabled: boolean;
    extension: string;
  };
  extraction?: {
    enabled: boolean;
    maxCharacters: number;
    supportedExtensions: string[];
  };
};
```

---

# 9. Backend utility

Create:

```text
utilities/filesystem-feed.utility.ts
```

## Responsibilities

```text
- validate folder path
- scan files
- apply include/exclude globs
- ignore directories
- ignore symlinks
- collect file stats
- normalize relative paths
- create public URLs
- optionally read sidecar JSON
- optionally extract text preview
- sort files
- limit item count
- return warnings and stats
```

## Internal model

```ts
export type FilesystemFeedItem = {
  id: string;
  absolutePath: string;
  relativePath: string;
  publicUrl?: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  createdAt?: Date;
  modifiedAt?: Date;
  firstSeenAt?: Date;
  contentHash?: string;
  title?: string;
  description?: string;
  categories?: string[];
  metadata?: Record<string, unknown>;
};

export type FilesystemScanResult = {
  items: FilesystemFeedItem[];
  warnings: string[];
  stats: {
    scannedFiles: number;
    matchedFiles: number;
    excludedFiles: number;
    skippedDirectories: number;
    skippedSymlinks: number;
    sidecarFilesRead: number;
    sidecarFilesFailed: number;
  };
};
```

## Utility API

```ts
export async function scanFilesystemFeed(
  config: FilesystemFeedConfig,
  options?: {
    allowedRoot?: string;
    state?: FilesystemFeedState;
  },
): Promise<FilesystemScanResult>;
```

---

# 10. Glob matching

Add a dependency for glob matching.

Recommended:

```bash
bun add minimatch
```

Use it for include/exclude patterns.

Behavior:

```text
- If include list is empty, include all files.
- Exclude patterns always win.
- Patterns match relative paths.
- Normalize Windows separators to `/`.
```

Example:

```ts
import { minimatch } from "minimatch";

function matchesAny(relativePath: string, patterns: string[]) {
  return patterns.some((pattern) =>
    minimatch(relativePath, pattern, {
      dot: true,
      nocase: false,
      matchBase: true,
    }),
  );
}
```

---

# 11. File scanning logic

Use recursive scanning with guardrails.

```ts
async function walkDirectory(
  root: string,
  recursive: boolean,
  result: string[],
) {
  for await (const entry of new Bun.Glob("*").scan({ cwd: root, onlyFiles: false })) {
    // Alternative: use node fs/promises readdir with withFileTypes
  }
}
```

I would probably use `node:fs/promises` because it is clearer for symlink checks.

Pseudo-flow:

```text
scan root directory
for each dirent:
  if symlink: skip
  if directory and recursive: walk
  if file: evaluate relative path
```

---

# 12. Sidecar metadata support

This is optional but very powerful.

If enabled, Mkfd looks for:

```text
example.pdf.json
```

next to:

```text
example.pdf
```

Example sidecar:

```json
{
  "title": "City Council Agenda",
  "description": "Agenda for the May 15 meeting.",
  "date": "2026-05-15T18:00:00Z",
  "categories": ["city", "agenda", "public-meeting"],
  "link": "https://example.gov/agendas/may-15"
}
```

Supported fields:

```ts
type FilesystemSidecarMetadata = {
  title?: string;
  description?: string;
  date?: string;
  link?: string;
  categories?: string[];
  author?: string;
  guid?: string;
};
```

Priority rules:

```text
title:
  sidecar title -> filename strategy

description:
  sidecar description -> file metadata -> text preview -> empty

date:
  sidecar date -> configured date strategy

link:
  sidecar link -> public file URL
```

This lets external scripts generate rich feed metadata without needing a webhook.

---

# 13. Text extraction MVP

Start only with plain text formats:

```text
.txt
.md
.html
.htm
.json
.csv
.log
```

Do not add PDF/DOCX extraction in the first pass.

Extraction rules:

```text
- Max characters default: 1000
- Strip HTML for .html/.htm
- Collapse whitespace
- Never read files larger than configured max, maybe 5 MB by default
```

Config:

```yaml
extraction:
  enabled: true
  maxCharacters: 1000
  maxFileSizeBytes: 5242880
  supportedExtensions:
    - ".txt"
    - ".md"
    - ".html"
```

---

# 14. State tracking

Filesystem feeds benefit from state.

If SQLite is not added yet, use JSON:

```text
./feed-state/filesystem/{feedId}.json
```

State shape:

```ts
export type FilesystemFeedState = {
  files: Record<string, {
    firstSeenAt: string;
    lastSeenAt: string;
    lastModifiedAt?: string;
    lastSizeBytes?: number;
    lastContentHash?: string;
    stableId: string;
  }>;
};
```

Why state matters:

```text
- first-seen date strategy
- stable GUIDs
- changed-file detection later
- disappeared-file count
- health dashboard stats
```

MVP can work without state, but I recommend adding minimal state early.

---

# 15. GUID strategies

Filesystem GUIDs need careful thought.

## Option A: path

```text
guid = filesystem:{feedId}:{relativePath}
```

Stable across modifications.

Good for: “this file exists.”

Bad for: RSS readers may not notice updates to the same file.

## Option B: path + modified time

```text
guid = filesystem:{feedId}:{relativePath}:{mtime}
```

Creates a new RSS item when the file changes.

Good for: “tell me when file changed.”

Bad for: same file can appear repeatedly.

## Option C: content hash

```text
guid = filesystem:{feedId}:{relativePath}:{sha256}
```

Best semantic change detection.

More expensive for large files.

## Recommended default

```text
pathAndModifiedTime
```

This makes changed files visible in readers.

Add UI explanation:

```text
Path only = one item per file.
Path + modified time = new item when file changes.
Content hash = new item only when content changes.
```

---

# 16. RSS builder

Add to:

```text
utilities/rss-builder.utility.ts
```

Mkfd already has RSS builder paths for scraped HTML and API data. Add a specific builder instead of forcing filesystem items into selector/API mapping logic.

```ts
export function buildRSSFromFilesystemItems(
  items: FilesystemFeedItem[],
  feedConfig: FeedConfig,
): string;
```

## RSS mapping

|RSS field|Filesystem source|
|---|---|
|title|title strategy / sidecar title|
|link|sidecar link or public file URL|
|guid|configured GUID strategy|
|pubDate|configured date strategy|
|description|sidecar description, metadata, or preview|
|category|sidecar categories|
|author|sidecar author|

Example description:

```text
File: city-council-agenda.pdf
Size: 242 KB
Modified: 2026-05-15 13:20:00
Path: agendas/city-council-agenda.pdf
```

---

# 17. Preview endpoint support

Extend `/preview`.

Pseudo-flow:

```ts
if (body.feedType === "filesystem") {
  const result = await scanFilesystemFeed(body.filesystem, {
    allowedRoot: process.env.FILESYSTEM_FEEDS_ROOT || "/app/watch",
  });

  const rssXml = buildRSSFromFilesystemItems(
    result.items.slice(0, body.filesystem.maxItems),
    body,
  );

  return c.text(rssXml);
}
```

Later, add a structured preview endpoint:

```text
POST /preview/filesystem
```

Response:

```ts
{
  items: FilesystemFeedItem[];
  warnings: string[];
  stats: FilesystemScanResult["stats"];
  rssXml: string;
}
```

---

# 18. Worker support

Update:

```text
workers/feed-updater.worker.ts
```

Add branch:

```ts
if (feed.feedType === "filesystem") {
  const state = await loadFilesystemFeedState(feedId);
  const result = await scanFilesystemFeed(feed.filesystem, {
    allowedRoot: process.env.FILESYSTEM_FEEDS_ROOT || "/app/watch",
    state,
  });

  const items = result.items.slice(0, feed.filesystem.maxItems);
  const rssXml = buildRSSFromFilesystemItems(items, feed);

  await Bun.write(`./public/feeds/${feedId}.xml`, rssXml);
  await saveFilesystemFeedState(feedId, updateFilesystemState(state, result.items));

  postRunStats({
    feedId,
    scannedFiles: result.stats.scannedFiles,
    matchedFiles: result.stats.matchedFiles,
    emittedItems: items.length,
    warnings: result.warnings,
  });
}
```

Filesystem feeds should use normal interval updates like web/API feeds, not a continuous worker like email. Mkfd’s email feeds are special because they run continuously and update when new messages arrive. Folder feeds can be interval-based for simplicity and reliability.

---

# 19. Public file serving route

Add an optional static-serving route.

Example:

```text
GET /files/*
```

Only enable if:

```text
FILESYSTEM_FEEDS_PUBLIC_SERVING=true
```

Rules:

```text
- requested path must resolve inside FILESYSTEM_FEEDS_ROOT or FILESYSTEM_PUBLIC_ROOT
- no directory listing
- no dotfiles by default
- no symlinks
- set safe content type
- optionally force download for unknown types
```

If you do not want Mkfd to serve files yet, require users to provide `publicBaseUrl` pointing to another server. But self-hosted users will expect Mkfd to serve the files.

---

# 20. Health dashboard integration

Even before the dashboard is built, design stats now.

Filesystem-specific run stats:

```ts
type FilesystemRunStats = {
  feedId: string;
  startedAt: string;
  completedAt: string;
  rootPath: string;
  scannedFiles: number;
  matchedFiles: number;
  excludedFiles: number;
  emittedItems: number;
  newFiles: number;
  changedFiles: number;
  disappearedFiles: number;
  skippedSymlinks: number;
  sidecarFilesRead: number;
  sidecarFilesFailed: number;
  warnings: string[];
};
```

Useful warnings:

```text
- folder does not exist
- folder is outside allowed root
- include patterns matched no files
- public serving disabled but no publicBaseUrl configured
- sidecar JSON invalid
- file too large for extraction
- symlink skipped
- permission denied
```

This fits your planned feed health dashboard and error logging direction.

---

# 21. Tests

## Fixtures

Create:

```text
tests/fixtures/filesystem-feed/
  agendas/
    agenda-2026-05-15.pdf
    agenda-2026-05-15.pdf.json
    notes.md
    page.html
    ignore.tmp
    nested/
      report.txt
```

## Utility tests

Test:

```text
- rejects folder outside allowed root
- scans direct files
- scans recursively when enabled
- does not scan recursively when disabled
- include glob works
- exclude glob overrides include
- symlink is skipped
- sidecar metadata is read
- invalid sidecar creates warning
- title from filename works
- description from metadata works
- sort by modified desc works
- max items works
```

## RSS builder tests

Test:

```text
- file becomes RSS item
- public URL becomes link
- sidecar title overrides filename
- sidecar categories become categories
- modified time becomes pubDate
- pathAndModifiedTime GUID changes when modified time changes
- path GUID remains stable
- XML is valid
```

## Worker tests

Test:

```text
- filesystem feed writes XML to public feeds
- missing folder returns useful error
- empty folder produces valid empty feed or warning
- state file is created
- firstSeenAt persists across runs
```

---

# 22. README documentation

Add a section:

```md
## 📁 Filesystem Feeds

Mkfd can generate RSS feeds from files in a watched folder. This is useful for self-hosted workflows where reports, PDFs, Markdown files, exports, scans, or generated documents are dropped into a directory and should appear in an RSS feed.

Filesystem feeds scan a configured folder on an interval. You can include or exclude files with glob patterns, choose how file dates and GUIDs are generated, and optionally expose files through Mkfd.
```

Add Docker example:

```yaml
services:
  mkfd:
    image: tbosk/mkfd:latest
    ports:
      - "5000:5000"
    volumes:
      - ./configs:/app/configs
      - ./watch:/app/watch
    environment:
      - FILESYSTEM_FEEDS_ROOT=/app/watch
      - FILESYSTEM_FEEDS_PUBLIC_SERVING=true
```

Add sample config:

```yaml
feedType: filesystem
feedName: agendas
refreshTime: 15

filesystem:
  rootPath: /app/watch/agendas
  publicBaseUrl: /files/agendas
  recursive: true
  include:
    - "*.pdf"
    - "*.md"
  exclude:
    - "*.tmp"
  maxItems: 50
  sortOrder: modifiedDesc
  dateStrategy: modifiedTime
  guidStrategy: pathAndModifiedTime
  titleStrategy: filenameWithoutExtension
  descriptionStrategy: fileMetadata
```

---

# 23. Recommended implementation order

## Sprint 1: Config, types, and scanning utility

Deliverables:

```text
- Add filesystem feed type
- Add FilesystemFeedConfig type
- Add filesystem-feed.utility.ts
- Validate allowed root
- Scan folder
- Include/exclude globs
- Sort and limit items
- Unit tests
```

## Sprint 2: RSS builder and preview

Deliverables:

```text
- buildRSSFromFilesystemItems
- Extend preview route
- Generate valid RSS from scanned files
- Add file preview XML support
- RSS builder tests
```

## Sprint 3: UI form

Deliverables:

```text
- FilesystemForm.tsx
- Add Filesystem tab
- Add defaults
- Wire preview/save
- Add basic validation messages
```

## Sprint 4: Worker integration and state

Deliverables:

```text
- Add feed-updater worker branch
- Write generated XML
- Add JSON state file
- Track firstSeenAt, lastSeenAt, modified time
- Add warning/stats capture
```

## Sprint 5: Public file serving

Deliverables:

```text
- Optional /files/* route
- Path safety checks
- Public serving env flags
- README Docker volume docs
```

## Sprint 6: Sidecar metadata and text extraction

Deliverables:

```text
- Read sidecar JSON
- Apply sidecar title/description/date/link/categories
- Extract preview from txt/md/html/json/csv/log
- Add extraction size limits
```

---

# 24. MVP acceptance criteria

Filesystem feeds are MVP-complete when:

```text
- User can select Filesystem as a feed type.
- User can configure a folder path under FILESYSTEM_FEEDS_ROOT.
- User can configure include/exclude patterns.
- User can preview generated RSS.
- User can save a filesystem feed.
- Worker refreshes the feed on schedule.
- Matching files become RSS items.
- File links use publicBaseUrl or Mkfd public serving.
- File dates are stable and predictable.
- GUID strategy is configurable.
- Symlinks are skipped.
- Paths outside allowed root are rejected.
- Empty folders and permission errors show useful warnings.
```

---

# 25. Strategic positioning

Filesystem feeds are not just a convenience feature. They help Mkfd become an automation bridge.

Good product language:

> Generate RSS feeds from local folders, reports, exports, documents, and self-hosted automation outputs.

Or broader:

> Turn files dropped into a folder into a portable RSS feed.

This pairs extremely well with:

```text
- webhook/event feeds
- sitemap change detection
- calendar feeds
- feed health dashboard
- OPML export
- feed merging
```

My recommendation: put Filesystem feeds at **P2**, or **late P1** if you add SQLite/state management early. The MVP is not too hard, but it becomes much more valuable once Mkfd has feed health and config management in place.