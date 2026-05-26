/**
 * Preview Generator Utility
 *
 * Encapsulates preview feed generation: browser-based (Playwright),
 * FlareSolverr, standard axios, and API feed type handling.
 */

import axios from "axios";
import { chromium } from "patchright";
import { getChromiumLaunchOptions } from "./chrome-extensions.utility";
import { getRandomUserAgent } from "./user-agents.utility";
import { buildFeedObject, buildFeedObjectFromApiData } from "./rss-builder.utility";
import {
  assertOutboundFetchAllowed,
  getGlobalFetchPolicyOptions,
  mergeFeedPolicyOptions,
} from "./outbound-fetch-policy.utility";
import { normalizeUrl, axiosGetWithPolicyRedirects } from "./feed-config-route-adapter.utility";
import { runFeedTransformer } from "./feed-transformer.utility";
import { fetchWebScrapingHtml } from "./web-scraping-fetcher.utility";
import { buildFeedFromNormalizedItems } from "./normalized-feed-builder.utility";
import { fetchAndBuildSitemapItems } from "./sitemap.utility";
import { fetchAndBuildCalendarItems } from "./calendar-feed.utility";
import { executeGraphQLFeed, buildGraphQLItems } from "./graphql-feed.utility";
import { readWebhookEvents, buildWebhookItems } from "./webhook-feed.utility";
import { scanFilesystemFeed } from "./filesystem-feed.utility";
import { runServiceConnector } from "./service-connector-runner.utility";

const REDIRECT_STATUSES_IDX = new Set([301, 302, 303, 307, 308]);

// ---------------------------------------------------------------------------
// generatePreview
// ---------------------------------------------------------------------------

export async function generatePreview(feedConfig: any): Promise<import("feed").Feed> {
  try {
    let previewFeed: import("feed").Feed | undefined;

    // SSRF protection: validate the target URL before any fetch.
    const previewPolicyOptions = mergeFeedPolicyOptions(
      getGlobalFetchPolicyOptions(),
      feedConfig,
    );
    const previewUrl =
      feedConfig.feedType === "webScraping" ||
      feedConfig.feedType === "api" ||
      feedConfig.feedType === "rest"
        ? ((feedConfig.config?.baseUrl || "") + (feedConfig.config?.route || "")).trim()
        : feedConfig.feedType === "sitemap" ? feedConfig.sitemap?.url
        : feedConfig.feedType === "calendar" ? feedConfig.calendar?.url
        : feedConfig.feedType === "graphql" ? feedConfig.graphql?.endpoint
        : feedConfig.feedType === "serviceConnector" ? feedConfig.serviceConnector?.connection?.settings?.serverUrl
        : null;
    if (previewUrl) {
      await assertOutboundFetchAllowed(previewUrl, previewPolicyOptions);
    }

    if (feedConfig.feedType === "webScraping") {
      console.log(
        `[Preview] Advanced mode check: ${feedConfig.advanced} (raw: ${feedConfig._debug_advanced_raw})`,
      );

      if (feedConfig.flaresolverr?.enabled) {
        // FlareSolverr scraping
        console.log("[Preview] Using FlareSolverr");
        const flaresolverrUrl = normalizeUrl(
          feedConfig.flaresolverr.serverUrl || "http://localhost:8191",
        );
        const timeout = feedConfig.flaresolverr.timeout || 60000;

        await assertOutboundFetchAllowed(`${flaresolverrUrl}/v1`, previewPolicyOptions);

        const flaresolverrPayload: any = {
          cmd: "request.get",
          url: feedConfig.config.baseUrl,
          maxTimeout: timeout,
        };

        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          flaresolverrPayload.cookies = feedConfig.cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
          }));
        }

        const flaresolverrResponse = await axios.post(
          `${flaresolverrUrl}/v1`,
          flaresolverrPayload,
          {
            headers: { "Content-Type": "application/json" },
            timeout: timeout + 5000,
          },
        );

        if (
          flaresolverrResponse.data?.solution?.response &&
          flaresolverrResponse.data?.solution?.status === 200
        ) {
          const html = flaresolverrResponse.data.solution.response;
          previewFeed = (await buildFeedObject(html, feedConfig)).feed;
        } else {
          throw new Error(
            `FlareSolverr failed: ${flaresolverrResponse.data?.message || "Unknown error"}`,
          );
        }
      } else if (feedConfig.advanced) {
        // Playwright-based scraping
        console.log("[Preview] Launching browser...");
        const browser = await chromium.launch(
          getChromiumLaunchOptions({
            headless: true,
            timeout: 60000,
          }),
        );
        console.log("[Preview] Browser launched, creating context...");
        const userAgent = getRandomUserAgent();
        const context = await browser.newContext({ userAgent });
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
        });
        const page = await context.newPage();
        console.log(
          `[Preview] Using user agent: ${userAgent.substring(0, 50)}...`,
        );

        if (feedConfig.headers && Object.keys(feedConfig.headers).length) {
          await page.setExtraHTTPHeaders(feedConfig.headers);
        }

        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          const domain = new URL(feedConfig.config.baseUrl).hostname;
          const playwrightCookies = feedConfig.cookies.map((c: any) => ({
            ...c,
            domain,
            path: "/",
          }));
          if (playwrightCookies.length)
            await page.context().addCookies(playwrightCookies);
        }

        console.log(`[Preview] Navigating to ${feedConfig.config.baseUrl}...`);
        try {
          await page.goto(feedConfig.config.baseUrl, {
            waitUntil: "networkidle",
            timeout: 10000,
          });
          console.log("[Preview] Page loaded (networkidle)");
        } catch (_error) {
          console.log("[Preview] Networkidle timeout, using current page state");
        }
        console.log("[Preview] Extracting content...");
        const html = await page.content();
        await browser.close();
        console.log("[Preview] Browser closed, building feed...");
        previewFeed = (await buildFeedObject(html, feedConfig)).feed;
      } else {
        // Standard axios (redirect-aware, SSRF-safe)
        console.log("[Preview] Using standard (non-advanced) scraping");
        const cookieString = (feedConfig.cookies || [])
          .map((c: any) => `${c.name}=${c.value}`)
          .join("; ");
        const response = await fetchWebScrapingHtml({
          feedConfig,
          policyOptions: previewPolicyOptions,
          headers: feedConfig.headers || {},
          cookieString,
        });
        console.log("[Preview] Page fetched, building feed...");
        const html = response.html;
        previewFeed = (await buildFeedObject(html, feedConfig)).feed;
        console.log("[Preview] Feed build complete");
      }
    } else if (feedConfig.feedType === "feedTransformer") {
      previewFeed = (await runFeedTransformer(feedConfig, { policyOptions: previewPolicyOptions })).feed;
    } else if (feedConfig.feedType === "sitemap") {
      previewFeed = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items: await fetchAndBuildSitemapItems(feedConfig.sitemap) });
    } else if (feedConfig.feedType === "calendar") {
      previewFeed = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items: await fetchAndBuildCalendarItems(feedConfig.calendar) });
    } else if (feedConfig.feedType === "graphql") {
      const result = await executeGraphQLFeed({ ...feedConfig.graphql, headers: feedConfig.graphql.headers ?? {} });
      previewFeed = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items: buildGraphQLItems(result.data, feedConfig.graphql) });
    } else if (feedConfig.feedType === "webhook") {
      previewFeed = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items: buildWebhookItems(await readWebhookEvents(feedConfig.feedId), feedConfig.webhookFeed) });
    } else if (feedConfig.feedType === "filesystem") {
      const result = await scanFilesystemFeed(feedConfig.filesystem, process.env.FILESYSTEM_FEEDS_ROOT ?? process.cwd(), feedConfig.feedId);
      previewFeed = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items: result.items });
    } else if (feedConfig.feedType === "serviceConnector") {
      const result = await runServiceConnector(feedConfig.serviceConnector, process.env.ENCRYPTION_KEY ?? "", null);
      previewFeed = buildFeedFromNormalizedItems({ feedId: feedConfig.feedId, feedName: feedConfig.feedName, items: result.items });
    } else if (feedConfig.feedType === "api" || feedConfig.feedType === "rest") {
      const method = String(feedConfig.config.method || "GET").toUpperCase();
      const url =
        (feedConfig.config.baseUrl || "").trim() +
        (feedConfig.config.route || "").trim();

      const headers = {
        Accept: "application/json",
        ...(feedConfig.headers || {}),
        ...(feedConfig.config.apiSpecificHeaders || {}),
      };

      const axiosConfig: any = {
        method,
        url,
        headers,
        params: feedConfig.config.params || {},
        responseType: "json",
        validateStatus: (s: number) => s >= 200 && s < 400,
      };

      const cookieString = (feedConfig.cookies || [])
        .map((c: any) => `${c.name}=${c.value}`)
        .join("; ");

      if (
        cookieString &&
        !axiosConfig.headers.Authorization &&
        !axiosConfig.headers.cookie
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

      console.log("Preview Axios Config:", axiosConfig);

      // NOTE: The redirect-following loop below duplicates what axiosGetWithPolicyRedirects
      // does for the webScraping path. The API/REST path can't use that helper directly
      // because it needs to support non-GET methods with a request body (axiosConfig.data).
      // If axiosGetWithPolicyRedirects is ever extended to support POST/PUT with body,
      // this inline loop should be replaced.
      let previewApiResponse: import("axios").AxiosResponse | undefined;
      let currentPreviewUrl = url;
      for (let hop = 0; hop <= 5; hop++) {
        axiosConfig.url = currentPreviewUrl;
        const r = await axios(axiosConfig);
        if (!REDIRECT_STATUSES_IDX.has(r.status)) {
          previewApiResponse = r;
          break;
        }
        const location = r.headers["location"];
        if (!location)
          throw new Error(
            `Redirect from "${currentPreviewUrl}" had no Location header.`,
          );
        const nextUrl = new URL(location, currentPreviewUrl).toString();
        await assertOutboundFetchAllowed(nextUrl, previewPolicyOptions);
        currentPreviewUrl = nextUrl;
        if (hop === 5)
          throw new Error(`Too many redirects (>5) following "${url}".`);
      }
      const apiData = previewApiResponse!.data;
      previewFeed = buildFeedObjectFromApiData(apiData, feedConfig).feed;
    }

    if (!previewFeed) {
      throw new Error("Feed could not be generated for preview.");
    }
    return previewFeed;
  } catch (error: any) {
    console.error(
      `Error fetching/processing data for preview feedId ${feedConfig.feedId}:`,
      error.message,
    );
    throw error;
  }
}
