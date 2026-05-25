import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeMetadata, patchMetadata, patchEnabled, detectPlainSensitive } from "../utilities/config-metadata.utility";

const TEST_DIR = "./test-meta-tmp";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "feed-a.yaml"), "feedId: feed-a\nfeedName: Feed A\nfeedType: webScraping\nconfig:\n  baseUrl: https://example.com\n");
  writeFileSync(join(TEST_DIR, "plain-secret.yaml"), "feedId: ps\nfeedName: PS\nfeedType: rest\nconfig:\n  headers:\n    Authorization: Bearer hardcoded-token\n");
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("normalizeMetadata", () => {
  it("adds empty metadata block when missing", () => {
    const config: any = { feedId: "x", feedName: "X", feedType: "webScraping" };
    const result = normalizeMetadata(config);
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.tags).toEqual([]);
    expect(result.metadata!.favorite).toBe(false);
  });
  it("preserves existing metadata fields", () => {
    const config: any = { feedId: "x", metadata: { tags: ["a"], favorite: true } };
    const result = normalizeMetadata(config);
    expect(result.metadata!.tags).toEqual(["a"]);
    expect(result.metadata!.favorite).toBe(true);
  });
});

describe("patchMetadata", () => {
  it("updates tags without destroying config", async () => {
    const result = await patchMetadata("feed-a", { tags: ["gov", "local"] }, TEST_DIR);
    expect(result.metadata!.tags).toEqual(["gov", "local"]);
    expect((result as any).feedId).toBe("feed-a");
    expect((result as any).config?.baseUrl).toBe("https://example.com");
  });
  it("updates category", async () => {
    const result = await patchMetadata("feed-a", { category: "civic" }, TEST_DIR);
    expect(result.metadata!.category).toBe("civic");
  });
  it("updates favorite", async () => {
    const result = await patchMetadata("feed-a", { favorite: true }, TEST_DIR);
    expect(result.metadata!.favorite).toBe(true);
  });
});

describe("patchEnabled", () => {
  it("sets enabled to false", async () => {
    const result = await patchEnabled("feed-a", false, TEST_DIR);
    expect((result as any).enabled).toBe(false);
  });
  it("sets enabled to true", async () => {
    await patchEnabled("feed-a", false, TEST_DIR);
    const result = await patchEnabled("feed-a", true, TEST_DIR);
    expect((result as any).enabled).toBe(true);
  });
});

describe("detectPlainSensitive", () => {
  it("detects plain Authorization header", async () => {
    const { readFeedConfig } = await import("../utilities/config-manager.utility");
    const config = await readFeedConfig("plain-secret", TEST_DIR);
    expect(detectPlainSensitive(config as any)).toBe(true);
  });
  it("returns false for clean config", async () => {
    const { readFeedConfig } = await import("../utilities/config-manager.utility");
    const config = await readFeedConfig("feed-a", TEST_DIR);
    expect(detectPlainSensitive(config as any)).toBe(false);
  });
});
