import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CatalogManifest, CatalogSanitizeResult } from "../models/community-catalog.model";
import { clearCatalogCache, getCatalogFeed, getCatalogManifest } from "../utilities/community-catalog/catalog-client.utility";
import { sanitizeForCommunityCatalog } from "../utilities/community-catalog/catalog-sanitizer.utility";

let tempDirs: string[] = [];

afterEach(async () => {
  clearCatalogCache();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("community catalog", () => {
  test("CatalogManifest compiles", () => {
    const manifest: CatalogManifest = {
      schemaVersion: 1,
      updatedAt: "2026-05-24T00:00:00Z",
      feeds: [{
        id: "test-feed",
        title: "Test Feed",
        description: "A test feed.",
        category: "gaming",
        tags: ["test"],
        feedType: "webScraping",
        path: "feeds/gaming/test.yaml",
        requiresSecrets: false,
        requiresPrivateNetwork: false,
        schemaVersion: 2,
        catalogVersion: 1,
      }],
    };
    expect(manifest.feeds).toHaveLength(1);
  });

  test("CatalogSanitizeResult has all required fields", () => {
    const result: CatalogSanitizeResult = {
      eligible: true,
      sanitizedYaml: "feedType: webScraping",
      errors: [],
      warnings: [],
      removed: [],
    };
    expect(result.eligible).toBe(true);
  });

  test("loads manifest and feed details from catalog directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mkfd-catalog-"));
    tempDirs.push(dir);
    await mkdir(join(dir, "feeds", "news"), { recursive: true });
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-05-24T00:00:00Z",
      feeds: [{
        id: "news-feed",
        title: "News Feed",
        description: "Test",
        category: "news",
        tags: ["news"],
        feedType: "webScraping",
        path: "feeds/news/news-feed.yaml",
        requiresSecrets: false,
        requiresPrivateNetwork: false,
        schemaVersion: 2,
        catalogVersion: 1,
      }],
    }), "utf8");
    await writeFile(join(dir, "feeds/news/news-feed.yaml"), "schemaVersion: 2\nfeedName: News\nfeedType: webScraping\nrefreshTime: 60\nconfig:\n  baseUrl: https://example.com\narticle:\n  iterator:\n    selector: article\n", "utf8");

    const manifest = await getCatalogManifest({ catalogDir: dir, cacheMs: 0 });
    const detail = await getCatalogFeed("news-feed", { catalogDir: dir, cacheMs: 0 });

    expect(manifest.feeds[0].id).toBe("news-feed");
    expect(detail.config.feedName).toBe("News");
  });

  test("sanitizer removes private fields and rejects private URLs", () => {
    const result = sanitizeForCommunityCatalog({
      schemaVersion: 2,
      feedId: "local",
      feedName: "Local",
      feedType: "webScraping",
      refreshTime: 60,
      headers: { Authorization: "secret" },
      config: { baseUrl: "http://127.0.0.1:3000", headers: { Authorization: "secret" } },
      article: { iterator: { selector: "article" } },
    } as any, {
      title: "Local",
      description: "Local test",
      category: "dev",
      tags: ["dev"],
    });
    expect(result.eligible).toBe(false);
    expect(result.removed.map((item) => item.path)).toContain("headers");
    expect(result.removed.map((item) => item.path)).toContain("config.headers");
    expect(result.errors.some((issue) => issue.message.includes("Private network"))).toBe(true);
  });
});
