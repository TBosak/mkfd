import { writeFile } from "node:fs/promises";
import axios, { type AxiosRequestConfig } from "axios";
import {
  buildRSS,
  buildRSSFromApiData,
} from "../utilities/rss-builder.utility";
import { join } from "node:path";
// parseCookiesForPlaywright might be simplified or removed if cookies are directly structured correctly
// import { parseCookiesForPlaywright } from "../utilities/data-handler.utility"
import { chromium } from "patchright";
import { getChromiumLaunchOptions } from "../utilities/chrome-extensions.utility";
import { getRandomUserAgent } from "../utilities/user-agents.utility";
import { loadDateIndex, saveDateIndex, getPreviousFeedHistory, storeFeedHistory } from "../utilities/feed-history.utility";

declare var self: Worker;
const rssDir = "./public/feeds";

async function fetchDataAndUpdateFeed(feedConfig: any) {
  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let timedOut = false;
  let lastBuildResult: import("../utilities/rss-builder.utility").BuildRSSResult | null = null;
  let lastWebhookStatus: "success" | "failed" | "skipped" | null = null;
  let lastWebhookError: string | null = null;

  try {
    let rssXml: string | undefined;
    const dateIndex = await loadDateIndex(feedConfig.feedId);

    // Common: Convert cookie array to string for Axios, or format for Playwright
    const cookieString = (feedConfig.cookies || [])
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    if (feedConfig.feedType === "webScraping") {
      if (feedConfig.flaresolverr?.enabled) {
        // FlareSolverr scraping
        const flaresolverrUrl =
          feedConfig.flaresolverr.serverUrl || "http://localhost:8191";
        const timeout = feedConfig.flaresolverr.timeout || 60000;

        const flaresolverrPayload: any = {
          cmd: "request.get",
          url: feedConfig.config.baseUrl,
          maxTimeout: timeout,
        };

        // Add cookies if present
        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          flaresolverrPayload.cookies = feedConfig.cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
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
          lastBuildResult = await buildRSS(html, feedConfig, dateIndex);
          rssXml = lastBuildResult.xml;
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
          await page.setExtraHTTPHeaders(feedConfig.headers); // Use general headers
        }

        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          const domain = new URL(feedConfig.config.baseUrl).hostname;
          // Playwright expects cookies in a specific format
          const playwrightCookies = feedConfig.cookies.map((c) => ({
            name: c.name,
            value: c.value,
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
        lastBuildResult = await buildRSS(html, feedConfig, dateIndex);
        rssXml = lastBuildResult.xml;
      } else {
        // Standard web scraping with Axios
        const response = await axios.get(feedConfig.config.baseUrl, {
          headers: {
            ...(feedConfig.headers || {}), // Use general headers
            ...(cookieString && { Cookie: cookieString }), // Add cookie string if cookies exist
          },
          maxContentLength: 2 * 1024 * 1024, // 2MB
          maxBodyLength: 2 * 1024 * 1024, // 2MB
        });
        httpStatus = response.status;
        const html = response.data;
        lastBuildResult = await buildRSS(html, feedConfig, dateIndex);
        rssXml = lastBuildResult.xml;
      }
    } else if (feedConfig.feedType === "api") {
      const method = String(feedConfig.config.method || "GET").toUpperCase();
      const url = (feedConfig.config.baseUrl || "").trim() + (feedConfig.config.route || "").trim();

      const headers = {
        Accept: "application/json",
        ...(feedConfig.headers || {}),
        ...(feedConfig.config.apiSpecificHeaders || {}),
      };

      const axiosConfig: AxiosRequestConfig = {
        method,
        url,
        headers,
        params: feedConfig.config.params || {},
        responseType: "json",
        validateStatus: (s) => s >= 200 && s < 400,
      };

      const cookieString = (feedConfig.cookies || [])
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");

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

      console.log("Worker Axios Config:", axiosConfig);

      const response = await axios(axiosConfig);
      httpStatus = response.status;
      const apiData = response.data;
      lastBuildResult = buildRSSFromApiData(apiData, feedConfig, dateIndex);
      rssXml = lastBuildResult.xml;
    }

    if (rssXml) {
      const rssFilePath = join(rssDir, `${feedConfig.feedId}.xml`);
      await writeFile(rssFilePath, rssXml, "utf8");
      try {
        await saveDateIndex(feedConfig.feedId, dateIndex);
      } catch (indexErr) {
        console.error("[Feed %s] Failed to persist date index:", feedConfig.feedId, indexErr);
      }

      // Handle webhook if configured
      if (feedConfig.webhook?.enabled && feedConfig.webhook?.url) {
        try {
          const {
            sendWebhook,
            createWebhookPayload,
            createJsonWebhookPayload,
            getNewItemsFromRSS,
          } = await import("../utilities/webhook.utility");
          let shouldSendWebhook = true;
          let webhookRssXml = rssXml;

          // Check if only new items should be sent
          if (feedConfig.webhook.newItemsOnly) {
            const previousRss = await getPreviousFeedHistory(feedConfig.feedId);
            const newItemsRss = getNewItemsFromRSS(rssXml, previousRss);

            if (!newItemsRss) {
              shouldSendWebhook = false; // No new items
            } else {
              webhookRssXml = newItemsRss;
            }
          }

          if (shouldSendWebhook) {
            // Create webhook payload
            const payload =
              feedConfig.webhook.format === "json"
                ? createJsonWebhookPayload(
                    feedConfig,
                    webhookRssXml,
                    "automatic"
                  )
                : createWebhookPayload(feedConfig, webhookRssXml, "automatic");

            // Send webhook
            const success = await sendWebhook(feedConfig.webhook, payload);

            if (success) {
              lastWebhookStatus = "success";
              console.log(`Webhook sent successfully for feed ${feedConfig.feedId}`);
            } else {
              lastWebhookStatus = "failed";
              lastWebhookError = "Webhook send returned false";
              console.warn(`Webhook failed for feed ${feedConfig.feedId}`);
            }
          }

          // Store current RSS for future comparison
          await storeFeedHistory(feedConfig.feedId, rssXml);
        } catch (webhookError) {
          lastWebhookStatus = "failed";
          lastWebhookError = webhookError.message;
          console.error(
            "Webhook error for feed %s:",
            feedConfig.feedId,
            webhookError.message
          );
          // Don't fail the entire feed update if webhook fails
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
