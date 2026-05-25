import { mkdirSync } from "node:fs";
import type { Feed } from "feed";

export type SerializedFeedOutputs = { rss2: string; atom: string; json: string };
export type FeedOutputUrls        = { rss2: string; atom: string; json: string };

export type FeedItemSnapshot = {
  guid?:    string;
  link?:    string;
  title?:   string;
  pubDate?: string;
};

export function serializeAllFeedFormats(feed: Feed): SerializedFeedOutputs {
  return {
    rss2: feed.rss2(),
    atom: feed.atom1(),
    json: feed.json1(),
  };
}

export async function writeAllFeedFormats(
  feedId: string,
  feed: Feed,
  outputDir = "./public/feeds",
): Promise<FeedOutputUrls> {
  if (!/^[A-Za-z0-9_-]+$/.test(feedId)) {
    throw new Error(`Unsafe feedId: ${feedId}`);
  }
  mkdirSync(outputDir, { recursive: true });
  const outputs = serializeAllFeedFormats(feed);
  await Bun.write(`${outputDir}/${feedId}.xml`,  outputs.rss2);
  await Bun.write(`${outputDir}/${feedId}.atom`, outputs.atom);
  await Bun.write(`${outputDir}/${feedId}.json`, outputs.json);
  // URL paths are always /public/feeds/ regardless of outputDir (which controls
  // the write location only — e.g. a temp dir in tests).
  return {
    rss2: `/public/feeds/${feedId}.xml`,
    atom: `/public/feeds/${feedId}.atom`,
    json: `/public/feeds/${feedId}.json`,
  };
}

export function extractFeedItemSnapshots(feed: Feed): FeedItemSnapshot[] {
  return feed.items.map((item) => ({
    guid:    item.id,
    link:    item.link,
    title:   item.title,
    pubDate: item.date?.toISOString(),
  }));
}
