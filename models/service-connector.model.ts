import type { ProtectedValue } from "./protected-value.model";
import type { NormalizedFeedItem } from "./normalized-feed-item.model";

export type ServiceConnectorServiceId = "jellyfin" | string;

export type ServiceConnectorAuthConfig = {
  mode: "none" | "apiKey" | "bearerToken" | "botToken" | "basic" | "oauth2" | "custom";
  fields: Record<string, ProtectedValue>;
};

export type ServiceConnectorConnectionConfig = {
  label?: string;
  auth: ServiceConnectorAuthConfig;
  settings?: Record<string, unknown>;
};

export type ServiceConnectorResourceRef = {
  type: string;
  id: string;
  label?: string;
  parentId?: string;
  parentLabel?: string;
};

export type ServiceConnectorCursorConfig = {
  strategy: "none" | "latestId" | "latestTimestamp" | "offset" | "page" | "cursor" | "serviceManaged";
  field?: string;
};

export type ServiceConnectorConfig = {
  service: ServiceConnectorServiceId;
  connection: ServiceConnectorConnectionConfig;
  resource: ServiceConnectorResourceRef;
  preset: string;
  options?: Record<string, unknown>;
  cursor?: ServiceConnectorCursorConfig;
};

export type ServiceConnectorDefinition = {
  id: string;
  label: string;
  description: string;
  authModes: ServiceConnectorAuthConfig["mode"][];
  presets: Array<{ id: string; label: string; description: string; resourceTypes: string[] }>;
  resourceTypes: Array<{ type: string; label: string }>;
};

export type ServiceConnectorFeedState = {
  service: string;
  resourceType: string;
  resourceId: string;
  preset: string;
  cursor?: string;
  lastSeenId?: string;
  lastSeenAt?: string;
  lastFetchedAt?: string;
  itemState?: Record<string, unknown>;
  rateLimit?: { limitedUntil?: string; lastWarning?: string };
};

export type ServiceConnectorFetchResult = {
  items: NormalizedFeedItem[];
  nextState?: Partial<ServiceConnectorFeedState>;
  warnings?: Array<{ code: string; message: string; detail?: string }>;
  health?: { ok: boolean; status?: number; message?: string; lastCheckedAt?: string };
};

export type ServiceConnectorAdapter = {
  definition: ServiceConnectorDefinition;
  testConnection(input: ServiceConnectorConfig, auth: Record<string, string>): Promise<{ ok: boolean; message?: string; status?: number }>;
  listResources(input: ServiceConnectorConfig, auth: Record<string, string>): Promise<ServiceConnectorResourceRef[]>;
  fetchItems(input: ServiceConnectorConfig, auth: Record<string, string>, state?: ServiceConnectorFeedState | null): Promise<ServiceConnectorFetchResult>;
};
