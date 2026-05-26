import type { JsonLdFieldMappings } from "./feed-config.model";

export type SitemapMode = "urlList" | "pageMetadata" | "jsonLd" | "jsonLdWithFallback" | "changeDetection";
export type SitemapInputMode = "exact" | "discover";
export type SitemapSortOrder = "lastmodDesc" | "lastmodAsc" | "firstSeenDesc" | "urlAsc" | "sitemapOrder";
export type SitemapDateStrategy = "lastmodOrFirstSeen" | "lastmodOnly" | "firstSeen" | "currentRun" | "bestAvailable" | "jsonLdOrLastmodOrFirstSeen";

export type SitemapFilterRule = {
  type: "keyword" | "regex";
  field: "loc" | "lastmod" | "changefreq" | "priority";
  value: string;
  caseSensitive?: boolean;
};

export type SitemapJsonLdConfig = {
  enabled: boolean;
  scope: "sitemapUrls";
  sampleUrls?: number;
  fetch: { mode: "standard" | "advanced"; timeoutMs: number; concurrency: number; maxPages: number };
  types?: string[];
  mapping: JsonLdFieldMappings;
  fallback?: { enabled: boolean; order: Array<"openGraph" | "htmlMeta" | "sitemap" | "url"> };
};

export type SitemapPageMetadataConfig = {
  enabled: boolean;
  fetchMode: "standard" | "advanced";
  timeoutMs: number;
  concurrency: number;
};

export type SitemapChangeDetectionConfig = {
  enabled: boolean;
  target: "fullPage" | "mainContent" | "selector";
  selector?: string;
  emitOn: "contentHashChanged";
  includeDiff: boolean;
  ignoreSelectors?: string[];
};

export type SitemapFeedConfig = {
  inputMode: SitemapInputMode;
  url: string;
  mode: SitemapMode;
  maxItems: number;
  maxUrlsToScan: number;
  sortOrder: SitemapSortOrder;
  dateStrategy: SitemapDateStrategy;
  titleStrategy: "path" | "url" | "hostnameAndPath" | "bestAvailable";
  descriptionStrategy: "sitemapMetadata" | "pageMetadata" | "jsonLd" | "bestAvailable" | "none";
  filters?: { include?: SitemapFilterRule[]; exclude?: SitemapFilterRule[] };
  pageMetadata?: SitemapPageMetadataConfig;
  jsonLd?: SitemapJsonLdConfig;
  changeDetection?: SitemapChangeDetectionConfig;
};

export type SitemapEntry = {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  sourceSitemapUrl: string;
  discoveredAt: string;
  order: number;
};

export type SitemapIndexEntry = {
  loc: string;
  lastmod?: string;
  sourceSitemapUrl: string;
};

export type SitemapParseResult = {
  type: "urlset" | "sitemapindex" | "text" | "rss" | "atom";
  entries: SitemapEntry[];
  childSitemaps: SitemapIndexEntry[];
  warnings: string[];
  stats: {
    totalUrls: number;
    urlsAfterFilters: number;
    totalChildSitemaps: number;
    fetchedChildSitemaps: number;
    failedChildSitemaps: number;
    duplicateUrls: number;
  };
};

export type SitemapFeedState = {
  urls: Record<string, {
    firstSeenAt: string;
    lastSeenAt: string;
    lastSitemapLastmod?: string;
    lastJsonLdHash?: string;
    lastContentHash?: string;
    lastEmittedAt?: string;
    lastStatusCode?: number;
    lastError?: string;
  }>;
};

export type PageMetadata = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  image?: string;
  publishedTime?: string;
  modifiedTime?: string;
  sourceTitle?: string;
  warnings: string[];
};
