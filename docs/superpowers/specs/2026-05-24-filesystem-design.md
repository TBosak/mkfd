# Filesystem Feeds — Design Spec

**Date:** 2026-05-24
**Tier:** R5 New Source Types
**Status:** Approved

---

## Goal

Add `feedType: filesystem` so Mkfd can scan a configured folder on an interval and turn matching files into RSS feed items. Each file becomes an item; the item's title, date, link, GUID, and description are resolved from the file's metadata, optional sidecar JSON, or optional text extraction. Security is enforced by restricting all paths to approved deployment roots, and the builder can inspect those roots to surface the options that actually exist in the deployed environment.

---

## Scope

### In scope (MVP)

- `feedType: filesystem` added to `FeedType`
- `FilesystemFeedConfig` and supporting types in `models/filesystem.model.ts`
- `utilities/filesystem-feed.utility.ts` — path safety, directory scanning, glob matching, sidecar reading, text extraction, sorting, state load/save
- `utilities/filesystem-inspection.utility.ts` — approved-root discovery and lightweight deployment inspection
- `buildRSSFromFilesystemItems` in RSS builder
- Worker branch in `workers/feed-updater.worker.ts`
- `GET /filesystem/inspect` endpoint for safe deployment inspection and root suggestions
- Preview route extension
- `FilesystemForm.tsx` builder UI + Filesystem tab in `FeedBuilderForm.tsx`
- `tests/filesystem.test.ts` and fixture directory
- `FILESYSTEM_FEEDS_ROOT` env var for path confinement
- Optional `FILESYSTEM_FEEDS_ROOTS` env var for comma-separated allowlisted deployment roots
- Optional `GET /files/*` static serving route (gated by `FILESYSTEM_FEEDS_PUBLIC_SERVING=true`)
- JSON state file at `./feed-state/filesystem/{feedId}.json` for `firstSeenAt` tracking

### Out of scope (MVP)

- PDF / DOCX / ODT extraction (text extraction only for `.txt`, `.md`, `.html`, `.json`, `.csv`, `.log`)
- Live `fs.watch` watching (polling only)
- Symlink traversal
- Per-file manual metadata overrides in the UI
- SQLite state (use JSON; SQLite migration deferred to SQLite Runtime Substrate)
- Content hash GUID strategy (available as config option but computed on-demand, not stored)
- Arbitrary host filesystem discovery outside approved deployment roots

---

## Dependencies

Must be implemented first:

- Feed Config Formalization (canonical `FeedConfig` for `feedType: filesystem`)

---

## Architecture

| Unit | File | Responsibility |
|---|---|---|
| Filesystem model | `models/filesystem.model.ts` | All filesystem types |
| Filesystem utility | `utilities/filesystem-feed.utility.ts` | Path safety, scan, glob, sidecar, extraction, sort, state |
| Filesystem inspection | `utilities/filesystem-inspection.utility.ts` | Safe deployment-root discovery and directory hints |
| RSS builder | `utilities/rss-builder.utility.ts` | Add `buildRSSFromFilesystemItems` |
| Filesystem tests | `tests/filesystem.test.ts` | Unit tests for utility, state, builder |
| Worker branch | `workers/feed-updater.worker.ts` | Filesystem refresh branch |
| Filesystem inspect route | `routes/filesystem.ts` | `GET /filesystem/inspect` |
| File serving route | `routes/files.ts` | Optional `GET /files/*` static route |
| Filesystem form | `frontend/src/components/forms/FilesystemForm.tsx` | Filesystem builder UI |
| Feed builder | `frontend/src/components/forms/FeedBuilderForm.tsx` | Add Filesystem tab |

---

## Data Model

### `models/filesystem.model.ts` (new)

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
    maxFileSizeBytes: number;
    supportedExtensions: string[];
  };
};

export type FilesystemSidecarMetadata = {
  title?: string;
  description?: string;
  date?: string;
  link?: string;
  categories?: string[];
  author?: string;
  guid?: string;
};

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
  title: string;
  description?: string;
  link?: string;
  author?: string;
  categories?: string[];
  guid: string;
  pubDate: Date;
};

export type FilesystemFeedState = {
  files: Record<string, {
    firstSeenAt: string;
    lastSeenAt: string;
    lastModifiedAt?: string;
    lastSizeBytes?: number;
    stableId: string;
  }>;
};

export type FilesystemDeploymentRoot = {
  path: string;
  label?: string;
  readable: boolean;
  writable?: boolean;
  directoryCount: number;
  fileCount: number;
  extensions: Array<{ extension: string; count: number }>;
  suggestedInclude: string[];
  suggestedExclude: string[];
  recursiveRecommended: boolean;
};

export type FilesystemDeploymentInspection = {
  roots: FilesystemDeploymentRoot[];
  inspectedAt: string;
  warnings: string[];
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

export type FilesystemRunStats = {
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

### `FeedConfig` addition

Add `"filesystem"` to `FeedType` and `filesystem?: FilesystemFeedConfig` to `FeedConfig`.

---

## Filesystem Utility

### `utilities/filesystem-feed.utility.ts` (new)

```ts
export function resolveSafeFilesystemPath(inputPath: string, allowedRoot: string): string;
// Resolves inputPath; throws if it doesn't resolve inside allowedRoot

export function matchesGlob(relativePath: string, patterns: string[]): boolean;
// True if relativePath matches any pattern using minimatch (matchBase: true, dot: true)

export async function scanFilesystemFeed(
  config: FilesystemFeedConfig,
  options: { allowedRoot: string; state?: FilesystemFeedState; now?: Date },
): Promise<FilesystemScanResult>;
// Walks directory, applies include/exclude, skips symlinks, collects stats,
// reads sidecars, applies strategies, sorts, returns FilesystemFeedItem[]

export async function loadFilesystemFeedState(feedId: string): Promise<FilesystemFeedState>;
export async function saveFilesystemFeedState(feedId: string, state: FilesystemFeedState): Promise<void>;
export function updateFilesystemState(
  state: FilesystemFeedState,
  items: FilesystemFeedItem[],
  now: Date,
): FilesystemFeedState;
// Merges new file observations into existing state

export function extractTextPreview(
  absolutePath: string,
  config: FilesystemFeedConfig["extraction"],
): Promise<string | undefined>;
// Reads up to maxFileSizeBytes, strips HTML tags for .html files, truncates to maxCharacters

export function listApprovedFilesystemRoots(): string[];
// Parses FILESYSTEM_FEEDS_ROOTS if present, otherwise falls back to FILESYSTEM_FEEDS_ROOT

export async function inspectFilesystemDeployment(): Promise<FilesystemDeploymentInspection>;
// Returns safe metadata for approved roots only: counts, extension hints, and folder suggestions
```

**Path safety:** `path.resolve(inputPath)` must equal or start with `path.resolve(allowedRoot) + path.sep`. Throws if not.

**Deployment inspection:** The inspection endpoint may only enumerate approved roots and their readable child directories. It must not read file bytes, follow symlinks, or probe arbitrary host paths outside the allowlist.

**Glob matching:** Uses `minimatch` with `{ dot: true, matchBase: true }`. If `include` is empty, all files match (before exclude filtering). Exclude always wins.

**Scanning rules:**
- Skip symlinks (lstat check)
- Skip directories unless `recursive: true`
- Relative path uses forward slashes (normalize `path.sep`)

**Sidecar:** When `sidecar.enabled`, look for `{filename}{sidecar.extension}` alongside each matched file. Parse JSON; warn and continue on parse failure.

**State file:** `./feed-state/filesystem/{feedId}.json` — JSON, written after each scan.

---

## Title, Description, GUID, Date Resolution

### Title
| Strategy | Source |
|---|---|
| `filename` | `path.basename(absolutePath)` |
| `filenameWithoutExtension` | filename without extension |
| `relativePath` | relative path from root |
| `sidecarTitle` | `sidecar.title ?? filenameWithoutExtension` |

### Description (`fileMetadata` default)
```
File: {filename}
Size: {sizeBytes formatted as KB/MB}
Modified: {modifiedAt ISO string}
Path: {relativePath}
```
`sidecarDescription` uses sidecar.description; `textPreview` reads first N chars; `none` omits.

### GUID
| Strategy | Value |
|---|---|
| `path` | `filesystem:{feedId}:{relativePath}` |
| `pathAndModifiedTime` | `filesystem:{feedId}:{relativePath}:{mtime.getTime()}` |
| `contentHash` | `filesystem:{feedId}:{relativePath}:{sha256hex}` |
| `firstSeenId` | `filesystem:{feedId}:{state.files[rel].stableId}` |

### pubDate
| Strategy | Value |
|---|---|
| `modifiedTime` | `modifiedAt` |
| `createdTime` | `createdAt ?? modifiedAt` |
| `firstSeen` | `firstSeenAt from state ?? modifiedAt` |
| `currentRun` | `options.now ?? new Date()` |

Sidecar `date` field overrides the configured `dateStrategy` when present and parseable.

---

## RSS Builder

### Add to `utilities/rss-builder.utility.ts`

```ts
export function buildRSSFromFilesystemItems(
  items: FilesystemFeedItem[],
  feedConfig: FeedConfig,
): string;
```

Mapping per item:

| RSS field | Source |
|---|---|
| `title` | `item.title` |
| `link` | `item.link ?? item.publicUrl` |
| `guid` | `item.guid` |
| `pubDate` | `item.pubDate.toUTCString()` |
| `author` | `item.author` |
| `description` | `item.description` |
| `categories` | `item.categories` |

All string values XML-escaped.

---

## Backend Routes

### Deployment inspection route

`GET /filesystem/inspect` returns the approved roots and safe metadata for the current deployment only. It must not read file contents, follow symlinks, or probe paths outside the allowlist.

### Worker branch in `workers/feed-updater.worker.ts`

```ts
} else if (feed.feedType === "filesystem" && feed.filesystem) {
  const allowedRoot = process.env.FILESYSTEM_FEEDS_ROOT ?? "/app/watch";
  const state = await loadFilesystemFeedState(feed.feedId);
  const result = await scanFilesystemFeed(feed.filesystem, { allowedRoot, state });
  for (const w of result.warnings) console.warn(`[filesystem:${feed.feedId}]`, w);
  const items = result.items.slice(0, feed.filesystem.maxItems);
  const xml = buildRSSFromFilesystemItems(items, feed);
  await Bun.write(`./public/feeds/${feed.feedName}.xml`, xml);
  const newState = updateFilesystemState(state, result.items, new Date());
  await saveFilesystemFeedState(feed.feedId, newState);
}
```

### Preview route extension

```ts
if (body.feedType === "filesystem") {
  const allowedRoot = process.env.FILESYSTEM_FEEDS_ROOT ?? "/app/watch";
  const result = await scanFilesystemFeed(body.filesystem, { allowedRoot });
  const items = result.items.slice(0, body.filesystem.maxItems);
  return c.text(buildRSSFromFilesystemItems(items, body), 200, { "Content-Type": "application/xml" });
}
```

### Optional `GET /files/*` route (`routes/files.ts`)

Enabled only when `FILESYSTEM_FEEDS_PUBLIC_SERVING=true`. Resolves requested path inside `FILESYSTEM_FEEDS_ROOT`, rejects symlinks, rejects dotfiles, sets `Content-Type` from extension, serves file bytes.

```ts
app.get("/files/*", async (c) => {
  if (process.env.FILESYSTEM_FEEDS_PUBLIC_SERVING !== "true") {
    return c.json({ error: "File serving not enabled" }, 403);
  }
  const root = path.resolve(process.env.FILESYSTEM_FEEDS_ROOT ?? "/app/watch");
  const rel = c.req.param("*") ?? "";
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep) && target !== root) {
    return c.json({ error: "Forbidden" }, 403);
  }
  // check not symlink, not dotfile segment, file exists
  // serve with Bun.file(target)
});
```

---

## Payload Validation Rules

`FilesystemFeedConfig` validation:

| Field | Rule |
|---|---|
| `rootPath` | Required, string |
| `recursive` | Required, boolean |
| `include` | Optional, string array |
| `exclude` | Optional, string array |
| `maxItems` | Required, integer 1–10000 |
| `sortOrder` | Required, one of the 7 values |
| `dateStrategy` | Required, one of the 4 values |
| `guidStrategy` | Required, one of the 4 values |
| `titleStrategy` | Required, one of the 4 values |
| `descriptionStrategy` | Required, one of the 4 values |

---

## Frontend

> **For implementers:** This plan involves significant UI work. **REQUIRED SUB-SKILL: Use `superpowers:frontend-design` before implementing any component in this section.**

### `FilesystemForm.tsx` (new)

Sections:
1. **Deployment discovery** — approved roots selector, refresh inspection button, root hint summary
2. **Folder source** — rootPath input, publicBaseUrl input, recursive checkbox
3. **File matching** — include patterns textarea (one per line), exclude patterns textarea
4. **Feed behavior** — max items, sort order dropdown, date strategy dropdown, GUID strategy dropdown, title strategy dropdown, description strategy dropdown
5. **Optional features** — sidecar metadata toggle (extension input shown when enabled), text extraction toggle (maxCharacters input shown when enabled)
6. **Preview** — standard preview RSS button

### `FeedBuilderForm.tsx`

Add Filesystem tab. Render `<FilesystemForm>` inside the new tab content.

---

## Testing

**Fixtures** (`tests/fixtures/filesystem/`)
- `agendas/agenda-2026-05-15.pdf` (empty file, just needs to exist)
- `agendas/agenda-2026-05-15.pdf.json` (sidecar JSON)
- `agendas/notes.md`
- `agendas/page.html`
- `agendas/ignore.tmp`
- `agendas/nested/report.txt`
- `agendas/.hidden` (dotfile)
- `agendas/symlink-target` (symlink)

**`tests/filesystem.test.ts`**

Path safety:
- `resolveSafeFilesystemPath` accepts path inside root
- `resolveSafeFilesystemPath` rejects `../../` traversal
- `resolveSafeFilesystemPath` rejects path outside root

Glob matching:
- `matchesGlob` matches `*.pdf` against `agenda.pdf`
- `matchesGlob` matches `*.md` against `docs/notes.md` (matchBase)
- `matchesGlob` returns false for non-matching extension

Scanning:
- Scans files in root directory
- Does not recurse when `recursive: false`
- Recurses when `recursive: true`
- Skips symlinks
- Include glob filters correctly
- Exclude glob overrides include
- Empty include matches all files

Sidecar:
- Reads sidecar JSON and populates title, description, categories
- Invalid sidecar JSON creates a warning and continues

Item building:
- `titleStrategy: filename` uses basename
- `titleStrategy: filenameWithoutExtension` strips extension
- `guidStrategy: path` stable across runs
- `guidStrategy: pathAndModifiedTime` changes when modifiedAt changes
- `dateStrategy: modifiedTime` uses file mtime
- `descriptionStrategy: fileMetadata` includes filename, size, path, modified

State:
- `updateFilesystemState` sets `firstSeenAt` on first scan
- `updateFilesystemState` does not overwrite `firstSeenAt` on second scan
- `loadFilesystemFeedState` returns empty state for missing file
- `inspectFilesystemDeployment` returns approved roots and readable directory hints
- `GET /filesystem/inspect` returns deployment metadata without file bytes

RSS builder:
- File becomes RSS `<item>`
- Title XML-escaped
- GUID present
- pubDate from item
- Link present when publicBaseUrl set
- Valid RSS 2.0 output

---

## Acceptance Criteria

- `feedType: filesystem` recognized by the system
- User can configure a folder path and see it restricted to `FILESYSTEM_FEEDS_ROOT`
- User can inspect approved deployment roots and choose from readable options only
- Include/exclude patterns filter files correctly
- Files become RSS items with title, GUID, pubDate, link
- Sidecar JSON overrides title, description, date, link when present
- Worker refreshes filesystem feeds on schedule
- XML is written to `./public/feeds/{feedName}.xml`
- State file tracks `firstSeenAt` and `lastSeenAt`
- Symlinks are skipped
- Paths outside allowed root are rejected at validation time
- Inspection endpoint only returns metadata for approved roots, not arbitrary host paths
- Optional `GET /files/*` serves files when `FILESYSTEM_FEEDS_PUBLIC_SERVING=true`

---

## Design Decisions

### 1. Polling vs. live `fs.watch`?

**Options:**
- A. Polling on refresh interval (same as all other feed types)
- B. Live `fs.watch` / `fs.watchRecursive` for immediate updates
- C. Both: live watch + periodic refresh fallback

**Chosen: A.** Mkfd's existing feed updater is interval-based and works reliably in Docker/NAS/remote mount environments where `inotify` or `kqueue` may not be available. Polling fits the existing architecture without a new background process. Live watching is a post-MVP addition.

---

### 2. Where to put types — new model file or inline in utility?

**Options:**
- A. `models/filesystem.model.ts` — new dedicated model file
- B. Inline types in `utilities/filesystem-feed.utility.ts`
- C. Add to existing `models/feed-config.model.ts`

**Chosen: A.** Consistent with how other source types (graphql, webhook, calendar) each get their own model file. The type surface is large enough to justify isolation. Inline types make the utility harder to import in tests and the RSS builder.

---

### 3. Should `firstSeenAt` tracking require state persistence?

**Options:**
- A. Require JSON state file; degrade gracefully (use modifiedAt) if missing
- B. Require SQLite (deferred)
- C. Skip `firstSeen` strategy until SQLite lands

**Chosen: A.** `firstSeenAt` is the most useful date strategy for append-only dropboxes (files don't change once dropped; modifiedAt is the deployment time, not the "new file" time). JSON state files are the established pattern in Mkfd (sitemaps use them). SQLite migration is mechanical when the substrate lands.

---

### 4. Should text extraction include PDF/DOCX in MVP?

**Options:**
- A. Plain text formats only (`.txt`, `.md`, `.html`, `.json`, `.csv`, `.log`)
- B. Include PDF via a Bun-native parser
- C. Include PDF + DOCX via external binaries

**Chosen: A.** PDF extraction requires a binary dependency (`pdftotext`, `pdf.js`, or equivalent) which adds significant complexity and image size. Plain text formats cover the most common automation outputs (Markdown reports, HTML exports, JSON logs, CSV exports). PDF extraction is a clear post-MVP addition once there is user demand.

---

### 5. How should the public file serving route be gated?

**Options:**
- A. Always-on, path-restricted route at `/files/*`
- B. Opt-in via `FILESYSTEM_FEEDS_PUBLIC_SERVING=true` env var
- C. Completely separate reverse-proxy concern (no built-in serving)

**Chosen: B.** File serving is a deliberate security decision — exposing a folder over HTTP is not a safe default. An env var gate is explicit and visible in Docker Compose configuration. Users who prefer to use nginx or Caddy for file serving can point `publicBaseUrl` at their own server and leave `FILESYSTEM_FEEDS_PUBLIC_SERVING` unset.

---

### 6. How should deployment inspection discover roots?

**Options:**
- A. Read an allowlisted root list from `FILESYSTEM_FEEDS_ROOTS` and fall back to `FILESYSTEM_FEEDS_ROOT`
- B. Probe the whole host filesystem and infer mounted paths automatically
- C. Skip deployment inspection entirely and require manual root entry

**Chosen: A.** Mkfd should only inspect paths the deployment explicitly allows. A configured allowlist is enough to surface mounted folders and directory hints without turning inspection into host enumeration or accidental data exposure.
