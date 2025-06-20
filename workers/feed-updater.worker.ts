import { writeFile } from "fs/promises"
import axios, { AxiosRequestConfig } from "axios"
import { buildRSS, buildRSSFromApiData } from "../utilities/rss-builder.utility"
import { join } from "path"
// parseCookiesForPlaywright might be simplified or removed if cookies are directly structured correctly
// import { parseCookiesForPlaywright } from "../utilities/data-handler.utility"
import { chromium } from "patchright";

declare var self: Worker
const rssDir = "./public/feeds"

async function fetchDataAndUpdateFeed(feedConfig: any) {
  try {
    let rssXml: string | undefined

    // Common: Convert cookie array to string for Axios, or format for Playwright
    const cookieString = (feedConfig.cookies || []).map(c => `${c.name}=${c.value}`).join('; ');

    if (feedConfig.feedType === "webScraping") {
      if (feedConfig.advanced) { // Advanced scraping with Playwright
        const context = await chromium.launch({
          channel: "chrome",
          headless: true,
        });
        const page = await context.newPage();

        if (feedConfig.headers && Object.keys(feedConfig.headers).length) {
          await page.setExtraHTTPHeaders(feedConfig.headers); // Use general headers
        }

        if (feedConfig.cookies && feedConfig.cookies.length > 0) {
          const domain = new URL(feedConfig.config.baseUrl).hostname;
          // Playwright expects cookies in a specific format
          const playwrightCookies = feedConfig.cookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: domain,
            path: '/', // Common default path
            // Potentially add other fields like expires, httpOnly, secure if available in your cookie object
          }));
          if (playwrightCookies.length) await page.context().addCookies(playwrightCookies);
        }

        await page.goto(feedConfig.config.baseUrl, { waitUntil: "networkidle" });
        const html = await page.content();
        await context.close();
        rssXml = await buildRSS(html, feedConfig); // feedConfig now has all RSS options

      } else { // Standard web scraping with Axios
        const response = await axios.get(feedConfig.config.baseUrl, {
          headers: {
            ...(feedConfig.headers || {}), // Use general headers
            ...(cookieString && { Cookie: cookieString }) // Add cookie string if cookies exist
          },
          maxContentLength: 2 * 1024 * 1024, // 2MB
          maxBodyLength: 2 * 1024 * 1024,    // 2MB
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
      if (cookieString && !axiosConfig.headers.Cookie && !axiosConfig.headers.cookie && !axiosConfig.headers.Authorization) {
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
      self.postMessage({ status: "done", feedId: feedConfig.feedId });
    } else {
      self.postMessage({ status: "error", feedId: feedConfig.feedId, error: "RSS XML could not be generated." });
    }

  } catch (error) {
    console.error(`Error fetching/processing data for feedId ${feedConfig.feedId}:`, error.message, error.stack);
    self.postMessage({ status: "error", feedId: feedConfig.feedId, error: error.message });
  }
}

self.onmessage = (message) => {
  if (message.data.command === "start") {
    console.log(`Worker received start command for feedId: ${message.data.config.feedId}`);
    fetchDataAndUpdateFeed(message.data.config);
  }
};
