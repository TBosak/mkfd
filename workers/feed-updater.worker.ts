import { writeFile } from "fs/promises"
import axios, { AxiosRequestConfig } from "axios"
import { buildRSS, buildRSSFromApiData } from "../utilities/rss-builder.utility"
import { join } from "path"
import puppeteer from "puppeteer"
import { parseCookiesForPuppeteer } from "../utilities/data-handler.utility"

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
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      })
      const page = await browser.newPage()

      if (feedConfig.config.headers && Object.keys(feedConfig.config.headers).length > 0) {
        await page.setExtraHTTPHeaders(feedConfig.config.headers)
      }

      if (feedConfig.config.cookieString) {
        const domain = new URL(feedConfig.config.baseUrl).hostname
        const cookiesArray = parseCookiesForPuppeteer(feedConfig.config.cookieString, domain)
        if (cookiesArray.length > 0) {
          await browser.setCookie(...cookiesArray)
        }
      }

      await page.goto(feedConfig.config.baseUrl, { waitUntil: "networkidle2" })
      const html = await page.content()
      await browser.close()
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
