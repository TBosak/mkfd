import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";
import type { FeedConfig } from "../models/feed-config.model";

const DEFAULT_CONFIGS_DIR = join(__dirname, "../configs");

export async function listFeedConfigs(dir: string = DEFAULT_CONFIGS_DIR): Promise<{ id: string; filename: string }[]> {
  const files = await readdir(dir);
  return files.filter((f) => f.endsWith(".yaml")).map((f) => ({ id: f.replace(/\.yaml$/, ""), filename: f }));
}

export async function readFeedConfig(id: string, dir: string = DEFAULT_CONFIGS_DIR): Promise<FeedConfig & Record<string, unknown>> {
  assertSafeFeedId(id);
  const path = join(dir, `${id}.yaml`);
  if (!existsSync(path)) throw new Error(`Feed config not found: ${id}`);
  const raw = await readFile(path, "utf8");
  return yaml.load(raw) as FeedConfig & Record<string, unknown>;
}

export async function writeFeedConfig(id: string, config: FeedConfig, dir: string = DEFAULT_CONFIGS_DIR): Promise<void> {
  assertSafeFeedId(id);
  const path = join(dir, `${id}.yaml`);
  await writeFile(path, yaml.dump(config), "utf8");
}

export async function deleteFeedConfig(id: string, dir: string = DEFAULT_CONFIGS_DIR): Promise<void> {
  assertSafeFeedId(id);
  const path = join(dir, `${id}.yaml`);
  if (!existsSync(path)) throw new Error(`Feed config not found: ${id}`);
  await unlink(path);
}

export async function duplicateFeedConfig(id: string, dir: string = DEFAULT_CONFIGS_DIR): Promise<{ id: string; filename: string }> {
  const config = await readFeedConfig(id, dir);
  let newId = `${id}-copy`;
  let counter = 2;
  while (existsSync(join(dir, `${newId}.yaml`))) {
    newId = `${id}-copy-${counter++}`;
  }
  const newConfig = { ...config, feedId: newId, feedName: `${(config as any).feedName} (copy)` };
  await writeFeedConfig(newId, newConfig as FeedConfig, dir);
  return { id: newId, filename: `${newId}.yaml` };
}

export async function exportFeedConfig(id: string, dir: string = DEFAULT_CONFIGS_DIR): Promise<string> {
  assertSafeFeedId(id);
  const path = join(dir, `${id}.yaml`);
  if (!existsSync(path)) throw new Error(`Feed config not found: ${id}`);
  return readFile(path, "utf8");
}

export function safeFeedId(raw: string): string {
  return raw
    .replace(/\.yaml$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function assertSafeFeedId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid feedId: ${id}`);
  }
}
