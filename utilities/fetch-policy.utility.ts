import type { AxiosRequestConfig, AxiosResponse } from "axios";
import type { FetchAttempt, FetchPolicy, FetchPolicyResult } from "../models/fetch-policy.model";
import type { EffectiveRequestProfile } from "../models/request-profile.model";
import { axiosGetWithPolicyRedirects } from "./feed-config-route-adapter.utility";
import { getGlobalFetchPolicyOptions, parseAllowlist, type OutboundFetchPolicyOptions } from "./outbound-fetch-policy.utility";

const DEFAULT_POLICY: FetchPolicy = {
  feedRunTimeoutMs: 60000,
  maxResponseSizeBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
  retryCount: 1,
  retryBackoffMode: "fixed",
  retryBackoffMs: 250,
  mode: "standard",
  fallbackToAdvanced: false,
  allowPrivateFetches: false,
  outboundFetchAllowlist: [],
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function resolveFetchPolicy(feedConfig: Record<string, any> = {}, env: NodeJS.ProcessEnv = process.env): FetchPolicy {
  const fetchPolicy = feedConfig.fetchPolicy ?? {};
  const global = getGlobalFetchPolicyOptions();
  return {
    feedRunTimeoutMs: clamp(fetchPolicy.feedRunTimeoutMs ?? feedConfig.config?.timeoutMs ?? env.FEED_RUN_TIMEOUT_MS, 1000, 10 * 60 * 1000, DEFAULT_POLICY.feedRunTimeoutMs),
    maxResponseSizeBytes: clamp(fetchPolicy.maxResponseSizeBytes ?? env.FETCH_MAX_RESPONSE_SIZE_BYTES, 64 * 1024, 20 * 1024 * 1024, DEFAULT_POLICY.maxResponseSizeBytes),
    maxRedirects: clamp(fetchPolicy.maxRedirects ?? env.FETCH_MAX_REDIRECTS, 0, 10, DEFAULT_POLICY.maxRedirects),
    retryCount: clamp(fetchPolicy.retryCount ?? env.FETCH_RETRY_COUNT, 0, 5, DEFAULT_POLICY.retryCount),
    retryBackoffMode: ["none", "fixed", "exponential"].includes(fetchPolicy.retryBackoffMode) ? fetchPolicy.retryBackoffMode : DEFAULT_POLICY.retryBackoffMode,
    retryBackoffMs: clamp(fetchPolicy.retryBackoffMs ?? env.FETCH_RETRY_BACKOFF_MS, 0, 30000, DEFAULT_POLICY.retryBackoffMs),
    mode: fetchPolicy.mode === "advanced" ? "advanced" : "standard",
    fallbackToAdvanced: Boolean(fetchPolicy.fallbackToAdvanced),
    allowPrivateFetches: fetchPolicy.allowPrivateFetches ?? global.allowPrivateFetches ?? DEFAULT_POLICY.allowPrivateFetches,
    outboundFetchAllowlist: fetchPolicy.outboundFetchAllowlist ?? global.allowlist ?? parseAllowlist(env.OUTBOUND_FETCH_ALLOWLIST),
    userAgentProfileId: fetchPolicy.userAgentProfileId,
    proxyProfileId: fetchPolicy.proxyProfileId,
  };
}

function shouldRetry(status?: number, error?: unknown): boolean {
  if (error) return true;
  if (!status) return false;
  return status === 408 || status === 429 || status >= 500;
}

function backoffMs(policy: FetchPolicy, attempt: number): number {
  if (policy.retryBackoffMode === "none") return 0;
  if (policy.retryBackoffMode === "exponential") return policy.retryBackoffMs * 2 ** Math.max(0, attempt - 1);
  return policy.retryBackoffMs;
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithFetchPolicy<T = unknown>(args: {
  url: string;
  policy?: Partial<FetchPolicy>;
  axiosConfig?: AxiosRequestConfig;
  outboundPolicy?: OutboundFetchPolicyOptions;
  axiosGet?: typeof axiosGetWithPolicyRedirects;
  requestProfile?: EffectiveRequestProfile;
}): Promise<FetchPolicyResult<T>> {
  const policy = { ...DEFAULT_POLICY, ...(args.policy ?? {}) };
  const startedAt = Date.now();
  const deadline = startedAt + policy.feedRunTimeoutMs;
  const attempts: FetchAttempt[] = [];
  const outboundPolicy = args.outboundPolicy ?? {
    allowPrivateFetches: policy.allowPrivateFetches,
    allowlist: policy.outboundFetchAllowlist,
  };
  const axiosGet = args.axiosGet ?? axiosGetWithPolicyRedirects;
  let lastError: unknown;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= policy.retryCount + 1; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Fetch policy deadline exceeded before request");
    try {
      const response: AxiosResponse = await axiosGet(args.url, {
        ...args.axiosConfig,
        headers: {
          ...(args.requestProfile?.userAgent ? { "User-Agent": args.requestProfile.userAgent } : {}),
          ...(args.requestProfile?.headers ?? {}),
          ...(args.axiosConfig?.headers ?? {}),
        },
        proxy: args.requestProfile?.proxy && args.requestProfile.proxy.protocol !== "socks5"
          ? {
              protocol: args.requestProfile.proxy.protocol,
              host: args.requestProfile.proxy.host,
              port: args.requestProfile.proxy.port,
              auth: args.requestProfile.proxy.auth?.username ? args.requestProfile.proxy.auth as any : undefined,
            }
          : args.axiosConfig?.proxy,
        timeout: Math.min(remainingMs, Number(args.axiosConfig?.timeout ?? remainingMs)),
        maxContentLength: policy.maxResponseSizeBytes,
        maxBodyLength: policy.maxResponseSizeBytes,
        validateStatus: () => true,
      }, outboundPolicy, policy.maxRedirects);
      lastStatus = response.status;
      attempts.push({ url: args.url, mode: policy.mode, attempt, status: response.status });
      if (!shouldRetry(response.status)) {
        return {
          data: response.data as T,
          status: response.status,
          finalUrl: response.request?.res?.responseUrl ?? args.url,
          headers: response.headers as Record<string, unknown>,
          attempts,
        };
      }
    } catch (error: any) {
      lastError = error;
      attempts.push({ url: args.url, mode: policy.mode, attempt, error: error?.message ?? "request failed" });
    }
    if (attempt <= policy.retryCount) await sleep(backoffMs(policy, attempt));
  }

  throw new Error(`Fetch failed after ${attempts.length} attempt(s): ${lastError instanceof Error ? lastError.message : lastStatus ?? "unknown error"}`);
}
