import type { FeedConfig, WebScrapingFeedConfig, RestFeedConfig, ApiFeedConfig, EmailFeedConfig } from "../models/feed-config.model";
import { defaultFeedRssMetadata } from "../models/feed-config.model";

function s(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function n(v: unknown, fallback = 0): number {
  const parsed = typeof v === "number" ? v : Number(v);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function b(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  return ["on", "true", "checked"].includes(String(v ?? "").toLowerCase()) ? true : fallback;
}

function normalizeArticle(raw: Record<string, unknown>): Record<string, unknown> {
  const dateTarget = raw.date ?? raw.pubDate;
  return { ...raw, date: dateTarget, pubDate: dateTarget };
}

function normalizeRssMetadata(input: Record<string, unknown>) {
  return {
    feedLanguage:       s(input.feedLanguage,       defaultFeedRssMetadata.feedLanguage),
    feedCopyright:      s(input.feedCopyright,      defaultFeedRssMetadata.feedCopyright),
    feedDescription:    s(input.feedDescription,    defaultFeedRssMetadata.feedDescription),
    feedManagingEditor: s(input.feedManagingEditor, defaultFeedRssMetadata.feedManagingEditor),
    feedWebMaster:      s(input.feedWebMaster,      defaultFeedRssMetadata.feedWebMaster),
    feedPubDate:        s(input.feedPubDate,        defaultFeedRssMetadata.feedPubDate),
    feedLastBuildDate:  s(input.feedLastBuildDate,  defaultFeedRssMetadata.feedLastBuildDate),
    feedCategories:     Array.isArray(input.feedCategories) ? input.feedCategories : [],
    feedDocs:           s(input.feedDocs,           defaultFeedRssMetadata.feedDocs),
    feedGenerator:      s(input.feedGenerator,      defaultFeedRssMetadata.feedGenerator),
    feedSkipHours:      Array.isArray(input.feedSkipHours) ? input.feedSkipHours : [],
    feedSkipDays:       Array.isArray(input.feedSkipDays)  ? input.feedSkipDays  : [],
    feedTtl:            typeof input.feedTtl === "number" ? input.feedTtl : undefined,
    feedImage:          s(input.feedImage) || undefined,
  };
}

export function normalizeLoadedFeedConfig(input: Record<string, unknown>): FeedConfig {
  const feedType = s(input.feedType, "webScraping");

  const base = {
    schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : 1,
    feedId:        s(input.feedId),
    feedName:      s(input.feedName, "RSS Feed"),
    feedType,
    enabled:       b(input.enabled, true),
    refreshTime:   n(input.refreshTime, 5),
    reverse:       b(input.reverse, false),
    strict:        b(input.strict, false),
    advanced:      b(input.advanced, false),
    headers:       (input.headers as Record<string, unknown>) ?? {},
    cookies:       Array.isArray(input.cookies) ? input.cookies : [],
    webhook:       input.webhook as FeedConfig["webhook"],
    flaresolverr:  input.flaresolverr as FeedConfig["flaresolverr"],
    metadata:      input.metadata as FeedConfig["metadata"],
    ...normalizeRssMetadata(input),
  };

  if (feedType === "webScraping") {
    return {
      ...base,
      feedType: "webScraping",
      config: (input.config as WebScrapingFeedConfig["config"]) ?? { baseUrl: "" },
      article: normalizeArticle((input.article as Record<string, unknown>) ?? {}),
    } as WebScrapingFeedConfig;
  }

  if (feedType === "rest") {
    return {
      ...base,
      feedType: "rest",
      config: (input.config as RestFeedConfig["config"]) ?? { baseUrl: "" },
      apiMapping: (input.apiMapping as RestFeedConfig["apiMapping"]) ?? {},
    } as RestFeedConfig;
  }

  if (feedType === "api") {
    return {
      ...base,
      feedType: "api",
      config: (input.config as ApiFeedConfig["config"]) ?? { baseUrl: "" },
      apiMapping: (input.apiMapping as ApiFeedConfig["apiMapping"]) ?? {},
    } as ApiFeedConfig;
  }

  if (feedType === "email") {
    return {
      ...base,
      feedType: "email",
      config: (input.config as EmailFeedConfig["config"]) ?? {
        host: "", port: 993, user: "", folder: "INBOX", emailCount: 10,
      },
    } as EmailFeedConfig;
  }

  // Stub types and unknown — pass through base with their source block
  return {
    ...base,
    feedType,
    [feedType]: (input[feedType] as Record<string, unknown>) ?? {},
  } as FeedConfig;
}
