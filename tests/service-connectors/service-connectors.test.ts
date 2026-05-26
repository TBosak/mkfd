import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import axios from "axios";
import { serviceConnectorsRouter } from "../../routes/service-connectors";
import type { ServiceConnectorConfig } from "../../models/service-connector.model";
import { protectValue } from "../../utilities/protected-values.utility";
import { listServiceConnectors, getServiceConnectorPreset } from "../../utilities/service-connector-registry.utility";
import { runServiceConnector, testServiceConnector, listServiceConnectorResources } from "../../utilities/service-connector-runner.utility";
import { loadServiceConnectorState, saveServiceConnectorState } from "../../utilities/service-connector-state.utility";
import { validateFeedConfig } from "../../utilities/feed-config-validator.utility";

const encryptionKey = "1234567890123456";
const originalAxiosGet = axios.get;

afterEach(() => {
  axios.get = originalAxiosGet;
});

function startJellyfinMock() {
  axios.get = (async (url: string, options?: any) => {
    if (options?.headers?.["X-Emby-Token"] !== "secret") return { status: 401, statusText: "Unauthorized", data: {} };
    const path = new URL(url).pathname;
    if (path === "/System/Info") return { status: 200, statusText: "OK", data: { ServerName: "Test Jellyfin" } };
    if (path === "/Library/MediaFolders") return { status: 200, statusText: "OK", data: { Items: [{ Id: "movies", Name: "Movies" }] } };
    if (path === "/Items") return { status: 200, statusText: "OK", data: { Items: [{ Id: "item-1", Name: "Movie One", Overview: "A film", DateCreated: "2026-05-20T00:00:00Z", Type: "Movie", Genres: ["Drama"], ImageTags: { Primary: "img" } }] } };
    return { status: 404, statusText: "Not Found", data: {} };
  }) as typeof axios.get;
  return "https://jellyfin.example.com";
}

function config(serverUrl: string): ServiceConnectorConfig {
  return {
    service: "jellyfin",
    connection: {
      settings: { serverUrl },
      auth: { mode: "apiKey", fields: { apiKey: protectValue("secret", encryptionKey) } },
    },
    resource: { type: "library", id: "movies", label: "Movies" },
    preset: "latestItems",
    options: { limit: 10 },
  };
}

describe("service connectors", () => {
  test("registry lists Jellyfin without adapter functions", () => {
    const connectors = listServiceConnectors();
    expect(connectors.some((connector) => connector.id === "jellyfin")).toBe(true);
    expect(getServiceConnectorPreset("jellyfin", "latestItems")?.resourceTypes).toContain("library");
    expect((connectors[0] as any).fetchItems).toBeUndefined();
  });

  test("Jellyfin adapter tests connection, lists resources, and maps items", async () => {
    const serverUrl = startJellyfinMock();
    const input = config(serverUrl);
    await expect(testServiceConnector(input, encryptionKey)).resolves.toMatchObject({ ok: true, message: "Test Jellyfin" });
    await expect(listServiceConnectorResources(input, encryptionKey)).resolves.toEqual([{ type: "library", id: "movies", label: "Movies" }]);
    const result = await runServiceConnector(input, encryptionKey, null);
    expect(result.items[0]).toMatchObject({ title: "Movie One", guid: "item-1", categories: ["Movie", "Drama"] });
    expect(result.nextState?.lastSeenId).toBe("item-1");
  });

  test("state store reads and writes connector state by feed id", () => {
    const db = new Database(":memory:");
    expect(loadServiceConnectorState(db, "feed-1")).toBeNull();
    saveServiceConnectorState(db, "feed-1", { service: "jellyfin", resourceType: "library", resourceId: "movies", preset: "latestItems", lastSeenId: "item-1" });
    expect(loadServiceConnectorState(db, "feed-1")?.lastSeenId).toBe("item-1");
    db.close();
  });

  test("validation rejects plain auth values", () => {
    const result = validateFeedConfig({
      schemaVersion: 2,
      feedId: "connector",
      feedName: "Connector",
      feedType: "serviceConnector",
      refreshTime: 60,
      serviceConnector: {
        ...config("https://jellyfin.example.com"),
        connection: { settings: { serverUrl: "https://jellyfin.example.com" }, auth: { mode: "apiKey", fields: { apiKey: "plain" as any } } },
      },
    } as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path.includes("auth.fields.apiKey"))).toBe(true);
  });

  test("routes list and preview connector items", async () => {
    const serverUrl = startJellyfinMock();
    const app = serviceConnectorsRouter({ encryptionKey });
    const list = await app.request("/service-connectors");
    expect(await list.json()).toMatchObject({ connectors: [{ id: "jellyfin" }] });
    const preview = await app.request("/service-connectors/jellyfin/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config(serverUrl)),
    });
    const body = await preview.json();
    expect(body.items[0].title).toBe("Movie One");
  });
});
