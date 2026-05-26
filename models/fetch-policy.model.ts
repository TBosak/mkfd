export type RetryBackoffMode = "none" | "fixed" | "exponential";
export type FetchMode = "standard" | "advanced";

export type FetchPolicy = {
  feedRunTimeoutMs: number;
  maxResponseSizeBytes: number;
  maxRedirects: number;
  retryCount: number;
  retryBackoffMode: RetryBackoffMode;
  retryBackoffMs: number;
  mode: FetchMode;
  fallbackToAdvanced: boolean;
  allowPrivateFetches: boolean;
  outboundFetchAllowlist: string[];
  userAgentProfileId?: string;
  proxyProfileId?: string;
};

export type FetchAttempt = {
  url: string;
  mode: FetchMode;
  attempt: number;
  status?: number;
  error?: string;
};

export type FetchPolicyResult<T = unknown> = {
  data: T;
  status: number;
  finalUrl: string;
  headers?: Record<string, unknown>;
  attempts: FetchAttempt[];
};
