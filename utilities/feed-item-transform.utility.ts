import { createHash } from "node:crypto";
import striptags from "striptags";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import type {
  BasicItemTransformConfig,
  CategoryTransformConfig,
  LinkTransformConfig,
  TextTransformConfig,
} from "../models/feed-transformer.model";

const DEFAULT_TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "fbclid", "gclid", "mc_cid", "mc_eid", "igshid", "ref",
  "ref_src", "spm",
];

export type TransformFeedItemsInput = {
  items: NormalizedFeedItem[];
  config?: BasicItemTransformConfig;
  fetchedAt: string;
  maxItems?: number;
};

export type TransformFeedItemsResult = {
  items: NormalizedFeedItem[];
  warnings: string[];
  stats: {
    inputItemCount: number;
    outputItemCount: number;
  };
};

export function transformFeedItems(input: TransformFeedItemsInput): TransformFeedItemsResult {
  const config = input.config ?? {};
  const transformed = input.items.map((item) => {
    const out: NormalizedFeedItem = { ...item };
    out.title = applyTextTransform(out.title, config.title, out) ?? out.title;
    out.description = applyTextTransform(out.description, config.description, out);
    out.content = applyTextTransform(out.content, config.content, out);
    out.link = applyLinkTransform(out.link, config.link);
    out.categories = applyCategoryTransform(out.categories, config.categories);
    out.guid = resolveGuid(out, config.guidStrategy);
    out.pubDate = resolveDate(out, config.dateStrategy, input.fetchedAt);
    return out;
  });
  const items = typeof input.maxItems === "number" && input.maxItems > 0
    ? transformed.slice(0, input.maxItems)
    : transformed;

  return {
    items,
    warnings: [],
    stats: { inputItemCount: input.items.length, outputItemCount: items.length },
  };
}

function applyTextTransform(
  value: string | undefined,
  config: TextTransformConfig | undefined,
  item: NormalizedFeedItem,
): string | undefined {
  if (!config) return value;
  let out = value;
  if (!out && config.fallbackFrom?.length) {
    for (const field of config.fallbackFrom) {
      const candidate = item[field];
      if (typeof candidate === "string" && candidate.trim()) {
        out = candidate;
        break;
      }
    }
  }
  if (!out) return out;
  if (config.stripHtml || config.stripDangerousHtml) out = striptags(out);
  if (config.normalizeWhitespace) out = out.replace(/\s+/g, " ").trim();
  if (typeof config.truncateCharacters === "number" && config.truncateCharacters >= 0) {
    out = out.slice(0, config.truncateCharacters);
  }
  if (config.prefix) out = `${config.prefix}${out}`;
  if (config.suffix) out = `${out}${config.suffix}`;
  return out;
}

function applyLinkTransform(value: string | undefined, config: LinkTransformConfig | undefined): string | undefined {
  if (!value || !config) return value;
  try {
    const url = new URL(value);
    if (config.forceHttps && url.protocol === "http:") url.protocol = "https:";
    if (config.removeTrackingParams) {
      for (const param of DEFAULT_TRACKING_PARAMS) url.searchParams.delete(param);
    }
    if (config.allowedParams?.length) {
      for (const key of Array.from(url.searchParams.keys())) {
        if (!config.allowedParams.includes(key)) url.searchParams.delete(key);
      }
    }
    if (config.blockedParams?.length) {
      for (const key of config.blockedParams) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function applyCategoryTransform(categories: string[] | undefined, config: CategoryTransformConfig | undefined): string[] | undefined {
  if (!categories || !config) return categories;
  let out = categories.map((category) => {
    let next = category;
    if (config.normalizeWhitespace) next = next.replace(/\s+/g, " ").trim();
    if (config.lowercase) next = next.toLowerCase();
    return next;
  });
  if (config.dedupe) out = Array.from(new Set(out));
  return out;
}

function resolveGuid(item: NormalizedFeedItem, strategy: BasicItemTransformConfig["guidStrategy"]): string | undefined {
  switch (strategy) {
    case "existing": return item.guid;
    case "link": return item.link;
    case "existingOrLinkHash": return item.guid || item.link || hashStable(item.title, item.description, item.content);
    case "titleLinkDateHash": return hashStable(item.title, item.link, stringifyDate(item.pubDate));
    case "contentHash": return hashStable(item.content, item.description, item.title);
    default: return item.guid;
  }
}

function resolveDate(
  item: NormalizedFeedItem,
  strategy: BasicItemTransformConfig["dateStrategy"],
  fetchedAt: string,
): string | Date | undefined {
  const published = validDateOrUndefined(item.pubDate);
  const updated = validDateOrUndefined(item.updatedDate);
  switch (strategy) {
    case "published": return published;
    case "updated": return updated;
    case "publishedOrUpdated": return published ?? updated;
    case "publishedOrUpdatedOrFetched": return published ?? updated ?? fetchedAt;
    case "fetched": return fetchedAt;
    default: return item.pubDate;
  }
}

function validDateOrUndefined(value: string | Date | undefined): string | Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : value;
}

function stringifyDate(value: string | Date | undefined): string {
  return value instanceof Date ? value.toISOString() : (value ?? "");
}

function hashStable(...parts: Array<unknown>): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u001f"))
    .digest("hex");
}
