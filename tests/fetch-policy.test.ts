import { describe, expect, test } from "bun:test";
import { executeWithFetchPolicy, resolveFetchPolicy } from "../utilities/fetch-policy.utility";

describe("fetch policy", () => {
  test("resolves per-feed overrides with bounded values", () => {
    const policy = resolveFetchPolicy({
      fetchPolicy: {
        feedRunTimeoutMs: 500,
        retryCount: 99,
        retryBackoffMode: "exponential",
      },
    });
    expect(policy.feedRunTimeoutMs).toBe(1000);
    expect(policy.retryCount).toBe(5);
    expect(policy.retryBackoffMode).toBe("exponential");
  });

  test("retries retryable status responses", async () => {
    let calls = 0;
    const result = await executeWithFetchPolicy<string>({
      url: "https://example.com",
      policy: { retryCount: 1, retryBackoffMode: "none" },
      axiosGet: async () => {
        calls++;
        return {
          status: calls === 1 ? 500 : 200,
          data: "ok",
          headers: {},
          request: { res: { responseUrl: "https://example.com" } },
        } as any;
      },
    });
    expect(result.data).toBe("ok");
    expect(result.attempts).toHaveLength(2);
  });

  test("does not retry ordinary 404 responses", async () => {
    const result = await executeWithFetchPolicy<string>({
      url: "https://example.com/missing",
      policy: { retryCount: 3, retryBackoffMode: "none" },
      axiosGet: async () => ({ status: 404, data: "missing", headers: {}, request: {} }) as any,
    });
    expect(result.status).toBe(404);
    expect(result.attempts).toHaveLength(1);
  });
});
