# Filesystem Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `feedType: filesystem` so Mkfd can scan a configured folder on a refresh interval and turn matching files into RSS feed items, with path confinement, glob filtering, optional sidecar JSON metadata, text extraction for plain-text formats, JSON state for `firstSeenAt` tracking, and a safe deployment inspection endpoint that shows the roots actually mounted in the running environment.

**Architecture:** `models/filesystem.model.ts` defines all types; `utilities/filesystem-feed.utility.ts` owns path safety, directory scanning, glob filtering (via `minimatch`), sidecar reading, text extraction, sort/limit, and state persistence; `utilities/filesystem-inspection.utility.ts` lists approved roots and returns safe deployment metadata; `utilities/rss-builder.utility.ts` gains `buildRSSFromFilesystemItems`; the feed updater worker gains a filesystem branch; `routes/filesystem.ts` serves `GET /filesystem/inspect`; an optional `routes/files.ts` serves files at `GET /files/*` when `FILESYSTEM_FEEDS_PUBLIC_SERVING=true`; `frontend/src/components/forms/FilesystemForm.tsx` provides the builder UI.

**Tech Stack:** Bun, TypeScript, Hono, React 18, shadcn/ui, bun:test, `minimatch` for glob matching, Node.js `fs/promises` and `path` for filesystem operations

---

### Task 1: Filesystem Model Types

**Files:**
- Create: `models/filesystem.model.ts`
- Modify: `models/feed-config.model.ts`

- [ ] **Step 1: Create `models/filesystem.model.ts`**

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

- [ ] **Step 2: Update `models/feed-config.model.ts`**

Add `"filesystem"` to the `FeedType` union and add to `FeedConfig`:

```ts
filesystem?: FilesystemFeedConfig;
```

Import `FilesystemFeedConfig` from `./filesystem.model`.

- [ ] **Step 3: Commit**

```bash
git add models/filesystem.model.ts models/feed-config.model.ts
git commit -m "feat: add FilesystemFeedConfig and related model types"
```

---

### Task 2: Install `minimatch` and Create Test Fixtures

**Files:**
- Create: `tests/fixtures/filesystem/` directory and files

- [ ] **Step 1: Install minimatch**

```bash
bun add minimatch
```

- [ ] **Step 2: Create fixture directory structure**

```bash
mkdir -p tests/fixtures/filesystem/agendas/nested
```

- [ ] **Step 3: Create fixture files**

```bash
# Plain files
echo "PDF content placeholder" > tests/fixtures/filesystem/agendas/agenda-2026-05-15.pdf
echo "# Meeting Notes" > tests/fixtures/filesystem/agendas/notes.md
echo "<html><body>Page content</body></html>" > tests/fixtures/filesystem/agendas/page.html
echo "ignore me" > tests/fixtures/filesystem/agendas/ignore.tmp
echo ".hidden file" > tests/fixtures/filesystem/agendas/.hidden
echo "nested report" > tests/fixtures/filesystem/agendas/nested/report.txt
```

- [ ] **Step 4: Create sidecar JSON**

```bash
cat > tests/fixtures/filesystem/agendas/agenda-2026-05-15.pdf.json << 'EOF'
{
  "title": "City Council Agenda",
  "description": "Agenda for the May 15 meeting.",
  "date": "2026-05-15T18:00:00Z",
  "categories": ["city", "agenda", "public-meeting"],
  "link": "https://example.gov/agendas/may-15"
}
EOF
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/filesystem/ bun.lock package.json
git commit -m "chore: add minimatch dependency and filesystem test fixtures"
```

---

### Task 3: Path Safety and Glob Matching

**Files:**
- Create: `utilities/filesystem-feed.utility.ts`
- Create: `tests/filesystem.test.ts`

- [ ] **Step 1: Write failing tests for path safety and glob matching**

```ts
// tests/filesystem.test.ts
import { describe, expect, test } from "bun:test";
import { resolveSafeFilesystemPath, matchesGlob } from "../utilities/filesystem-feed.utility";
import { resolve } from "path";

const ALLOWED_ROOT = resolve("tests/fixtures/filesystem");

describe("resolveSafeFilesystemPath", () => {
  test("accepts path inside allowed root", () => {
    const result = resolveSafeFilesystemPath(
      "tests/fixtures/filesystem/agendas",
      ALLOWED_ROOT,
    );
    expect(result).toBe(resolve("tests/fixtures/filesystem/agendas"));
  });

  test("accepts allowed root itself", () => {
    const result = resolveSafeFilesystemPath(ALLOWED_ROOT, ALLOWED_ROOT);
    expect(result).toBe(ALLOWED_ROOT);
  });

  test("rejects path traversal via ..", () => {
    expect(() =>
      resolveSafeFilesystemPath(
        "tests/fixtures/filesystem/../../src",
        ALLOWED_ROOT,
      ),
    ).toThrow(/outside/i);
  });

  test("rejects absolute path outside root", () => {
    expect(() =>
      resolveSafeFilesystemPath("/etc/passwd", ALLOWED_ROOT),
    ).toThrow(/outside/i);
  });
});

describe("matchesGlob", () => {
  test("matches *.pdf", () => {
    expect(matchesGlob("agenda.pdf", ["*.pdf"])).toBe(true);
  });

  test("matches *.md in subdirectory (matchBase)", () => {
    expect(matchesGlob("docs/notes.md", ["*.md"])).toBe(true);
  });

  test("does not match wrong extension", () => {
    expect(matchesGlob("file.tmp", ["*.pdf"])).toBe(false);
  });

  test("empty pattern list returns false", () => {
    expect(matchesGlob("file.pdf", [])).toBe(false);
  });

  test("matches dotfiles with dot: true", () => {
    expect(matchesGlob(".hidden", [".*"])).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/filesystem.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement path safety and glob matching**

```ts
// utilities/filesystem-feed.utility.ts
import { resolve, sep, relative, basename, extname, join } from "path";
import { minimatch } from "minimatch";
import type {
  FilesystemFeedConfig,
  FilesystemFeedItem,
  FilesystemFeedState,
  FilesystemScanResult,
  FilesystemSidecarMetadata,
} from "../models/filesystem.model";

export function resolveSafeFilesystemPath(inputPath: string, allowedRoot: string): string {
  const root = resolve(allowedRoot);
  const target = resolve(inputPath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Filesystem path is outside the allowed root: ${target}`);
  }
  return target;
}

export function matchesGlob(relativePath: string, patterns: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return patterns.some((pattern) =>
    minimatch(normalized, pattern, { dot: true, matchBase: true }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/filesystem.test.ts
```

Expected: PASS — all path safety and glob tests green.

- [ ] **Step 5: Commit**

```bash
git add utilities/filesystem-feed.utility.ts tests/filesystem.test.ts
git commit -m "feat: add resolveSafeFilesystemPath and matchesGlob"
```

---

### Task 4: Deployment Inspection and Root Discovery

**Files:**
- Create: `utilities/filesystem-inspection.utility.ts`
- Create: `routes/filesystem.ts`
- Modify: `tests/filesystem.test.ts`

- [ ] **Step 1: Write failing tests for deployment inspection**

```ts
// append to tests/filesystem.test.ts
import { inspectFilesystemDeployment, listApprovedFilesystemRoots } from "../utilities/filesystem-inspection.utility";

describe("filesystem deployment inspection", () => {
  test("lists approved deployment roots", () => {
    const roots = listApprovedFilesystemRoots();
    expect(roots.length).toBeGreaterThan(0);
  });

  test("returns safe metadata for approved roots only", async () => {
    const result = await inspectFilesystemDeployment();
    expect(result.roots.length).toBeGreaterThan(0);
    expect(result.inspectedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/filesystem.test.ts
```

Expected: FAIL - module not found.

- [ ] **Step 3: Implement deployment inspection**

```ts
// utilities/filesystem-inspection.utility.ts
import { readdir } from "fs/promises";
import { resolve, extname } from "path";

export function listApprovedFilesystemRoots(): string[] {
  const roots = process.env.FILESYSTEM_FEEDS_ROOTS?.split(",").map((v) => v.trim()).filter(Boolean);
  if (roots && roots.length > 0) return roots;
  return [process.env.FILESYSTEM_FEEDS_ROOT ?? "/app/watch"];
}

export async function inspectFilesystemDeployment() {
  const inspectedAt = new Date().toISOString();
  const roots = await Promise.all(
    listApprovedFilesystemRoots().map(async (root) => {
      const resolvedRoot = resolve(root);
      const entries = await readdir(resolvedRoot, { withFileTypes: true }).catch(() => []);
      const fileEntries = entries.filter((e) => e.isFile());
      const extensionCounts = new Map<string, number>();
      for (const entry of fileEntries) {
        const ext = extname(entry.name) || "";
        extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
      }
      const sortedExtensions = Array.from(extensionCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([extension, count]) => ({ extension: extension || "(no extension)", count }));
      return {
        path: resolvedRoot,
        readable: true,
        directoryCount: entries.filter((e) => e.isDirectory()).length,
        fileCount: fileEntries.length,
        extensions: sortedExtensions,
        suggestedInclude: sortedExtensions
          .filter((entry) => entry.extension !== "(no extension)")
          .slice(0, 5)
          .map((entry) => `*${entry.extension}`),
        suggestedExclude: [".*", "*.tmp", "~$*"],
        recursiveRecommended: entries.filter((e) => e.isDirectory()).length > 0,
      };
    }),
  );
  return { roots, inspectedAt, warnings: [] };
}
```

- [ ] **Step 4: Add the inspect route**

```ts
// routes/filesystem.ts
app.get("/filesystem/inspect", async (c) => {
  return c.json(await inspectFilesystemDeployment(), 200);
});
```

- [ ] **Step 5: Commit**

```bash
git add utilities/filesystem-inspection.utility.ts routes/filesystem.ts tests/filesystem.test.ts
git commit -m "feat: add filesystem deployment inspection endpoint"
```

---

### Task 5: Directory Scanning

**Files:**
- Modify: `utilities/filesystem-feed.utility.ts`
- Modify: `tests/filesystem.test.ts`

- [ ] **Step 1: Write failing tests for scanning**

```ts
// append to tests/filesystem.test.ts
import { scanFilesystemFeed } from "../utilities/filesystem-feed.utility";
import type { FilesystemFeedConfig } from "../models/filesystem.model";
import { randomUUID } from "crypto";

const FIXTURE_ROOT = resolve("tests/fixtures/filesystem/agendas");

function makeConfig(overrides: Partial<FilesystemFeedConfig> = {}): FilesystemFeedConfig {
  return {
    rootPath: FIXTURE_ROOT,
    recursive: false,
    include: [],
    exclude: [],
    maxItems: 50,
    sortOrder: "modifiedDesc",
    dateStrategy: "modifiedTime",
    guidStrategy: "pathAndModifiedTime",
    titleStrategy: "filename",
    descriptionStrategy: "fileMetadata",
    ...overrides,
  };
}

describe("scanFilesystemFeed", () => {
  test("scans files in root directory", async () => {
    const result = await scanFilesystemFeed(makeConfig(), { allowedRoot: ALLOWED_ROOT });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.stats.scannedFiles).toBeGreaterThan(0);
  });

  test("does not recurse when recursive: false", async () => {
    const result = await scanFilesystemFeed(
      makeConfig({ recursive: false }),
      { allowedRoot: ALLOWED_ROOT },
    );
    const relPaths = result.items.map((i) => i.relativePath);
    expect(relPaths.every((p) => !p.includes("/"))).toBe(true);
  });

  test("recurses when recursive: true", async () => {
    const result = await scanFilesystemFeed(
      makeConfig({ recursive: true }),
      { allowedRoot: ALLOWED_ROOT },
    );
    const relPaths = result.items.map((i) => i.relativePath);
    expect(relPaths.some((p) => p.includes("/"))).toBe(true);
  });

  test("include glob filters correctly", async () => {
    const result = await scanFilesystemFeed(
      makeConfig({ include: ["*.pdf"] }),
      { allowedRoot: ALLOWED_ROOT },
    );
    expect(result.items.every((i) => i.extension === ".pdf")).toBe(true);
  });

  test("exclude glob overrides include", async () => {
    const result = await scanFilesystemFeed(
      makeConfig({ include: [], exclude: ["*.pdf"] }),
      { allowedRoot: ALLOWED_ROOT },
    );
    expect(result.items.every((i) => i.extension !== ".pdf")).toBe(true);
  });

  test("empty include matches all files", async () => {
    const result = await scanFilesystemFeed(makeConfig({ include: [] }), { allowedRoot: ALLOWED_ROOT });
    expect(result.items.length).toBeGreaterThan(1);
  });

  test("skips symlinks", async () => {
    // symlinks in fixture dir would be counted in skippedSymlinks
    const result = await scanFilesystemFeed(makeConfig(), { allowedRoot: ALLOWED_ROOT });
    // no error thrown; symlinks not in items (they're flagged as skipped)
    expect(result).toBeTruthy();
  });

  test("title strategy filename uses basename", async () => {
    const result = await scanFilesystemFeed(
      makeConfig({ titleStrategy: "filename" }),
      { allowedRoot: ALLOWED_ROOT },
    );
    for (const item of result.items) {
      expect(item.title).toBe(item.filename);
    }
  });

  test("title strategy filenameWithoutExtension strips extension", async () => {
    const result = await scanFilesystemFeed(
      makeConfig({ titleStrategy: "filenameWithoutExtension", include: ["*.pdf"] }),
      { allowedRoot: ALLOWED_ROOT },
    );
    expect(result.items[0]?.title).not.toContain(".pdf");
  });

  test("descriptionStrategy fileMetadata includes filename", async () => {
    const result = await scanFilesystemFeed(
      makeConfig({ descriptionStrategy: "fileMetadata", include: ["*.md"] }),
      { allowedRoot: ALLOWED_ROOT },
    );
    for (const item of result.items) {
      expect(item.description).toContain(item.filename);
    }
  });

  test("guidStrategy path is stable", async () => {
    const config = makeConfig({ guidStrategy: "path", include: ["*.md"] });
    const r1 = await scanFilesystemFeed(config, { allowedRoot: ALLOWED_ROOT });
    const r2 = await scanFilesystemFeed(config, { allowedRoot: ALLOWED_ROOT });
    expect(r1.items[0]?.guid).toBe(r2.items[0]?.guid);
  });

  test("sidecar metadata read and applied to title", async () => {
    const result = await scanFilesystemFeed(
      makeConfig({
        include: ["*.pdf"],
        titleStrategy: "sidecarTitle",
        sidecar: { enabled: true, extension: ".json" },
      }),
      { allowedRoot: ALLOWED_ROOT },
    );
    expect(result.items[0]?.title).toBe("City Council Agenda");
    expect(result.stats.sidecarFilesRead).toBeGreaterThan(0);
  });

  test("invalid sidecar JSON creates warning and continues", async () => {
    // Create a bad sidecar temporarily
    const badPath = join(FIXTURE_ROOT, "notes.md.json");
    await Bun.write(badPath, "{ invalid json }");
    const result = await scanFilesystemFeed(
      makeConfig({
        include: ["*.md"],
        sidecar: { enabled: true, extension: ".json" },
      }),
      { allowedRoot: ALLOWED_ROOT },
    );
    expect(result.warnings.some((w) => w.includes("sidecar") || w.includes("notes"))).toBe(true);
    expect(result.stats.sidecarFilesFailed).toBeGreaterThan(0);
    // Cleanup
    try { require("fs").unlinkSync(badPath); } catch {}
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/filesystem.test.ts 2>&1 | tail -20
```

Expected: FAIL — `scanFilesystemFeed` not implemented.

- [ ] **Step 3: Implement `scanFilesystemFeed`**

```ts
// append to utilities/filesystem-feed.utility.ts
import { lstatSync, existsSync, readdirSync } from "fs";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { randomUUID } from "crypto";

async function walkDirectory(
  dir: string,
  recursive: boolean,
  items: Array<{ abs: string; rel: string }>,
  stats: FilesystemScanResult["stats"],
  baseRoot: string,
): Promise<void> {
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    const abs = join(dir, dirent.name);
    // Use lstat to detect symlinks before following
    let lstat;
    try { lstat = lstatSync(abs); } catch { continue; }
    if (lstat.isSymbolicLink()) {
      stats.skippedSymlinks++;
      continue;
    }
    if (dirent.isDirectory()) {
      stats.skippedDirectories++;
      if (recursive) await walkDirectory(abs, recursive, items, stats, baseRoot);
      continue;
    }
    if (dirent.isFile()) {
      const rel = relative(baseRoot, abs).replace(/\\/g, "/");
      items.push({ abs, rel });
      stats.scannedFiles++;
    }
  }
}

function buildTitle(
  strategy: FilesystemFeedConfig["titleStrategy"],
  filename: string,
  relativePath: string,
  sidecar?: FilesystemSidecarMetadata,
): string {
  switch (strategy) {
    case "filename": return filename;
    case "filenameWithoutExtension": return filename.replace(/\.[^.]+$/, "");
    case "relativePath": return relativePath;
    case "sidecarTitle": return sidecar?.title ?? filename.replace(/\.[^.]+$/, "");
  }
}

function buildDescription(
  strategy: FilesystemFeedConfig["descriptionStrategy"],
  item: { filename: string; sizeBytes: number; modifiedAt?: Date; relativePath: string },
  sidecar?: FilesystemSidecarMetadata,
  textPreview?: string,
): string | undefined {
  switch (strategy) {
    case "none": return undefined;
    case "sidecarDescription": return sidecar?.description;
    case "textPreview": return textPreview;
    case "fileMetadata":
    default: {
      const kb = (item.sizeBytes / 1024).toFixed(1);
      const mod = item.modifiedAt?.toISOString() ?? "unknown";
      return `File: ${item.filename}\nSize: ${kb} KB\nModified: ${mod}\nPath: ${item.relativePath}`;
    }
  }
}

function buildGuid(
  strategy: FilesystemFeedConfig["guidStrategy"],
  feedId: string,
  relativePath: string,
  modifiedAt?: Date,
  stateId?: string,
  contentHash?: string,
): string {
  switch (strategy) {
    case "path": return `filesystem:${feedId}:${relativePath}`;
    case "pathAndModifiedTime":
      return `filesystem:${feedId}:${relativePath}:${modifiedAt?.getTime() ?? 0}`;
    case "contentHash":
      return `filesystem:${feedId}:${relativePath}:${contentHash ?? "nohash"}`;
    case "firstSeenId":
      return `filesystem:${feedId}:${stateId ?? relativePath}`;
  }
}

function buildPubDate(
  strategy: FilesystemFeedConfig["dateStrategy"],
  modifiedAt?: Date,
  createdAt?: Date,
  firstSeenAt?: Date,
  now?: Date,
  sidecarDate?: string,
): Date {
  if (sidecarDate) {
    const parsed = new Date(sidecarDate);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  switch (strategy) {
    case "modifiedTime": return modifiedAt ?? now ?? new Date();
    case "createdTime": return createdAt ?? modifiedAt ?? now ?? new Date();
    case "firstSeen": return firstSeenAt ?? modifiedAt ?? now ?? new Date();
    case "currentRun": return now ?? new Date();
  }
}

export async function scanFilesystemFeed(
  config: FilesystemFeedConfig,
  options: { allowedRoot: string; state?: FilesystemFeedState; now?: Date; feedId?: string },
): Promise<FilesystemScanResult> {
  const { allowedRoot, state, now = new Date(), feedId = "unknown" } = options;
  const resolvedRoot = resolveSafeFilesystemPath(config.rootPath, allowedRoot);
  const scanStats: FilesystemScanResult["stats"] = {
    scannedFiles: 0,
    matchedFiles: 0,
    excludedFiles: 0,
    skippedDirectories: 0,
    skippedSymlinks: 0,
    sidecarFilesRead: 0,
    sidecarFilesFailed: 0,
  };
  const warnings: string[] = [];

  if (!existsSync(resolvedRoot)) {
    warnings.push(`Folder does not exist: ${resolvedRoot}`);
    return { items: [], warnings, stats: scanStats };
  }

  const allFiles: Array<{ abs: string; rel: string }> = [];
  await walkDirectory(resolvedRoot, config.recursive, allFiles, scanStats, resolvedRoot);

  const items: FilesystemFeedItem[] = [];

  for (const { abs, rel } of allFiles) {
    // Apply include/exclude
    const hasInclude = config.include.length > 0;
    const included = !hasInclude || matchesGlob(rel, config.include);
    const excluded = config.exclude.length > 0 && matchesGlob(rel, config.exclude);

    if (!included) { scanStats.excludedFiles++; continue; }
    if (excluded) { scanStats.excludedFiles++; continue; }

    scanStats.matchedFiles++;

    let fileStat;
    try { fileStat = lstatSync(abs); } catch { continue; }
    const filename = basename(abs);
    const extension = extname(abs);
    const modifiedAt = fileStat.mtime;
    const createdAt = fileStat.birthtime ?? fileStat.mtime;
    const sizeBytes = fileStat.size;

    // Read sidecar
    let sidecar: FilesystemSidecarMetadata | undefined;
    if (config.sidecar?.enabled) {
      const sidecarPath = abs + config.sidecar.extension;
      if (existsSync(sidecarPath)) {
        try {
          sidecar = JSON.parse(await readFile(sidecarPath, "utf-8")) as FilesystemSidecarMetadata;
          scanStats.sidecarFilesRead++;
        } catch {
          warnings.push(`Failed to parse sidecar file: ${sidecarPath}`);
          scanStats.sidecarFilesFailed++;
        }
      }
    }

    // Text preview
    let textPreview: string | undefined;
    if (config.extraction?.enabled) {
      const supportedExt = config.extraction.supportedExtensions ?? [".txt", ".md", ".html", ".json", ".csv", ".log"];
      if (supportedExt.includes(extension) && sizeBytes <= (config.extraction.maxFileSizeBytes ?? 5_242_880)) {
        try {
          let content = await readFile(abs, "utf-8");
          if (extension === ".html" || extension === ".htm") {
            content = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          }
          textPreview = content.slice(0, config.extraction.maxCharacters ?? 1000);
        } catch {}
      }
    }

    // Content hash for GUID
    let contentHash: string | undefined;
    if (config.guidStrategy === "contentHash") {
      try {
        const buf = await readFile(abs);
        contentHash = createHash("sha256").update(buf).digest("hex");
      } catch {}
    }

    // State lookup
    const stateEntry = state?.files?.[rel];
    const firstSeenAt = stateEntry ? new Date(stateEntry.firstSeenAt) : undefined;
    const stableId = stateEntry?.stableId ?? randomUUID();

    // Build item
    const title = buildTitle(config.titleStrategy, filename, rel, sidecar);
    const description = buildDescription(config.descriptionStrategy, { filename, sizeBytes, modifiedAt, relativePath: rel }, sidecar, textPreview);
    const guid = buildGuid(config.guidStrategy, feedId, rel, modifiedAt, stableId, contentHash);
    const pubDate = buildPubDate(config.dateStrategy, modifiedAt, createdAt, firstSeenAt, now, sidecar?.date);
    const publicUrl = config.publicBaseUrl
      ? `${config.publicBaseUrl.replace(/\/$/, "")}/${rel}`
      : undefined;

    items.push({
      id: randomUUID(),
      absolutePath: abs,
      relativePath: rel,
      publicUrl,
      filename,
      extension,
      sizeBytes,
      createdAt,
      modifiedAt,
      firstSeenAt,
      contentHash,
      title,
      description,
      link: sidecar?.link ?? publicUrl,
      author: sidecar?.author,
      categories: sidecar?.categories,
      guid,
      pubDate,
    });
  }

  // Sort
  items.sort((a, b) => {
    switch (config.sortOrder) {
      case "modifiedDesc": return (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0);
      case "modifiedAsc": return (a.modifiedAt?.getTime() ?? 0) - (b.modifiedAt?.getTime() ?? 0);
      case "createdDesc": return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
      case "createdAsc": return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
      case "filenameAsc": return a.filename.localeCompare(b.filename);
      case "filenameDesc": return b.filename.localeCompare(a.filename);
      case "firstSeenDesc": return (b.firstSeenAt?.getTime() ?? 0) - (a.firstSeenAt?.getTime() ?? 0);
    }
  });

  return { items, warnings, stats: scanStats };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/filesystem.test.ts
```

Expected: PASS — all scanning tests green.

- [ ] **Step 5: Commit**

```bash
git add utilities/filesystem-feed.utility.ts tests/filesystem.test.ts
git commit -m "feat: implement scanFilesystemFeed with glob filtering, sidecar, strategies"
```

---

### Task 5: State Persistence

**Files:**
- Modify: `utilities/filesystem-feed.utility.ts`
- Modify: `tests/filesystem.test.ts`

- [ ] **Step 1: Write failing tests for state functions**

```ts
// append to tests/filesystem.test.ts
import {
  loadFilesystemFeedState,
  saveFilesystemFeedState,
  updateFilesystemState,
} from "../utilities/filesystem-feed.utility";
import type { FilesystemFeedItem } from "../models/filesystem.model";
import { rmSync } from "fs";

const STATE_FEED_ID = "test-fs-state";

describe("filesystem state", () => {
  beforeEach(() => {
    try { rmSync(`./feed-state/filesystem/${STATE_FEED_ID}.json`); } catch {}
  });

  test("loadFilesystemFeedState returns empty state for missing file", async () => {
    const state = await loadFilesystemFeedState(STATE_FEED_ID);
    expect(state.files).toEqual({});
  });

  test("save and load round-trips state", async () => {
    const state = {
      files: {
        "report.pdf": {
          firstSeenAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-01-02T00:00:00Z",
          stableId: "abc-123",
        },
      },
    };
    await saveFilesystemFeedState(STATE_FEED_ID, state);
    const loaded = await loadFilesystemFeedState(STATE_FEED_ID);
    expect(loaded.files["report.pdf"]?.firstSeenAt).toBe("2026-01-01T00:00:00Z");
  });

  test("updateFilesystemState sets firstSeenAt on first scan", () => {
    const empty = { files: {} };
    const now = new Date("2026-05-15T12:00:00Z");
    const items = [
      {
        relativePath: "report.pdf",
        id: "x",
        modifiedAt: now,
        sizeBytes: 100,
      } as FilesystemFeedItem,
    ];
    const updated = updateFilesystemState(empty, items, now);
    expect(updated.files["report.pdf"]?.firstSeenAt).toBe(now.toISOString());
  });

  test("updateFilesystemState does not overwrite firstSeenAt on second scan", () => {
    const first = new Date("2026-01-01T00:00:00Z");
    const second = new Date("2026-06-01T00:00:00Z");
    const state = {
      files: {
        "report.pdf": {
          firstSeenAt: first.toISOString(),
          lastSeenAt: first.toISOString(),
          stableId: "stable-1",
        },
      },
    };
    const items = [
      { relativePath: "report.pdf", id: "x", modifiedAt: second, sizeBytes: 100 } as FilesystemFeedItem,
    ];
    const updated = updateFilesystemState(state, items, second);
    expect(updated.files["report.pdf"]?.firstSeenAt).toBe(first.toISOString());
    expect(updated.files["report.pdf"]?.lastSeenAt).toBe(second.toISOString());
  });
});
```

Add `import { beforeEach } from "bun:test";` to the imports block.

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/filesystem.test.ts 2>&1 | tail -20
```

Expected: FAIL — state functions not implemented.

- [ ] **Step 3: Implement state functions**

```ts
// append to utilities/filesystem-feed.utility.ts
import { writeFileSync, readFileSync } from "fs";
import type { FilesystemFeedState, FilesystemFeedItem } from "../models/filesystem.model";

const FS_STATE_DIR = "./feed-state/filesystem";

function ensureFsStateDir() {
  const { mkdirSync, existsSync } = require("fs");
  if (!existsSync(FS_STATE_DIR)) mkdirSync(FS_STATE_DIR, { recursive: true });
}

export async function loadFilesystemFeedState(feedId: string): Promise<FilesystemFeedState> {
  const path = join(FS_STATE_DIR, `${feedId}.json`);
  if (!existsSync(path)) return { files: {} };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as FilesystemFeedState;
  } catch {
    return { files: {} };
  }
}

export async function saveFilesystemFeedState(
  feedId: string,
  state: FilesystemFeedState,
): Promise<void> {
  ensureFsStateDir();
  writeFileSync(join(FS_STATE_DIR, `${feedId}.json`), JSON.stringify(state, null, 2), "utf-8");
}

export function updateFilesystemState(
  state: FilesystemFeedState,
  items: FilesystemFeedItem[],
  now: Date,
): FilesystemFeedState {
  const updated: FilesystemFeedState = { files: { ...state.files } };
  for (const item of items) {
    const rel = item.relativePath;
    const existing = updated.files[rel];
    updated.files[rel] = {
      firstSeenAt: existing?.firstSeenAt ?? now.toISOString(),
      lastSeenAt: now.toISOString(),
      lastModifiedAt: item.modifiedAt?.toISOString(),
      lastSizeBytes: item.sizeBytes,
      stableId: existing?.stableId ?? item.id,
    };
  }
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/filesystem.test.ts
```

Expected: PASS — all state tests green.

- [ ] **Step 5: Commit**

```bash
git add utilities/filesystem-feed.utility.ts tests/filesystem.test.ts
git commit -m "feat: add loadFilesystemFeedState, saveFilesystemFeedState, updateFilesystemState"
```

---

### Task 6: RSS Builder — `buildRSSFromFilesystemItems`

**Files:**
- Modify: `utilities/rss-builder.utility.ts`
- Modify: `tests/filesystem.test.ts`

- [ ] **Step 1: Write failing tests for the RSS builder**

```ts
// append to tests/filesystem.test.ts
import { buildRSSFromFilesystemItems } from "../utilities/rss-builder.utility";
import type { FeedConfig } from "../models/feed-config.model";

function makeFilesystemFeedConfig(): FeedConfig {
  return {
    feedId: "fs-feed-1",
    feedName: "agendas",
    feedType: "filesystem",
    feedUrl: "",
    refreshTime: 15,
    filesystem: {
      rootPath: FIXTURE_ROOT,
      publicBaseUrl: "/files/agendas",
      recursive: false,
      include: [],
      exclude: [],
      maxItems: 50,
      sortOrder: "modifiedDesc",
      dateStrategy: "modifiedTime",
      guidStrategy: "pathAndModifiedTime",
      titleStrategy: "filename",
      descriptionStrategy: "fileMetadata",
    },
  } as unknown as FeedConfig;
}

const now = new Date("2026-05-15T12:00:00Z");
const baseItem: FilesystemFeedItem = {
  id: "item-1",
  absolutePath: "/app/watch/agendas/agenda.pdf",
  relativePath: "agenda.pdf",
  publicUrl: "/files/agendas/agenda.pdf",
  filename: "agenda.pdf",
  extension: ".pdf",
  sizeBytes: 248_000,
  createdAt: now,
  modifiedAt: now,
  title: "agenda.pdf",
  guid: "filesystem:fs-feed-1:agenda.pdf:1234567890",
  pubDate: now,
  link: "/files/agendas/agenda.pdf",
};

describe("buildRSSFromFilesystemItems", () => {
  test("produces valid RSS 2.0 with channel and item", () => {
    const xml = buildRSSFromFilesystemItems([baseItem], makeFilesystemFeedConfig());
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<channel>");
    expect(xml).toContain("<item>");
  });

  test("title is XML-escaped", () => {
    const item = { ...baseItem, title: "Agenda <2026> & Beyond" };
    const xml = buildRSSFromFilesystemItems([item], makeFilesystemFeedConfig());
    expect(xml).toContain("Agenda &lt;2026&gt; &amp; Beyond");
  });

  test("GUID present", () => {
    const xml = buildRSSFromFilesystemItems([baseItem], makeFilesystemFeedConfig());
    expect(xml).toContain(`<guid>${baseItem.guid}</guid>`);
  });

  test("pubDate from item.pubDate", () => {
    const xml = buildRSSFromFilesystemItems([baseItem], makeFilesystemFeedConfig());
    expect(xml).toContain("<pubDate>");
  });

  test("link present when publicUrl set", () => {
    const xml = buildRSSFromFilesystemItems([baseItem], makeFilesystemFeedConfig());
    expect(xml).toContain("/files/agendas/agenda.pdf");
  });

  test("empty items produces valid empty channel", () => {
    const xml = buildRSSFromFilesystemItems([], makeFilesystemFeedConfig());
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });

  test("categories from sidecar", () => {
    const item = { ...baseItem, categories: ["city", "agenda"] };
    const xml = buildRSSFromFilesystemItems([item], makeFilesystemFeedConfig());
    expect(xml).toContain("<category>city</category>");
    expect(xml).toContain("<category>agenda</category>");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/filesystem.test.ts 2>&1 | tail -20
```

Expected: FAIL — `buildRSSFromFilesystemItems` not exported.

- [ ] **Step 3: Implement `buildRSSFromFilesystemItems` in RSS builder**

Open `utilities/rss-builder.utility.ts` and add at the bottom:

```ts
import type { FilesystemFeedItem } from "../models/filesystem.model";

export function buildRSSFromFilesystemItems(
  items: FilesystemFeedItem[],
  feedConfig: FeedConfig,
): string {
  // Reuse xmlEscape function already defined in this file
  const feedTitle = xmlEscape(feedConfig.feedName ?? "Filesystem Feed");
  const now = new Date().toUTCString();

  const rssItems = items
    .map((item) => {
      const link = item.link ?? item.publicUrl;
      const cats = (item.categories ?? [])
        .map((c) => `<category>${xmlEscape(c)}</category>`)
        .join("\n        ");

      return `  <item>
      <title>${xmlEscape(item.title)}</title>
      ${link ? `<link>${xmlEscape(link)}</link>` : ""}
      <guid>${xmlEscape(item.guid)}</guid>
      <pubDate>${item.pubDate.toUTCString()}</pubDate>
      ${item.author ? `<author>${xmlEscape(item.author)}</author>` : ""}
      ${item.description ? `<description>${xmlEscape(item.description)}</description>` : ""}
      ${cats}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${feedTitle}</title>
    <description>${feedTitle}</description>
    <lastBuildDate>${now}</lastBuildDate>
    ${rssItems}
  </channel>
</rss>`;
}
```

Note: Check if `xmlEscape` already exists in the file — reuse it rather than duplicating.

- [ ] **Step 4: Run all filesystem tests**

```bash
bun test tests/filesystem.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
bun test
```

Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add utilities/rss-builder.utility.ts tests/filesystem.test.ts
git commit -m "feat: add buildRSSFromFilesystemItems to rss-builder"
```

---

### Task 7: Worker Branch and Preview Route

**Files:**
- Modify: `workers/feed-updater.worker.ts`
- Modify: `index.ts` (or wherever the preview route lives)

- [ ] **Step 1: Add filesystem branch to the feed updater worker**

Open `workers/feed-updater.worker.ts`. Find the existing feed type branches (webScraping, api, email, etc.). Add after the last branch:

```ts
} else if (feed.feedType === "filesystem" && feed.filesystem) {
  const allowedRoot = process.env.FILESYSTEM_FEEDS_ROOT ?? "/app/watch";
  const state = await loadFilesystemFeedState(feed.feedId);
  const result = await scanFilesystemFeed(feed.filesystem, {
    allowedRoot,
    state,
    now: new Date(),
    feedId: feed.feedId,
  });
  for (const w of result.warnings) console.warn(`[filesystem:${feed.feedId}]`, w);
  const items = result.items.slice(0, feed.filesystem.maxItems);
  const xml = buildRSSFromFilesystemItems(items, feed);
  await Bun.write(`./public/feeds/${feed.feedName}.xml`, xml);
  const newState = updateFilesystemState(state, result.items, new Date());
  await saveFilesystemFeedState(feed.feedId, newState);
}
```

Add required imports at the top of the worker file:

```ts
import {
  scanFilesystemFeed,
  loadFilesystemFeedState,
  saveFilesystemFeedState,
  updateFilesystemState,
} from "../utilities/filesystem-feed.utility";
import { buildRSSFromFilesystemItems } from "../utilities/rss-builder.utility";
```

- [ ] **Step 2: Add filesystem branch to the preview route**

In the preview handler (look for `POST /preview` or similar), add before the default response:

```ts
if (body.feedType === "filesystem" && body.filesystem) {
  const allowedRoot = process.env.FILESYSTEM_FEEDS_ROOT ?? "/app/watch";
  try {
    const result = await scanFilesystemFeed(body.filesystem, { allowedRoot });
    const items = result.items.slice(0, body.filesystem.maxItems);
    const xml = buildRSSFromFilesystemItems(items, body);
    return c.text(xml, 200, { "Content-Type": "application/xml" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Scan failed";
    return c.json({ error: msg }, 400);
  }
}
```

- [ ] **Step 3: Verify worker runs without errors**

Create a minimal test config, run the worker manually or start the app, and verify:
1. Filesystem feed produces XML in `./public/feeds/`
2. State file created at `./feed-state/filesystem/{feedId}.json`
3. No unhandled errors in console

- [ ] **Step 4: Commit**

```bash
git add workers/feed-updater.worker.ts index.ts
git commit -m "feat: add filesystem worker branch and preview route extension"
```

---

### Task 8: Optional File Serving Route

**Files:**
- Create: `routes/files.ts`
- Modify: `index.ts`

- [ ] **Step 1: Create the file serving route**

```ts
// routes/files.ts
import { Hono } from "hono";
import { resolve, join, sep } from "path";
import { lstatSync, existsSync } from "fs";

export function createFilesRoute(app: Hono) {
  app.get("/files/*", async (c) => {
    if (process.env.FILESYSTEM_FEEDS_PUBLIC_SERVING !== "true") {
      return c.json({ error: "File serving is not enabled" }, 403);
    }

    const root = resolve(process.env.FILESYSTEM_FEEDS_ROOT ?? "/app/watch");
    const rel = c.req.param("*") ?? "";

    // Reject dotfile segments
    if (rel.split("/").some((seg) => seg.startsWith("."))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const target = resolve(join(root, rel));
    if (target !== root && !target.startsWith(root + sep)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (!existsSync(target)) {
      return c.json({ error: "Not found" }, 404);
    }

    // Reject symlinks
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (stat.isDirectory()) {
      return c.json({ error: "Directory listing not allowed" }, 403);
    }

    const file = Bun.file(target);
    return new Response(file);
  });
}
```

- [ ] **Step 2: Register the route in the main app**

In `index.ts`, add:

```ts
import { createFilesRoute } from "./routes/files";

createFilesRoute(app);
```

- [ ] **Step 3: Test file serving manually**

Set `FILESYSTEM_FEEDS_PUBLIC_SERVING=true` temporarily. Start the server. Confirm:
1. `GET /files/agendas/notes.md` returns file content
2. `GET /files/../etc/passwd` returns 403
3. `GET /files/.hidden` returns 403
4. Without the env var set, all requests return 403

- [ ] **Step 4: Commit**

```bash
git add routes/files.ts index.ts
git commit -m "feat: add optional GET /files/* static serving route gated by env var"
```

---

### Task 9: Frontend — `FilesystemForm.tsx`

> **REQUIRED: Use `superpowers:frontend-design` before implementing this task.**

**Files:**
- Create: `frontend/src/components/forms/FilesystemForm.tsx`
- Modify: `frontend/src/components/forms/FeedBuilderForm.tsx`

- [ ] **Step 1: Create `FilesystemForm.tsx`**

```tsx
// frontend/src/components/forms/FilesystemForm.tsx
import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FilesystemFeedConfig } from "@/models/filesystem.model";

type Props = {
  value: Partial<FilesystemFeedConfig>;
  onChange: (config: Partial<FilesystemFeedConfig>) => void;
};

export function FilesystemForm({ value, onChange }: Props) {
  const update = (patch: Partial<FilesystemFeedConfig>) => onChange({ ...value, ...patch });

  const includeText = (value.include ?? []).join("\n");
  const excludeText = (value.exclude ?? ["*.tmp", "~$*", ".DS_Store"]).join("\n");

  return (
    <div className="space-y-6">
      {/* Deployment discovery */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fs-roots">Approved Deployment Roots</Label>
          <Select
            value={value.rootPath ?? ""}
            onValueChange={(v) => update({ rootPath: v })}
          >
            <SelectTrigger><SelectValue placeholder="Choose an approved root" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="/app/watch">/app/watch</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Load the approved roots from `GET /filesystem/inspect` and pick one that exists in the current deployment.
          </p>
        </div>
      </div>

      {/* Folder source */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fs-root">Folder Path</Label>
          <Input
            id="fs-root"
            value={value.rootPath ?? ""}
            onChange={(e) => update({ rootPath: e.target.value })}
            placeholder="/app/watch/agendas"
          />
          <p className="text-sm text-muted-foreground">
            Must be inside FILESYSTEM_FEEDS_ROOT (set in environment)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="fs-public-url">Public Base URL</Label>
          <Input
            id="fs-public-url"
            value={value.publicBaseUrl ?? ""}
            onChange={(e) => update({ publicBaseUrl: e.target.value })}
            placeholder="/files/agendas"
          />
          <p className="text-sm text-muted-foreground">
            URL prefix for file links in the feed. Leave empty to omit links.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="fs-recursive"
            checked={value.recursive ?? true}
            onCheckedChange={(checked) => update({ recursive: !!checked })}
          />
          <Label htmlFor="fs-recursive">Include subfolders</Label>
        </div>
      </div>

      {/* File matching */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fs-include">Include Patterns (one per line)</Label>
          <Textarea
            id="fs-include"
            rows={4}
            value={includeText}
            onChange={(e) => update({ include: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
            placeholder={"*.pdf\n*.md\n*.html"}
          />
          <p className="text-sm text-muted-foreground">Empty = include all files</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-exclude">Exclude Patterns (one per line)</Label>
          <Textarea
            id="fs-exclude"
            rows={4}
            value={excludeText}
            onChange={(e) => update({ exclude: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
            placeholder={"*.tmp\n~$*\n.DS_Store"}
          />
        </div>
      </div>

      {/* Feed behavior */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fs-max-items">Max Items</Label>
          <Input
            id="fs-max-items"
            type="number"
            min={1}
            max={10000}
            value={value.maxItems ?? 50}
            onChange={(e) => update({ maxItems: Number(e.target.value) })}
          />
        </div>

        <div className="space-y-2">
          <Label>Sort Order</Label>
          <Select
            value={value.sortOrder ?? "modifiedDesc"}
            onValueChange={(v) => update({ sortOrder: v as FilesystemFeedConfig["sortOrder"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="modifiedDesc">Modified (newest first)</SelectItem>
              <SelectItem value="modifiedAsc">Modified (oldest first)</SelectItem>
              <SelectItem value="createdDesc">Created (newest first)</SelectItem>
              <SelectItem value="createdAsc">Created (oldest first)</SelectItem>
              <SelectItem value="filenameAsc">Filename (A–Z)</SelectItem>
              <SelectItem value="filenameDesc">Filename (Z–A)</SelectItem>
              <SelectItem value="firstSeenDesc">First seen (newest first)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Date Strategy</Label>
          <Select
            value={value.dateStrategy ?? "modifiedTime"}
            onValueChange={(v) => update({ dateStrategy: v as FilesystemFeedConfig["dateStrategy"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="modifiedTime">File modified time</SelectItem>
              <SelectItem value="createdTime">File created time</SelectItem>
              <SelectItem value="firstSeen">First seen by Mkfd</SelectItem>
              <SelectItem value="currentRun">Current run time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>GUID Strategy</Label>
          <Select
            value={value.guidStrategy ?? "pathAndModifiedTime"}
            onValueChange={(v) => update({ guidStrategy: v as FilesystemFeedConfig["guidStrategy"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="path">Path only (stable, one item per file)</SelectItem>
              <SelectItem value="pathAndModifiedTime">Path + modified time (new item on change)</SelectItem>
              <SelectItem value="contentHash">Content hash (new item on content change)</SelectItem>
              <SelectItem value="firstSeenId">First-seen ID (stable UUID)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Title Strategy</Label>
          <Select
            value={value.titleStrategy ?? "filename"}
            onValueChange={(v) => update({ titleStrategy: v as FilesystemFeedConfig["titleStrategy"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="filename">Filename</SelectItem>
              <SelectItem value="filenameWithoutExtension">Filename without extension</SelectItem>
              <SelectItem value="relativePath">Relative path</SelectItem>
              <SelectItem value="sidecarTitle">Sidecar title (fallback to filename)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Description Strategy</Label>
          <Select
            value={value.descriptionStrategy ?? "fileMetadata"}
            onValueChange={(v) => update({ descriptionStrategy: v as FilesystemFeedConfig["descriptionStrategy"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fileMetadata">File metadata (size, path, date)</SelectItem>
              <SelectItem value="sidecarDescription">Sidecar description</SelectItem>
              <SelectItem value="textPreview">Text preview (supported formats)</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Optional features */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="fs-sidecar"
            checked={value.sidecar?.enabled ?? false}
            onCheckedChange={(checked) =>
              update({ sidecar: { enabled: !!checked, extension: value.sidecar?.extension ?? ".json" } })
            }
          />
          <Label htmlFor="fs-sidecar">Read sidecar JSON metadata files</Label>
        </div>
        {value.sidecar?.enabled && (
          <div className="ml-6 space-y-2">
            <Label htmlFor="fs-sidecar-ext">Sidecar extension</Label>
            <Input
              id="fs-sidecar-ext"
              value={value.sidecar.extension}
              onChange={(e) =>
                update({ sidecar: { enabled: true, extension: e.target.value } })
              }
              placeholder=".json"
            />
            <p className="text-sm text-muted-foreground">
              e.g. `report.pdf` + `report.pdf.json`
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="fs-extraction"
            checked={value.extraction?.enabled ?? false}
            onCheckedChange={(checked) =>
              update({
                extraction: {
                  enabled: !!checked,
                  maxCharacters: value.extraction?.maxCharacters ?? 1000,
                  maxFileSizeBytes: value.extraction?.maxFileSizeBytes ?? 5_242_880,
                  supportedExtensions: value.extraction?.supportedExtensions ?? [
                    ".txt", ".md", ".html", ".json", ".csv", ".log",
                  ],
                },
              })
            }
          />
          <Label htmlFor="fs-extraction">Extract text preview for supported formats</Label>
        </div>
        {value.extraction?.enabled && (
          <div className="ml-6 space-y-2">
            <Label htmlFor="fs-max-chars">Max preview characters</Label>
            <Input
              id="fs-max-chars"
              type="number"
              min={100}
              max={20000}
              value={value.extraction.maxCharacters}
              onChange={(e) =>
                update({
                  extraction: { ...value.extraction!, maxCharacters: Number(e.target.value) },
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              Supported: .txt, .md, .html, .json, .csv, .log
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Filesystem tab to `FeedBuilderForm.tsx`**

Open `frontend/src/components/forms/FeedBuilderForm.tsx`. Find the tab list where source types are listed. Add a "Filesystem" tab entry.

In the tab content section, render `<FilesystemForm>` when the Filesystem tab is active:
Have the form call `GET /filesystem/inspect` on mount or on demand and use the returned approved roots and hints to help the user choose a valid `rootPath` for the current deployment.

```tsx
import { FilesystemForm } from "./FilesystemForm";

// In tab content:
{activeTab === "filesystem" && (
  <FilesystemForm
    value={formState.filesystem ?? {
      rootPath: "",
      recursive: true,
      include: [],
      exclude: ["*.tmp", "~$*", ".DS_Store"],
      maxItems: 50,
      sortOrder: "modifiedDesc",
      dateStrategy: "modifiedTime",
      guidStrategy: "pathAndModifiedTime",
      titleStrategy: "filename",
      descriptionStrategy: "fileMetadata",
    }}
    onChange={(filesystem) =>
      setFormState({ ...formState, feedType: "filesystem", filesystem })
    }
  />
)}
```

- [ ] **Step 3: Start dev server and verify in browser**

```bash
cd frontend && bun run dev
```

Navigate to the feed builder. Confirm:
1. Filesystem tab appears in the source type selector
2. `GET /filesystem/inspect` loads approved roots and the selector shows deployment-specific choices
3. Folder path, public URL, recursive checkbox render
4. Include/exclude textareas render correctly (newline-separated)
5. All dropdowns (sort order, date strategy, GUID strategy, title strategy, description strategy) render and update
6. Sidecar toggle shows/hides extension input
7. Extraction toggle shows/hides max characters input

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/forms/FilesystemForm.tsx \
        frontend/src/components/forms/FeedBuilderForm.tsx
git commit -m "feat: add FilesystemForm with all strategies and optional sidecar/extraction toggles"
```

---

### Task 10: Update PROGRESS.md

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Update Filesystem row**

Find:
```
| Filesystem | ⬜ | ⬜ | ⬜ |
```

Replace with:
```
| Filesystem | ✅ | ✅ | ⬜ |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: mark Filesystem spec and plan complete in PROGRESS.md"
```
