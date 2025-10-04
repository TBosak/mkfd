export interface ApiMapping {
  // Path to the array of items in the API response
  items: string;

  // Basic item fields
  title?: string;
  description?: string;
  link?: string;
  author?: string;
  date?: string;
  enclosure?: {
    url: string;
    size?: string;
    type?: string;
  };

  // Additional item fields
  content?: string;
  contentEncoded?: string;
  summary?: string;
  guid?: string;
  guidIsPermaLink?: string;
  categories?: string;
  contributors?: string;
  source?: {
    url: string;
    title: string;
  };

  // Geo fields
  lat?: string;
  long?: string;

  // Feed level fields
  feedTitle?: string;
  feedDescription?: string;
  feedImageUrl?: string;
  feedLanguage?: string;
  feedCopyright?: string;
  feedManagingEditor?: string;
  feedWebMaster?: string;
  feedCategories?: string;
  feedTtl?: string;
  feedSkipDays?: string;
  feedSkipHours?: string;
  feedPubDate?: string;

  // Custom fields
  customElements?: {
    [key: string]: string;
  };
} 