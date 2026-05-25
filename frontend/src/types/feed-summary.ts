export type FeedStatus = "healthy" | "warning" | "error" | "disabled" | "neverRun" | "running";

export type FeedType = "scrape" | "rest" | "graphql" | "email" | "calendar" | "sitemap" | "filesystem" | "webhook";

export type FeedSummary = {
  id: string;
  filename: string;
  title: string;
  description?: string;
  type: FeedType;
  category?: string;
  sourceUrl: string;
  sourceMethod?: string;
  publicFeedUrl: string;
  enabled: boolean;
  favorite: boolean;
  tags: string[];
  status: FeedStatus;
  statusDetail?: string;
  refreshMinutes?: number | null;
  lastRunAt?: string;
  lastRunRelative?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastItemCount?: number | null;
  lastNewItemCount?: number;
  secrets: { protected: boolean; env: boolean; plain: boolean };
  origin: { type: "local" | "community"; catalogId?: string };
};
