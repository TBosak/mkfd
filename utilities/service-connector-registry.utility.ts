import type { ServiceConnectorAdapter, ServiceConnectorDefinition } from "../models/service-connector.model";
import { jellyfinConnector } from "./service-connectors/jellyfin.connector";

const registry: Record<string, ServiceConnectorAdapter> = {
  jellyfin: jellyfinConnector,
};

export function listServiceConnectors(): ServiceConnectorDefinition[] {
  return Object.values(registry).map((adapter) => adapter.definition);
}

export function getServiceConnector(id: string): ServiceConnectorAdapter {
  const adapter = registry[id];
  if (!adapter) throw new Error(`Unknown service connector: ${id}`);
  return adapter;
}

export function getServiceConnectorPreset(service: string, preset: string) {
  return getServiceConnector(service).definition.presets.find((item) => item.id === preset);
}
