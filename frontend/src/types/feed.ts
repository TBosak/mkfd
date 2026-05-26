// Drill Chain Step
export interface DrillStep {
  selector: string;
  attribute?: string;
  isRelative?: boolean;
  baseUrl?: string;
  stripHtml?: boolean;
}

// CSS Target for field configuration
export interface CSSTarget {
  selector?: string;
  attribute?: string;
  stripHtml?: boolean;
  baseUrl?: string;
  isRelative?: boolean;
  titleCase?: boolean;
  iterator?: string;
  dateFormat?: string;
  customDateFormat?: string;
  guidIsPermaLink?: boolean;
  drillChain?: DrillStep[];
}

// Cookie configuration
export interface Cookie {
  name: string;
  value: string;
}

// Generic key-value pair
export interface KeyValuePair {
  key: string;
  value: string;
}

// Webhook configuration
export interface WebhookConfig {
  enabled?: boolean;
  url?: string;
  format?: "xml" | "json";
  newItemsOnly?: boolean;
  headers?: string; // JSON string
  customPayload?: string;
}

// FlareSolverr configuration
export interface FlareSolverrConfig {
  enabled?: boolean;
  serverUrl?: string;
  timeout?: number;
}

// Web Scraping Feed Configuration
export interface WebScrapingConfig {
  feedUrl: string;
  itemSelector: string;
  extractionMode?: "cssSelectors" | "jsonLdPage" | "jsonLdDetailDrillChain" | "jsonLdWithCssFallback" | "jsonLdDetailDrillChainWithCssFallback";
  jsonLdTitlePath?: string;
  jsonLdDescriptionPath?: string;
  jsonLdLinkPath?: string;
  jsonLdDatePath?: string;
  jsonLdAuthorPath?: string;
  jsonLdGuidPath?: string;
  jsonLdContentPath?: string;
  jsonLdCategoriesPath?: string;
  requestMode?: "simple" | "form";
  proxyProfileId?: string;
  userAgentProfileId?: string;
  userAgentOverride?: string;
  formMethod?: "GET" | "POST";
  formActionUrl?: string;
  formEncoding?: "application/x-www-form-urlencoded" | "multipart/form-data" | "application/json";
  formFields?: KeyValuePair[];

  // Field selectors
  titleSelector?: string;
  titleAttribute?: string;
  titleIterator?: string;
  titleStripHtml?: boolean;
  titleTitleCase?: boolean;
  titleDrillChain?: DrillStep[];

  descriptionSelector?: string;
  descriptionAttribute?: string;
  descriptionIterator?: string;
  descriptionStripHtml?: boolean;
  descriptionTitleCase?: boolean;
  descriptionDrillChain?: DrillStep[];

  linkSelector?: string;
  linkAttribute?: string;
  linkIterator?: string;
  linkRelativeLink?: boolean;
  linkBaseUrl?: string;
  linkDrillChain?: DrillStep[];

  enclosureSelector?: string;
  enclosureAttribute?: string;
  enclosureIterator?: string;
  enclosureRelativeLink?: boolean;
  enclosureBaseUrl?: string;
  enclosureDrillChain?: DrillStep[];

  authorSelector?: string;
  authorAttribute?: string;
  authorIterator?: string;
  authorStripHtml?: boolean;
  authorTitleCase?: boolean;
  authorDrillChain?: DrillStep[];

  dateSelector?: string;
  dateAttribute?: string;
  dateIterator?: string;
  dateFormat?: string;
  customDateFormat?: string;
  dateDrillChain?: DrillStep[];

  contentEncodedSelector?: string;
  contentEncodedAttribute?: string;
  contentEncodedIterator?: string;
  contentEncodedStripHtml?: boolean;
  contentEncodedTitleCase?: boolean;
  contentEncodedDrillChain?: DrillStep[];

  summarySelector?: string;
  summaryAttribute?: string;
  summaryIterator?: string;
  summaryStripHtml?: boolean;
  summaryTitleCase?: boolean;
  summaryDrillChain?: DrillStep[];

  guidSelector?: string;
  guidAttribute?: string;
  guidIterator?: string;
  guidIsPermaLink?: boolean;
  guidDrillChain?: DrillStep[];

  categoriesSelector?: string;
  categoriesAttribute?: string;
  categoriesIterator?: string;
  categoriesDrillChain?: DrillStep[];

  contributorsSelector?: string;
  contributorsAttribute?: string;
  contributorsIterator?: string;
  contributorsDrillChain?: DrillStep[];

  latSelector?: string;
  latAttribute?: string;
  latIterator?: string;
  latDrillChain?: DrillStep[];

  longSelector?: string;
  longAttribute?: string;
  longIterator?: string;
  longDrillChain?: DrillStep[];

  sourceUrlSelector?: string;
  sourceUrlAttribute?: string;
  sourceUrlIterator?: string;
  sourceUrlRelativeLink?: boolean;
  sourceUrlBaseUrl?: string;
  sourceUrlDrillChain?: DrillStep[];

  sourceTitleSelector?: string;
  sourceTitleAttribute?: string;
  sourceTitleIterator?: string;
  sourceTitleDrillChain?: DrillStep[];

  // Feed level selectors
  feedLanguageSelector?: string;
  feedLanguageAttribute?: string;
  feedCopyrightSelector?: string;
  feedCopyrightAttribute?: string;
  feedManagingEditorSelector?: string;
  feedManagingEditorAttribute?: string;
  feedWebMasterSelector?: string;
  feedWebMasterAttribute?: string;
  feedCategoriesScrapingSelector?: string;
  feedCategoriesScrapingAttribute?: string;
  feedTtlSelector?: string;
  feedTtlAttribute?: string;
  feedSkipDaysSelector?: string;
  feedSkipDaysAttribute?: string;
  feedSkipHoursSelector?: string;
  feedSkipHoursAttribute?: string;
  feedImageUrlSelector?: string;
  feedImageUrlAttribute?: string;
}

// API Feed Configuration
export interface APIConfig {
  feedUrl: string; // Base URL
  apiRoute?: string;
  apiMethod?: "GET" | "POST" | "PUT" | "DELETE";
  apiParams?: KeyValuePair[];
  apiHeaders?: KeyValuePair[];
  apiBody?: KeyValuePair[];

  // Item field mappings (JSONPath)
  apiItemsPath?: string;
  apiTitleField?: string;
  apiDescriptionField?: string;
  apiLinkField?: string;
  apiDateField?: string;
  apiAuthor?: string;
  apiDate?: string;
  apiEnclosureUrl?: string;
  apiEnclosureSize?: string;
  apiEnclosureType?: string;
  apiContentEncoded?: string;
  apiSummary?: string;
  apiGuid?: string;
  apiGuidIsPermaLink?: string;
  apiCategories?: string;
  apiContributors?: string;
  apiLat?: string;
  apiLong?: string;
  apiSourceUrl?: string;
  apiSourceTitle?: string;

  // Feed level mappings
  apiFeedTitle?: string;
  apiFeedDescription?: string;
  apiFeedLanguage?: string;
  apiFeedCopyright?: string;
  apiFeedManagingEditor?: string;
  apiFeedWebMaster?: string;
  apiFeedCategories?: string;
  apiFeedPubDate?: string;
  apiFeedLastBuildDate?: string;
  apiFeedTtl?: string;
  apiFeedSkipDays?: string;
  apiFeedSkipHours?: string;
  apiFeedImageUrl?: string;
}

// Email/IMAP Feed Configuration
export interface EmailConfig {
  emailHost: string;
  emailPort: number;
  emailUsername: string;
  emailPassword: string;
  emailFolder: string;
  emailCount?: number;
}

export interface FeedTransformerSourceForm {
  url: string;
  format?: "auto" | "rss" | "atom" | "jsonFeed";
}

export interface FeedTransformerFormConfig {
  transformerSources?: FeedTransformerSourceForm[];
  transformerMergeStrategy?: "dateDesc" | "dateAsc" | "preserveOrder";
  transformerMaxItems?: number;
  transformerDedupeAcrossSources?: boolean;
  transformerFeedTitle?: string;
  transformerFeedDescription?: string;
  transformerFeedLink?: string;
  transformerGuidStrategy?: "existing" | "link" | "existingOrLinkHash" | "titleLinkDateHash" | "contentHash";
  transformerDateStrategy?: "published" | "updated" | "publishedOrUpdated" | "publishedOrUpdatedOrFetched" | "fetched";
  transformerStripDescriptionHtml?: boolean;
  transformerNormalizeWhitespace?: boolean;
  transformerForceHttps?: boolean;
  transformerRemoveTrackingParams?: boolean;
  transformerNormalizeCategories?: boolean;
  transformerFilterInclude?: FeedTransformerFilterRuleForm[];
  transformerFilterExclude?: FeedTransformerFilterRuleForm[];
}

export interface FeedTransformerFilterRuleForm {
  field: "title" | "link" | "description" | "content" | "author" | "categories";
  type: "contains" | "notContains" | "equals" | "startsWith" | "endsWith" | "regex";
  value: string;
  caseSensitive?: boolean;
}

export interface SitemapFormConfig {
  sitemapUrl?: string;
  sitemapMode?: "urlList" | "pageMetadata" | "jsonLd" | "jsonLdWithFallback" | "changeDetection";
  sitemapMaxItems?: number;
  sitemapMaxUrlsToScan?: number;
  sitemapSortOrder?: "lastmodDesc" | "lastmodAsc" | "urlAsc" | "sitemapOrder";
  sitemapTitleStrategy?: "path" | "url" | "hostnameAndPath" | "bestAvailable";
  sitemapDescriptionStrategy?: "sitemapMetadata" | "pageMetadata" | "jsonLd" | "bestAvailable" | "none";
}

export interface CalendarFormConfig {
  calendarUrl?: string;
  calendarWindowDays?: number;
  calendarMaxEvents?: number;
  calendarExpandRecurringEvents?: boolean;
  calendarSortOrder?: "startAsc" | "startDesc" | "modifiedDesc";
  calendarLinkStrategy?: "eventUrl" | "location" | "calendarUrl" | "none";
  calendarIncludePastEvents?: boolean;
  calendarIncludeCanceled?: boolean;
}

export interface GraphQLFormConfig {
  graphqlEndpoint?: string;
  graphqlQuery?: string;
  graphqlVariables?: string;
  graphqlOperationName?: string;
  graphqlItemPath?: string;
  graphqlTitlePath?: string;
  graphqlLinkPath?: string;
  graphqlDescriptionPath?: string;
  graphqlDatePath?: string;
  graphqlGuidPath?: string;
}

export interface WebhookFeedFormConfig {
  webhookSlug?: string;
  webhookToken?: string;
  webhookTokenHash?: string;
  webhookMaxItems?: number;
  webhookRetentionDays?: number;
  webhookDuplicateStrategy?: "idOrHash" | "idOnly" | "always";
  webhookDateStrategy?: "payloadDateOrReceivedAt" | "receivedAt" | "payloadDateOnly";
  webhookStoreRawPayload?: boolean;
}

export interface FilesystemFormConfig {
  filesystemRootPath?: string;
  filesystemPublicBaseUrl?: string;
  filesystemRecursive?: boolean;
  filesystemInclude?: string;
  filesystemExclude?: string;
  filesystemMaxItems?: number;
  filesystemSortOrder?: "modifiedDesc" | "modifiedAsc" | "createdDesc" | "createdAsc" | "filenameAsc" | "filenameDesc" | "firstSeenDesc";
  filesystemTitleStrategy?: "filename" | "filenameWithoutExtension" | "relativePath" | "sidecarTitle";
  filesystemDescriptionStrategy?: "fileMetadata" | "sidecarDescription" | "textPreview" | "none";
  filesystemSidecarEnabled?: boolean;
  filesystemExtractionEnabled?: boolean;
}

export interface ServiceConnectorFormConfig {
  serviceConnectorService?: string;
  serviceConnectorLabel?: string;
  serviceConnectorServerUrl?: string;
  serviceConnectorApiKey?: string;
  serviceConnectorResourceId?: string;
  serviceConnectorResourceLabel?: string;
  serviceConnectorPreset?: string;
  serviceConnectorLimit?: number;
}

// Main Feed Configuration
export interface FeedConfig {
  feedName: string;
  feedType: "webScraping" | "api" | "email" | "feedTransformer" | "sitemap" | "calendar" | "graphql" | "webhook" | "filesystem" | "serviceConnector";

  // Additional options (common to all types)
  headers?: KeyValuePair[];
  cookies?: Cookie[];
  refreshTime?: number;
  reverse?: boolean;
  advanced?: boolean;
  strict?: boolean;
  webhook?: WebhookConfig;
  flaresolverr?: FlareSolverrConfig;

  // Type-specific configurations
  webScraping?: WebScrapingConfig;
  api?: APIConfig;
  email?: EmailConfig;
  feedTransformer?: FeedTransformerFormConfig;
  sitemap?: SitemapFormConfig;
  calendar?: CalendarFormConfig;
  graphql?: GraphQLFormConfig;
  webhookFeed?: WebhookFeedFormConfig;
  filesystem?: FilesystemFormConfig;
  serviceConnector?: ServiceConnectorFormConfig;
}

// Form data type (matches what we send to backend)
export type FeedFormData = FeedConfig &
  WebScrapingConfig &
  APIConfig &
  EmailConfig &
  FeedTransformerFormConfig &
  SitemapFormConfig &
  CalendarFormConfig &
  GraphQLFormConfig &
  WebhookFeedFormConfig &
  FilesystemFormConfig &
  ServiceConnectorFormConfig;
