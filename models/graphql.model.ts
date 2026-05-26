import type { ProtectedRecord } from "./protected-value.model";

export type StructuredFeedMapping = {
  itemPath: string;
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  author?: string;
  enclosureUrl?: string;
  content?: string;
  contentEncoded?: string;
  summary?: string;
  categories?: string;
  contributors?: string;
  source?: string;
  lat?: string;
  long?: string;
};

export type StructuredFeedSourceResult = {
  data: unknown;
  warnings: string[];
  stats: { itemCount?: number; responseBytes?: number; fetchMs?: number };
};

export type GraphQLFeedConfig = {
  endpoint: string;
  method: "POST";
  headers?: ProtectedRecord;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  timeoutMs?: number;
  mapping: StructuredFeedMapping;
  pagination?: { enabled: false };
};

export type ExecuteGraphQLFeedOptions = {
  endpoint: string;
  headers?: Record<string, string>;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  timeoutMs?: number;
};

export type GraphQLRunStats = {
  feedId: string;
  endpoint: string;
  operationName?: string;
  fetchMs: number;
  responseBytes: number;
  graphQLErrorCount: number;
  itemCount: number;
  itemPath: string;
  warnings: string[];
};

export type JsonArrayPathCandidate = {
  path: string;
  length: number;
  sampleKeys: string[];
  confidence: number;
};
