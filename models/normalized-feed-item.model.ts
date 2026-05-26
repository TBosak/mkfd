export type NormalizedFeedEnclosure = {
  url: string;
  type?: string;
  length?: number;
};

export type NormalizedFeedSource = {
  url?: string;
  title?: string;
};

export type NormalizedFeedItem = {
  title?: string;
  link?: string;
  description?: string;
  content?: string;
  contentEncoded?: string;
  summary?: string;
  guid?: string;
  updatedDate?: Date | string;
  pubDate?: Date | string;
  author?: string | Array<{ name?: string; email?: string; link?: string }>;
  categories?: string[];
  image?: string;
  enclosure?: NormalizedFeedEnclosure;
  source?: NormalizedFeedSource;
  raw?: unknown;
};
