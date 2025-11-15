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

// Webhook configuration
export interface WebhookConfig {
  enabled?: boolean;
  url?: string;
  format?: "xml" | "json";
  newItemsOnly?: boolean;
  headers?: string; // JSON string
  customPayload?: string;
}

// Web Scraping Feed Configuration
export interface WebScrapingConfig {
  feedUrl: string;
  itemSelector: string;

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
  apiParams?: string; // JSON string
  apiHeaders?: string; // JSON string
  apiBody?: string; // JSON string

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

// Main Feed Configuration
export interface FeedConfig {
  feedName: string;
  feedType: "webScraping" | "api" | "email";

  // Additional options (common to all types)
  headers?: string; // JSON string
  cookies?: Cookie[];
  refreshTime?: number;
  reverse?: boolean;
  advanced?: boolean;
  strict?: boolean;
  webhook?: WebhookConfig;

  // Type-specific configurations
  webScraping?: WebScrapingConfig;
  api?: APIConfig;
  email?: EmailConfig;
}

// Form data type (matches what we send to backend)
export type FeedFormData = FeedConfig &
  WebScrapingConfig &
  APIConfig &
  EmailConfig;
