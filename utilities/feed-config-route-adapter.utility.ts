/**
 * Feed Config Route Adapter Utility
 *
 * Route-level adapter that wraps the Feed Config Formalization caster/validator.
 * Handles route-level form parsing concerns (sample HTML fetching, policy checks)
 * and delegates config shape to existing utilities.
 */

import axios from "axios";
import { solveWithFlareSolverr } from "../lib/outbound/flaresolverr-adapter";
import { redact } from "./log-redaction.utility";
import {
  requestPinnedAddress,
  requestPinnedWithConfig,
} from "../lib/outbound/pinned-request";
import {
  assertOutboundFetchAllowed,
  assertAndResolveOutboundTarget,
  type ValidatedTarget,
  mergeFeedPolicyOptions,
  type OutboundFetchPolicyOptions,
} from "./outbound-fetch-policy.utility";

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

export function normalizeUrl(url: string): string {
  if (!url) return url;
  return url.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// SSRF-aware redirect-following fetch (re-exported from shared logic)
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The method-aware form of the executor, for flows that need a body — the
 * preview API path and the worker's API fetch.
 *
 * Both of those previously carried their own inline redirect loop, with a
 * comment saying it existed only because the shared helper was GET-only. This
 * is that helper: one validation path, one pin, one deadline, whatever the
 * method.
 */
export async function requestWithPolicyRedirects(
  url: string,
  config: import("axios").AxiosRequestConfig,
  policyOptions: OutboundFetchPolicyOptions,
  maxRedirects = 5,
  deadlineAt?: number,
): Promise<import("axios").AxiosResponse> {
  let validated = await assertAndResolveOutboundTarget(url, policyOptions);

  let currentUrl = url;
  let currentResponse = await requestPinnedWithConfig(currentUrl, validated.address, config, deadlineAt);

  for (let hop = 0; hop < maxRedirects; hop++) {
    if (!REDIRECT_STATUSES.has(currentResponse.status)) return currentResponse;

    const location = currentResponse.headers["location"];
    if (!location) {
      throw new Error(`Redirect from "${currentUrl}" had no Location header.`);
    }
    const nextUrl = new URL(location, currentUrl).toString();
    validated = await assertAndResolveOutboundTarget(nextUrl, policyOptions);
    currentUrl = nextUrl;
    currentResponse = await requestPinnedWithConfig(currentUrl, validated.address, config, deadlineAt);
  }

  if (!REDIRECT_STATUSES.has(currentResponse.status)) return currentResponse;
  throw new Error(`Too many redirects (>${maxRedirects}) following "${url}".`);
}

export async function axiosGetWithPolicyRedirects(
  url: string,
  config: import("axios").AxiosRequestConfig,
  policyOptions: OutboundFetchPolicyOptions,
  maxRedirects = 5,
  deadlineAt?: number,
): Promise<import("axios").AxiosResponse> {
  let validated = await assertAndResolveOutboundTarget(url, policyOptions);

  let currentUrl = url;
  let currentResponse = await requestPinnedAddress(currentUrl, validated.address, config, deadlineAt);

  for (let hop = 0; hop < maxRedirects; hop++) {
    if (!REDIRECT_STATUSES.has(currentResponse.status)) {
      return currentResponse;
    }
    const location = currentResponse.headers["location"];
    if (!location) {
      throw new Error(`Redirect from "${currentUrl}" had no Location header.`);
    }
    const nextUrl = new URL(location, currentUrl).toString();
    // Every hop is revalidated against the full policy, not merely counted:
    // a permitted first hop redirecting to a private address must be refused
    // at the hop that introduces it.
    validated = await assertAndResolveOutboundTarget(nextUrl, policyOptions);
    currentUrl = nextUrl;
    currentResponse = await requestPinnedAddress(currentUrl, validated.address, config, deadlineAt);
  }

  if (!REDIRECT_STATUSES.has(currentResponse.status)) {
    return currentResponse;
  }
  throw new Error(`Too many redirects (>${maxRedirects}) following "${url}".`);
}

// ---------------------------------------------------------------------------
// Sample HTML fetching
// ---------------------------------------------------------------------------

export interface FetchSampleHtmlOptions {
  feedUrl: string;
  body: Record<string, any>;
  policyOptions: OutboundFetchPolicyOptions;
}

/**
 * Fetches sample HTML for a webScraping feed URL.
 * Respects FlareSolverr config and SSRF policy options.
 * Returns empty string on transient network errors (not on policy errors).
 */
export async function fetchSampleHtml(opts: FetchSampleHtmlOptions): Promise<string> {
  const { feedUrl, body, policyOptions } = opts;

  const flaresolverrData = body.flaresolverr || {};
  const flaresolverrEnabled =
    typeof flaresolverrData.enabled === "boolean"
      ? flaresolverrData.enabled
      : false;
  const flaresolverrUrl = normalizeUrl(flaresolverrData.serverUrl || "");
  const flaresolverrTimeout =
    parseInt(flaresolverrData.timeout || "60000", 10) || 60000;

  if (flaresolverrEnabled && flaresolverrUrl) {
    // Routed through the one approved FlareSolverr adapter, which validates the
    // endpoint and the target separately and bounds the whole call.
    try {
      const solved = await solveWithFlareSolverr({
        serverUrl: flaresolverrUrl,
        targetUrl: feedUrl,
        maxTimeoutMs: flaresolverrTimeout,
        cookies: (body.cookies ?? []).map((c: { name: string; value: string }) => ({
          name: c.name,
          value: c.value,
        })),
        policyOptions,
        budgetMs: flaresolverrTimeout,
      });
      return solved.html;
    } catch (error) {
      // A policy refusal propagates. Sample-HTML fetching is best-effort about
      // *transport* failures — an unreachable FlareSolverr should not fail the
      // whole form-parsing path — but "this endpoint or target is not allowed"
      // is a decision, not a hiccup, and swallowing it would turn a refusal
      // into a silently empty page. The original code kept the policy check
      // outside its try for the same reason.
      const message = String((error as Error)?.message ?? "");
      if (message.startsWith("Outbound fetch blocked")) throw error;
      // The endpoint is not logged — it can carry credentials.
      console.warn("FlareSolverr failed for sample HTML:", redact({ message }));
      return "";
    }
  } else {
    const response = await axiosGetWithPolicyRedirects(
      feedUrl,
      {
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
      },
      policyOptions,
    );
    return response.data;
  }
}

// ---------------------------------------------------------------------------
// Parse body helper (form-data drill chains)
// ---------------------------------------------------------------------------

/**
 * Parses a raw form body (multipart or URL-encoded) and assembles structured
 * drill chain arrays from flat bracket-notation keys.
 */
export function assembleFormBody(raw: Record<string, any>): Record<string, any> {
  const body = { ...raw };
  const potentialDrillChainKeys = Object.keys(body).filter((k) =>
    k.includes("DrillChain"),
  );
  const structuredDrillChains: Record<string, any[]> = {};

  for (const key of potentialDrillChainKeys) {
    const drillChainMatch = key.match(/^(\w+)DrillChain\[(\d+)\]\[(\w+)\]$/);
    if (drillChainMatch) {
      const fieldName = drillChainMatch[1];
      const index = parseInt(drillChainMatch[2], 10);
      const property = drillChainMatch[3];
      const chainKey = `${fieldName}DrillChain`;
      const value = body[key];

      if (!structuredDrillChains[chainKey]) {
        structuredDrillChains[chainKey] = [];
      }
      while (structuredDrillChains[chainKey].length <= index) {
        structuredDrillChains[chainKey].push({});
      }
      if (value !== null && value !== undefined) {
        structuredDrillChains[chainKey][index][property] = value;
        delete body[key];
      }
    }
  }

  Object.assign(body, structuredDrillChains);
  return body;
}
