import type { Feed } from "feed";
import type { FeedTransformerFeedConfig } from "../models/feed-config.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import { buildFeedFromNormalizedItems } from "./normalized-feed-builder.utility";
import { parseExistingFeed, type ParsedExistingFeed } from "./existing-feed-parser.utility";
import { transformFeedItems } from "./feed-item-transform.utility";
import { filterFeedItems } from "./feed-item-filter.utility";
import type { OutboundFetchPolicyOptions } from "./outbound-fetch-policy.utility";

export type FeedTransformerRunResult = {
  feed: Feed;
  parsedFeeds: ParsedExistingFeed[];
  warnings: string[];
  metrics: {
    itemCount: number;
    inputItemCount: number;
    filteredItemCount: number;
    duplicateGuids: number;
  };
};

export async function runFeedTransformer(
  config: FeedTransformerFeedConfig,
  options: { policyOptions?: OutboundFetchPolicyOptions; serverUrl?: string } = {},
): Promise<FeedTransformerRunResult> {
  const block = config.feedTransformer;
  const fetchedAt = new Date().toISOString();
  const parsedFeeds = await Promise.all(
    block.sources.map((source) =>
      parseExistingFeed({
        url: source.url,
        format: source.format ?? "auto",
        headers: source.headers,
        policyOptions: options.policyOptions,
      }),
    ),
  );

  const warnings = parsedFeeds.flatMap((parsed) => parsed.warnings);
  let items: NormalizedFeedItem[] = parsedFeeds.flatMap((parsed) => parsed.items);
  const inputItemCount = items.length;
  items = mergeItems(items, block.mergeStrategy ?? "dateDesc");

  let duplicateGuids = 0;
  if (block.dedupeAcrossSources !== false) {
    const deduped = dedupeItems(items);
    duplicateGuids = items.length - deduped.length;
    items = deduped;
  }

  const transformed = transformFeedItems({
    items,
    config: block.items ?? {},
    fetchedAt,
    maxItems: block.maxItems,
  });
  const filtered = filterFeedItems({
    items: transformed.items,
    filters: block.items?.filters,
  });

  const primaryMeta = parsedFeeds[0]?.feed ?? {};
  const feed = buildFeedFromNormalizedItems({
    feedId: config.feedId,
    feedName: config.feedName,
    serverUrl: options.serverUrl ?? "",
    metadata: {
      title: block.feed?.title,
      description: block.feed?.description,
      link: block.feed?.link,
      language: block.feed?.language,
      image: block.feed?.image,
      copyright: block.feed?.copyright,
      generator: config.feedGenerator,
    },
    sourceFeedMeta: primaryMeta,
    items: filtered.items,
  });

  return {
    feed,
    parsedFeeds,
    warnings: [...warnings, ...transformed.warnings],
    metrics: {
      itemCount: filtered.items.length,
      inputItemCount,
      filteredItemCount: filtered.filteredItemCount,
      duplicateGuids,
    },
  };
}

function mergeItems(items: NormalizedFeedItem[], strategy: string): NormalizedFeedItem[] {
  const copy = [...items];
  if (strategy === "preserveOrder") return copy;
  return copy.sort((a, b) => {
    const aTime = dateTime(a.pubDate ?? a.updatedDate);
    const bTime = dateTime(b.pubDate ?? b.updatedDate);
    return strategy === "dateAsc" ? aTime - bTime : bTime - aTime;
  });
}

function dedupeItems(items: NormalizedFeedItem[]): NormalizedFeedItem[] {
  const seen = new Set<string>();
  const out: NormalizedFeedItem[] = [];
  for (const item of items) {
    const key = item.guid || item.link || `${item.title ?? ""}:${item.pubDate ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function dateTime(value: string | Date | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
