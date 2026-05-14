import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const FEED_HISTORY_DIR = "./feed-history";

/**
 * Ensures the feed history directory exists
 */
export function ensureFeedHistoryDir() {
  if (!existsSync(FEED_HISTORY_DIR)) {
    mkdirSync(FEED_HISTORY_DIR, { recursive: true });
  }
}

/**
 * Stores the current RSS XML for a feed to track changes
 */
export async function storeFeedHistory(feedId: string, rssXml: string): Promise<void> {
  ensureFeedHistoryDir();
  const historyPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
  try {
    await writeFile(historyPath, rssXml, "utf8");
  } catch (error) {
    console.error(`Error storing feed history for ${feedId}:`, error);
  }
}

/**
 * Retrieves the previous RSS XML for a feed
 */
export async function getPreviousFeedHistory(feedId: string): Promise<string | null> {
  ensureFeedHistoryDir();
  const historyPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
  try {
    if (existsSync(historyPath)) {
      return await readFile(historyPath, "utf8");
    }
    return null;
  } catch (error) {
    console.error(`Error reading feed history for ${feedId}:`, error);
    return null;
  }
}

/**
 * Clears feed history for a specific feed
 */
export async function clearFeedHistory(feedId: string): Promise<void> {
  const historyPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
  try {
    if (existsSync(historyPath)) {
      const { unlink } = await import("fs/promises");
      await unlink(historyPath);
    }
  } catch (error) {
    console.error(`Error clearing feed history for ${feedId}:`, error);
  }
}

/**
 * Produces a stable SHA-256 fingerprint for an RSS item, excluding the date
 * field so that items re-fetched on different days hash identically.
 */
export function makeItemKey(item: Record<string, unknown>): string {
  const { date, ...rest } = item;
  const sorted = Object.fromEntries(
    Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))
  );
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/**
 * Loads the per-feed date index from disk.
 * Returns an empty Map when no index file exists yet.
 */
export async function loadDateIndex(feedId: string): Promise<Map<string, string>> {
  ensureFeedHistoryDir();
  const indexPath = join(FEED_HISTORY_DIR, `${feedId}.dates.json`);
  try {
    if (existsSync(indexPath)) {
      const raw = await readFile(indexPath, "utf8");
      return new Map(Object.entries(JSON.parse(raw)));
    }
  } catch (error) {
    console.error(`Error loading date index for ${feedId}:`, error);
  }
  return new Map();
}

/**
 * Persists the per-feed date index to disk, overwriting any existing file.
 */
export async function saveDateIndex(feedId: string, index: Map<string, string>): Promise<void> {
  ensureFeedHistoryDir();
  const indexPath = join(FEED_HISTORY_DIR, `${feedId}.dates.json`);
  try {
    await writeFile(indexPath, JSON.stringify(Object.fromEntries(index)), "utf8");
  } catch (error) {
    console.error(`Error saving date index for ${feedId}:`, error);
  }
}