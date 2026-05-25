import { readFeedConfig, writeFeedConfig } from "./config-manager.utility";
import type { FeedConfig } from "../models/feed-config.model";
import type { FeedMetadata } from "../models/feed-metadata.model";
import { join } from "node:path";

const SENSITIVE_KEYS = /password|token|secret|authorization|api[_-]?key|bearer/i;
const DEFAULT_CONFIGS_DIR = join(__dirname, "../configs");

export function normalizeMetadata(config: any): any {
  const meta = config.metadata ?? {};
  return {
    ...config,
    metadata: { tags: [], favorite: false, ...meta },
  };
}

export async function patchMetadata(id: string, patch: Partial<FeedMetadata>, dir: string = DEFAULT_CONFIGS_DIR): Promise<any> {
  const config = await readFeedConfig(id, dir);
  const normalized = normalizeMetadata(config);
  const updated = { ...normalized, metadata: { ...normalized.metadata, ...patch } };
  await writeFeedConfig(id, updated as FeedConfig, dir);
  return updated;
}

export async function patchEnabled(id: string, enabled: boolean, dir: string = DEFAULT_CONFIGS_DIR): Promise<any> {
  const config = await readFeedConfig(id, dir);
  const updated = { ...config, enabled };
  await writeFeedConfig(id, updated as FeedConfig, dir);
  return updated;
}

export function detectPlainSensitive(config: any): boolean {
  return checkObject(config);
}

function checkObject(obj: any): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key) && typeof val === "string" && val.length > 0) return true;
    if (typeof val === "object" && checkObject(val)) return true;
  }
  return false;
}
