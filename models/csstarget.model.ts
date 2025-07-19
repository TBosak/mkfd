export interface CSSTargetOptions {
    selector?: string;
    attribute?: string;
    stripHtml?: boolean;
    baseUrl?: string;
    isRelative?: boolean; // For links/URLs
    titleCase?: boolean;  // For text
    iterator?: string;    // For iterating over a list of items
    dateFormat?: string;  // For dates (e.g., "YYYY-MM-DD HH:mm:ss", "iso", "epoch")
    customDateFormat?: string; // If dateFormat is "other"
    guidIsPermaLink?: boolean; // For GUIDs
    drillChain?: Array<{
        selector: string;
        attribute?: string;
        isRelative?: boolean;
        baseUrl?: string;
        stripHtml?: boolean;
    }>;
}

export default class CSSTarget implements CSSTargetOptions {
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
    drillChain?: Array<{
        selector: string;
        attribute?: string;
        isRelative?: boolean;
        baseUrl?: string;
        stripHtml?: boolean;
    }>;

    constructor(
        selector?: string,
        attribute?: string,
        stripHtml?: boolean,
        baseUrl?: string,
        isRelative?: boolean,
        titleCase?: boolean,
        iterator?: string,
        dateFormat?: string, 
        customDateFormat?: string,
        guidIsPermaLink?: boolean,
        drillChain?: Array<{
            selector: string;
            attribute?: string;
            isRelative?: boolean;
            baseUrl?: string;
            stripHtml?: boolean;
        }> 
    ) {
        this.selector = selector;
        this.attribute = attribute;
        this.stripHtml = stripHtml;
        this.baseUrl = baseUrl;
        this.isRelative = isRelative;
        this.titleCase = titleCase;
        this.iterator = iterator;
        this.dateFormat = dateFormat;
        this.customDateFormat = customDateFormat;
        this.guidIsPermaLink = guidIsPermaLink;
        this.drillChain = drillChain || [];
    }
}

export interface CSSTargetFields {
  // Required fields
  iterator: CSSTarget;
  
  // Basic item fields
  title?: CSSTarget;
  description?: CSSTarget;
  link?: CSSTarget;
  author?: CSSTarget;
  date?: CSSTarget;
  enclosure?: CSSTarget;
  
  // Additional item fields
  content?: CSSTarget;
  contentEncoded?: CSSTarget;
  summary?: CSSTarget;
  guid?: CSSTarget;
  categories?: CSSTarget;
  contributors?: CSSTarget;
  source?: {
    url: CSSTarget;
    title: CSSTarget;
  };
  
  // Geo fields
  lat?: CSSTarget;
  long?: CSSTarget;
  
  // Feed level fields
  feedTitle?: CSSTarget;
  feedDescription?: CSSTarget;
  feedImage?: {
    url: CSSTarget;
    title: CSSTarget;
    link: CSSTarget;
    width?: CSSTarget;
    height?: CSSTarget;
    description?: CSSTarget;
  };
  feedLanguage?: CSSTarget;
  feedCopyright?: CSSTarget;
  feedManagingEditor?: CSSTarget;
  feedWebMaster?: CSSTarget;
  feedCategories?: CSSTarget;
  feedTtl?: CSSTarget;
  feedRating?: CSSTarget;
  feedSkipDays?: CSSTarget;
  feedSkipHours?: CSSTarget;
}
