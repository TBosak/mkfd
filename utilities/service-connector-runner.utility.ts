import type { ServiceConnectorConfig, ServiceConnectorFetchResult, ServiceConnectorFeedState } from "../models/service-connector.model";
import { getServiceConnector } from "./service-connector-registry.utility";
import { resolveProtectedValues } from "./protected-values.utility";

export function resolveServiceConnectorAuth(config: ServiceConnectorConfig, encryptionKey: string): Record<string, string> {
  return resolveProtectedValues(config.connection.auth.fields, { encryptionKey }) as Record<string, string>;
}

export async function testServiceConnector(config: ServiceConnectorConfig, encryptionKey: string) {
  return getServiceConnector(config.service).testConnection(config, resolveServiceConnectorAuth(config, encryptionKey));
}

export async function listServiceConnectorResources(config: ServiceConnectorConfig, encryptionKey: string) {
  return getServiceConnector(config.service).listResources(config, resolveServiceConnectorAuth(config, encryptionKey));
}

export async function runServiceConnector(config: ServiceConnectorConfig, encryptionKey: string, state?: ServiceConnectorFeedState | null): Promise<ServiceConnectorFetchResult> {
  const adapter = getServiceConnector(config.service);
  const preset = adapter.definition.presets.find((item) => item.id === config.preset);
  if (!preset) throw new Error(`Unknown preset "${config.preset}" for ${config.service}`);
  return adapter.fetchItems(config, resolveServiceConnectorAuth(config, encryptionKey), state);
}
