import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  listFeedConfigs, readFeedConfig, writeFeedConfig, deleteFeedConfig,
  duplicateFeedConfig, exportFeedConfig, safeFeedId, assertSafeFeedId,
} from "../utilities/config-manager.utility";

const TEST_DIR = "./test-configs-tmp";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "my-feed.yaml"), "feedId: my-feed\nfeedName: My Feed\nfeedType: webScraping\n");
  writeFileSync(join(TEST_DIR, "other-feed.yaml"), "feedId: other-feed\nfeedName: Other\nfeedType: rest\n");
  writeFileSync(join(TEST_DIR, "notayaml.txt"), "ignored");
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("listFeedConfigs", () => {
  it("returns only .yaml files", async () => {
    const list = await listFeedConfigs(TEST_DIR);
    expect(list.length).toBe(2);
    expect(list.every(f => f.filename.endsWith(".yaml"))).toBe(true);
  });
  it("derives id from filename", async () => {
    const list = await listFeedConfigs(TEST_DIR);
    const ids = list.map(f => f.id).sort();
    expect(ids).toEqual(["my-feed", "other-feed"]);
  });
});

describe("readFeedConfig", () => {
  it("parses YAML into object", async () => {
    const config = await readFeedConfig("my-feed", TEST_DIR);
    expect(config.feedId).toBe("my-feed");
    expect(config.feedType).toBe("webScraping");
  });
  it("throws on missing config", async () => {
    expect(readFeedConfig("nonexistent", TEST_DIR)).rejects.toThrow();
  });
});

describe("writeFeedConfig", () => {
  it("writes YAML file", async () => {
    await writeFeedConfig("new-feed", { feedId: "new-feed", feedName: "New", feedType: "email" } as any, TEST_DIR);
    const back = await readFeedConfig("new-feed", TEST_DIR);
    expect(back.feedId).toBe("new-feed");
  });
});

describe("deleteFeedConfig", () => {
  it("removes the YAML file", async () => {
    await deleteFeedConfig("my-feed", TEST_DIR);
    expect(existsSync(join(TEST_DIR, "my-feed.yaml"))).toBe(false);
  });
  it("throws on missing config", async () => {
    expect(deleteFeedConfig("ghost", TEST_DIR)).rejects.toThrow();
  });
});

describe("duplicateFeedConfig", () => {
  it("creates a -copy file", async () => {
    const result = await duplicateFeedConfig("my-feed", TEST_DIR);
    expect(result.id).toBe("my-feed-copy");
    expect(existsSync(join(TEST_DIR, "my-feed-copy.yaml"))).toBe(true);
  });
  it("avoids collision with -copy-2", async () => {
    await duplicateFeedConfig("my-feed", TEST_DIR);
    const result = await duplicateFeedConfig("my-feed", TEST_DIR);
    expect(result.id).toBe("my-feed-copy-2");
  });
});

describe("exportFeedConfig", () => {
  it("returns raw YAML string", async () => {
    const yaml = await exportFeedConfig("my-feed", TEST_DIR);
    expect(yaml).toContain("feedId: my-feed");
  });
});

describe("safeFeedId", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(safeFeedId("My Feed Name")).toBe("my-feed-name");
  });
  it("strips disallowed characters", () => {
    expect(safeFeedId("feed/../../etc")).toBe("feed-etc");
  });
  it("strips .yaml extension", () => {
    expect(safeFeedId("foo.yaml")).toBe("foo");
  });
});

describe("assertSafeFeedId", () => {
  it("throws on path traversal", () => {
    expect(() => assertSafeFeedId("../etc/passwd")).toThrow("Invalid feedId");
  });
  it("throws on slash", () => {
    expect(() => assertSafeFeedId("feed/bad")).toThrow("Invalid feedId");
  });
  it("throws on dot", () => {
    expect(() => assertSafeFeedId(".hidden")).toThrow("Invalid feedId");
  });
  it("allows valid feed id", () => {
    expect(() => assertSafeFeedId("my-feed_123")).not.toThrow();
  });
});
