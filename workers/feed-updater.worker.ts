import { writeFile } from "fs/promises"
import axios, { AxiosRequestConfig } from "axios"
import { buildRSS, buildRSSFromApiData } from "../utilities/rss-builder.utility"
import { join } from "path"
import { parseCookiesForPlaywright } from "../utilities/data-handler.utility"
import { chromium } from "patchright";

declare var self: Worker
const rssDir = "./public/feeds"

async function fetchDataAndUpdateFeed(feedConfig: any) {
  try {
    let rssXml: string | undefined
    if (feedConfig.feedType === "webScraping" && !feedConfig.config.advanced) {
      const response = await axios.get(feedConfig.config.baseUrl, {
        headers: {
          ...(feedConfig.config.headers || {}),
          Cookie: feedConfig.config.cookieString || ""
        }
      });
      const html = response.data
      rssXml = await buildRSS(html, feedConfig)

    } else if (feedConfig.feedType === "webScraping" && feedConfig.config.advanced) {
      const context = await chromium.launch({
        channel: "chrome",
        headless: true,
      });
      const page = await context.newPage();

      if (feedConfig.config.headers && Object.keys(feedConfig.config.headers).length) {
        await page.setExtraHTTPHeaders(feedConfig.config.headers);
      }

      if (feedConfig.config.cookieString) {
        const domain = new URL(feedConfig.config.baseUrl).hostname;
        const cookiesArray = parseCookiesForPlaywright(feedConfig.config.cookieString, domain);
        if (cookiesArray.length) await page.context().addCookies(cookiesArray);
      }

      await page.goto(feedConfig.config.baseUrl, { waitUntil: "networkidle" });
      const html = await page.content();
      await context.close();
      rssXml = await buildRSS(html, feedConfig)

    } else if (feedConfig.feedType === "api") {
      const axiosConfig: AxiosRequestConfig = {
        method: feedConfig.config.method || "GET",
        url: feedConfig.config.baseUrl + (feedConfig.config.route || ""),
        headers: {
          ...feedConfig.config.headers,
          Cookie: feedConfig.config.cookieString || ""
        },
        params: feedConfig.config.params || {},
        data: feedConfig.config.body || {},
        withCredentials: feedConfig.config.withCredentials || false
      }
      const response = await axios(axiosConfig)
      const apiData = response.data
      rssXml = buildRSSFromApiData(apiData, feedConfig)

    }

    if (rssXml) {
      const rssFilePath = join(rssDir, `${feedConfig.feedId}.xml`)
      await writeFile(rssFilePath, rssXml, "utf8")
    }

  } catch (error) {
    console.error(`Error fetching data for feedId ${feedConfig.feedId}:`, error.message)
  }
}

self.onmessage = (message) => {
  if (message.data.command === "start") {
    fetchDataAndUpdateFeed(message.data.config)
  }
}
