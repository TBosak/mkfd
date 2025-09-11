export interface WebhookConfig {
  /**
   * URL to send webhook POST requests to
   */
  url: string;

  /**
   * Whether webhook is enabled for this feed
   */
  enabled: boolean;

  /**
   * Optional authentication headers
   */
  headers?: Record<string, string>;

  /**
   * Format of webhook payload: 'xml' or 'json'
   */
  format: 'xml' | 'json';

  /**
   * Whether to send only new items or all items
   */
  newItemsOnly: boolean;

  /**
   * Custom payload template (optional)
   */
  customPayload?: string;
}

export interface WebhookPayload {
  /**
   * Feed identification
   */
  feedId: string;
  feedName: string;
  feedType: string;

  /**
   * Timestamp of the webhook trigger
   */
  timestamp: string;

  /**
   * Type of trigger: 'automatic' or 'manual'
   */
  triggerType: 'automatic' | 'manual';

  /**
   * Number of items being sent
   */
  itemCount: number;

  /**
   * RSS XML content or parsed JSON data
   */
  data: string | object;

  /**
   * Feed metadata
   */
  metadata?: {
    lastBuildDate?: string;
    feedUrl?: string;
    siteUrl?: string;
  };
}