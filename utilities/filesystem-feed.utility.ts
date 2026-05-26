import { createHash } from "crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { FilesystemFeedConfig, FilesystemFeedItem, FilesystemFeedState, FilesystemScanResult, FilesystemSidecarMetadata } from "../models/filesystem.model";

const DEFAULT_STATE_DIR = join(__dirname, "../feed-state/filesystem");

export function resolveSafeFilesystemPath(inputPath: string, allowedRoot: string): string {
  const root = resolve(allowedRoot);
  const candidate = resolve(inputPath);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error("Filesystem feed path is outside the allowed root");
  }
  return candidate;
}

export function matchesGlob(path: string, patterns: string[]): boolean {
  if (!patterns.length) return true;
  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`(^|/)${escaped}$`).test(path);
  });
}

export async function scanFilesystemFeed(config: FilesystemFeedConfig, allowedRoot = process.env.FILESYSTEM_FEEDS_ROOT ?? process.cwd(), feedId = "preview"): Promise<FilesystemScanResult> {
  const rootPath = resolveSafeFilesystemPath(config.rootPath, allowedRoot);
  const state = await loadFilesystemState(feedId);
  const warnings: string[] = [];
  const stats = { scannedFiles: 0, matchedFiles: 0, excludedFiles: 0, skippedDirectories: 0, skippedSymlinks: 0, sidecarFilesRead: 0, sidecarFilesFailed: 0 };
  const files = await listFiles(rootPath, config.recursive, stats);
  const now = new Date();
  const items: FilesystemFeedItem[] = [];
  for (const filePath of files) {
    const rel = relative(rootPath, filePath).replace(/\\/g, "/");
    stats.scannedFiles++;
    if (!matchesGlob(rel, config.include.length ? config.include : ["*"]) || (config.exclude.length > 0 && matchesGlob(rel, config.exclude))) {
      stats.excludedFiles++;
      continue;
    }
    const fileStat = await stat(filePath);
    const stableId = state.files[rel]?.stableId ?? createHash("sha256").update(rel).digest("hex");
    const firstSeenAt = state.files[rel]?.firstSeenAt ? new Date(state.files[rel].firstSeenAt) : now;
    let sidecar: FilesystemSidecarMetadata = {};
    if (config.sidecar?.enabled) {
      try {
        sidecar = JSON.parse(await readFile(`${filePath}${config.sidecar.extension}`, "utf8"));
        stats.sidecarFilesRead++;
      } catch {
        stats.sidecarFilesFailed++;
      }
    }
    const contentHash = config.guidStrategy === "contentHash" ? createHash("sha256").update(await readFile(filePath)).digest("hex") : undefined;
    const textPreview = config.extraction?.enabled && fileStat.size <= config.extraction.maxFileSizeBytes
      ? (await readFile(filePath, "utf8").catch(() => "")).slice(0, config.extraction.maxCharacters)
      : undefined;
    const filename = basename(filePath);
    const extension = extname(filePath).replace(/^\./, "");
    const pubDate = sidecar.date ? new Date(sidecar.date) : config.dateStrategy === "createdTime" ? fileStat.birthtime : config.dateStrategy === "firstSeen" ? firstSeenAt : config.dateStrategy === "currentRun" ? now : fileStat.mtime;
    const title = sidecar.title && config.titleStrategy === "sidecarTitle"
      ? sidecar.title
      : config.titleStrategy === "filenameWithoutExtension"
        ? filename.replace(/\.[^.]+$/, "")
        : config.titleStrategy === "relativePath" ? rel : filename;
    const guid = sidecar.guid ?? (config.guidStrategy === "pathAndModifiedTime" ? `${rel}:${fileStat.mtimeMs}` : config.guidStrategy === "contentHash" ? contentHash! : config.guidStrategy === "firstSeenId" ? stableId : rel);
    items.push({
      id: stableId,
      absolutePath: filePath,
      relativePath: rel,
      publicUrl: config.publicBaseUrl ? `${config.publicBaseUrl.replace(/\/$/, "")}/${rel}` : sidecar.link,
      filename,
      extension,
      sizeBytes: fileStat.size,
      createdAt: fileStat.birthtime,
      modifiedAt: fileStat.mtime,
      firstSeenAt,
      contentHash,
      title,
      description: config.descriptionStrategy === "sidecarDescription" ? sidecar.description : config.descriptionStrategy === "textPreview" ? textPreview : config.descriptionStrategy === "fileMetadata" ? `${rel} (${fileStat.size} bytes)` : undefined,
      link: sidecar.link ?? (config.publicBaseUrl ? `${config.publicBaseUrl.replace(/\/$/, "")}/${rel}` : undefined),
      author: sidecar.author,
      categories: sidecar.categories,
      guid,
      pubDate,
    });
    state.files[rel] = { firstSeenAt: firstSeenAt.toISOString(), lastSeenAt: now.toISOString(), lastModifiedAt: fileStat.mtime.toISOString(), lastSizeBytes: fileStat.size, stableId };
  }
  await saveFilesystemState(feedId, state);
  stats.matchedFiles = items.length;
  return { items: sortItems(items, config.sortOrder).slice(0, config.maxItems), warnings, stats };
}

export async function loadFilesystemState(feedId: string, dir = DEFAULT_STATE_DIR): Promise<FilesystemFeedState> {
  const path = join(dir, `${feedId}.json`);
  if (!existsSync(path)) return { files: {} };
  return JSON.parse(await readFile(path, "utf8"));
}

async function saveFilesystemState(feedId: string, state: FilesystemFeedState, dir = DEFAULT_STATE_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${feedId}.json`), JSON.stringify(state, null, 2), "utf8");
}

async function listFiles(root: string, recursive: boolean, stats: FilesystemScanResult["stats"]): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isSymbolicLink()) { stats.skippedSymlinks++; continue; }
    if (entry.isDirectory()) {
      if (recursive) out.push(...await listFiles(full, recursive, stats));
      else stats.skippedDirectories++;
    } else if (entry.isFile()) out.push(full);
  }
  return out;
}

function sortItems(items: FilesystemFeedItem[], sortOrder: FilesystemFeedConfig["sortOrder"]): FilesystemFeedItem[] {
  return [...items].sort((a, b) => {
    if (sortOrder === "filenameAsc") return a.filename.localeCompare(b.filename);
    if (sortOrder === "filenameDesc") return b.filename.localeCompare(a.filename);
    const at = sortOrder.startsWith("created") ? a.createdAt?.getTime() ?? 0 : sortOrder === "firstSeenDesc" ? a.firstSeenAt?.getTime() ?? 0 : a.modifiedAt?.getTime() ?? 0;
    const bt = sortOrder.startsWith("created") ? b.createdAt?.getTime() ?? 0 : sortOrder === "firstSeenDesc" ? b.firstSeenAt?.getTime() ?? 0 : b.modifiedAt?.getTime() ?? 0;
    return sortOrder.endsWith("Asc") ? at - bt : bt - at;
  });
}
