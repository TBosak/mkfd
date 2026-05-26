/**
 * Feed Config Route Adapter Utility
 *
 * Route-level adapter that wraps the Feed Config Formalization caster/validator.
 * Handles route-level form parsing concerns (sample HTML fetching, policy checks)
 * and delegates config shape to existing utilities.
 */

import axios from "axios";
import {
  assertOutboundFetchAllowed,
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

export async function axiosGetWithPolicyRedirects(
  url: string,
  config: import("axios").AxiosRequestConfig,
  policyOptions: OutboundFetchPolicyOptions,
  maxRedirects = 5,
): Promise<import("axios").AxiosResponse> {
  await assertOutboundFetchAllowed(url, policyOptions);

  let currentUrl = url;
  let currentResponse = await axios.get(currentUrl, { ...config, maxRedirects: 0 });

  for (let hop = 0; hop < maxRedirects; hop++) {
    if (!REDIRECT_STATUSES.has(currentResponse.status)) {
      return currentResponse;
    }
    const location = currentResponse.headers["location"];
    if (!location) {
      throw new Error(`Redirect from "${currentUrl}" had no Location header.`);
    }
    const nextUrl = new URL(location, currentUrl).toString();
    await assertOutboundFetchAllowed(nextUrl, policyOptions);
    currentUrl = nextUrl;
    currentResponse = await axios.get(currentUrl, { ...config, maxRedirects: 0 });
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
    // SSRF protection: validate FlareSolverr server URL before posting to it.
    await assertOutboundFetchAllowed(`${flaresolverrUrl}/v1`, policyOptions);

    const payload: any = {
      cmd: "request.get",
      url: feedUrl,
      maxTimeout: flaresolverrTimeout,
    };

    if (body.cookies && body.cookies.length > 0) {
      payload.cookies = body.cookies.map((c: any) => ({
        name: c.name,
        value: c.value,
      }));
    }

    const flaresolverrResponse = await axios.post(
      `${flaresolverrUrl}/v1`,
      payload,
      {
        headers: { "Content-Type": "application/json" },
        timeout: flaresolverrTimeout + 5000,
      },
    );

    if (
      flaresolverrResponse.data?.solution?.response &&
      flaresolverrResponse.data?.solution?.status === 200
    ) {
      return flaresolverrResponse.data.solution.response;
    } else {
      console.warn(
        "FlareSolverr failed for sample HTML:",
        flaresolverrResponse.data?.message,
      );
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
