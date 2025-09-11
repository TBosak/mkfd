import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

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