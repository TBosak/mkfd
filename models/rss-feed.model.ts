export interface RSSFeedOptions {
  /**
   * Title of the feed
   */
  title: string;

  /**
   * URL to the HTML website corresponding to the channel
   */
  site_url: string;

  /**
   * URL to the RSS feed
   */
  feed_url?: string;

  /**
   * Description of the feed
   */
  description?: string;

  /**
   * Feed generator
   */
  generator?: string;

  /**
   * URL to the feed's favicon
   */
  favicon?: string;

  /**
   * Copyright notice for feed content
   */
  copyright?: string;

  /**
   * Feed author/managing editor
   */
  managingEditor?: string;

  /**
   * Feed webmaster
   */
  webMaster?: string;

  /**
   * Feed categories
   */
  categories?: string[];

  /**
   * Feed cloud settings for RSS Cloud
   */
  cloud?: {
    domain: string;
    port: string;
    path: string;
    registerProcedure: string;
    protocol: string;
  };

  /**
   * Time to live in minutes
   */
  ttl?: number;

  /**
   * URL to an image to be displayed with the feed
   */
  image?: {
    url: string;
    title: string;
    link: string;
    width?: number;
    height?: number;
    description?: string;
  };

  /**
   * Language of the feed
   */
  language?: string;

  /**
   * Rating of the feed (PICS rating)
   */
  rating?: string;

  /**
   * Days and hours in which the feed is updated
   */
  skipDays?: string[];
  skipHours?: number[];

  /**
   * Publication date of the feed
   */
  pubDate?: Date;

  /**
   * Last build date of the feed
   */
  lastBuildDate?: Date;

  /**
   * Custom namespaces
   */
  custom_namespaces?: {
    [key: string]: string;
  };

  /**
   * Custom elements
   */
  custom_elements?: any[];
}

export interface RSSItemOptions {
  /**
   * Title of the item
   */
  title?: string;

  /**
   * Description of the item
   */
  description?: string;

  /**
   * URL to the item
   */
  url?: string;

  /**
   * HTML content of the item
   */
  content?: string;

  /**
   * Content encoded in CDATA
   */
  content_encoded?: string;

  /**
   * Brief excerpt of the item
   */
  summary?: string;

  /**
   * Unique identifier for the item
   */
  guid?: string | number;

  /**
   * Whether the guid is a permalink
   */
  guid_isPermaLink?: boolean;

  /**
   * Categories/tags for the item
   */
  categories?: string[];

  /**
   * Author of the item
   */
  author?: string;

  /**
   * Contributors to the item
   */
  contributors?: string[];

  /**
   * Publication date of the item
   */
  date?: Date | string;

  /**
   * URL and metadata for an attached file
   */
  enclosure?: {
    url: string;
    file?: string;
    size?: number;
    type?: string;
  };

  /**
   * Latitude and longitude
   */
  lat?: number;
  long?: number;

  /**
   * Source feed if item is aggregated
   */
  source?: {
    url: string;
    title: string;
  };

  /**
   * Custom elements
   */
  custom_elements?: any[];
} 