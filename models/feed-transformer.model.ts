export type FeedTransformerSourceFormat = "auto" | "rss" | "atom" | "jsonFeed";

export type FeedTransformerSource = {
  url: string;
  format: FeedTransformerSourceFormat;
  headers?: Record<string, string>;
};

export type FeedTransformerMergeStrategy = "dateDesc" | "dateAsc" | "preserveOrder";

export type FeedTransformerFeedMetadataOverrides = {
  title?: string;
  description?: string;
  link?: string;
  language?: string;
  image?: string;
  copyright?: string;
};

export type TextTransformConfig = {
  stripHtml?: boolean;
  stripDangerousHtml?: boolean;
  normalizeWhitespace?: boolean;
  truncateCharacters?: number;
  fallbackFrom?: Array<"title" | "description" | "content" | "contentEncoded" | "summary">;
  prefix?: string;
  suffix?: string;
};

export type LinkTransformConfig = {
  removeTrackingParams?: boolean;
  allowedParams?: string[];
  blockedParams?: string[];
  forceHttps?: boolean;
};

export type CategoryTransformConfig = {
  normalizeWhitespace?: boolean;
  dedupe?: boolean;
  lowercase?: boolean;
};

export type BasicFilterRule = {
  field: "title" | "link" | "description" | "content" | "author" | "categories";
  type: "contains" | "notContains" | "equals" | "startsWith" | "endsWith" | "regex";
  value: string;
  caseSensitive?: boolean;
};

export type BasicItemTransformConfig = {
  guidStrategy?: "existing" | "link" | "existingOrLinkHash" | "titleLinkDateHash" | "contentHash";
  dateStrategy?: "published" | "updated" | "publishedOrUpdated" | "publishedOrUpdatedOrFetched" | "fetched";
  title?: TextTransformConfig;
  description?: TextTransformConfig;
  content?: TextTransformConfig;
  link?: LinkTransformConfig;
  categories?: CategoryTransformConfig;
  filters?: {
    include?: BasicFilterRule[];
    exclude?: BasicFilterRule[];
  };
};

export type FeedTransformerConfigBlock = {
  sources: FeedTransformerSource[];
  mergeStrategy?: FeedTransformerMergeStrategy;
  maxItems?: number;
  dedupeAcrossSources?: boolean;
  feed?: FeedTransformerFeedMetadataOverrides;
  items?: BasicItemTransformConfig;
};
