import { readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { FeedHistoryStore } from "../lib/analytics/db";

const FEED_HISTORY_DIR = "./feed-history";

let _store: FeedHistoryStore | null = null;

/**
 * Sets the SQLite-backed feed history store. Once set, all operations use the
 * DB store with file-based lazy migration as a fallback for missing entries.
 */
export function setFeedHistoryStore(store: FeedHistoryStore): void {
  _store = store;
}

/**
 * Ensures the feed history directory exists
 */
export function ensureFeedHistoryDir(): void {
  if (!existsSync(FEED_HISTORY_DIR)) {
    mkdirSync(FEED_HISTORY_DIR, { recursive: true });
  }
}

/**
 * Stores the current RSS XML (or items JSON) for a feed to track changes.
 */
export async function storeFeedHistory(feedId: string, snapshotData: string, format = "items_json"): Promise<void> {
  if (_store) {
    await _store.storeFeedHistory(feedId, snapshotData, format);
    return;
  }
  // File-based fallback: write as .xml regardless of format (legacy behaviour)
  ensureFeedHistoryDir();
  const historyPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
  try {
    await writeFile(historyPath, snapshotData, "utf8");
  } catch (error) {
    console.error("Error storing feed history for %s:", feedId, error);
  }
}

/**
 * Retrieves the previous snapshot for a feed.
 */
export async function getPreviousFeedHistory(feedId: string): Promise<string | null> {
  if (_store) {
    const fromDb = await _store.getPreviousFeedHistory(feedId);
    if (fromDb !== null) return fromDb;
    // Lazy migration: check legacy file
    const xmlPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
    if (existsSync(xmlPath)) {
      try {
        const xml = await readFile(xmlPath, "utf8");
        await _store.storeFeedHistory(feedId, xml, "legacy_xml");
        return xml;
      } catch { /* fall through */ }
    }
    return null;
  }
  // File-based fallback
  ensureFeedHistoryDir();
  const historyPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
  try {
    if (existsSync(historyPath)) {
      return await readFile(historyPath, "utf8");
    }
    return null;
  } catch (error) {
    console.error("Error reading feed history for %s:", feedId, error);
    return null;
  }
}

/**
 * Clears feed history for a specific feed.
 */
export async function clearFeedHistory(feedId: string): Promise<void> {
  if (_store) {
    await _store.clearFeedHistory(feedId);
  }
  const xmlPath = join(FEED_HISTORY_DIR, `${feedId}.xml`);
  if (existsSync(xmlPath)) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(xmlPath);
    } catch (error) {
      console.error("Error clearing feed history for %s:", feedId, error);
    }
  }
}

/**
 * Loads the per-feed date index.
 * Returns an empty Map when no index exists yet.
 */
export async function loadDateIndex(feedId: string): Promise<Map<string, string>> {
  if (_store) {
    const fromDb = await _store.loadDateIndex(feedId);
    if (fromDb.size > 0) return fromDb;
    // Lazy migration: check legacy .dates.json file
    const jsonPath = join(FEED_HISTORY_DIR, `${feedId}.dates.json`);
    if (existsSync(jsonPath)) {
      try {
        const raw = await readFile(jsonPath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, string>;
        const index = new Map(Object.entries(parsed));
        await _store.saveDateIndex(feedId, index);
        return index;
      } catch { /* fall through */ }
    }
    return new Map();
  }
  // File-based fallback
  ensureFeedHistoryDir();
  const indexPath = join(FEED_HISTORY_DIR, `${feedId}.dates.json`);
  try {
    if (existsSync(indexPath)) {
      const raw = await readFile(indexPath, "utf8");
      return new Map(Object.entries(JSON.parse(raw)));
    }
  } catch (error) {
    console.error("Error loading date index for %s:", feedId, error);
  }
  return new Map();
}

/**
 * Persists the per-feed date index, overwriting any existing file (file path)
 * or upserting into SQLite (store path).
 */
export async function saveDateIndex(feedId: string, index: Map<string, string>): Promise<void> {
  if (_store) {
    await _store.saveDateIndex(feedId, index);
    return;
  }
  // File-based fallback
  ensureFeedHistoryDir();
  const indexPath = join(FEED_HISTORY_DIR, `${feedId}.dates.json`);
  try {
    await writeFile(indexPath, JSON.stringify(Object.fromEntries(index)), "utf8");
  } catch (error) {
    console.error("Error saving date index for %s:", feedId, error);
    throw error;
  }
}

function stableStringify(val: unknown): string {
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(",")}]`;
  if (val !== null && typeof val === "object") {
    return `{${Object.keys(val as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(val);
}

/**
 * Produces a stable SHA-256 fingerprint for an RSS item, excluding the date
 * field so that items re-fetched on different days hash identically.
 */
export function makeItemKey(item: Record<string, unknown>): string {
  const { date: _date, ...rest } = item;
  return createHash("sha256").update(stableStringify(rest)).digest("hex");
}
