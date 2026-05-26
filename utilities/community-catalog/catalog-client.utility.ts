import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import * as yaml from "js-yaml";
import type { CatalogFeedDetail, CatalogManifest, CatalogManifestEntry } from "../../models/community-catalog.model";
import { hasFeedTemplate } from "../feed-template.utility";

const DEFAULT_CATALOG_DIR = join(__dirname, "../../community-catalog");
const DEFAULT_CACHE_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

let manifestCache: CacheEntry<CatalogManifest> | null = null;
const feedCache = new Map<string, CacheEntry<CatalogFeedDetail>>();

export type CatalogClientOptions = {
  catalogDir?: string;
  cacheMs?: number;
};

function resolveCatalogPath(catalogDir: string, relativePath: string): string {
  const fullPath = normalize(join(catalogDir, relativePath));
  const normalizedRoot = normalize(catalogDir);
  if (!fullPath.startsWith(normalizedRoot)) {
    throw new Error("Catalog path escapes catalog root");
  }
  return fullPath;
}

export function clearCatalogCache(): void {
  manifestCache = null;
  feedCache.clear();
}

export async function getCatalogManifest(options: CatalogClientOptions = {}): Promise<CatalogManifest> {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const now = Date.now();
  if (manifestCache && manifestCache.expiresAt > now) return manifestCache.value;

  const catalogDir = options.catalogDir ?? DEFAULT_CATALOG_DIR;
  const raw = await readFile(join(catalogDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(raw) as CatalogManifest;
  manifestCache = { value: manifest, expiresAt: now + cacheMs };
  return manifest;
}

export async function getCatalogEntry(id: string, options: CatalogClientOptions = {}): Promise<CatalogManifestEntry> {
  const manifest = await getCatalogManifest(options);
  const entry = manifest.feeds.find((feed) => feed.id === id);
  if (!entry) throw new Error(`Catalog feed not found: ${id}`);
  return entry;
}

export async function getCatalogFeed(id: string, options: CatalogClientOptions = {}): Promise<CatalogFeedDetail> {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const now = Date.now();
  const cacheKey = `${options.catalogDir ?? DEFAULT_CATALOG_DIR}:${id}`;
  const cached = feedCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const catalogDir = options.catalogDir ?? DEFAULT_CATALOG_DIR;
  const entry = await getCatalogEntry(id, options);
  const yamlPath = resolveCatalogPath(catalogDir, entry.path);
  const yamlText = await readFile(yamlPath, "utf8");
  const config = yaml.load(yamlText) as Record<string, unknown>;
  const detail: CatalogFeedDetail = {
    entry,
    yaml: yamlText,
    config,
    template: hasFeedTemplate(config) ? config.template : undefined,
  };
  feedCache.set(cacheKey, { value: detail, expiresAt: now + cacheMs });
  return detail;
}
