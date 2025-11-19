import { writeFile } from "fs/promises";
import axios, { AxiosRequestConfig } from "axios";
import {
  buildRSS,
  buildRSSFromApiData,
} from "../utilities/rss-builder.utility";
import { join } from "path";
// parseCookiesForPlaywright might be simplified or removed if cookies are directly structured correctly
// import { parseCookiesForPlaywright } from "../utilities/data-handler.utility"
import { chromium } from "patchright";
import { getChromiumLaunchOptions } from "../utilities/chrome-extensions.utility";
import { getRandomUserAgent } from "../utilities/user-agents.utility";

declare var self: Worker;
const rssDir = "./public/feeds";

async function fetchDataAndUpdateFeed(feedConfig: any) {
  try {
    let rssXml: string | undefined;

    // Common: Convert cookie array to string for Axios, or format for Playwright
    const cookieString = (feedConfig.cookies || [])
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    if (feedConfig.feedType === "webScraping") {
      if (feedConfig.advanced) {
        // Advanced scraping with Playwright
        const browser = await chromium.launch(
          getChromiumLaunchOptions({
            headless: true,
            timeout: 60000, // 1 minute timeout
          }),
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
        } catch (error) {
          // If networkidle times out, page is likely already loaded
          console.log(
            `[Feed ${feedConfig.feedId}] Networkidle timeout, using current page state`,
          );
        }
        const html = await page.content();
        await browser.close();
        rssXml = await buildRSS(html, feedConfig); // feedConfig now has all RSS options
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
        const html = response.data;
        rssXml = await buildRSS(html, feedConfig); // feedConfig now has all RSS options
      }
    } else if (feedConfig.feedType === "api") {
      const axiosConfig: AxiosRequestConfig = {
        method: feedConfig.config.method || "GET",
        url: feedConfig.config.baseUrl + (feedConfig.config.route || ""),
        // Prioritize API-specific headers, then general headers
        headers: {
          ...(feedConfig.headers || {}), // General headers first
          ...(feedConfig.config.apiSpecificHeaders || {}), // API specific headers override general if conflicts
        },
        params: feedConfig.config.params || {},
        data: feedConfig.config.apiSpecificBody || {}, // Use API specific body
      };

      // Add cookies if not already set by apiSpecificHeaders
      if (
        cookieString &&
        !axiosConfig.headers.Cookie &&
        !axiosConfig.headers.cookie &&
        !axiosConfig.headers.Authorization
      ) {
        axiosConfig.headers.Cookie = cookieString;
      }

      console.log("Worker Axios Config:", axiosConfig); // For debugging
      const response = await axios(axiosConfig);
      const apiData = response.data;
      rssXml = buildRSSFromApiData(apiData, feedConfig); // feedConfig has apiMapping and RSS options
    }

    if (rssXml) {
      const rssFilePath = join(rssDir, `${feedConfig.feedId}.xml`);
      await writeFile(rssFilePath, rssXml, "utf8");

      // Handle webhook if configured
      if (feedConfig.webhook?.enabled && feedConfig.webhook?.url) {
        try {
          const {
            sendWebhook,
            createWebhookPayload,
            createJsonWebhookPayload,
            getNewItemsFromRSS,
          } = await import("../utilities/webhook.utility");
          const { getPreviousFeedHistory, storeFeedHistory } = await import(
            "../utilities/feed-history.utility"
          );

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
                    "automatic",
                  )
                : createWebhookPayload(feedConfig, webhookRssXml, "automatic");

            // Send webhook
            const success = await sendWebhook(feedConfig.webhook, payload);

            if (success) {
              console.log(
                `Webhook sent successfully for feed ${feedConfig.feedId}`,
              );
            } else {
              console.warn(`Webhook failed for feed ${feedConfig.feedId}`);
            }
          }

          // Store current RSS for future comparison
          await storeFeedHistory(feedConfig.feedId, rssXml);
        } catch (webhookError) {
          console.error(
            `Webhook error for feed ${feedConfig.feedId}:`,
            webhookError.message,
          );
          // Don't fail the entire feed update if webhook fails
        }
      }

      self.postMessage({ status: "done", feedId: feedConfig.feedId });
    } else {
      self.postMessage({
        status: "error",
        feedId: feedConfig.feedId,
        error: "RSS XML could not be generated.",
      });
    }
  } catch (error) {
    console.error(
      "Error fetching/processing data for feedId %s:",
      feedConfig.feedId,
      error.message,
      error.stack,
    );
    self.postMessage({
      status: "error",
      feedId: feedConfig.feedId,
      error: error.message,
    });
  }
}

self.onmessage = (message) => {
  if (message.data.command === "start") {
    console.log(
      `Worker received start command for feedId: ${message.data.config.feedId}`,
    );
    fetchDataAndUpdateFeed(message.data.config);
  }
};
