import axios, { type AxiosRequestConfig } from "axios";
import {
  buildFeedObject,
  buildFeedObjectFromApiData,
} from "../utilities/rss-builder.utility";
import {
  writeAllFeedFormats,
  serializeAllFeedFormats,
  extractFeedItemSnapshots,
} from "../utilities/feed-output.utility";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
// parseCookiesForPlaywright might be simplified or removed if cookies are directly structured correctly
// import { parseCookiesForPlaywright } from "../utilities/data-handler.utility"
import { chromium } from "patchright";
import { getChromiumLaunchOptions } from "../utilities/chrome-extensions.utility";
import { getRandomUserAgent } from "../utilities/user-agents.utility";
import { loadDateIndex, saveDateIndex, storeFeedHistory } from "../utilities/feed-history.utility";
import { resolveProtectedValues } from "../utilities/protected-values.utility";
import { assertOutboundFetchAllowed, mergeFeedPolicyOptions, parseAllowlist, type OutboundFetchPolicyOptions } from "../utilities/outbound-fetch-policy.utility";
import { runFeedTransformer } from "../utilities/feed-transformer.utility";
import { fetchWebScrapingHtml } from "../utilities/web-scraping-fetcher.utility";
import { initDb } from "../lib/analytics/db";
import { buildFeedFromNormalizedItems } from "../utilities/normalized-feed-builder.utility";
import { fetchAndBuildSitemapItems } from "../utilities/sitemap.utility";
import { fetchAndBuildCalendarItems } from "../utilities/calendar-feed.utility";
import { executeGraphQLFeed, buildGraphQLItems } from "../utilities/graphql-feed.utility";
import { readWebhookEvents, buildWebhookItems } from "../utilities/webhook-feed.utility";
import { scanFilesystemFeed } from "../utilities/filesystem-feed.utility";
import { runServiceConnector } from "../utilities/service-connector-runner.utility";
import { loadServiceConnectorState, saveServiceConnectorState } from "../utilities/service-connector-state.utility";
import { getDb } from "../lib/analytics/db";

declare var self: Worker;
initDb();
const rssDir = "./public/feeds";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Performs an axios GET that manually follows redirects, re-checking the
 * outbound fetch policy before each hop. Prevents redirect-based SSRF.
 *
 * Validates the initial URL first (defence-in-depth). Then makes the initial
 * request outside the redirect loop. The redirect loop runs at most
 * `maxRedirects` times, so total network calls = 1 + maxRedirects.
 */
async function axiosGetWithPolicyRedirects(
  url: string,
  config: AxiosRequestConfig,
  policyOptions: OutboundFetchPolicyOptions,
  maxRedirects = 5,
): Promise<import("axios").AxiosResponse> {
  // Defence-in-depth: validate the initial URL even if the caller already did.
  await assertOutboundFetchAllowed(url, policyOptions);

  let currentUrl = url;
  // Initial request (not a redirect hop).
  let currentResponse = await axios.get(currentUrl, { ...config, maxRedirects: 0 });

  // Follow up to maxRedirects redirect hops.
  for (let hop = 0; hop < maxRedirects; hop++) {
    if (!REDIRECT_STATUSES.has(currentResponse.status)) {
      return currentResponse;
    }
    const location = currentResponse.headers["location"];
    if (!location) {
      throw new Error(`Redirect from "${currentUrl}" had no Location header.`);
    }
    // Resolve relative redirects against the current URL
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

async function fetchDataAndUpdateFeed(rawConfig: Record<string, unknown>) {
  const feedConfig = normalizeLoadedFeedConfig(rawConfig);
  const encKey = process.env.ENCRYPTION_KEY ?? "";
  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let timedOut = false;
  let lastBuildResult: import("../utilities/rss-builder.utility").BuildRSSResult | null = null;
  let lastWebhookStatus: "success" | "failed" | "skipped" | null = null;
  let lastWebhookError: string | null = null;

  try {
    let lastFeedObject: import("feed").Feed | null = null;
    const dateIndex = await loadDateIndex(feedConfig.feedId);
    const knownHashes = new Map(dateIndex);

    // SSRF protection: validate the feed URL before any fetch.
    // Migration note: replace env reads with settings lookups when Settings Page lands.
    const feedUrl =
      feedConfig.feedType === "webScraping" || feedConfig.feedType === "api" || feedConfig.feedType === "rest"
        ? ((feedConfig.config?.baseUrl || "") + (feedConfig.config?.route || "")).trim()
        : feedConfig.feedType === "sitemap" ? (feedConfig as any).sitemap?.url
        : feedConfig.feedType === "calendar" ? (feedConfig as any).calendar?.url
        : feedConfig.feedType === "graphql" ? (feedConfig as any).graphql?.endpoint
        : feedConfig.feedType === "serviceConnector" ? (feedConfig as any).serviceConnector?.connection?.settings?.serverUrl
        : null;

    // Build the effective outbound-fetch policy for this feed (used for initial
    // check and for re-checking redirect targets).
    const globalAllowPrivate = process.env.ALLOW_PRIVATE_FETCHES === "true";
    const globalAllowlist = parseAllowlist(process.env.OUTBOUND_FETCH_ALLOWLIST);
    const globalPolicyOptions: OutboundFetchPolicyOptions = {
      allowPrivateFetches: globalAllowPrivate,
      allowlist: globalAllowlist,
    };
    const effectivePolicyOptions = mergeFeedPolicyOptions(globalPolicyOptions, feedConfig as any);

    if (feedUrl) {
      await assertOutboundFetchAllowed(feedUrl, effectivePolicyOptions);
    }

    // Common: Convert cookie array to string for Axios, or format for Playwright
    const cookieString = (feedConfig.cookies || [])
      .map((c: any) => {
        const val = resolveProtectedValues(c.value, { encryptionKey: encKey });
        return `${c.name}=${val}`;
      })
      .join("; ");

    if (feedConfig.feedType === "feedTransformer") {
      const transformerResult = await runFeedTransformer(feedConfig as any, {
        policyOptions: effectivePolicyOptions,
      });
      lastFeedObject = transformerResult.feed;
      lastBuildResult = {
        xml: transformerResult.feed.rss2(),
        metrics: {
          itemCount: transformerResult.metrics.itemCount,
          selectorMatches: null,
          dateFallbacks: 0,
          duplicateGuids: transformerResult.metrics.duplicateGuids,
        },
      };
    } else if (feedConfig.feedType === "sitemap") {
      const items = await fetchAndBuildSitemapItems((feedConfig as any).sitemap);
      lastFeedObject = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items });
      lastBuildResult = { xml: lastFeedObject.rss2(), metrics: { itemCount: items.length, selectorMatches: null, dateFallbacks: 0, duplicateGuids: 0 } };
    } else if (feedConfig.feedType === "calendar") {
      const items = await fetchAndBuildCalendarItems((feedConfig as any).calendar);
      lastFeedObject = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items });
      lastBuildResult = { xml: lastFeedObject.rss2(), metrics: { itemCount: items.length, selectorMatches: null, dateFallbacks: 0, duplicateGuids: 0 } };
    } else if (feedConfig.feedType === "graphql") {
      const result = await executeGraphQLFeed({
        endpoint: (feedConfig as any).graphql.endpoint,
        headers: resolveProtectedValues((feedConfig as any).graphql.headers ?? {}, { encryptionKey: encKey }),
        query: (feedConfig as any).graphql.query,
        variables: (feedConfig as any).graphql.variables,
        operationName: (feedConfig as any).graphql.operationName,
        timeoutMs: (feedConfig as any).graphql.timeoutMs,
      });
      const items = buildGraphQLItems(result.data, (feedConfig as any).graphql);
      lastFeedObject = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items });
      lastBuildResult = { xml: lastFeedObject.rss2(), metrics: { itemCount: items.length, selectorMatches: null, dateFallbacks: 0, duplicateGuids: 0 } };
    } else if (feedConfig.feedType === "webhook") {
      const items = buildWebhookItems(await readWebhookEvents(feedConfig.feedId), (feedConfig as any).webhookFeed);
      lastFeedObject = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items });
      lastBuildResult = { xml: lastFeedObject.rss2(), metrics: { itemCount: items.length, selectorMatches: null, dateFallbacks: 0, duplicateGuids: 0 } };
    } else if (feedConfig.feedType === "filesystem") {
      const result = await scanFilesystemFeed((feedConfig as any).filesystem, process.env.FILESYSTEM_FEEDS_ROOT ?? process.cwd(), feedConfig.feedId);
      lastFeedObject = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items: result.items });
      lastBuildResult = { xml: lastFeedObject.rss2(), metrics: { itemCount: result.items.length, selectorMatches: null, dateFallbacks: 0, duplicateGuids: 0 } };
    } else if (feedConfig.feedType === "serviceConnector") {
      const db = getDb();
      const priorState = loadServiceConnectorState(db, feedConfig.feedId);
      const result = await runServiceConnector((feedConfig as any).serviceConnector, encKey, priorState);
      if (result.nextState) saveServiceConnectorState(db, feedConfig.feedId, result.nextState as any);
      lastFeedObject = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items: result.items });
      lastBuildResult = { xml: lastFeedObject.rss2(), metrics: { itemCount: result.items.length, selectorMatches: null, dateFallbacks: 0, duplicateGuids: 0 } };
    } else if (feedConfig.feedType === "webScraping") {
      if (feedConfig.flaresolverr?.enabled) {
        // FlareSolverr scraping
        const flaresolverrUrl =
          feedConfig.flaresolverr.serverUrl || "http://localhost:8191";
        const timeout = feedConfig.flaresolverr.timeout || 60000;

        // SSRF protection: validate FlareSolverr server URL before posting to it.
        await assertOutboundFetchAllowed(`${flaresolverrUrl}/v1`, effectivePolicyOptions);

        const flaresolverrPayload: any = {
          cmd: "request.get",
          url: feedConfig.config.baseUrl,
          maxTimeout: timeout,
        };

        // Add cookies if present
        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          flaresolverrPayload.cookies = feedConfig.cookies.map((c: any) => ({
            name: c.name,
            value: resolveProtectedValues(c.value, { encryptionKey: encKey }),
          }));
        }

        console.log(
          `[Feed ${feedConfig.feedId}] Using FlareSolverr at ${flaresolverrUrl}`
        );

        const flaresolverrResponse = await axios.post(
          `${flaresolverrUrl}/v1`,
          flaresolverrPayload,
          {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: timeout + 5000, // Add 5 seconds buffer to axios timeout
          }
        );

        httpStatus = flaresolverrResponse.data?.solution?.status ?? flaresolverrResponse.status ?? null;

        if (
          flaresolverrResponse.data?.solution?.response &&
          flaresolverrResponse.data?.solution?.status === 200
        ) {
          const html = flaresolverrResponse.data.solution.response;
          const flareResult = await buildFeedObject(html, feedConfig, dateIndex);
          lastFeedObject = flareResult.feed;
          lastBuildResult = { xml: flareResult.feed.rss2(), metrics: flareResult.metrics };
        } else {
          throw new Error(
            `FlareSolverr failed: ${
              flaresolverrResponse.data?.message || "Unknown error"
            }`
          );
        }
      } else if (feedConfig.advanced) {
        // Advanced scraping with Playwright
        const browser = await chromium.launch(
          getChromiumLaunchOptions({
            headless: true,
            timeout: 60000, // 1 minute timeout
          })
        );
        const userAgent = getRandomUserAgent();
        const context = await browser.newContext({ userAgent });
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
        });
        const page = await context.newPage();

        if (feedConfig.headers && Object.keys(feedConfig.headers).length) {
          await page.setExtraHTTPHeaders(
            resolveProtectedValues(feedConfig.headers, { encryptionKey: encKey }),
          );
        }

        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          const domain = new URL(feedConfig.config.baseUrl).hostname;
          // Playwright expects cookies in a specific format
          const playwrightCookies = feedConfig.cookies.map((c) => ({
            name: c.name,
            value: resolveProtectedValues(c.value, { encryptionKey: encKey }),
            domain: domain,
            path: "/", // Common default path
            // Potentially add other fields like expires, httpOnly, secure if available in your cookie object
          }));
          if (playwrightCookies.length)
            await page.context().addCookies(playwrightCookies);
        }

        try {
          await page.goto(feedConfig.config.baseUrl, {
            waitUntil: "networkidle",
            timeout: 10000, // 10 second timeout for networkidle
          });
        } catch (_error) {
          // If networkidle times out, page is likely already loaded
          console.log(
            `[Feed ${feedConfig.feedId}] Networkidle timeout, using current page state`
          );
        }
        const html = await page.content();
        await browser.close();
        const playwrightResult = await buildFeedObject(html, feedConfig, dateIndex);
        lastFeedObject = playwrightResult.feed;
        lastBuildResult = { xml: playwrightResult.feed.rss2(), metrics: playwrightResult.metrics };
      } else {
        // Standard web scraping with Axios
        const resolvedHeaders = resolveProtectedValues(
          feedConfig.headers ?? {},
          { encryptionKey: encKey },
        );
        const response = await fetchWebScrapingHtml({
          feedConfig: feedConfig as any,
          policyOptions: effectivePolicyOptions,
          encryptionKey: encKey,
          headers: resolvedHeaders,
          cookieString,
        });
        httpStatus = response.status;
        const html = response.html;
        const standardResult = await buildFeedObject(html, feedConfig, dateIndex);
        lastFeedObject = standardResult.feed;
        lastBuildResult = { xml: standardResult.feed.rss2(), metrics: standardResult.metrics };
      }
    } else if (feedConfig.feedType === "api" || feedConfig.feedType === "rest") {
      const method = String(feedConfig.config.method || "GET").toUpperCase();
      const url = (feedConfig.config.baseUrl || "").trim() + (feedConfig.config.route || "").trim();

      const headers = resolveProtectedValues(
        {
          Accept: "application/json",
          ...(feedConfig.headers || {}),
          ...(feedConfig.config.apiSpecificHeaders || {}),
        },
        { encryptionKey: encKey },
      );

      const axiosConfig: AxiosRequestConfig = {
        method,
        url,
        headers,
        params: resolveProtectedValues(feedConfig.config.params || {}, { encryptionKey: encKey }),
        responseType: "json",
        validateStatus: (s) => s >= 200 && s < 400,
      };

      if (
        cookieString &&
        !axiosConfig.headers.Cookie &&
        !axiosConfig.headers.cookie &&
        !axiosConfig.headers.Authorization
      ) {
        axiosConfig.headers.Cookie = cookieString;
      }

      const body = feedConfig.config.apiSpecificBody || {};
      const hasBody =
        method !== "GET" &&
        method !== "HEAD" &&
        body &&
        typeof body === "object" &&
        Object.keys(body).length > 0;

      if (hasBody) axiosConfig.data = body;

      axiosConfig.timeout = 60000;
      axiosConfig.maxRedirects = 0;

      let response: import("axios").AxiosResponse;
      // For non-GET/HEAD requests we don't auto-follow; only GET redirects are safe to re-issue.
      // Wrap in redirect loop same as GET path for consistency.
      let currentApiUrl = url;
      for (let hop = 0; hop <= 5; hop++) {
        axiosConfig.url = currentApiUrl;
        const r = await axios(axiosConfig);
        if (!REDIRECT_STATUSES.has(r.status)) {
          response = r;
          break;
        }
        const location = r.headers["location"];
        if (!location) throw new Error(`Redirect from "${currentApiUrl}" had no Location header.`);
        const nextUrl = new URL(location, currentApiUrl).toString();
        await assertOutboundFetchAllowed(nextUrl, effectivePolicyOptions);
        currentApiUrl = nextUrl;
        if (hop === 5) throw new Error(`Too many redirects (>5) following "${url}".`);
      }
      httpStatus = response!.status;
      const apiData = response!.data;
      const apiResult = buildFeedObjectFromApiData(apiData, feedConfig, dateIndex);
      lastFeedObject = apiResult.feed;
      lastBuildResult = { xml: apiResult.feed.rss2(), metrics: apiResult.metrics };
    }

    if (lastFeedObject) {
      // 1. Write all three formats
      const outputUrls = await writeAllFeedFormats(feedConfig.feedId, lastFeedObject);

      // 2. Store format-agnostic snapshot
      const snapshots = extractFeedItemSnapshots(lastFeedObject);
      await storeFeedHistory(
        feedConfig.feedId,
        JSON.stringify(snapshots),
        "items_json",
      );

      // 3. Update item hash index
      try {
        await saveDateIndex(feedConfig.feedId, dateIndex);
      } catch (indexErr) {
        console.error("[Feed %s] Failed to persist date index:", feedConfig.feedId, indexErr);
      }

      // 4. Webhook delivery — only if configured
      if (feedConfig.webhook?.enabled && feedConfig.webhook?.url) {
        try {
          const {
            sendWebhook,
            createWebhookPayload,
            createJsonWebhookPayload,
          } = await import("../utilities/webhook.utility");

          const newItemHashes = new Set(
            [...dateIndex.keys()].filter((k) => !knownHashes.has(k)),
          );

          const shouldDeliver = !feedConfig.webhook.newItemsOnly || newItemHashes.size > 0;

          if (shouldDeliver) {
            const outputs = serializeAllFeedFormats(lastFeedObject);
            const payload =
              feedConfig.webhook.format === "json"
                ? createJsonWebhookPayload(feedConfig, outputs.rss2, "automatic")
                : createWebhookPayload(feedConfig, outputs.rss2, "automatic");

            const success = await sendWebhook(feedConfig.webhook, payload);
            if (success) {
              lastWebhookStatus = "success";
              console.log(`Webhook sent for feed ${feedConfig.feedId} (${newItemHashes.size} new items)`);
            } else {
              lastWebhookStatus = "failed";
              lastWebhookError = "Webhook send returned false";
              console.warn(`Webhook failed for feed ${feedConfig.feedId}`);
            }
          } else {
            lastWebhookStatus = "skipped";
          }
        } catch (webhookError) {
          lastWebhookStatus = "failed";
          lastWebhookError = webhookError.message;
          console.error("[Feed %s] Webhook error:", feedConfig.feedId, webhookError);
        }
      } else {
        lastWebhookStatus = "skipped";
      }

      self.postMessage({
        status: "done",
        feedId: feedConfig.feedId,
        metrics: {
          startedAt,
          durationMs: Date.now() - startedAt,
          httpStatus,
          timedOut,
          itemCount: lastBuildResult?.metrics.itemCount ?? null,
          selectorMatches: lastBuildResult?.metrics.selectorMatches ?? null,
          dateFallbacks: lastBuildResult?.metrics.dateFallbacks ?? 0,
          duplicateGuids: lastBuildResult?.metrics.duplicateGuids ?? 0,
          webhookStatus: lastWebhookStatus,
          webhookError: lastWebhookError,
          errorMessage: null,
        },
      });
    } else {
      self.postMessage({
        status: "error",
        feedId: feedConfig.feedId,
        error: "RSS XML could not be generated.",
      });
    }
  } catch (error) {
    if (
      error.code === "ECONNABORTED" ||
      error.message?.toLowerCase().includes("timeout") ||
      error.message?.toLowerCase().includes("timed out")
    ) {
      timedOut = true;
    }

    console.error(
      "Error fetching/processing data for feedId %s:",
      feedConfig.feedId,
      error.message,
      error.stack
    );
    self.postMessage({
      status: "error",
      feedId: feedConfig.feedId,
      metrics: {
        startedAt,
        durationMs: Date.now() - startedAt,
        httpStatus,
        timedOut,
        itemCount: null,
        selectorMatches: null,
        dateFallbacks: 0,
        duplicateGuids: 0,
        webhookStatus: null,
        webhookError: null,
        errorMessage: error.message,
      },
    });
  }
}

self.onmessage = (message) => {
  if (message.data.command === "start") {
    console.log(
      `Worker received start command for feedId: ${message.data.config.feedId}`
    );
    fetchDataAndUpdateFeed(message.data.config);
  }
};
