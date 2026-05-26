import axios from "axios";
import type { ServiceConnectorAdapter, ServiceConnectorConfig, ServiceConnectorResourceRef } from "../../models/service-connector.model";
import type { NormalizedFeedItem } from "../../models/normalized-feed-item.model";

function serverUrl(config: ServiceConnectorConfig): string {
  return String(config.connection.settings?.serverUrl ?? "").replace(/\/$/, "");
}

function headers(auth: Record<string, string>) {
  return { "X-Emby-Token": auth.apiKey ?? "" };
}

export const jellyfinConnector: ServiceConnectorAdapter = {
  definition: {
    id: "jellyfin",
    label: "Jellyfin",
    description: "Create feeds from recently added Jellyfin media.",
    authModes: ["apiKey"],
    presets: [{ id: "latestItems", label: "Latest Items", description: "Recently added media items", resourceTypes: ["library"] }],
    resourceTypes: [{ type: "library", label: "Library" }],
  },

  async testConnection(config, auth) {
    const response = await axios.get(`${serverUrl(config)}/System/Info`, { headers: headers(auth), validateStatus: () => true });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, message: response.data?.ServerName ?? response.statusText };
  },

  async listResources(config, auth): Promise<ServiceConnectorResourceRef[]> {
    const response = await axios.get(`${serverUrl(config)}/Library/MediaFolders`, { headers: headers(auth) });
    return (response.data?.Items ?? []).map((item: any) => ({
      type: "library",
      id: String(item.Id),
      label: item.Name ?? String(item.Id),
    }));
  },

  async fetchItems(config, auth) {
    const limit = Number(config.options?.limit) || 50;
    const params: Record<string, string | number> = {
      Recursive: "true",
      SortBy: "DateCreated",
      SortOrder: "Descending",
      Limit: limit,
      Fields: "Overview,DateCreated,PremiereDate,Genres,PrimaryImageAspectRatio",
    };
    if (config.resource.id) params.ParentId = config.resource.id;
    const response = await axios.get(`${serverUrl(config)}/Items`, { headers: headers(auth), params });
    const items: NormalizedFeedItem[] = (response.data?.Items ?? []).map((item: any) => ({
      title: item.Name,
      link: `${serverUrl(config)}/web/index.html#!/details?id=${item.Id}`,
      description: item.Overview,
      guid: item.Id,
      pubDate: item.DateCreated ?? item.PremiereDate,
      categories: [item.Type, ...(item.Genres ?? [])].filter(Boolean),
      image: item.ImageTags?.Primary ? `${serverUrl(config)}/Items/${item.Id}/Images/Primary` : undefined,
      raw: item,
    }));
    return {
      items,
      nextState: {
        service: "jellyfin",
        resourceType: config.resource.type,
        resourceId: config.resource.id,
        preset: config.preset,
        lastSeenId: items[0]?.guid,
        lastSeenAt: items[0]?.pubDate ? String(items[0].pubDate) : undefined,
        lastFetchedAt: new Date().toISOString(),
      },
    };
  },
};
