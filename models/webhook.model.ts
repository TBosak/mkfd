export type WebhookFeedPayload = {
  id?: string;
  title: string;
  description?: string;
  url?: string;
  date?: string;
  author?: string;
  categories?: string[];
  severity?: "info" | "success" | "warning" | "error";
  metadata?: Record<string, unknown>;
};

export type WebhookFeedEvent = {
  id: string;
  feedId: string;
  externalId?: string;
  receivedAt: string;
  eventDate: string;
  title: string;
  description?: string;
  link?: string;
  author?: string;
  categories: string[];
  severity?: "info" | "success" | "warning" | "error";
  metadata?: Record<string, unknown>;
  rawPayload?: unknown;
  dedupeKey: string;
};

export type WebhookFeedConfig = {
  slug: string;
  tokenHash: string;
  maxItems: number;
  retentionDays: number;
  duplicateStrategy: "idOrHash" | "idOnly" | "always";
  dateStrategy: "payloadDateOrReceivedAt" | "receivedAt" | "payloadDateOnly";
  storeRawPayload: boolean;
  mapping: { mode: "native" };
};

export type WebhookReceiveResult = {
  ok: boolean;
  eventId?: string;
  feedUrl?: string;
  duplicate?: boolean;
  error?: string;
};
