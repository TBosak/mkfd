export type FeedConfigOrigin = {
  type: "local" | "community" | "sourceAssistant" | "imported";
  catalogId?: string;
  importedAt?: string;
  sourceRepo?: string;
  sourcePath?: string;
};

export type FeedMetadata = {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  language?: string;
  visibility?: "public" | "private";
  localOnly?: boolean;
  favorite?: boolean;
  color?: string;
  origin?: FeedConfigOrigin;
};
