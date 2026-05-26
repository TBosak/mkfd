import type { AxiosRequestConfig } from "axios";
import { resolveProtectedValues } from "./protected-values.utility";
import type { OutboundFetchPolicyOptions } from "./outbound-fetch-policy.utility";
import type { WebScrapingFeedConfig } from "../models/feed-config.model";
import { executeWithFetchPolicy, resolveFetchPolicy } from "./fetch-policy.utility";
import { resolveEffectiveRequestProfile } from "./request-profile.utility";

function encodeFields(fields: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, String(entry)));
    } else if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  return params;
}

export async function fetchWebScrapingHtml(args: {
  feedConfig: WebScrapingFeedConfig;
  policyOptions: OutboundFetchPolicyOptions;
  encryptionKey?: string;
  headers?: Record<string, unknown>;
  cookieString?: string;
}): Promise<{ html: string; status: number; finalUrl: string }> {
  const { feedConfig, policyOptions, encryptionKey = "", headers = {}, cookieString = "" } = args;
  const baseUrl = resolveProtectedValues(feedConfig.config.baseUrl, { encryptionKey });
  const request = feedConfig.config.request ?? { mode: "simple" as const };
  const resolvedHeaders = resolveProtectedValues(headers, { encryptionKey });
  const commonHeaders = {
    ...resolvedHeaders,
    ...(cookieString && { Cookie: cookieString }),
  };
  const requestProfile = resolveEffectiveRequestProfile(feedConfig, encryptionKey);

  if (request.mode !== "form") {
    const response = await executeWithFetchPolicy<string>({
      url: baseUrl,
      policy: resolveFetchPolicy(feedConfig),
      outboundPolicy: policyOptions,
      requestProfile,
      axiosConfig: {
      headers: commonHeaders,
      maxContentLength: 2 * 1024 * 1024,
      maxBodyLength: 2 * 1024 * 1024,
      },
    });
    return { html: String(response.data ?? ""), status: response.status, finalUrl: response.finalUrl };
  }

  const actionUrl = new URL(request.actionUrl || baseUrl, baseUrl).toString();
  const fields = resolveProtectedValues(request.fields ?? {}, { encryptionKey });
  const method = request.method || "GET";
  let url = actionUrl;
  const config: AxiosRequestConfig = {
    method,
    headers: commonHeaders,
    maxContentLength: 2 * 1024 * 1024,
    maxBodyLength: 2 * 1024 * 1024,
  };

  if (method === "GET") {
    const params = encodeFields(fields);
    url = `${actionUrl}${actionUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  } else if (request.encoding === "application/json") {
    config.headers = { ...commonHeaders, "Content-Type": "application/json" };
    config.data = fields;
  } else {
    config.headers = { ...commonHeaders, "Content-Type": "application/x-www-form-urlencoded" };
    config.data = encodeFields(fields).toString();
  }

  const response = await executeWithFetchPolicy<string>({
    url,
    policy: resolveFetchPolicy(feedConfig),
    outboundPolicy: policyOptions,
    requestProfile,
    axiosConfig: config,
  });
  return { html: String(response.data ?? ""), status: response.status, finalUrl: response.finalUrl };
}
