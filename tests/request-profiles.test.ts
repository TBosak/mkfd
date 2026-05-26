import { describe, expect, test } from "bun:test";
import {
  clearRequestProfiles,
  listRequestProfiles,
  resolveEffectiveRequestProfile,
  upsertProxyProfile,
  upsertUserAgentProfile,
} from "../utilities/request-profile.utility";
import { executeWithFetchPolicy } from "../utilities/fetch-policy.utility";

describe("request profiles", () => {
  test("validates and masks proxy profile secrets", () => {
    clearRequestProfiles();
    const created = upsertProxyProfile({
      name: "Proxy",
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
      password: "secret",
      enabled: true,
    }, "1234567890123456");
    expect(created.password).toMatchObject({ value: "********" });
    expect(listRequestProfiles().proxyProfiles[0].password).toMatchObject({ value: "********" });
  });

  test("resolves user-agent profile and per-feed override precedence", () => {
    clearRequestProfiles();
    const ua = upsertUserAgentProfile({ name: "UA", userAgent: "Profile UA/1.0", enabled: true });
    expect(resolveEffectiveRequestProfile({ config: { request: { userAgentProfileId: ua.id } } }).userAgent).toBe("Profile UA/1.0");
    expect(resolveEffectiveRequestProfile({ config: { request: { userAgentProfileId: ua.id, userAgentOverride: "Override UA/1.0" } } }).userAgent).toBe("Override UA/1.0");
  });

  test("fetch executor applies resolved user-agent", async () => {
    const result = await executeWithFetchPolicy({
      url: "https://example.com",
      requestProfile: { userAgent: "Profile UA/1.0" },
      axiosGet: async (_url, config) => {
        expect(config.headers?.["User-Agent"]).toBe("Profile UA/1.0");
        return { status: 200, data: "ok", headers: {}, request: {} } as any;
      },
    });
    expect(result.status).toBe(200);
  });
});
