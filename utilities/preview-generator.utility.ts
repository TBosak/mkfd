/**
 * Preview Generator Utility
 *
 * Encapsulates preview feed generation: browser-based (Playwright),
 * FlareSolverr, standard axios, and API feed type handling.
 */

import axios from "axios";
import { chromium } from "patchright";
import { redact } from "./log-redaction.utility";
import { solveWithFlareSolverr } from "../lib/outbound/flaresolverr-adapter";
import { resolveFetchPolicy } from "./fetch-policy.utility";
import { getFeedSourceDefinition } from "./feed-source-registry.utility";
import { getChromiumLaunchOptions } from "./chrome-extensions.utility";
import { getRandomUserAgent } from "./user-agents.utility";
import { buildFeedObject, buildFeedObjectFromApiData } from "./rss-builder.utility";
import {
  assertOutboundFetchAllowed,
  getGlobalFetchPolicyOptions,
  mergeFeedPolicyOptions,
} from "./outbound-fetch-policy.utility";
import {
  normalizeUrl,
  axiosGetWithPolicyRedirects,
  requestWithPolicyRedirects,
} from "./feed-config-route-adapter.utility";
import { runFeedTransformer } from "./feed-transformer.utility";
import { fetchWebScrapingHtml } from "./web-scraping-fetcher.utility";
import { buildFeedFromNormalizedItems } from "./normalized-feed-builder.utility";
import { fetchAndBuildSitemapItems } from "./sitemap.utility";
import { fetchAndBuildCalendarItems } from "./calendar-feed.utility";
import { executeGraphQLFeed, buildGraphQLItems } from "./graphql-feed.utility";
import { readWebhookEvents, buildWebhookItems } from "./webhook-feed.utility";
import { scanFilesystemFeed } from "./filesystem-feed.utility";
import { runServiceConnector } from "./service-connector-runner.utility";

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
        // Routed through the one approved FlareSolverr adapter, which validates
        // the endpoint and the target separately and bounds the whole call.
        const solved = await solveWithFlareSolverr({
          serverUrl: flaresolverrUrl,
          targetUrl: feedConfig.config.baseUrl,
          maxTimeoutMs: feedConfig.flaresolverr.timeout || 60000,
          cookies: (feedConfig.cookies ?? []).map((c: { name: string; value: string }) => ({
            name: c.name,
            value: c.value,
          })),
          policyOptions: previewPolicyOptions,
          budgetMs: resolveFetchPolicy(feedConfig).feedRunTimeoutMs,
        });
        previewFeed = (await buildFeedObject(solved.html, feedConfig)).feed;
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

      // Redacted: preview resolves protected values before building this
      // request, so axiosConfig.headers carries live Authorization values and
      // any configured proxy carries its credentials.
      console.log("Preview Axios Config:", redact(axiosConfig));

      // This used to be an inline redirect loop, kept only because the shared
      // helper was GET-only — its own comment said to replace it once a
      // method-aware form existed. That form is requestWithPolicyRedirects,
      // so the duplicate is gone: the initial URL is now validated too, which
      // the inline loop never did.
      const previewApiResponse = await requestWithPolicyRedirects(
        url,
        axiosConfig,
        previewPolicyOptions,
      );
      const apiData = previewApiResponse.data;
      previewFeed = buildFeedObjectFromApiData(apiData, feedConfig).feed;
    }

    if (!previewFeed) {
      // The registry is consulted before giving up, so a type registered
      // through registerFeedSourceType routes here without any branch above
      // being edited. That is what makes "adding a source type touches one
      // place" true rather than aspirational.
      const definition = getFeedSourceDefinition(feedConfig.feedType);
      if (definition?.executePreview) {
        previewFeed = await definition.executePreview(feedConfig);
      }
    }

    if (!previewFeed) {
      const definition = getFeedSourceDefinition(feedConfig.feedType);
      if (!definition) {
        throw new Error(
          `Preview refused: unknown feed source type "${feedConfig.feedType}". ` +
            "It is not declared in the source-definition registry.",
        );
      }
      if (!definition.previewSupported) {
        throw new Error(
          `Preview is not supported for feed source type "${feedConfig.feedType}".`,
        );
      }
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
