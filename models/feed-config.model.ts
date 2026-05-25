import type { CSSTargetFields } from "./csstarget.model";
import type { ApiMapping } from "./api-mapping.model";
import type { ProtectedRecord, FeedCookie, ProtectedValue } from "./protected-value.model";
import type { FeedMetadata } from "./feed-metadata.model";

export type FeedType =
  | "webScraping"
  | "rest"
  | "api"
  | "email"
  | "graphql"
  | "calendar"
  | "sitemap"
  | "filesystem"
  | "webhook"
  | "feedTransformer"
  | "serviceConnector"
  | "changeDetection";

export type FeedRssMetadata = {
  feedLanguage?: string;
  feedCopyright?: string;
  feedDescription?: string;
  feedManagingEditor?: string;
  feedWebMaster?: string;
  feedPubDate?: string;
  feedLastBuildDate?: string;
  feedCategories?: string[];
  feedDocs?: string;
  feedGenerator?: string;
  feedTtl?: number;
  feedSkipHours?: number[];
  feedSkipDays?: string[];
  feedImage?: string;
};

export const defaultFeedRssMetadata = {
  feedLanguage: "",
  feedCopyright: "",
  feedDescription: "",
  feedManagingEditor: "",
  feedWebMaster: "",
  feedPubDate: "",
  feedLastBuildDate: "",
  feedCategories: [] as string[],
  feedDocs: "https://www.rssboard.org/rss-specification",
  feedGenerator: "MkFD Feed Generator",
  feedSkipHours: [] as number[],
  feedSkipDays: [] as string[],
} as const;

export type OutgoingWebhookConfig = {
  enabled: boolean;
  url?: string | ProtectedValue;
  method?: "POST" | "PUT";
  format?: "xml" | "json";
  headers?: ProtectedRecord;
  newItemsOnly?: boolean;
  customPayload?: string;
};

export type FlareSolverrConfig = {
  enabled: boolean;
  serverUrl?: string;
  timeout?: number;
};

export type FeedConfigBase<T extends FeedType> = {
  schemaVersion?: number;
  feedId: string;
  feedName: string;
  feedType: T;
  enabled?: boolean;
  refreshTime: number;
  reverse?: boolean;
  strict?: boolean;
  advanced?: boolean;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  webhook?: OutgoingWebhookConfig;
  flaresolverr?: FlareSolverrConfig;
  metadata?: FeedMetadata;
} & FeedRssMetadata;

export type WebScrapingSourceConfig = {
  baseUrl: string;
  title?: string;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  timeoutMs?: number;
  userAgent?: string;
  proxyId?: string;
};

export type WebScrapingFeedConfig = FeedConfigBase<"webScraping"> & {
  config: WebScrapingSourceConfig;
  article: CSSTargetFields;
};

export type ApiSourceConfig = {
  title?: string;
  baseUrl: string;
  method?: string;
  route?: string;
  params?: ProtectedRecord;
  headers?: ProtectedRecord;
  apiSpecificHeaders?: ProtectedRecord;
  apiSpecificBody?: Record<string, unknown>;
  cookieString?: string;
  body?: unknown;
  withCredentials?: boolean;
  contributor?: string;
  advanced?: boolean;
};

export type RestFeedConfig = FeedConfigBase<"rest"> & {
  config: ApiSourceConfig;
  apiMapping: ApiMapping;
};

export type ApiFeedConfig = FeedConfigBase<"api"> & {
  config: ApiSourceConfig;
  apiMapping: ApiMapping;
};

export type EmailSourceConfig = {
  host: string;
  port: number;
  user: string;
  folder: string;
  emailCount: number;
  password?: ProtectedValue;
  encryptedPassword?: string;
};

export type EmailFeedConfig = FeedConfigBase<"email"> & {
  config: EmailSourceConfig;
};

// Stub types — source block is Record<string, unknown> until each feature spec defines it
export type GraphQLFeedConfig         = FeedConfigBase<"graphql">          & { graphql: Record<string, unknown>; apiMapping: ApiMapping };
export type CalendarFeedConfig        = FeedConfigBase<"calendar">         & { calendar: Record<string, unknown> };
export type SitemapFeedConfig         = FeedConfigBase<"sitemap">          & { sitemap: Record<string, unknown> };
export type FilesystemFeedConfig      = FeedConfigBase<"filesystem">       & { filesystem: Record<string, unknown> };
export type WebhookFeedConfig         = FeedConfigBase<"webhook">          & { webhookFeed: Record<string, unknown> };
export type FeedTransformerFeedConfig = FeedConfigBase<"feedTransformer">  & { feedTransformer: Record<string, unknown> };
export type ServiceConnectorFeedConfig = FeedConfigBase<"serviceConnector"> & { serviceConnector: Record<string, unknown> };
export type ChangeDetectionFeedConfig = FeedConfigBase<"changeDetection">  & { changeDetection: Record<string, unknown> };

export type FeedConfig =
  | WebScrapingFeedConfig
  | RestFeedConfig
  | ApiFeedConfig
  | EmailFeedConfig
  | GraphQLFeedConfig
  | CalendarFeedConfig
  | SitemapFeedConfig
  | FilesystemFeedConfig
  | WebhookFeedConfig
  | FeedTransformerFeedConfig
  | ServiceConnectorFeedConfig
  | ChangeDetectionFeedConfig;
