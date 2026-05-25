import { Feed } from "feed";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

export type NormalizedFeedMeta = {
  feedId: string;
  feedName: string;
  serverUrl?: string;
  metadata?: {
    title?: string;
    description?: string;
    link?: string;
    language?: string;
    copyright?: string;
    generator?: string;
    image?: string;
    ttl?: number;
  };
  sourceFeedMeta?: {
    title?: string;
    description?: string;
    link?: string;
  };
  overrides?: {
    title?: string;
    description?: string;
  };
  items: NormalizedFeedItem[];
};

export function buildFeedFromNormalizedItems(opts: NormalizedFeedMeta): Feed {
  const {
    feedId,
    feedName,
    serverUrl = "",
    metadata = {},
    sourceFeedMeta = {},
    overrides = {},
    items,
  } = opts;

  const title = overrides.title ?? metadata.title ?? sourceFeedMeta.title ?? feedName;
  const description = overrides.description ?? metadata.description ?? sourceFeedMeta.description ?? "";
  const link = metadata.link ?? sourceFeedMeta.link ?? serverUrl ?? `https://example.com/feeds/${feedId}`;

  const feed = new Feed({
    title,
    description,
    id: link,
    link,
    language: metadata.language,
    copyright: metadata.copyright,
    generator: metadata.generator ?? "MkFD Feed Generator",
    image: metadata.image,
    ttl: metadata.ttl,
    updated: new Date(),
    feedLinks: {
      rss2: `${serverUrl}/public/feeds/${feedId}.xml`,
      atom: `${serverUrl}/public/feeds/${feedId}.atom`,
      json: `${serverUrl}/public/feeds/${feedId}.json`,
    },
  });

  for (const item of items) {
    const pubDate = item.pubDate
      ? typeof item.pubDate === "string" ? new Date(item.pubDate) : item.pubDate
      : new Date();

    const guid = item.guid ?? item.link ?? `${feedId}-${pubDate.getTime()}`;

    feed.addItem({
      title: item.title ?? "(no title)",
      link: item.link ?? "",
      id: guid,
      date: pubDate,
      description: item.description,
      content: item.content,
      author: item.author,
      category: item.categories?.map((name) => ({ name })),
      image: item.image,
      enclosure: item.enclosure ? { url: item.enclosure.url, type: item.enclosure.type, length: item.enclosure.length } : undefined,
    });
  }

  return feed;
}
